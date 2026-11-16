# Docker Compose

Ce que tu vas apprendre : décrire une stack locale réaliste (API + Postgres + Redis + worker) avec Compose, gérer volumes, réseaux, healthchecks, variables d'environnement, profils et overrides, et savoir quand Compose suffit en prod.

## Le principe

`compose.yaml` décrit des **services** (conteneurs), des **volumes** et des **réseaux**. Une commande lance tout :

```bash
docker compose up -d          # crée + démarre
docker compose ps
docker compose logs -f api worker
docker compose exec postgres psql -U app billing
docker compose run --rm api pnpm db:migrate
docker compose down           # stop + supprime conteneurs/réseau
docker compose down -v        # ... et les volumes (données !)
docker compose config         # YAML final après merge/interpolation
```

En 2026 : on écrit `docker compose` (plugin v2, en Go), plus `docker-compose` (v1, Python, mort). Le fichier s'appelle `compose.yaml`, et le champ `version:` en tête est **obsolète** (ignoré avec un warning).

## La stack de `billing-api`

```yaml
# compose.yaml
name: billing

services:
  api:
    build: .
    ports:
      - "127.0.0.1:3000:3000"
    env_file: .env
    environment:
      DATABASE_URL: postgres://app:app@postgres:5432/billing
      REDIS_URL: redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    restart: unless-stopped
```

Le worker réutilise la même image avec une autre commande, et un service one-shot applique les migrations :

```yaml
  worker:
    build: .
    command: ["node", "dist/worker.js"]
    env_file: .env
    environment:
      DATABASE_URL: postgres://app:app@postgres:5432/billing
      REDIS_URL: redis://redis:6379
    depends_on:
      api:
        condition: service_started
    restart: unless-stopped

  migrate:
    build: .
    command: ["node", "dist/migrate.js"]
    environment:
      DATABASE_URL: postgres://app:app@postgres:5432/billing
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"
```

Les dépendances avec leurs healthchecks :

```yaml
  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: billing
    volumes:
      - pgdata:/var/lib/postgresql
      - ./db/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d billing"]
      interval: 5s
      timeout: 3s
      retries: 10
    ports:
      - "127.0.0.1:5432:5432"

  redis:
    image: redis:8-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
  redisdata:
```

::: warning Postgres 18 : nouveau chemin de données
À partir de l'image `postgres:18`, `PGDATA` vaut `/var/lib/postgresql/18/docker` et le volume se monte sur **`/var/lib/postgresql`** (pour faciliter les montées de version avec `pg_upgrade`). Avec `postgres:17` et avant, c'était `/var/lib/postgresql/data`. Avec un vieux `compose.yaml` monté sur `/var/lib/postgresql/data`, l'image 18 refuse de démarrer (message explicite dans les logs) ou, pire, tes données ne sont pas là où tu crois : vérifie le montage.
:::

## Réseaux et DNS interne

Compose crée un réseau par défaut (`billing_default`). Chaque service y est joignable **par son nom** : `postgres:5432`, `redis:6379`. C'est le DNS interne de Docker.

- Dans le conteneur `api`, `localhost` désigne **le conteneur lui-même**, pas Postgres ni ta machine.
- `ports:` sert uniquement à joindre un service **depuis l'hôte**. Deux services se parlent sans `ports`.
- Pour joindre un service qui tourne sur ton Mac depuis un conteneur : `host.docker.internal`.

Pour isoler, déclare plusieurs réseaux :

```yaml
services:
  proxy:
    networks: [front]
  api:
    networks: [front, back]
  postgres:
    networks: [back]

networks:
  front:
  back:
    internal: true    # pas d'accès Internet sortant
```

Le proxy ne peut pas parler à Postgres : seule l'API est sur les deux réseaux.

## Volumes

| Type | Syntaxe | Usage |
|---|---|---|
| Volume nommé | `pgdata:/var/lib/postgresql` | Données persistantes (DB) |
| Bind mount | `./src:/app/src` | Code en dev, fichiers de conf |
| tmpfs | `tmpfs: [/tmp]` | Fichiers temporaires en RAM |

- Volume nommé : géré par Docker, survit à `down`, détruit par `down -v`. Bonnes perfs sur macOS.
- Bind mount : pratique pour le hot reload, mais attention aux permissions (uid de l'hôte ≠ uid du conteneur) et aux perfs sur macOS.
- `:ro` (read-only) pour la conf et les scripts d'init.

Les scripts dans `/docker-entrypoint-initdb.d` ne s'exécutent **qu'au premier démarrage**, quand le volume est vide. Modifier `init.sql` ensuite ne fait rien tant que le volume existe.

## depends_on et healthchecks

`depends_on` simple (liste) ne fait qu'**ordonner le démarrage** : l'API démarre dès que le conteneur Postgres est lancé, pas quand Postgres accepte des connexions. D'où les conditions :

| Condition | Attend que… |
|---|---|
| `service_started` | le conteneur soit lancé (défaut) |
| `service_healthy` | son healthcheck soit `healthy` |
| `service_completed_successfully` | il se termine avec le code 0 |

C'est le pattern du service `migrate` : l'API ne démarre que si les migrations ont réussi.

::: tip Mais ton app doit quand même retenter
En prod (K8s, redémarrage de la DB), aucune garantie d'ordre. Ton app doit **retenter la connexion** avec backoff au démarrage plutôt que crasher au premier `ECONNREFUSED`. `depends_on` est un confort de dev, pas une garantie de résilience.
:::

## Variables d'environnement

Trois mécanismes à ne pas confondre :

1. **Interpolation** dans le YAML : `${VAR}` est remplacé par Compose au moment du parse, à partir de ton shell et du fichier `.env` **à côté du compose.yaml**.
2. **`environment:`** : variables injectées dans le conteneur.
3. **`env_file:`** : fichier(s) dont le contenu est injecté dans le conteneur.

```yaml
services:
  api:
    image: ghcr.io/acme/billing-api:${API_TAG:-latest}
    environment:
      LOG_LEVEL: ${LOG_LEVEL:-info}
      STRIPE_KEY: ${STRIPE_KEY:?STRIPE_KEY manquant}
```

- `${VAR:-défaut}` : valeur par défaut.
- `${VAR:?message}` : erreur si absent : utile pour les secrets obligatoires.
- Priorité dans le conteneur : `environment:` l'emporte sur `env_file:`.
- `docker compose config` montre le résultat final : ton premier réflexe quand une variable « n'est pas prise ».

Commite un `.env.example`, **jamais** le `.env`.

Pour des secrets en fichiers (le mieux), Compose supporte `secrets:` :

```yaml
services:
  api:
    secrets: [stripe_key]
    environment:
      STRIPE_KEY_FILE: /run/secrets/stripe_key
secrets:
  stripe_key:
    file: ./secrets/stripe_key.txt
```

L'app lit le fichier : le secret n'apparaît ni dans `docker inspect` ni dans `/proc/1/environ`.

## Profils

Les **profils** activent des services optionnels :

```yaml
services:
  mailpit:
    image: axllent/mailpit
    profiles: [tools]
    ports: ["127.0.0.1:8025:8025"]

  pgadmin:
    image: dpage/pgadmin4
    profiles: [tools]

  loadtest:
    image: grafana/k6
    profiles: [bench]
    command: ["run", "/scripts/invoices.js"]
    volumes: ["./bench:/scripts:ro"]
```

```bash
docker compose up -d                       # sans tools ni bench
docker compose --profile tools up -d       # + mailpit, pgadmin
COMPOSE_PROFILES=tools,bench docker compose up -d
```

Un service sans `profiles` est toujours actif.

## Override et fichiers multiples

Compose fusionne automatiquement `compose.yaml` + `compose.override.yaml`. Convention : la base décrit la prod-like, l'override ajoute le confort de dev.

```yaml
# compose.override.yaml (dev, chargé automatiquement)
services:
  api:
    build:
      target: deps
    command: ["pnpm", "dev"]
    volumes:
      - ./src:/app/src
    environment:
      LOG_LEVEL: debug
```

Pour la prod ou la CI, fichiers explicites (l'override n'est alors **pas** chargé) :

```bash
docker compose -f compose.yaml -f compose.prod.yaml up -d
docker compose -f compose.yaml -f compose.ci.yaml run --rm api pnpm test
```

Règles de fusion : les scalaires sont remplacés, `ports`/`volumes`/`environment` sont fusionnés par clé. Pour remplacer complètement une liste, utilise `!reset` ou `!override` (Compose 2.24+).

Alternative plus lisible pour les gros projets : `include:` pour composer plusieurs fichiers, ou `extends:` pour partager un bloc entre `api` et `worker`.

## Le hot reload en 2026 : `develop.watch`

```yaml
services:
  api:
    develop:
      watch:
        - action: sync
          path: ./src
          target: /app/src
        - action: rebuild
          path: package.json
```

`docker compose watch` (ou `up --watch`) synchronise les fichiers et reconstruit l'image quand le lockfile change. Plus rapide qu'un bind mount sur macOS.

## Compose en prod ?

Sur **un seul** VPS, Compose est un choix parfaitement raisonnable (cf. [Déployer une vraie app](/infra/11-deployer-une-vraie-app)) :

- `restart: unless-stopped` + Docker démarré au boot par systemd ;
- `docker compose pull && docker compose up -d` pour déployer ;
- rotation des logs (`logging: { options: { max-size: 50m } }`).

Ce qu'il ne fait **pas** : multi-machines, rolling update sans coupure natif, autoscaling, auto-réparation sur healthcheck `unhealthy`. Au-delà d'un serveur, regarde [Kubernetes](/infra/07-kubernetes) (ou un PaaS).

## Cas réel

Onboarding sur `billing-api` : avant Compose, le README faisait 3 pages (installer Postgres 18, Redis, créer la DB, lancer les migrations, configurer Mailhog…), et un nouvel arrivant mettait une journée.

Après :

```bash
cp .env.example .env
docker compose --profile tools up -d
open http://localhost:3000/health  # API
open http://localhost:8025         # mails envoyés par le worker
```

Ce qui a demandé du soin :

- Le worker testait l'envoi de factures vers le vrai SMTP : `SMTP_HOST=mailpit` dans l'override de dev.
- Les tests d'intégration en CI utilisent `compose.ci.yaml` avec Postgres en `tmpfs` (`tmpfs: /var/lib/postgresql`) : DB jetable et 3× plus rapide.
- Deux devs avaient un Postgres local sur 5432 : port host paramétrable `"127.0.0.1:${PG_PORT:-5432}:5432"`.

## Pièges classiques

- `DATABASE_URL=postgres://localhost:5432` dans le conteneur : `localhost` = le conteneur lui-même. Utilise le nom du service.
- `depends_on` sans `condition` : l'API démarre avant que Postgres soit prêt.
- `docker compose down -v` « pour nettoyer » : base de dev perdue.
- Modifier un script d'init et ne pas comprendre qu'il ne s'exécute pas (volume déjà initialisé).
- `ports: "5432:5432"` sur un serveur : DB exposée sur Internet (Docker contourne ufw).
- Confondre le `.env` d'interpolation et `env_file:`.
- `image: postgres` sans tag : un `pull` te fait passer à une nouvelle version majeure, incompatible avec les données existantes.

## Défis

**1. L'API crashe au démarrage.** `docker compose up` : `api-1 | Error: connect ECONNREFUSED 127.0.0.1:5432`, puis `api-1 exited with code 1`. Postgres est `healthy`. Trouve la cause.

::: details Solution
L'IP `127.0.0.1` trahit le problème : l'app se connecte à `localhost`, donc à son propre conteneur, où rien n'écoute sur 5432. Le `.env` (copié d'un setup sans Docker) contient `DATABASE_URL=postgres://app:app@localhost:5432/billing`, il est chargé via `env_file:`, et aucun `environment:` ne surcharge la variable.

Correctif : `postgres` comme host dans le conteneur. Vérifier avec `docker compose config` ou `docker compose exec api printenv DATABASE_URL`.
:::

**2. Trouve les 5 problèmes de ce compose.**

```yaml
version: "3.8"
services:
  api:
    build: .
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgres://app:prod-P4ss@db:5432/billing
    depends_on: [db]
  db:
    image: postgres
    ports: ["5432:5432"]
    environment:
      POSTGRES_PASSWORD: prod-P4ss
```

::: details Solution
1. `version:` obsolète (ignoré, warning).
2. Mot de passe de prod en clair dans un fichier versionné → `${PG_PASSWORD:?}` depuis un `.env` non commité, ou `secrets:`.
3. `image: postgres` sans tag → `postgres:18`.
4. Pas de volume sur `db` : les données disparaissent avec le conteneur (`docker compose down`, recréation).
5. `ports: 5432:5432` (et `3000:3000`) publiés sur toutes les interfaces → DB exposée. Retire les ports de `db` ou `127.0.0.1:5432:5432`.

Bonus : `depends_on` sans healthcheck ni `condition: service_healthy`, pas de `restart:`.
:::

**3. Script d'init ignoré.** Tu as ajouté `CREATE EXTENSION pg_trgm;` dans `db/init/01.sql`, relancé `docker compose up -d`, et la recherche plante : `function similarity(text, text) does not exist`. Pourquoi ? Deux façons de régler.

::: details Solution
Les scripts de `/docker-entrypoint-initdb.d` ne tournent que si le répertoire de données est **vide** (premier démarrage). Le volume `pgdata` existe déjà.

1. En dev, repartir de zéro : `docker compose down -v && docker compose up -d` (données perdues).
2. Mieux : mettre `CREATE EXTENSION IF NOT EXISTS pg_trgm;` dans une **migration**, qui s'applique partout (dev, CI, prod). Les scripts d'init ne servent qu'au bootstrap local.
:::

**4. Écris les commandes.** a) Lancer les tests d'intégration de l'API dans un conteneur jetable avec la stack démarrée. b) Ouvrir un `psql` sur la DB. c) Voir les 50 dernières lignes de log du worker depuis 10 min. d) Recréer uniquement l'API après un changement d'image, sans toucher à Postgres.

::: details Solution
```bash
# a)
docker compose run --rm api pnpm test:integration
# b)
docker compose exec postgres psql -U app -d billing
# c)
docker compose logs --since 10m --tail 50 worker
# d)
docker compose up -d --no-deps --build api
# (ou --force-recreate si seule la conf a changé)
```
:::

**5. Le worker et le Redis du voisin.** En prod sur un VPS, tu fais tourner deux projets Compose (`billing` et `crm`), chacun avec un service `redis`. Le worker de `billing` pourrait-il, par erreur, parler au Redis de `crm` ? Explique.

::: details Solution
Non par défaut : chaque projet Compose a son propre réseau (`billing_default`, `crm_default`), et le nom `redis` est résolu dans le réseau du conteneur. Les deux sont isolés.

Ça devient possible si les deux projets partagent un réseau `external: true` (souvent créé pour un reverse proxy commun) et que les deux services y sont attachés sous le même nom : la résolution devient ambiguë. Règle : ne mettre sur le réseau partagé que les services exposés au proxy, et donner des alias explicites.

Attention aussi au **nom de projet** : deux dossiers nommés pareil sur la même machine = même projet = conteneurs écrasés. Fixe `name:` dans le fichier.
:::

## À retenir

- `compose.yaml` sans `version:`, commande `docker compose`.
- Les services se joignent par leur **nom** ; `localhost` = le conteneur lui-même.
- `depends_on` + `condition: service_healthy` / `service_completed_successfully` pour l'ordre, mais l'app doit savoir retenter.
- Volumes nommés pour les données ; Postgres 18 se monte sur `/var/lib/postgresql`.
- Profils pour les outils optionnels, override pour le dev, `-f` explicites pour CI/prod.
- `docker compose config` est ton debugger.
