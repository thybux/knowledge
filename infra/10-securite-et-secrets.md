# Sécurité & secrets

Ce que tu vas apprendre : gérer les secrets proprement (env, SOPS, Vault), appliquer le moindre privilège, scanner dépendances et images, couvrir l'essentiel de l'OWASP Top 10 côté back, et mettre en place des backups qu'on sait **restaurer**.

## Secrets : du pire au mieux

Un **secret** : mot de passe DB, clé API Stripe, clé de signature JWT, token SMTP, clé privée TLS ou SSH.

| Méthode | Verdict |
|---|---|
| En dur dans le code | Jamais (il est dans l'historique Git pour toujours) |
| `.env` commité | Jamais |
| `.env` sur le serveur, `chmod 600` | Acceptable sur un petit VPS |
| Secrets CI / secrets K8s | Standard, avec accès restreint |
| SOPS (fichiers chiffrés dans Git) | Très bien pour petites équipes |
| Vault / secret manager cloud | Le mieux à l'échelle : audit, rotation |

### Variables d'environnement

Le standard 12-factor : l'app lit sa config dans l'environnement, et **valide au démarrage** :

```ts
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z.url(),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  JWT_SECRET: z.string().min(32),
});

export const env = Env.parse(process.env); // crash si invalide
```

(`z.url()` est la syntaxe de Zod 4 ; en Zod 3 c'était `z.string().url()`.) Crasher au démarrage avec un message clair vaut mieux qu'une erreur 500 à 3 h du matin. Cf. [Erreurs et validation](/dev/typescript/05-erreurs-et-validation).

Limites des variables d'env : visibles dans `docker inspect`, `/proc/<pid>/environ`, héritées par les sous-processus, et parfois affichées dans les dumps d'erreur. Pour les secrets sensibles, préfère des **fichiers** montés (`/run/secrets/…`) avec la convention `*_FILE` :

```rust
fn secret(name: &str) -> anyhow::Result<String> {
    if let Ok(path) = std::env::var(format!("{name}_FILE")) {
        return Ok(std::fs::read_to_string(path)?.trim().into());
    }
    Ok(std::env::var(name)?)
}
```

### SOPS : secrets chiffrés dans Git

**SOPS** chiffre les **valeurs** d'un fichier YAML/JSON/env (les clés restent lisibles, donc les diffs aussi), avec **age**, PGP ou un KMS cloud.

```bash
age-keygen -o ~/.config/sops/age/keys.txt
# public key: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p
```

```yaml
# .sops.yaml à la racine du repo
creation_rules:
  - path_regex: secrets/prod\..*
    age: >-
      age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p,
      age1serveurprod...
```

```bash
sops secrets/prod.env          # ouvre l'éditeur, chiffre à la sauvegarde
sops decrypt secrets/prod.env > /etc/billing/env
sops exec-env secrets/prod.env 'node dist/main.js'
```

- Chaque destinataire (dev, serveur, CI) a sa clé age ; retirer quelqu'un = retirer sa clé et **re-chiffrer** (`sops updatekeys`), **et** faire tourner les secrets qu'il a pu voir.
- Intégrations : Flux et Argo CD (via plugin) déchiffrent en cluster, Terraform via le provider `sops`.

### Vault et secret managers

**HashiCorp Vault** (ou OpenBao, son fork open source), AWS Secrets Manager, GCP Secret Manager, Scaleway Secret Manager… apportent :

- un **audit log** (qui a lu quel secret, quand) ;
- la **rotation** automatique ;
- les **secrets dynamiques** : Vault crée un user Postgres valable 1 h pour chaque instance de l'app, révoqué ensuite. Une fuite ne vaut plus rien après expiration ;
- l'authentification par identité (rôle K8s, OIDC de la CI) au lieu d'un token partagé.

En K8s, **External Secrets Operator** synchronise ces secrets vers des `Secret` Kubernetes.

### Un secret a fuité : la procédure

1. **Révoquer / faire tourner** le secret immédiatement. Supprimer le commit ne suffit pas : il a été cloné, mis en cache, scanné par des bots en quelques minutes.
2. Vérifier les logs d'accès du service concerné (Stripe, AWS CloudTrail, logs Postgres) depuis la date de la fuite.
3. Nettoyer l'historique si nécessaire (`git filter-repo`), en sachant que ça ne rattrape rien.
4. Prévenir la récidive : **secret scanning** (GitHub push protection, `gitleaks` en pre-commit et en CI).

## Least privilege

Chaque composant n'a **que** les droits dont il a besoin.

**Base de données** : l'app ne doit pas pouvoir faire `DROP TABLE`.

```sql
-- propriétaire du schéma, utilisé par les migrations
CREATE ROLE billing_owner LOGIN PASSWORD '...';
CREATE SCHEMA billing AUTHORIZATION billing_owner;

-- l'app : lecture/écriture des données, pas de DDL
CREATE ROLE billing_app LOGIN PASSWORD '...';
GRANT USAGE ON SCHEMA billing TO billing_app;
ALTER DEFAULT PRIVILEGES FOR ROLE billing_owner
  IN SCHEMA billing
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
  TO billing_app;
ALTER DEFAULT PRIVILEGES FOR ROLE billing_owner
  IN SCHEMA billing
  GRANT USAGE, SELECT ON SEQUENCES TO billing_app;

-- lecture seule pour le back-office / analytics
CREATE ROLE billing_ro LOGIN PASSWORD '...';
```

Les autres niveaux :

- **OS** : user système dédié par service, pas de root, `ProtectSystem` (cf. [Linux](/infra/01-linux-essentiels)).
- **Conteneur** : non-root, `--read-only`, `--cap-drop ALL`, pas de `--privileged`, pas de socket Docker monté (le monter = donner root sur l'hôte).
- **Cloud / CI** : un rôle par usage (`deploy-staging` ne touche pas la prod), OIDC, `permissions:` minimales dans les workflows.
- **Réseau** : la DB n'écoute pas sur Internet ; les admins (pgAdmin, Grafana, dashboards internes) derrière un VPN comme [WireGuard](/vpn/wireguard/new-user) ou un SSO, pas juste un mot de passe.
- **Humains** : accès prod nominatifs et révoqués au départ, MFA partout.

## Scanner dépendances et images

La plupart du code qui tourne en prod n'est pas le tien : il vient de `node_modules` et de `Cargo.lock`. Les attaques de **supply chain** (paquets npm compromis, typosquatting) sont devenues courantes.

```bash
pnpm audit --prod                # CVE connues des deps npm
cargo install cargo-audit cargo-deny
cargo audit                      # base RustSec
cargo deny check                 # licences, sources, doublons, CVE
trivy image ghcr.io/acme/billing-api:sha-3f2c1a7
trivy fs --scanners vuln,secret,misconfig .
```

En CI : `trivy` sur l'image (échec si `CRITICAL` corrigeable), **Dependabot** ou **Renovate** pour des PR de mise à jour régulières et petites, et génération d'un **SBOM** (`trivy image --format cyclonedx`, ou `docker buildx build --sbom=true`).

Côté npm, réduis aussi la surface :

- lockfile commité, `--frozen-lockfile` partout ;
- pnpm n'exécute pas les scripts `postinstall` des dépendances par défaut (depuis pnpm 10) : autorise explicitement ceux qui en ont besoin (`onlyBuiltDependencies`) ;
- un délai avant d'adopter une version toute fraîche (option `minimumReleaseAge` de pnpm, ou de Renovate) évite la plupart des paquets compromis, retirés en quelques heures.

Une CVE dans un rapport ne veut pas dire « exploitable chez toi » : vérifie si le code vulnérable est atteignable (dépendance de dev ? fonction utilisée ?) et priorise.

## OWASP Top 10 côté back

L'édition 2025 de l'OWASP Top 10, vue par un dev d'API :

| # | Risque | Ce que tu fais |
|---|---|---|
| A01 | Broken Access Control | Vérifier le droit sur **chaque** ressource |
| A02 | Security Misconfiguration | Defaults sûrs, pas de debug en prod |
| A03 | Supply Chain Failures | Lockfile, scans, mises à jour |
| A04 | Cryptographic Failures | TLS, argon2id, pas de crypto maison |
| A05 | Injection | Requêtes paramétrées, pas de `exec` |
| A06 | Insecure Design | Threat modeling, limites métier |
| A07 | Authentication Failures | MFA, rate limit login, sessions |
| A08 | Data Integrity Failures | Signatures (webhooks, artefacts) |
| A09 | Logging & Alerting Failures | Logs d'audit, alertes |
| A10 | Exceptional Conditions | Erreurs gérées, fail closed |

### A01 : l'IDOR, faille n°1 des API

```ts
// VULNÉRABLE : n'importe quel user connecté lit
// la facture de n'importe quel tenant
app.get("/invoices/:id", async (req) => {
  return db.invoice.findUnique({
    where: { id: req.params.id },
  });
});

// CORRIGÉ : la requête est scopée par le tenant
app.get("/invoices/:id", async (req, reply) => {
  const inv = await db.invoice.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId },
  });
  if (!inv) return reply.code(404).send();
  return inv;
});
```

Renvoie `404` (pas `403`) pour ne pas confirmer l'existence. En multi-tenant, la **Row Level Security** de Postgres ajoute un filet de sécurité au niveau DB (cf. [Postgres avancé](/bdd/05-postgres-avance)). Ajoute aussi la **SSRF** à cette catégorie : une API qui fetch une URL fournie par l'utilisateur (webhook, import d'image) doit refuser les IP internes (`169.254.169.254`, `10.0.0.0/8`, `localhost`).

### A05 : injection

```ts
// VULNÉRABLE
await sql.unsafe(
  `SELECT * FROM invoices WHERE number = '${q}'`);
// CORRIGÉ : paramètre lié
await pool.query(
  "SELECT * FROM invoices WHERE number = $1", [q]);
```

En Rust, `sqlx::query!("… WHERE number = $1", q)` est paramétré et vérifié à la compilation. Même règle pour les commandes système : `spawn("pdftotext", [file])` avec un tableau d'arguments, jamais `exec(\`pdftotext ${file}\`)`.

### A04, A07, A08 en bref

- Mots de passe : **argon2id** (ou bcrypt), jamais SHA-256 seul. Comparaison de tokens à temps constant (`crypto.timingSafeEqual`).
- JWT : vérifier l'algorithme attendu (refuser `none`), l'expiration, l'audience ; durée courte + refresh token révocable.
- **Webhooks entrants** (Stripe, GitHub) : vérifier la signature HMAC sur le **body brut** et le timestamp (anti-rejeu).
- Rate limit sur login, reset de mot de passe, et toute route coûteuse.

### Headers et erreurs

- Headers de sécurité au niveau du proxy (cf. [Reverse proxy & TLS](/infra/06-reverse-proxy-tls)) : HSTS, `nosniff`, CSP pour le front.
- Pas de stack trace ni de message SQL dans les réponses en prod : un message générique + un `request_id` que le support retrouve dans les logs.
- Retire `X-Powered-By` (Express : `app.disable("x-powered-by")`).
- Limite la taille des bodies et des uploads, et le temps de traitement.

## Backups et restauration

Un backup qu'on n'a **jamais restauré** n'est pas un backup, c'est un espoir.

Deux chiffres à fixer avec le métier :

- **RPO** (Recovery Point Objective) : combien de données on accepte de perdre. 24 h ? 5 min ?
- **RTO** (Recovery Time Objective) : en combien de temps on doit être reparti.

| Méthode | RPO | Usage |
|---|---|---|
| `pg_dump` quotidien | 24 h | Petites bases, simple |
| WAL archiving + base backup (pgBackRest, WAL-G) | Minutes | Prod sérieuse, PITR |
| Snapshot disque du provider | Variable | Complément, pas suffisant seul |
| DB managée (RDS, Cloud SQL…) | Minutes | PITR inclus, à tester aussi |

Règle **3-2-1** : 3 copies, sur 2 supports, dont 1 **hors site** (et idéalement une immuable : versioning + object lock, pour résister à un ransomware ou à un `rm` malveillant).

### Un backup `pg_dump` correct

```bash
#!/usr/bin/env bash
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
FILE="/var/backups/billing-$TS.dump"

docker compose exec -T postgres \
  pg_dump -U billing_owner -Fc billing > "$FILE"
age -r "$BACKUP_AGE_PUBKEY" -o "$FILE.age" "$FILE"
aws s3 cp "$FILE.age" "s3://acme-billing-backups-prod/"
rm -f "$FILE"
curl -fsS "$HEALTHCHECK_PING_URL" > /dev/null  # "backup OK"
```

- `-Fc` (format custom) : compressé, restauration sélective et parallèle avec `pg_restore -j`.
- Chiffré **avant** de quitter le serveur ; la clé privée age n'est **pas** sur le serveur.
- Le ping final alimente un **dead man's switch** : pas de ping depuis 26 h → alerte.
- `set -euo pipefail` : sans `pipefail`, un `pg_dump` qui échoue dans un pipe produit un fichier vide « réussi ».

### Tester la restauration

```bash
age -d -i backup-key.txt billing-20261116T020000Z.dump.age \
  > /tmp/billing.dump
createdb -h localhost -U postgres billing_restore_test
pg_restore -h localhost -U postgres -d billing_restore_test \
  -j 4 --no-owner /tmp/billing.dump
psql -h localhost -U postgres -d billing_restore_test \
  -c "SELECT count(*), max(created_at) FROM billing.invoices;"
```

Automatise-le (job hebdomadaire qui restaure le dernier backup dans une DB jetable et vérifie des comptages) et chronomètre : c'est ton RTO réel.

## Cas réel

Audit sécurité de `billing-api` avant la signature d'un gros client B2B. Constats et corrections :

1. `.env.production` commité il y a 8 mois, avec la clé Stripe live → clé révoquée et régénérée, logs Stripe vérifiés, passage à SOPS, `gitleaks` en CI.
2. L'app se connectait en `postgres` (superuser) → rôles `billing_owner` (migrations) et `billing_app` (runtime) séparés.
3. `GET /invoices/:id/pdf` ne vérifiait pas le tenant (IDOR) → scope systématique par `tenantId` + test d'intégration « un user du tenant A ne voit pas une facture du tenant B » sur **chaque** route.
4. Backups `pg_dump` sur le **même disque** que la base, jamais testés → chiffrés, envoyés sur S3 versionné, restauration testée chaque semaine. Premier test : le dump de 3 Go se restaurait en 11 min, RTO documenté.
5. pgAdmin exposé publiquement avec un mot de passe → retiré, accès par tunnel SSH ou VPN.

## Pièges classiques

- Croire qu'un repo privé protège un secret commité.
- Supprimer le commit au lieu de révoquer le secret.
- Un seul user DB superuser pour tout.
- Vérifier l'authentification mais pas l'autorisation sur la ressource (IDOR).
- Logs qui contiennent tokens, cookies ou payloads de paiement.
- Backups sur le même serveur, non chiffrés, jamais restaurés.
- Ignorer toutes les alertes Dependabot (fatigue) ou au contraire tout merger sans lire.
- Monter `/var/run/docker.sock` dans un conteneur « pour le monitoring ».

## Défis

**1. Fuite GitHub.** Un dev te prévient : il a pushé il y a 40 min sur un repo **public** un commit contenant `AWS_SECRET_ACCESS_KEY` et `DATABASE_URL` de prod. Il propose un `git push --force` pour l'effacer. Donne ton plan d'action ordonné.

::: details Solution
1. **Désactiver la clé AWS** tout de suite (IAM → désactiver puis supprimer), en créer une nouvelle (ou mieux, passer à OIDC). Changer le mot de passe Postgres (`ALTER ROLE … PASSWORD …`) et redéployer.
2. Vérifier l'usage : CloudTrail sur la clé depuis le push (création d'instances pour du minage, accès S3), logs de connexion Postgres (IP inconnues ?).
3. Ensuite seulement : nettoyer l'historique (`git filter-repo` + force push), en sachant que des bots ont déjà copié la clé (ils scannent GitHub en temps réel).
4. Post-mortem : push protection GitHub, `gitleaks` en pre-commit, secrets via SOPS/secret manager, plus jamais de secrets de prod sur un poste de dev.

Le `force push` seul ne sert à rien : la clé est compromise dès la première seconde.
:::

**2. Trouve les failles.** Ce handler Express sert le téléchargement d'un PDF de facture.

```ts
app.get("/invoices/:id/pdf", auth, async (req, res) => {
  const inv = await db.query(
    `SELECT * FROM invoices WHERE id = '${req.params.id}'`);
  if (!inv.rows[0]) return res.status(500).send(
    "Not found in table invoices: " + req.params.id);
  res.sendFile(`/data/pdf/${req.query.file}`);
});
```

::: details Solution
1. **Injection SQL** : `id` interpolé. → `WHERE id = $1`, `[req.params.id]`.
2. **IDOR** : aucune vérification que la facture appartient au tenant de l'utilisateur. → `AND tenant_id = $2`.
3. **Path traversal** : `req.query.file` contrôlé par le client (`../../etc/passwd`). → ne jamais prendre le chemin du client : utiliser `inv.rows[0].pdf_path` calculé côté serveur, avec l'option `root` de `sendFile`.
4. **Fuite d'information** : code `500` et message interne (nom de table). → `404` générique.
5. Pas de logs d'audit pour l'accès à un document sensible (bonus : pas de rate limit).
:::

**3. Écris le SQL.** Crée un rôle `reporting` en lecture seule sur toutes les tables (actuelles **et** futures) du schéma `billing`, avec une durée maximale de requête de 30 s.

::: details Solution
```sql
CREATE ROLE reporting LOGIN PASSWORD '...';
GRANT USAGE ON SCHEMA billing TO reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA billing TO reporting;
ALTER DEFAULT PRIVILEGES FOR ROLE billing_owner
  IN SCHEMA billing GRANT SELECT ON TABLES TO reporting;
ALTER ROLE reporting SET statement_timeout = '30s';
ALTER ROLE reporting SET default_transaction_read_only = on;
```

`ALTER DEFAULT PRIVILEGES` ne s'applique qu'aux tables créées **par le rôle indiqué** (`billing_owner`, celui des migrations). Sans `FOR ROLE`, il ne vise que les objets créés par l'utilisateur qui lance la commande, un piège classique.
:::

**4. Le backup qui n'en était pas un.** Le script cron fait `pg_dump billing | gzip > /backups/billing.sql.gz`. Après un incident, le fichier fait 20 octets. Les logs cron n'ont rien signalé. Explique et corrige.

::: details Solution
`pg_dump` a échoué (mot de passe changé, DB renommée, connexion refusée), mais dans un pipe le code de sortie est celui de **`gzip`**, qui a réussi en compressant une entrée vide : 20 octets = l'en-tête gzip. Cron n'a rien vu, personne ne vérifiait.

Corrections :
- `set -euo pipefail` (le pipe échoue si `pg_dump` échoue), ou `pg_dump -Fc` (déjà compressé) directement dans un fichier ;
- fichiers horodatés (pas un seul fichier écrasé chaque nuit) envoyés hors du serveur ;
- vérification de taille minimale + **dead man's switch** ;
- test de restauration automatisé hebdomadaire.
:::

**5. CVE critique.** `trivy` sur l'image de `ingest` remonte une CVE `CRITICAL` dans `libssl3` du runtime, et une CVE `HIGH` dans une crate utilisée seulement par les tests. Que fais-tu pour chacune ?

::: details Solution
- `libssl3` dans l'image de base : vérifier si une image de base corrigée existe (souvent oui en quelques jours) → rebuild avec la base à jour (ou nouveau digest). Si le binaire utilise `rustls` et ne charge jamais OpenSSL, le risque est faible, mais passer à `distroless/cc` à jour, voire `static`, élimine le paquet. Et automatiser le rebuild hebdomadaire des images même sans changement de code.
- Crate de **dev-dependency** : elle n'est pas dans le binaire de prod. Non exploitable en prod ; mettre à jour normalement, sans urgence. Documenter l'exception (`cargo deny` / `.trivyignore` avec justification et date d'expiration).
:::

## À retenir

- Secrets hors du code et de Git ; fichiers `*_FILE` > variables d'env ; SOPS ou un secret manager quand l'équipe grandit.
- Un secret fuité se **révoque** d'abord, le reste vient après.
- Moindre privilège partout : DB (owner vs app vs ro), OS, conteneur, CI, réseau.
- Lockfiles, scans (`pnpm audit`, `cargo audit`/`deny`, `trivy`) et mises à jour régulières contre la supply chain.
- IDOR et injection sont les failles d'API les plus fréquentes : scope par tenant et requêtes paramétrées.
- Backups chiffrés, hors site, surveillés, et **restaurés** régulièrement.
