# Déployer un job planifié

Ce que tu vas apprendre : livrer le crate sous forme d'image Docker et le faire tourner seul, à heure fixe, sur Kubernetes (k3s). Un Dockerfile multi-stage qui met en cache les dépendances cargo, une image finale minimale et non root, un CronJob borné (`schedule`, `concurrencyPolicy: Forbid`, `backoffLimit`, `activeDeadlineSeconds`, historiques), un volume persistant pour l'état, des ressources mémoire sans limite CPU (et pourquoi), les secrets en variables d'environnement, et le lancement manuel d'un essai.

## L'image : multi-stage

Un build Rust a besoin de la toolchain (plus de 1 Go). L'exécution n'a besoin que du binaire. Le *multi-stage build* sépare les deux : un étage `build` qui compile, un étage final qui ne reçoit que les binaires.

```dockerfile
FROM rust:1.95-bookworm AS build
WORKDIR /src

# 1. Dépendances seules, sur un code vide
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
RUN mkdir -p src/bin \
 && echo '' > src/lib.rs \
 && echo 'fn main() {}' > src/bin/sync.rs \
 && echo 'fn main() {}' > src/bin/scraper.rs \
 && cargo build --release --locked \
 && rm -rf src

# 2. Le vrai code
COPY src ./src
ARG VERSION=dev
RUN touch src/lib.rs src/bin/*.rs \
 && APP_VERSION=${VERSION} cargo build --release --locked \
 && mkdir -p /out /data \
 && cp target/release/sync target/release/scraper /out/
```

## Le cache des dépendances, expliqué

Docker met en cache chaque instruction tant que ses entrées (fichiers copiés, commande) ne changent pas. Compiler 300 crates de dépendances prend des minutes ; ton code, quelques secondes.

L'astuce de l'étape 1 : copier **seulement** `Cargo.toml` et `Cargo.lock`, compiler un projet **vide** qui a les mêmes dépendances. Cette couche ne se reconstruit que si les dépendances changent. Quand tu modifies `src/`, Docker repart de l'étape 2 avec toutes les dépendances déjà compilées dans `target/`.

Deux détails qui piègent :

- **`touch`** : cargo décide de recompiler en comparant les dates. Les fichiers copiés par `COPY` peuvent avoir une date **plus ancienne** que les binaires vides de l'étape 1 ; sans `touch`, cargo garde le `fn main() {}` vide et ton image ne fait rien.
- **`--locked`** : refuse de construire si `Cargo.lock` n'est pas à jour. L'image contient exactement les versions testées en CI, pas une résolution fraîche.

| Alternative | Pour | Contre |
|---|---|---|
| le « main vide » ci-dessus | zéro outil | à mettre à jour si tu ajoutes un binaire |
| `cargo-chef` | gère workspaces et binaires seul | un outil de plus dans le build |
| `RUN --mount=type=cache` (BuildKit) | cache `target/` entre builds | cache local au builder, pas partagé en CI sans config |

La version (`ARG VERSION`, souvent le tag git) est injectée à la **compilation** et lue par `option_env!("APP_VERSION")` : chaque binaire sait quelle version il est, et l'écrit dans ses logs et son signal de vie.

## L'étage final : distroless, non root

```dockerfile
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /out/ /usr/local/bin/
COPY --from=build --chown=65532:65532 /data /data
WORKDIR /data
ENV DATA_DIR=/data
USER 65532:65532
ENTRYPOINT []
```

| Image finale | Taille | Contient | Quand |
|---|---|---|---|
| `debian:bookworm-slim` | ~75 Mo | shell, apt, glibc | besoin d'outils (ex. un `pg_dump`) |
| **`distroless/cc`** | ~25 Mo | glibc, libgcc, certificats CA, user `nonroot` | binaire Rust lié dynamiquement à la glibc |
| `distroless/static` ou `scratch` | ~2 Mo | (presque) rien | binaire **statique** (cible musl) |

**Pourquoi `cc` et pas `static`** : par défaut, un binaire Rust sur Linux est lié dynamiquement à la glibc. Il a besoin de `libc.so` à l'exécution. Pour une image `scratch`, il faut compiler pour `x86_64-unknown-linux-musl` (binaire statique). Le coût de musl : un allocateur mémoire plus lent sous forte concurrence (remplaçable par `mimalloc`) et parfois des crates C à recompiler. Pour un job réseau, `distroless/cc` est le bon compromis.

**Même Debian aux deux étages** (`bookworm` pour le build, `debian12` pour distroless) : le binaire est lié à la glibc du build, il doit trouver une glibc au moins aussi récente à l'exécution.

**Les certificats CA** sont indispensables : sans eux, toute requête HTTPS échoue (`invalid peer certificate`). `rustls` peut embarquer ses racines (`webpki-roots`) ou lire celles du système ; distroless les fournit.

**Non root** : `USER 65532:65532` (l'utilisateur `nonroot` de distroless). Si quelqu'un exploite une faille du parsing HTML, il n'est pas root dans le conteneur. Mets l'UID **numérique** : `runAsNonRoot: true` côté Kubernetes ne peut pas vérifier un nom, et refuse de démarrer le conteneur (`CreateContainerConfigError`).

**Pas de shell** : `kubectl exec -- sh` ne marche pas. C'est voulu (moins de surface d'attaque) ; pour déboguer, `kubectl debug` attache un conteneur éphémère avec des outils.

`ENTRYPOINT []` sans `CMD` : l'image contient deux binaires, chaque CronJob donne sa commande.

## Le CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: sync-supplier-a
spec:
  schedule: "0 2 * * *"          # 2 h chaque nuit
  timeZone: Europe/Paris
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 3600
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      activeDeadlineSeconds: 7200
      backoffLimit: 2
      podFailurePolicy:
        rules:
          - action: FailJob
            onExitCodes: { operator: In, values: [2] }
          - action: Ignore
            onPodConditions: [{ type: DisruptionTarget }]
      template:   # suite plus bas
```

Chaque champ répond à une panne précise :

| Champ | Problème résolu |
|---|---|
| `schedule` + `timeZone` | sans `timeZone`, l'heure est celle du contrôleur (souvent UTC), et le job glisse d'une heure aux changements d'heure |
| `concurrencyPolicy: Forbid` | un run qui dure plus que l'intervalle ne lance pas un second run en parallèle : le suivant est sauté |
| `startingDeadlineSeconds` | si le contrôleur était indisponible à l'heure prévue, il rattrape le run jusqu'à 1 h après ; au-delà, il le saute |
| `successfulJobsHistoryLimit` / `failedJobsHistoryLimit` | garde les 3 derniers Jobs et leurs pods pour lire les logs, sans accumuler des centaines d'objets |
| `activeDeadlineSeconds` | le **dernier filet** : un run bloqué est tué après 2 h (SIGTERM, puis SIGKILL) |
| `backoffLimit: 2` | un échec (code 1) est réessayé 2 fois avec un nouveau pod |
| `podFailurePolicy` | code 2 (config invalide) : échec immédiat du Job, sans réessai inutile ; pod évincé (nœud drainé) : ne compte pas comme un échec |

`Forbid` et le verrou d'instance du chapitre 4 se complètent : Kubernetes empêche deux Jobs du même CronJob, le verrou empêche le CronJob **plus** un lancement manuel sur la même base.

`activeDeadlineSeconds` couvre la durée totale du Job, réessais compris. Calibre-le sur la durée réelle mesurée, avec de la marge : un scraping de 20 h avec une deadline de 12 h est tué à chaque run (et ne reprend que grâce à l'incrémental).

::: info `podFailurePolicy` exige `restartPolicy: Never`
Avec `OnFailure`, le kubelet redémarre le conteneur dans le même pod et la politique ne voit jamais le code de sortie. `Never` : chaque essai est un nouveau pod, avec ses propres logs (et son propre `POD_NAME` pour le signal de vie).
:::

## Le pod : volume, ressources, secrets

```yaml
      template:
        spec:
          restartPolicy: Never
          terminationGracePeriodSeconds: 60
          securityContext:
            runAsNonRoot: true
            fsGroup: 65532
          containers:
            - name: sync
              image: registry.example/catalog-jobs:1.4.0
              args: ["sync", "--provider", "supplier-a"]
              envFrom:
                - secretRef: { name: catalog-jobs-env }
              env:
                - name: POD_NAME
                  valueFrom:
                    fieldRef: { fieldPath: metadata.name }
              resources:
                requests: { cpu: 50m, memory: 64Mi }
                limits: { memory: 256Mi }
              volumeMounts:
                - { name: data, mountPath: /data }
          volumes:
            - name: data
              persistentVolumeClaim:
                claimName: catalog-jobs-data
```

**`terminationGracePeriodSeconds: 60`** : le délai entre SIGTERM et SIGKILL. Il doit couvrir la somme des nettoyages bornés (chapitre 5 : 5 s chacun).

**`fsGroup: 65532`** : les fichiers du volume monté appartiennent au groupe 65532, l'utilisateur non root peut y écrire. Sans lui, le PVC est souvent à root, et le job échoue sur `Permission denied` à l'ouverture de la base SQLite.

**`POD_NAME` par la downward API** : un identifiant unique par essai, utilisé comme `runId` du signal de vie.

## Le volume persistant pour l'état

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: catalog-jobs-data
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests: { storage: 2Gi }
```

Sans volume, chaque pod démarre avec un disque vide : l'incrémental du chapitre 4 repart de zéro à chaque run. Avec un PVC, la base SQLite survit d'un pod à l'autre.

`ReadWriteOnce` : montable en écriture par **un seul nœud** à la fois. Sur un cluster mono-nœud (k3s avec le `local-path` provisioner), tous les jobs peuvent le partager. Sur plusieurs nœuds, deux jobs planifiés sur des nœuds différents ne peuvent pas monter le même PVC en même temps : un PVC par job, ou des horaires décalés.

Un dossier par environnement (`DATA_DIR`) : la base d'état retient ce qui a été publié sur **un** broker. Copier la base de staging vers la prod ferait croire à la prod que tout est déjà publié.

## Requests et limits : mémoire oui, CPU non

| Ressource | `requests` | `limits` |
|---|---|---|
| CPU | **oui** : réserve pour l'ordonnanceur | **non** |
| mémoire | **oui** | **oui** |

**La `request`** est ce que l'ordonnanceur réserve sur le nœud. Sans elle, le pod est en classe *BestEffort* : premier tué en cas de pression mémoire.

**La limite mémoire** est un plafond dur : au-delà, le noyau tue le processus (**OOMKilled**, code 137). On la veut : un job qui fuit ne doit pas faire tomber le nœud et ses voisins.

**La limite CPU, on n'en met pas.** Elle est appliquée par le *CFS quota* du noyau : le conteneur a droit à X ms de CPU par période de 100 ms. Une fois le quota consommé, il est **gelé** jusqu'à la période suivante, même si le nœud est inoccupé. Pour un job qui fait des pointes (parser un CSV de 50 Mo, compresser une image), ça ajoute de la latence pour rien. Sans limite, le conteneur utilise le CPU libre, et la `request` lui garantit sa part quand le nœud est chargé.

Les valeurs viennent de la **mesure**, pas de l'intuition : `kubectl top pod` pendant un vrai run en staging, puis la limite mémoire à ~2-3× le pic observé. Un job Rust de ce type tient souvent sous 100 Mo ; la synchro qui charge un CSV entier en mémoire a besoin de plus.

## Les secrets en variables d'environnement

`envFrom.secretRef` injecte toutes les clés d'un Secret Kubernetes comme variables d'environnement. Le binaire les lit au démarrage (chapitre 1), la lib ne les voit que sous forme de struct.

Ce qui ne doit **jamais** être dans l'image : mots de passe, URL AMQP avec identifiants, clés S3. Une image est copiée dans des registres, des caches, des postes de dev ; un secret dedans est un secret publié. Règle de tri :

| Donnée | Où |
|---|---|
| version du binaire | compilée dans le binaire (`ARG`) |
| `DATA_DIR`, niveau de log | `env` du manifeste |
| identifiants, URL avec mot de passe | Secret (`envFrom`) |

Un Secret Kubernetes n'est qu'encodé en base64 dans etcd : active le chiffrement au repos du cluster, ou utilise un gestionnaire (Sealed Secrets, External Secrets) pour qu'ils ne soient pas en clair dans git.

## Lancer le job à la main

Pour un essai, ne recopie pas le manifeste : crée un Job **depuis** le CronJob, il hérite de tout (image, secrets, volume, ressources).

```bash
kubectl -n jobs create job \
  --from=cronjob/sync-supplier-a \
  sync-manual-$(date +%s)

kubectl -n jobs logs -f job/sync-manual-1763800000
```

Ça marche aussi sur un CronJob suspendu (`suspend: true`), pratique pour tester avant d'activer la planification. Pour un essai limité (`--limit 20`), il faut changer les `args` : `kubectl create job --from` ne le permet pas directement ; génère le YAML avec `--dry-run=client -o yaml`, modifie `args`, puis `kubectl apply -f`.

En local, la même image :

```bash
docker run --rm --env-file .env.staging \
  -v "$PWD/data:/data" \
  registry.example/catalog-jobs:1.4.0 \
  sync --provider supplier-a --limit 20
```

## Cas réel

La première mise en production du scraper : le pod démarre, puis `CreateContainerConfigError`. Cause : `runAsNonRoot: true` et une image avec `USER nonroot:nonroot` (un nom). Kubernetes ne peut pas vérifier qu'un nom correspond à un UID non nul. Correctif : `USER 65532:65532`.

Deuxième run : `Permission denied` sur `/data/state.db`. Le PVC est créé par le provisioner avec `root:root`. Correctif : `fsGroup: 65532`.

Troisième run : OK, 11 h 59, puis SIGTERM (`activeDeadlineSeconds: 43200`). Le bilan est écrit, le signal `failed` part, le run suivant reprend. La deadline est volontairement plus courte que le parcours complet : un premier run est découpé en deux nuits, les suivants (incrémentaux) tiennent en 3 h.

## Pièges classiques

- **Pas de cache de dépendances** : 10 minutes de build pour une ligne changée.
- **Oublier `touch`** après le build à vide : l'image contient le `main` vide.
- **Builder sans `--locked`** : l'image n'a pas les versions testées.
- **Image finale avec la toolchain** : 1,5 Go, et un compilateur dans le conteneur de prod.
- **`USER` par nom** avec `runAsNonRoot` : le pod ne démarre pas.
- **Pas de `fsGroup`** : volume en lecture seule pour l'utilisateur non root.
- **Pas de `timeZone`** : le job glisse aux changements d'heure.
- **`concurrencyPolicy: Allow`** (défaut) : deux runs simultanés sur le même état.
- **Pas d'`activeDeadlineSeconds`** : un run bloqué bloque tous les suivants (avec `Forbid`).
- **Limite CPU** : throttling CFS, latence même sur un nœud vide.
- **Secret dans l'image ou dans un `ENV` du Dockerfile** : publié avec l'image.
- **Question d'entretien** : « Pourquoi pas de limite CPU ? » → le quota CFS gèle le conteneur dès qu'il a consommé sa part de la période, même si le CPU est libre ; la `request` suffit à garantir sa part sous charge.
- **Question d'entretien** : « Différence entre `backoffLimit` et `restartPolicy` ? » → `restartPolicy` redémarre le conteneur dans le même pod (`OnFailure`) ou pas (`Never`) ; `backoffLimit` compte les échecs avant de déclarer le Job en échec.

## Défis

### 1. Exercice : quelle réaction pour quel code ?

Traduis en Rust la politique du CronJob : à partir du code de sortie (`None` = tué par un signal) et du nombre d'échecs déjà comptés, décide de l'action.

```rust play
#[derive(Debug, PartialEq)]
pub enum Action { Done, Retry, FailJob }

/// backoff_limit : réessais autorisés.
pub fn react(code: Option<i32>, failures: u32,
             backoff_limit: u32) -> Action {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use Action::*;

    #[test]
    fn policy() {
        assert_eq!(react(Some(0), 0, 2), Done);
        assert_eq!(react(Some(1), 0, 2), Retry);
        assert_eq!(react(Some(1), 2, 2), FailJob);
        assert_eq!(react(Some(2), 0, 2), FailJob, "config");
        assert_eq!(react(None, 0, 2), Retry, "OOM, SIGKILL");
    }
}
```

::: details Solution
```rust play
#[derive(Debug, PartialEq)]
pub enum Action { Done, Retry, FailJob }

pub fn react(code: Option<i32>, failures: u32,
             backoff_limit: u32) -> Action {
    match code {
        Some(0) => Action::Done,
        Some(2) => Action::FailJob, // podFailurePolicy
        _ if failures >= backoff_limit => Action::FailJob,
        _ => Action::Retry,
    }
}

fn main() {
    println!("{:?}", react(Some(137), 0, 2));
}
```

En vrai, un conteneur tué par SIGKILL (OOM) remonte le code **137** (128 + 9) dans le statut du pod ; c'est ce que voit `podFailurePolicy`. Réessayer un OOM avec la même limite échouera probablement de nouveau : c'est un signal pour monter la limite, pas pour monter `backoffLimit`.
:::

### 2. Exercice : la deadline tient-elle ?

Un job traite `items` éléments, à `gap` secondes chacun (politesse), plus 20 % de marge. Écris `fits` : `true` si le run tient dans `deadline`.

```rust play
use std::time::Duration;

pub fn fits(items: u64, gap: Duration,
            deadline: Duration) -> bool {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    const S: fn(u64) -> Duration = Duration::from_secs;

    #[test]
    fn cases() {
        // 1000 x 5 s = 5000 s, +20 % = 6000 s
        assert!(fits(1000, S(5), S(7200)));
        assert!(fits(1000, S(5), S(6000)));
        assert!(!fits(1000, S(5), S(5999)));
        // 40 000 vues x 2 s ne tiennent pas en 12 h
        assert!(!fits(40_000, S(2), S(12 * 3600)));
    }
}
```

::: details Solution
```rust play
use std::time::Duration;

pub fn fits(items: u64, gap: Duration,
            deadline: Duration) -> bool {
    let n = u32::try_from(items).unwrap_or(u32::MAX);
    let work = gap.saturating_mul(n);
    let with_margin = work.saturating_mul(6) / 5;
    with_margin <= deadline
}

fn main() {
    let s = Duration::from_secs;
    println!("{}", fits(40_000, s(2), s(12 * 3600)));
}
```

`Duration::saturating_mul` prend un `u32` : d'où le `try_from`. Le dernier cas est le cas réel du chapitre : 40 000 × 2 s × 1,2 = 26,7 h. Soit la deadline monte, soit on accepte un premier run en plusieurs fois grâce à l'incrémental.
:::

### 3. Question : pourquoi le job tourne deux fois en même temps ?

Le CronJob a `concurrencyPolicy: Forbid`. Pourtant, les logs montrent deux runs qui publient en parallèle sur la même base d'état. Comment est-ce possible, et quelle défense ?

::: details Solution
`Forbid` empêche deux Jobs **créés par le CronJob**. Un Job lancé à la main (`kubectl create job --from=cronjob/...`) n'est pas concerné : il tourne en parallèle du run planifié. Autre cas : un réessai (`backoffLimit`) pendant que l'ancien pod est encore en cours d'arrêt.

Défense dans le code, indépendante de l'orchestrateur : le verrou d'instance `flock` du chapitre 4. Le second run trouve le verrou pris et sort en 2, sans rien faire.
:::

### 4. Question : l'image ne fait rien

Le build passe, le CronJob se lance, le pod sort en 0 en une milliseconde, sans un log. Le Dockerfile est celui du chapitre, sans la ligne `touch`. Explique.

::: details Solution
L'étape 1 a compilé des binaires vides (`fn main() {}`) et les a laissés dans `target/`. À l'étape 2, `COPY src` dépose les vrais fichiers, mais avec une date de modification qui peut être **antérieure** à celle des artefacts de l'étape 1 (Docker préserve les dates du contexte de build). Cargo compare les dates, conclut que rien n'a changé, et garde les binaires vides. `touch` force la date à « maintenant ».
:::

## À retenir

- Multi-stage : compile dans `rust:*`, exécute dans `distroless/cc` (même Debian), binaires seuls, UID numérique non root.
- Couche de dépendances sur un code vide, puis `touch` et vrai build, toujours `--locked`.
- CronJob : `timeZone`, `Forbid`, `activeDeadlineSeconds` comme dernier filet, `backoffLimit` + `podFailurePolicy` pilotés par les codes de sortie.
- Un PVC (`ReadWriteOnce`, `fsGroup`) garde l'état entre les pods ; un dossier par environnement.
- `requests` CPU et mémoire, `limit` mémoire, **pas** de limite CPU ; valeurs mesurées.
- Secrets par `envFrom.secretRef`, jamais dans l'image ; essai manuel par `kubectl create job --from=cronjob/...`.
