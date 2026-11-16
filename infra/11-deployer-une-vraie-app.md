# Déployer une vraie app

Ce que tu vas apprendre : mettre en prod de bout en bout une API (TS ou Rust) avec Postgres sur un VPS : préparation du serveur, Docker Compose, Caddy, CI GitHub Actions, migrations au déploiement, backups, monitoring et rollback. Et la checklist à dérouler avant d'ouvrir aux utilisateurs.

## L'architecture cible

```text
GitHub ── push main ──> Actions : test, build, push GHCR
                              │ ssh deploy@vps ./deploy.sh sha-…
                              ▼
VPS Debian 13 (2 vCPU, 4 Go)
 ├─ Caddy :80/:443  (TLS auto, HTTP/3)
 ├─ api      (billing-api ou ingest)  127.0.0.1 only
 ├─ worker   (même image, autre commande)
 ├─ postgres 18     (volume, jamais exposé)
 └─ timers systemd : backup nocturne -> S3
Monitoring externe : uptime + dead man's switch backups
```

Pourquoi un VPS et pas Kubernetes : une seule machine à 10–20 €/mois tient sans problème des centaines de requêtes/s pour une API métier. On garde la complexité minimale, mais avec **les mêmes pratiques** qu'en grand : images immuables, déploiement automatisé, migrations contrôlées, backups testés, rollback en une commande.

On suit `billing-api` (Node). Les différences pour `ingest` (Rust) sont signalées.

## 1. Préparer le serveur

Création via Terraform (cf. [Terraform](/infra/09-terraform)) ou à la main, puis en root, une seule fois :

```bash
apt update && apt full-upgrade -y
apt install -y ufw unattended-upgrades fail2ban
dpkg-reconfigure -plow unattended-upgrades

adduser --disabled-password --gecos "" deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown deploy:deploy /home/deploy/.ssh/authorized_keys
```

SSH durci (garde ta session ouverte pendant le test !) :

```bash
cat > /etc/ssh/sshd_config.d/10-hardening.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin no
KbdInteractiveAuthentication no
EOF
sshd -t && systemctl reload ssh
```

Firewall :

```bash
ufw default deny incoming
ufw allow OpenSSH
ufw allow 80,443/tcp
ufw allow 443/udp
ufw enable
```

Docker (dépôt officiel, pas le paquet `docker.io` de Debian souvent en retard) puis la rotation des logs :

```bash
# installation : suivre docs.docker.com/engine/install/debian
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
EOF
systemctl restart docker
usermod -aG docker deploy
```

::: warning Le groupe docker = root
Être dans le groupe `docker` équivaut à être root sur la machine (on peut monter `/` dans un conteneur). C'est acceptable pour l'unique user de déploiement d'un VPS mono-app, mais sache-le, et protège sa clé SSH en conséquence.
:::

## 2. Le compose de prod

Dans `/opt/billing` (propriété de `deploy`) :

```yaml
# /opt/billing/compose.yaml
name: billing

x-app: &app
  image: ghcr.io/acme/billing-api:${API_TAG:?API_TAG manquant}
  env_file: /etc/billing/env
  restart: unless-stopped
  init: true
  read_only: true
  tmpfs: [/tmp]
  depends_on:
    postgres: { condition: service_healthy }
  networks: [back]

services:
  api:
    <<: *app
    ports: ["127.0.0.1:3000:3000"]

  worker:
    <<: *app
    command: ["node", "dist/worker.js"]
```

La base et le proxy :

```yaml
  postgres:
    image: postgres:18
    env_file: /etc/billing/pg.env
    volumes: [pgdata:/var/lib/postgresql]
    shm_size: 256mb
    restart: unless-stopped
    networks: [back]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U billing_owner -d billing"]
      interval: 5s
      retries: 10

  caddy:
    image: caddy:2
    network_mode: host
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    restart: unless-stopped

volumes: { pgdata: {}, caddy_data: {} }
networks: { back: {} }
```

Choix expliqués :

- `x-app` + ancre YAML `&app` : `api` et `worker` partagent image, env et durcissement.
- `${API_TAG:?…}` : impossible de démarrer sans dire **quelle** version.
- `init: true` : un mini-init relaie SIGTERM et ramasse les zombies.
- `read_only` + `tmpfs` : le conteneur ne peut rien écrire hors de `/tmp`.
- Postgres n'a **aucun** `ports` : il n'est joignable que sur le réseau `back`. Pour y accéder : tunnel SSH vers le conteneur, ou `docker compose exec postgres psql`.
- Caddy en `network_mode: host` : il écoute directement sur 80/443 de la machine et joint l'API sur `127.0.0.1:3000`. Le volume `caddy_data` garde les certificats (le perdre = redemander des certificats et risquer les limites Let's Encrypt).
- Secrets dans `/etc/billing/env` et `pg.env`, `chmod 600`, déchiffrés depuis SOPS (cf. [Sécurité & secrets](/infra/10-securite-et-secrets)).

Pour `ingest` (Rust) : image distroless sans shell, donc pas de `pg_isready` dedans (pas grave, c'est l'image Postgres qui l'exécute), et le healthcheck de l'API passe par Caddy ou une sous-commande `/ingest healthcheck`.

Le Caddyfile :

```text
api.exemple.fr {
	encode zstd gzip
	request_body {
		max_size 10MB
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		-Server
	}
	reverse_proxy 127.0.0.1:3000 {
		lb_try_duration 10s
		lb_try_interval 250ms
	}
}
```

`lb_try_duration` : pendant les quelques secondes où le conteneur `api` est recréé, Caddy **retente** au lieu de renvoyer des 502. Un déploiement Compose devient quasi transparent pour les clients.

## 3. Migrations au déploiement

Règle : les migrations tournent **une fois**, **avant** de démarrer la nouvelle version, et le déploiement s'arrête si elles échouent.

```bash
docker compose run --rm --no-deps api node dist/migrate.js
```

- `--no-deps` : la base tourne déjà, on ne relance rien d'autre.
- Elles s'exécutent avec un rôle qui a les droits DDL (`billing_owner`), l'app tourne avec `billing_app`. Concrètement : `MIGRATION_DATABASE_URL` dans l'env, utilisée par le seul script de migration.
- Pour `ingest` : une sous-commande `ingest migrate` qui appelle `sqlx::migrate!().run(&pool)`, ou le binaire `sqlx migrate run` dans un stage d'image dédié.

Toujours **compatibles en arrière** (expand/contract, cf. [Migrations & ORM en prod](/bdd/08-migrations-orm-en-prod)) : la version N-1 du code doit fonctionner sur le schéma N. C'est ce qui rend le rollback du code possible **sans** toucher à la base. Une migration destructive (`DROP COLUMN`) ne part qu'un déploiement **après** que plus aucun code ne lit la colonne.

Attention aux migrations qui verrouillent : un `ALTER TABLE … ADD COLUMN … DEFAULT now()` sur une grosse table, un `CREATE INDEX` sans `CONCURRENTLY`. Mets un `lock_timeout` (ex. `SET lock_timeout = '5s'`) dans tes migrations pour qu'elles échouent au lieu de bloquer toute l'API.

## 4. Le script de déploiement

```bash
#!/usr/bin/env bash
# /opt/billing/deploy.sh <tag>
set -euo pipefail
cd /opt/billing
NEW="$1"
PREV="$(cat .current_tag 2>/dev/null || echo none)"
export API_TAG="$NEW"

echo "deploy $PREV -> $NEW"
docker compose pull api worker
docker compose run --rm --no-deps api node dist/migrate.js
docker compose up -d --no-deps api worker

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/health > /dev/null; then
    echo "$NEW" > .current_tag
    echo "$PREV" > .previous_tag
    echo "OK $NEW"; exit 0
  fi
  sleep 2
done
```

Puis la branche d'échec, à la fin du même script :

```bash
echo "healthcheck KO, rollback vers $PREV" >&2
if [ "$PREV" != "none" ]; then
  API_TAG="$PREV" docker compose up -d --no-deps api worker
fi
exit 1
```

- `pull` **avant** les migrations : si l'image n'existe pas, on n'a rien touché.
- Si la migration échoue, `set -e` arrête tout : l'ancienne version tourne toujours.
- Si la nouvelle version ne passe pas le healthcheck en 60 s : retour automatique à l'image précédente (le schéma est compatible, cf. section 3).
- `.current_tag` sert au rollback manuel et à `docker compose` lancé à la main (`API_TAG=$(cat .current_tag) docker compose ps`).

Côté sécurité, la clé SSH de la CI est restreinte dans `~deploy/.ssh/authorized_keys` :

```text
command="/opt/billing/deploy.sh \"$SSH_ORIGINAL_COMMAND\"",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA… ci-deploy
```

La CI envoie seulement le tag (`ssh deploy@vps sha-3f2c…`) ; elle ne peut **rien** faire d'autre que lancer le script. (Valide le format du tag dans le script : `[[ "$1" =~ ^sha-[0-9a-f]{7,40}$ ]] || exit 2`.)

## 5. La CI GitHub Actions

Reprend le pipeline de [CI/CD GitHub Actions](/infra/05-ci-cd-github-actions) : `check` + `integration` (Postgres en service, migrations testées) → `image` (push GHCR, tag `sha-…`) → `deploy` :

```yaml
  deploy:
    needs: image
    runs-on: ubuntu-24.04
    environment:
      name: production
      url: https://api.exemple.fr
    concurrency: { group: deploy-prod, cancel-in-progress: false }
    steps:
      - name: Deploy
        env:
          SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          HOST_KEY: ${{ secrets.DEPLOY_HOST_KEY }}
        run: |
          install -m 700 -d ~/.ssh
          printf '%s\n' "$SSH_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          printf '%s\n' "$HOST_KEY" >> ~/.ssh/known_hosts
          ssh deploy@api.exemple.fr "sha-${GITHUB_SHA}"
      - name: Smoke test
        run: curl -fsS --retry 5 --retry-delay 3 https://api.exemple.fr/health
```

Le VPS doit pouvoir **pull** depuis GHCR : si le package est privé, `docker login ghcr.io` une fois sur le serveur avec un token **en lecture seule** (`read:packages`), stocké par Docker dans `~deploy/.docker/config.json`.

## 6. Backups

Un timer systemd plutôt que cron (logs dans le journal, `Persistent=true` rattrape un run manqué si le serveur était éteint) :

```ini
# /etc/systemd/system/billing-backup.service
[Unit]
Description=Backup Postgres billing
[Service]
Type=oneshot
User=deploy
EnvironmentFile=/etc/billing/backup.env
ExecStart=/opt/billing/backup.sh
```

```ini
# /etc/systemd/system/billing-backup.timer
[Unit]
Description=Backup nocturne billing
[Timer]
OnCalendar=*-*-* 02:30:00
RandomizedDelaySec=10m
Persistent=true
[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now billing-backup.timer
systemctl list-timers billing-backup.timer
sudo systemctl start billing-backup.service   # test immédiat
journalctl -u billing-backup -n 50
```

`backup.sh` : le script `pg_dump -Fc` → chiffrement `age` → `aws s3 cp` vers un bucket versionné → ping de dead man's switch, détaillé dans [Sécurité & secrets](/infra/10-securite-et-secrets). Et un test de **restauration** hebdomadaire (dans un conteneur Postgres jetable) qui vérifie quelques comptages.

Si le RPO de 24 h est trop large (paiements !), passe à pgBackRest ou WAL-G avec archivage continu des WAL vers S3 : RPO de quelques minutes et restauration à un instant précis (PITR). Ou une base managée.

## 7. Monitoring minimal

Sans monter une stack complète, le strict nécessaire :

| Quoi | Comment | Alerte si |
|---|---|---|
| API joignable | Sonde externe sur `/health` toutes les minutes | 2 échecs d'affilée |
| Certificat TLS | Même sonde | Expire < 14 j |
| Backups | Ping de fin de backup | Pas de ping depuis 26 h |
| Disque | Script ou agent | > 80 % |
| Erreurs app | Sentry ou équivalent | Nouvelle erreur, pic |
| Logs | `docker compose logs`, ou envoi vers Loki/Grafana Cloud | — |

La sonde doit être **externe** au VPS : si la machine tombe, un monitoring hébergé dessus tombe avec. Ensuite, quand le trafic le justifie : métriques Prometheus de l'app (RED), node_exporter, dashboards et alertes SLO (cf. [Observabilité](/infra/08-observabilite)).

Commandes de diagnostic du quotidien sur ce serveur :

```bash
cd /opt/billing && export API_TAG=$(cat .current_tag)
docker compose ps
docker compose logs -f --since 15m api
docker stats --no-stream
df -h && docker system df
journalctl -u docker --since "1h ago"
```

## 8. Rollback

Trois niveaux, du plus courant au plus rare :

1. **Le code** (90 % des cas) : `ssh deploy@vps "$(cat .previous_tag)"` ou relancer le job `deploy` d'un ancien run GitHub. 1 à 2 minutes. Possible parce que les images sont immuables et le schéma compatible.
2. **Une feature** : la désactiver par feature flag sans redéployer.
3. **Les données** (corruption, suppression massive) : restauration depuis le backup, ou PITR. Long, perte de données jusqu'au RPO : d'où l'importance de ne jamais avoir besoin d'un rollback de **schéma** pour revenir en arrière sur du code.

Écris un mini-runbook dans le repo (`docs/runbook.md`) : comment se connecter, où sont les logs, comment rollback, comment restaurer, qui prévenir. Le jour J, à 3 h du matin, tu ne réfléchis pas, tu suis la liste.

## Checklist de mise en prod

**Serveur**
- [ ] Mises à jour de sécurité automatiques activées
- [ ] SSH par clé uniquement, pas de root, user `deploy` dédié
- [ ] Firewall : 22, 80, 443 (+ UDP 443) seulement ; vérifié par un scan externe
- [ ] Rotation des logs Docker configurée

**App**
- [ ] Image taggée par SHA, non-root, `read_only`, healthcheck
- [ ] Config validée au démarrage, secrets hors du repo (`chmod 600` ou SOPS)
- [ ] Graceful shutdown (SIGTERM) testé
- [ ] Logs JSON sur stdout, sans données sensibles
- [ ] Rôle DB applicatif sans droits DDL ; Postgres non exposé

**Réseau & TLS**
- [ ] DNS avec TTL raisonnable (300 s le temps de stabiliser)
- [ ] HTTPS forcé, HSTS, certificats renouvelés automatiquement
- [ ] CORS en allowlist, rate limit sur login et routes coûteuses

**Déploiement**
- [ ] CI : lint, tests, migrations testées sur une vraie Postgres
- [ ] Déploiement automatisé, protégé par un environment
- [ ] Migrations compatibles en arrière, `lock_timeout`
- [ ] Rollback testé **pour de vrai** au moins une fois

**Données**
- [ ] Backup chiffré, hors site, quotidien (ou WAL continu)
- [ ] Restauration testée et chronométrée
- [ ] Alerte si le backup n'a pas tourné

**Exploitation**
- [ ] Sonde externe + alerte sur `/health` et sur le certificat
- [ ] Suivi des erreurs (Sentry ou équivalent)
- [ ] Runbook écrit, accès d'urgence documentés

## Cas réel

Premier mois en prod de `billing-api` avec ce setup, journal des incidents :

- **J+3** : `502` pendant 4 s à chaque déploiement → ajout de `lb_try_duration` dans Caddy. Plus aucune erreur visible.
- **J+9** : une migration `ALTER TABLE invoices ADD COLUMN … NOT NULL DEFAULT …` a pris un verrou ; depuis PG 11, ajouter une colonne avec un défaut constant est instantané, mais celle-ci avait un défaut volatile (`gen_random_uuid()`) → réécriture de la table, API bloquée 40 s. Depuis : `lock_timeout = '5s'` et revue des migrations en PR.
- **J+17** : le disque monte à 85 % → les dumps locaux n'étaient pas supprimés après l'upload. `rm` ajouté, alerte disque qui a fait son travail.
- **J+24** : un déploiement passe le healthcheck mais casse l'export CSV → rollback manuel en 90 s via `.previous_tag`, correctif le lendemain. Ajout d'un smoke test sur l'export en CI.

## Pièges classiques

- Déployer à la main par `git pull && pnpm build` sur le serveur : non reproductible, pas de rollback, deps de dev en prod.
- Migrations lancées par l'app au démarrage avec plusieurs réplicas : courses et verrous.
- Migration destructive dans le même déploiement que le code qui arrête d'utiliser la colonne : rollback impossible.
- Perdre le volume des certificats Caddy et se faire limiter par Let's Encrypt.
- Le monitoring hébergé sur le serveur qu'il surveille.
- Backups non testés, ou stockés sur le même disque.
- `docker compose down -v` tapé par réflexe en prod : base supprimée.

## Défis

**1. Déploiement bloqué.** La CI affiche `deploy sha-a1… -> sha-b2…`, puis `ERROR: relation "invoice_lines" does not exist` pendant `migrate.js`, puis le job échoue. Dans quel état est la prod ? Que fais-tu ?

::: details Solution
`set -e` a arrêté le script **pendant les migrations** : `up -d` n'a pas été exécuté, l'ancienne version `sha-a1…` tourne toujours. `.current_tag` n'a pas changé. La prod va bien, à une condition : vérifier si la migration était **transactionnelle** (Postgres permet le DDL en transaction, la plupart des outils l'utilisent). Si oui, rien n'a été appliqué. Sinon (ex. `CREATE INDEX CONCURRENTLY`, qui ne peut pas tourner en transaction), vérifier l'état réel du schéma et la table de suivi des migrations.

Cause probable : migrations dans le mauvais ordre (deux branches mergées avec des timestamps croisés), ou migration qui dépend d'une table créée par une migration pas encore mergée. Elle aurait dû être détectée en CI : vérifier que le job `integration` migre bien une base **vierge** puis une base au niveau de la prod.
:::

**2. Trouve les 6 problèmes de ce compose de prod.**

```yaml
services:
  api:
    image: ghcr.io/acme/billing-api:latest
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgres://postgres:postgres@db/billing
    command: sh -c "node dist/migrate.js && node dist/main.js"
  db:
    image: postgres:18
    ports: ["5432:5432"]
    environment: { POSTGRES_PASSWORD: postgres }
```

::: details Solution
1. `:latest` : pas de version explicite, rollback impossible.
2. `3000:3000` et `5432:5432` publiés sur toutes les interfaces : API joignable en contournant Caddy, base exposée sur Internet (Docker contourne ufw).
3. Secrets en clair dans le fichier, mot de passe trivial, et l'app se connecte en **superuser** `postgres`.
4. Migrations au démarrage du conteneur via `sh -c` : relancées à chaque restart, `sh` en PID 1 (SIGTERM perdu), et un échec de migration fait boucler le conteneur.
5. Pas de volume pour Postgres : données perdues à la recréation du conteneur.
6. Pas de `restart:`, pas de healthcheck ni de `depends_on` avec condition, pas de proxy TLS.
:::

**3. Écris la commande de rollback.** Tu es sur le serveur, dans `/opt/billing`. Reviens à la version précédente de l'API et du worker sans repasser par la CI, puis vérifie.

::: details Solution
```bash
cd /opt/billing
PREV=$(cat .previous_tag)
API_TAG="$PREV" docker compose up -d --no-deps api worker
curl -fsS http://127.0.0.1:3000/health
API_TAG="$PREV" docker compose ps
echo "$PREV" > .current_tag
```

Ou simplement `./deploy.sh "$(cat .previous_tag)"` (relance aussi les migrations, qui sont déjà appliquées : no-op). Ensuite, prévenir l'équipe et bloquer les déploiements automatiques jusqu'au correctif, sinon le prochain merge redéploie la version cassée.
:::

**4. Calcule le RPO/RTO.** Backups `pg_dump` quotidiens à 2 h 30, la restauration d'un dump prend 25 min, plus 15 min pour reprovisionner un serveur avec Terraform. Le disque du VPS meurt à 18 h. Combien de données perds-tu, combien de temps es-tu down ? Le métier exige « pas plus de 15 min de factures perdues » : que changes-tu ?

::: details Solution
- Données perdues : tout depuis 2 h 30, soit **15 h 30** de factures (RPO effectif = jusqu'à 24 h).
- Indisponibilité : 15 min (serveur) + téléchargement/déchiffrement + 25 min (restore) + DNS si l'IP change (TTL 300 s) + vérifications ≈ **50 min à 1 h** (RTO), si le runbook est prêt et testé.

Pour un RPO ≤ 15 min : archivage continu des WAL vers S3 (pgBackRest/WAL-G, `archive_timeout` ≤ 60 s) + base backup quotidien, ou une base managée avec PITR. Pour réduire le RTO : IP flottante (réattachable à un nouveau serveur), image serveur préparée, restauration répétée chaque mois.
:::

**5. Le déploiement « réussi » qui casse.** Le healthcheck `/health` renvoie `200` mais toutes les requêtes `POST /invoices` échouent avec `permission denied for table invoice_lines` depuis le dernier déploiement. Explique et propose deux améliorations.

::: details Solution
La migration a créé `invoice_lines` avec le rôle `billing_owner`, mais `billing_app` n'a pas de droit dessus : soit il manque `ALTER DEFAULT PRIVILEGES FOR ROLE billing_owner …`, soit la migration a été lancée par un autre rôle (`postgres`) que celui visé par les default privileges. Correctif immédiat : `GRANT SELECT, INSERT, UPDATE, DELETE ON billing.invoice_lines TO billing_app;`.

Améliorations :
1. En CI, faire tourner les tests d'intégration **avec les mêmes rôles qu'en prod** (migrations en `owner`, app en `app`) : l'erreur aurait été vue avant le merge.
2. Un healthcheck de déploiement plus parlant (`/ready` qui fait un `SELECT 1` sur les tables critiques avec le rôle de l'app) et un **smoke test** métier après déploiement (création d'une facture de test sur un tenant interne), avec rollback automatique en cas d'échec.
:::

## À retenir

- Un VPS + Compose + Caddy suffit pour beaucoup d'apps, à condition d'appliquer les pratiques de prod : images immuables, secrets hors repo, non-root.
- Déploiement = pull → migrations → up → healthcheck → rollback automatique si KO.
- Migrations compatibles en arrière : c'est ce qui permet de rollback le code sans toucher la base.
- Backups chiffrés hors site, surveillés et restaurés ; RPO/RTO chiffrés avec le métier.
- Monitoring externe minimal dès le jour 1 : uptime, certificat, backups, disque, erreurs.
- Déroule la checklist avant d'ouvrir, et garde un runbook à jour.
