# Docker

Ce que tu vas apprendre : comment fonctionne une image, comment écrire des Dockerfiles de prod pour une API Node/TS (pnpm) et un binaire Rust, et comment les garder petites, rapides à builder et sûres.

## Images vs conteneurs

- Une **image** : un empilement de **layers** en lecture seule + des métadonnées (`CMD`, `ENV`, `USER`, ports…). Identifiée par un digest `sha256:…`, nommée par un tag (`ghcr.io/acme/billing-api:1.4.2`).
- Un **conteneur** : une instance de l'image, avec une couche **inscriptible** par-dessus, isolée par les namespaces Linux (PID, réseau, mount) et limitée par les **cgroups** (CPU, mémoire).

Un conteneur n'est **pas** une VM : il partage le noyau de l'hôte. C'est juste un process Linux isolé.

```bash
docker build -t billing-api:dev .
docker run --rm -p 3000:3000 --env-file .env billing-api:dev
docker ps -a
docker logs -f --tail 100 <id>
docker exec -it <id> sh          # si l'image a un shell
docker inspect <id> --format '{{.State.ExitCode}}'
docker image ls
docker history billing-api:dev   # taille de chaque layer
```

La couche inscriptible disparaît avec le conteneur (`docker rm`). Tout ce qui doit survivre (données Postgres, uploads) va dans un **volume**.

::: tip Tag vs digest
Un tag est mutable (`node:24-slim` change chaque semaine). Un digest est immuable. En prod, déploie un tag **unique par build** (le SHA git) et, pour les images de base sensibles, épingle par digest (`node:24-slim@sha256:…`) avec Renovate/Dependabot pour les mettre à jour.
:::

## Layers et cache de build

Chaque instruction `RUN`, `COPY`, `ADD` crée un layer. BuildKit (le builder par défaut) **réutilise** un layer si l'instruction et ses entrées n'ont pas changé. Dès qu'un layer est invalidé, **tous les suivants** sont reconstruits.

D'où la règle d'ordre : **ce qui change rarement en haut, ce qui change souvent en bas**.

```dockerfile
# Mauvais : chaque modif de code réinstalle les deps
COPY . .
RUN pnpm install

# Bon : les deps ne bougent que si le lockfile bouge
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
```

Autres règles :

- Supprimer un fichier dans un layer **ultérieur** ne réduit pas l'image : il reste dans le layer précédent. Nettoie dans le **même** `RUN` (`apt-get install … && rm -rf /var/lib/apt/lists/*`).
- `RUN --mount=type=cache,target=…` garde un cache (store pnpm, registry cargo) **entre les builds** sans l'inclure dans l'image.
- `RUN --mount=type=secret,id=npmrc` passe un secret au build sans qu'il finisse dans un layer.

## .dockerignore

Le **contexte** de build (le `.` de `docker build .`) est envoyé au builder. Sans `.dockerignore`, tu envoies `node_modules`, `target/` (des Go !), `.git` et ton `.env`.

```text
# .dockerignore
.git
node_modules
dist
target
coverage
.env
.env.*
!.env.example
*.log
Dockerfile*
docker-compose*.yml
.github
```

Bonus : moins de fichiers copiés = cache `COPY . .` invalidé moins souvent.

## Dockerfile multi-stage : API Node/TS avec pnpm

Le **multi-stage** sépare l'environnement de build (compilateur TS, devDependencies) de l'image finale (juste `dist/` et les deps de prod).

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod
```

Puis l'image finale, à partir d'une base propre :

```dockerfile
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node \
     /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
```

Détails qui comptent :

- `corepack enable` lit le champ `"packageManager": "pnpm@x.y.z"` de `package.json` : la version de pnpm est la même partout. (Corepack est livré avec Node 22 et 24 ; il ne l'est plus à partir de Node 25, où il faut l'installer : `npm i -g corepack`.)
- `--frozen-lockfile` : échoue si le lockfile n'est pas à jour au lieu de le modifier silencieusement.
- `pnpm prune --prod` retire les devDependencies (TypeScript, Vitest…).
- `CMD ["node", …]` en forme **exec** (tableau JSON) : `node` est PID 1 et reçoit SIGTERM. La forme shell `CMD node dist/main.js` lance `/bin/sh -c`, qui ne relaie pas les signaux.
- L'image `node` fournit déjà un user `node` (uid 1000).

::: info Monorepo pnpm
Pour un workspace (`apps/api`, `packages/*`), utilise `pnpm deploy --filter=api --prod /out` dans le stage de build : il produit un dossier autonome avec seulement les deps de cette app, à copier dans l'image finale.
:::

## Dockerfile multi-stage : binaire Rust

Problème du Rust en Docker : compiler les dépendances prend des minutes, et un simple `COPY . .` invalide tout. **cargo-chef** résout ça : il extrait une « recette » (les `Cargo.toml`/`Cargo.lock`) pour compiler les deps dans un layer cacheable.

```dockerfile
# syntax=docker/dockerfile:1
FROM lukemathwalker/cargo-chef:latest-rust-1-trixie AS chef
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
# Layer mis en cache tant que les deps ne changent pas
RUN cargo chef cook --release --recipe-path recipe.json
COPY . .
RUN cargo build --release --locked --bin ingest

FROM gcr.io/distroless/cc-debian13:nonroot AS runtime
COPY --from=builder /app/target/release/ingest /ingest
USER nonroot
EXPOSE 8080
ENTRYPOINT ["/ingest"]
```

- **distroless `cc`** : glibc + libgcc + certificats CA + `/etc/passwd` avec un user `nonroot` (uid 65532). Pas de shell, pas de gestionnaire de paquets : rien à exploiter pour un attaquant. Image de ~25 Mo + ton binaire.
- Builder et runtime sur la **même version de Debian** (ici trixie / debian13). Un binaire compilé contre une glibc plus récente que celle du runtime plante au démarrage : `` version `GLIBC_2.39' not found ``.
- Pas de shell = pas de `HEALTHCHECK CMD curl`. Ajoute un sous-commande à ton binaire (`/ingest healthcheck` qui fait un GET local) ou délègue le check à l'orchestrateur (K8s probes, healthcheck Compose via un autre outil).

### Variante `scratch` (image vide)

Pour une image de quelques Mo, compile en **statique** avec musl :

```dockerfile
FROM rust:1-slim-trixie AS builder
RUN rustup target add x86_64-unknown-linux-musl \
 && apt-get update && apt-get install -y musl-tools \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN cargo build --release --locked \
    --target x86_64-unknown-linux-musl

FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt \
     /etc/ssl/certs/
COPY --from=builder \
  /app/target/x86_64-unknown-linux-musl/release/ingest /ingest
USER 65532:65532
ENTRYPOINT ["/ingest"]
```

Contreparties de `scratch` : pas de certificats CA (on les copie, sinon tout appel HTTPS sortant échoue), pas de fuseaux horaires, pas de `/etc/passwd` (d'où l'uid numérique), et l'allocateur de musl est plus lent sous forte concurrence (beaucoup d'équipes ajoutent `mimalloc` comme `#[global_allocator]`). Utilise `rustls` plutôt qu'OpenSSL pour éviter une lib C à lier statiquement.

## User non-root

Par défaut, un conteneur tourne en **root** (uid 0). Si l'app est compromise ou si un volume de l'hôte est monté, root dans le conteneur = beaucoup de dégâts potentiels (et root sur l'hôte en cas d'évasion).

```dockerfile
# Image sans user prévu (ex. debian:trixie-slim)
RUN groupadd --system app \
 && useradd --system --gid app --no-create-home app
USER app
```

- Les images `node` ont `node`, distroless a `nonroot`.
- Un user non-root ne peut pas écouter sur un port < 1024 : écoute sur 3000/8080, le mapping de port ou le proxy s'occupe du reste.
- Les fichiers copiés appartiennent à root par défaut : utilise `COPY --chown=…` si l'app doit y écrire (mieux : elle n'écrit que dans un volume ou `/tmp`).

Au runtime, durcis encore : `docker run --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges`.

## Taille d'image

| Base | Taille approx. | Usage |
|---|---|---|
| `node:24` | ~1 Go | Jamais en runtime |
| `node:24-slim` | ~200 Mo | Bon défaut Node |
| `node:24-alpine` | ~150 Mo | musl : attention aux modules natifs |
| `distroless/cc-debian13` | ~25 Mo | Binaire Rust (glibc) |
| `scratch` | 0 | Binaire statique |

Pourquoi ça compte : temps de pull au déploiement et en autoscaling, surface d'attaque (moins de paquets = moins de CVE), coût du registry.

```bash
docker image ls billing-api
docker history --no-trunc billing-api:dev | head
# outil interactif pour voir le contenu de chaque layer
dive billing-api:dev
```

## Healthcheck

Le `HEALTHCHECK` dit à Docker comment savoir si le conteneur est **sain** (pas juste démarré). Statut visible dans `docker ps` : `starting`, `healthy`, `unhealthy`.

```dockerfile
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  --start-period=20s CMD ["/ingest", "healthcheck"]
```

- `start-period` : période de grâce au démarrage (migrations, warmup).
- Docker seul **ne redémarre pas** un conteneur `unhealthy` ; Compose s'en sert pour `depends_on: condition: service_healthy`, Swarm pour remplacer. Kubernetes **ignore** `HEALTHCHECK` et utilise ses propres probes.
- Un endpoint `/health` léger : process vivant et capable de servir. Ne fais pas dépendre la santé d'une API tierce, sinon une panne externe te fait tout redémarrer.

## Cas réel

`billing-api` : l'image de prod faisait 1,4 Go et le build CI 6 min. Diagnostic avec `docker history` :

1. Base `node:24` (full) → passée en `node:24-slim` : -800 Mo.
2. `COPY . .` en premier, donc `pnpm install` à chaque commit → copie du lockfile d'abord + cache mount pnpm : build de 6 min à 1 min 10 quand seules les sources changent.
3. `node_modules` contenait TypeScript, Vitest, ESLint → `pnpm prune --prod` dans le stage build : -180 Mo.
4. Le `.git` (300 Mo) et un dump `.sql` de test étaient dans le contexte → `.dockerignore`.
5. L'app tournait en root et écrivait des PDF de factures dans `/app/tmp` → `USER node`, écriture dans un volume monté, et `--read-only` au runtime.

Résultat : 210 Mo, build incrémental ~1 min, conteneur non-root.

## Pièges classiques

- `FROM node:latest` : build non reproductible, une montée de version majeure peut tout casser.
- Secret passé en `ARG`/`ENV` au build : il est lisible dans `docker history` et dans l'image. Utilise `--mount=type=secret`.
- `COPY . .` sans `.dockerignore` : `.env` dans l'image publiée.
- `CMD npm start` (forme shell + npm) : SIGTERM perdu, arrêt en 10 s par SIGKILL.
- `apt-get update` dans un `RUN` séparé de l'`install` : cache de l'index périmé.
- Builder Rust en trixie, runtime en bookworm : erreur glibc au démarrage.
- Image Alpine + dépendance native (`bcrypt`, `sharp`) compilée pour glibc : crash au runtime.
- App qui écoute sur `127.0.0.1` dans le conteneur.

## Défis

**1. Trouve les 6 problèmes dans ce Dockerfile.**

```dockerfile
FROM node:latest
WORKDIR /app
COPY . .
ARG NPM_TOKEN
RUN echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" > .npmrc
RUN npm install -g pnpm && pnpm install
RUN pnpm build
EXPOSE 3000
CMD pnpm start
```

::: details Solution
1. `node:latest` : version non épinglée et image full (~1 Go). → `node:24-slim`.
2. `COPY . .` avant l'install : cache des deps invalidé à chaque modif. → copier `package.json` + `pnpm-lock.yaml` d'abord.
3. `NPM_TOKEN` en `ARG` et `.npmrc` écrit dans un layer : le token fuit dans l'image. → `RUN --mount=type=secret,id=npmrc,target=/app/.npmrc pnpm install …`.
4. `pnpm install` sans `--frozen-lockfile`, pnpm installé sans version fixe. → `corepack enable` + `packageManager`.
5. Un seul stage : devDependencies et sources dans l'image finale. → multi-stage + `pnpm prune --prod`.
6. Tourne en root, et `CMD pnpm start` en forme shell : signaux mal relayés. → `USER node` et `CMD ["node", "dist/main.js"]`.

Bonus : pas de `.dockerignore` mentionné, pas de `HEALTHCHECK`.
:::

**2. Restart en boucle.** `docker ps` montre `Restarting (1) 3 seconds ago` pour `ingest`. `docker logs ingest` :

```text
/ingest: /lib/x86_64-linux-gnu/libc.so.6:
  version `GLIBC_2.39' not found (required by /ingest)
```

Explique et corrige.

::: details Solution
Le binaire a été compilé dans un builder dont la glibc (Debian trixie : 2.41) est plus récente que celle du runtime (ex. `distroless/cc-debian12`, bookworm : 2.36). Le binaire exige des symboles absents.

Correctif : aligner les deux (`cargo-chef:latest-rust-1-trixie` + `distroless/cc-debian13`), ou builder en bookworm, ou compiler en musl statique pour `scratch`. Ajoute un test de démarrage de l'image en CI (`docker run --rm image --version`) pour attraper ça avant la prod.
:::

**3. Pourquoi ça prend 10 s ?** `docker stop billing` prend toujours exactement 10 secondes, et les logs ne montrent jamais « shutdown complete ». Le Dockerfile finit par `CMD npm run start`. Pourquoi, et deux façons de corriger ?

::: details Solution
`docker stop` envoie SIGTERM au PID 1, attend 10 s, puis SIGKILL. Le PID 1 est `/bin/sh -c "npm run start"` (forme shell) ou `npm`, qui ne transmettent pas (ou mal) SIGTERM à `node`. Résultat : rien ne se passe, SIGKILL au bout de 10 s.

1. `CMD ["node", "dist/main.js"]` (forme exec) + handler SIGTERM dans l'app.
2. Ajouter un init minimal : `docker run --init` (tini) ou `init: true` dans Compose, qui relaie les signaux et ramasse les zombies.
:::

**4. Écris la commande.** Construis l'image de `ingest` pour **amd64 et arm64** (ton laptop est un Mac ARM, ton serveur est x86) et pousse-la sur `ghcr.io/acme/ingest` avec le tag du commit courant.

::: details Solution
```bash
docker buildx create --use --name multi   # une fois
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/acme/ingest:$(git rev-parse --short HEAD) \
  --push .
```

Pour Rust, l'émulation QEMU de l'architecture étrangère est très lente : préfère la cross-compilation (`--platform=$BUILDPLATFORM` sur le stage builder + `cargo build --target` selon `TARGETARCH`) ou des runners natifs ARM en CI.
:::

**5. Cache cassé.** Le build Rust recompile toutes les dépendances à chaque commit, alors que tu utilises cargo-chef. Le Dockerfile contient `COPY . .` dans le stage `chef` (avant le `planner`). Explique.

::: details Solution
Si `COPY . .` est dans le stage `chef` (la base commune), le stage `builder` hérite d'un layer qui change à chaque commit : tout ce qui suit, y compris `cargo chef cook`, est invalidé. Le `COPY . .` doit être **uniquement** dans `planner` (pour produire `recipe.json`) puis dans `builder` **après** le `cook`. Le `recipe.json` est déterministe : tant que les deps ne bougent pas, le layer `cook` reste en cache.
:::

## À retenir

- Image = layers immuables ; conteneur = process isolé + couche inscriptible éphémère.
- Ordre des instructions : lockfile → install → sources → build, pour maximiser le cache.
- Multi-stage systématique : builder lourd, runtime minimal (`node:24-slim`, distroless, `scratch`).
- Non-root, forme exec pour `CMD`/`ENTRYPOINT`, gestion de SIGTERM.
- Jamais de secret en `ARG`/`ENV`/`COPY` : `--mount=type=secret`.
- `.dockerignore` dès le premier commit.
