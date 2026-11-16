# Kubernetes

Ce que tu vas apprendre : les objets Kubernetes qu'un dev back manipule au quotidien (pods, deployments, services, ingress, config, secrets), les probes et ressources qui font la différence en prod, l'autoscaling, le rolling update, et les commandes `kubectl` de survie.

## Le modèle mental

Kubernetes est une **boucle de réconciliation** : tu déclares l'état voulu (« 3 réplicas de `billing-api:sha-3f2c` »), des contrôleurs comparent en permanence avec l'état réel et corrigent. Tu ne lances pas de conteneurs, tu décris un état.

```text
Deployment  -> ReplicaSet -> Pods (1..n conteneurs)
Service     -> IP stable + DNS devant des pods (labels)
Ingress / Gateway -> routage HTTP externe -> Service
ConfigMap / Secret -> config injectée dans les pods
```

Ce qu'on attend d'un dev back : lire et modifier les manifests de son service, déboguer un pod qui ne démarre pas, comprendre un rollout. Pas d'administrer le cluster.

## Pod

Le **pod** est l'unité de base : un ou plusieurs conteneurs qui partagent le réseau (même IP, `localhost`) et des volumes. On ne crée presque jamais de pod à la main : un Deployment s'en charge. Un pod est **éphémère** : il peut être tué et recréé ailleurs, avec une autre IP.

Cycle de vie et statuts à reconnaître :

| Statut | Signification |
|---|---|
| `Pending` | Pas encore placé (ressources, PVC, affinité) |
| `ContainerCreating` | Pull d'image, montage des volumes |
| `Running` | Au moins un conteneur tourne |
| `CrashLoopBackOff` | Crash répété, backoff croissant |
| `ImagePullBackOff` | Image introuvable ou accès refusé |
| `OOMKilled` | Dépassement de la limite mémoire |

## Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: billing-api
  labels: { app: billing-api }
spec:
  replicas: 3
  selector:
    matchLabels: { app: billing-api }
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }
  template:
    metadata:
      labels: { app: billing-api }
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: api
          image: ghcr.io/acme/billing-api:sha-3f2c1a7
          ports: [{ name: http, containerPort: 3000 }]
          envFrom:
            - configMapRef: { name: billing-config }
            - secretRef: { name: billing-secrets }
```

- `selector.matchLabels` doit correspondre aux labels du `template` ; il est **immuable** après création.
- `maxUnavailable: 0` + `maxSurge: 1` : on ajoute un nouveau pod, on attend qu'il soit **ready**, puis on retire un ancien. Jamais moins de 3 pods prêts.
- Changer **n'importe quoi** dans `template` (image, env, annotation) déclenche un rollout.

## Probes

Trois probes, trois questions différentes :

| Probe | Question | Si échec |
|---|---|---|
| `startupProbe` | A-t-il fini de démarrer ? | Retente, puis restart |
| `readinessProbe` | Peut-il recevoir du trafic ? | Retiré du Service |
| `livenessProbe` | Est-il bloqué sans espoir ? | Conteneur **redémarré** |

```yaml
          startupProbe:
            httpGet: { path: /health, port: http }
            periodSeconds: 2
            failureThreshold: 30     # 60 s max pour démarrer
          readinessProbe:
            httpGet: { path: /ready, port: http }
            periodSeconds: 5
            failureThreshold: 2
          livenessProbe:
            httpGet: { path: /health, port: http }
            periodSeconds: 10
            failureThreshold: 3
```

- `/ready` peut vérifier la DB (si la DB est inaccessible, ne pas recevoir de trafic est raisonnable).
- `/health` (liveness) doit vérifier **uniquement le process** : jamais la DB ou une API tierce. Sinon une panne de Postgres redémarre tous tes pods en boucle, ce qui aggrave l'incident.
- Pas de `startupProbe` sur une app lente au démarrage → la liveness la tue avant qu'elle soit prête → `CrashLoopBackOff`.

## Resources et limits

```yaml
          resources:
            requests: { cpu: 250m, memory: 256Mi }
            limits: { memory: 512Mi }
```

- **requests** : ce que le scheduler **réserve** pour placer le pod. Base du calcul de l'HPA.
- **limits** : plafond. Mémoire dépassée → **OOMKilled** (exit 137). CPU dépassé → **throttling** (le process est ralenti, pas tué).
- `250m` = 0,25 vCPU. `Mi` = mébioctet.
- Pratique courante : limite mémoire = obligatoire ; limite CPU souvent omise (le throttling cause des pics de latence absurdes), à condition que les requests soient justes.

::: warning Node.js et la mémoire
V8 dimensionne son heap selon ses propres heuristiques, pas toujours alignées sur la limite du conteneur. Fixe-le explicitement à ~75 % de la limite : `NODE_OPTIONS=--max-old-space-size=384` pour 512Mi. Le reste sert aux buffers, à la pile, aux modules natifs. En Rust, pas de GC : la mémoire suit ta charge, surveille-la sous test de charge pour fixer la limite.
:::

## Service

Les pods changent d'IP ; un **Service** donne une IP virtuelle stable et un nom DNS, et répartit vers les pods **ready** qui matchent son selector.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: billing-api
spec:
  selector: { app: billing-api }
  ports:
    - name: http
      port: 80
      targetPort: http
```

Joignable dans le cluster par `http://billing-api` (même namespace) ou `billing-api.billing.svc.cluster.local`.

| Type | Usage |
|---|---|
| `ClusterIP` (défaut) | Interne au cluster |
| `NodePort` | Port ouvert sur chaque nœud (rarement utile) |
| `LoadBalancer` | Provisionne un LB du cloud |

## Ingress et Gateway API

L'**Ingress** route le HTTP externe (domaine, chemin) vers des Services. Il faut un **controller** installé dans le cluster (Traefik, HAProxy, NGINX Inc., celui du cloud…).

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: billing-api
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  ingressClassName: traefik
  tls:
    - hosts: [api.exemple.fr]
      secretName: billing-api-tls
  rules:
    - host: api.exemple.fr
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: billing-api, port: { name: http } }
```

**cert-manager** obtient et renouvelle le certificat Let's Encrypt et le stocke dans le Secret `billing-api-tls`.

::: info Ingress NGINX retiré, Gateway API
Le controller communautaire `ingress-nginx` a été retiré par le projet Kubernetes (fin de maintenance en mars 2026). L'API `Ingress` reste stable et supportée par d'autres controllers, mais les nouveaux projets partent sur la **Gateway API** (`Gateway` + `HTTPRoute`), plus expressive (poids par backend pour du canary, headers, séparation des rôles infra/dev).
:::

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: billing-api
spec:
  parentRefs: [{ name: public-gateway, namespace: infra }]
  hostnames: [api.exemple.fr]
  rules:
    - backendRefs:
        - { name: billing-api, port: 80, weight: 90 }
        - { name: billing-api-canary, port: 80, weight: 10 }
```

## ConfigMap et Secret

```yaml
apiVersion: v1
kind: ConfigMap
metadata: { name: billing-config }
data:
  LOG_LEVEL: info
  NODE_OPTIONS: --max-old-space-size=384
---
apiVersion: v1
kind: Secret
metadata: { name: billing-secrets }
type: Opaque
stringData:
  DATABASE_URL: postgres://app:CHANGE_ME@pg:5432/billing
```

- Un Secret est **encodé en base64**, pas chiffré. Il est lisible par quiconque a le droit `get secrets` sur le namespace, et en clair dans etcd si le chiffrement au repos n'est pas activé.
- Ne commite jamais un Secret en clair : utilise **External Secrets Operator** (synchronise depuis Vault/AWS Secrets Manager), **Sealed Secrets** ou **SOPS** (cf. [Sécurité & secrets](/infra/10-securite-et-secrets)).
- Changer une ConfigMap utilisée en `envFrom` ne met **pas** à jour les pods existants : il faut un rollout (`kubectl rollout restart`, ou un hash de la config en annotation du template, ce que font Helm et Kustomize).

## HPA : autoscaling horizontal

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: billing-api }
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: billing-api
  minReplicas: 3
  maxReplicas: 15
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: 70 }
```

- Utilisation = consommation / **requests**. Sans `requests.cpu`, l'HPA ne peut rien calculer.
- Nécessite **metrics-server** dans le cluster.
- Ne fixe pas `replicas` dans le Deployment si un HPA le gère : chaque `kubectl apply` remettrait le compte à la valeur du manifest.
- Pour un **worker** de jobs, scaler sur la CPU est peu pertinent : scale sur la longueur de la queue (KEDA).

## Rolling update et arrêt propre

Pendant un rollout, un pod qui s'arrête reçoit SIGTERM **en même temps** qu'il est retiré des endpoints du Service. La propagation prend quelques secondes : des requêtes arrivent encore sur un pod qui ferme. Solution : attendre un peu avant de fermer.

```yaml
          lifecycle:
            preStop:
              sleep: { seconds: 5 }
```

(L'action `sleep` existe depuis Kubernetes 1.30 ; elle évite d'avoir besoin d'un binaire `sleep` dans une image distroless.) Ensuite l'app reçoit SIGTERM et fait son graceful shutdown, dans la limite de `terminationGracePeriodSeconds`.

```bash
kubectl rollout status deploy/billing-api
kubectl rollout history deploy/billing-api
kubectl rollout undo deploy/billing-api        # version précédente
kubectl rollout undo deploy/billing-api --to-revision=4
kubectl set image deploy/billing-api api=ghcr.io/acme/billing-api:sha-9e1d
kubectl rollout restart deploy/billing-api
```

Un **PodDisruptionBudget** (`minAvailable: 2`) empêche qu'une maintenance de nœuds tue trop de pods à la fois.

## kubectl de survie

```bash
kubectl config get-contexts
kubectl config use-context prod      # ATTENTION au contexte
kubectl -n billing get pods -o wide
kubectl get deploy,svc,ingress,hpa -n billing
kubectl describe pod <pod>           # Events en bas !
kubectl logs <pod> -c api --tail 100 -f
kubectl logs <pod> --previous        # le conteneur crashé
kubectl logs -l app=billing-api --since 10m
kubectl get events -n billing --sort-by=.lastTimestamp
kubectl exec -it <pod> -- sh
kubectl debug -it <pod> --image=busybox --target=api
kubectl port-forward svc/billing-api 3000:80
kubectl top pods -n billing
kubectl get pod <pod> -o yaml | less
kubectl explain deployment.spec.strategy
kubectl diff -f k8s/                 # avant apply
kubectl apply -f k8s/
```

- `describe` + `Events` : explique 80 % des pods bloqués (image introuvable, probe en échec, OOM, PVC).
- `logs --previous` : les logs du conteneur **avant** son dernier crash.
- `kubectl debug --target` : ajoute un conteneur éphémère avec des outils dans un pod distroless, en partageant son namespace de processus.
- Mets le contexte et le namespace dans ton prompt shell : un `delete` sur le mauvais cluster arrive vite.

## Déployer l'API

Arborescence typique avec **Kustomize** (intégré à `kubectl`) :

```text
k8s/
  base/
    deployment.yaml  service.yaml  ingress.yaml
    kustomization.yaml
  overlays/
    staging/kustomization.yaml
    production/kustomization.yaml
```

```yaml
# k8s/overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: billing
resources: [../../base]
images:
  - name: ghcr.io/acme/billing-api
    newTag: sha-3f2c1a7
replicas:
  - name: billing-api
    count: 3
```

```bash
kubectl kustomize k8s/overlays/production   # rendu
kubectl apply -k k8s/overlays/production
```

En CI, le job de déploiement met à jour `newTag` (commit dans un repo de config, puis **Argo CD** ou **Flux** synchronise : c'est le **GitOps**), ou lance `kubectl apply -k` avec des credentials OIDC.

Les **migrations** : un `Job` Kubernetes lancé avant le rollout (hook Helm `pre-upgrade`, sync wave Argo CD), pas dans le démarrage de chaque pod (3 pods = 3 migrations concurrentes).

## Cas réel

Mise en prod de `ingest` (Rust) sur un cluster managé. Trois incidents la première semaine :

1. **`CrashLoopBackOff` au déploiement** : `describe` montre `Liveness probe failed: connection refused`. Le binaire applique des migrations SQLx au démarrage (8 s) ; la liveness démarrait à 0 s avec `failureThreshold: 3` × `periodSeconds: 2`. → `startupProbe`, et migrations sorties dans un `Job`.
2. **Pics de latence p99 à 800 ms** sans charge : `limits.cpu: 200m` sur un runtime Tokio multi-thread qui voyait 8 cœurs. Throttling CFS. → limite CPU retirée, `requests.cpu: 500m`, et `TOKIO_WORKER_THREADS=2`.
3. **Erreurs 502 à chaque déploiement** : pas de `preStop`, des requêtes arrivaient sur des pods en train de fermer. → `preStop: sleep 5` + graceful shutdown Axum.

## Pièges classiques

- Liveness qui vérifie la DB : redémarrages en cascade lors d'une panne Postgres.
- Pas de `requests` : scheduling au hasard, HPA aveugle, pods évincés en premier.
- Image `:latest` avec `imagePullPolicy: IfNotPresent` : le nœud garde l'ancienne image.
- Croire qu'un Secret est chiffré.
- Modifier une ConfigMap et attendre que les pods la prennent en compte.
- `kubectl edit` en prod : la modif sera écrasée au prochain `apply` et n'est pas dans Git.
- Mauvais contexte kubectl.
- Migrations lancées par chaque réplica au démarrage.

## Défis

**1. CrashLoopBackOff.** `kubectl get pods` : `billing-api-7d9f… 0/1 CrashLoopBackOff 6 (2m ago)`. Donne l'ordre exact des commandes de diagnostic et ce que tu cherches dans chacune.

::: details Solution
```bash
kubectl describe pod billing-api-7d9f…
# Last State: Terminated, Reason: Error/OOMKilled,
# Exit Code ; Events : probe failed ? pull ?
kubectl logs billing-api-7d9f… --previous
# la stack trace du crash (config manquante,
# DATABASE_URL invalide, migration en échec)
kubectl get events --sort-by=.lastTimestamp | tail
```

Lecture de l'exit code : `1` = erreur applicative (lire les logs), `137` = SIGKILL (OOMKilled ou liveness qui tue), `139` = segfault, `0` avec `restartPolicy: Always` = le process se termine normalement alors qu'il devrait tourner (mauvaise commande).
:::

**2. Trouve les 6 problèmes dans ce manifest.**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: ingest }
spec:
  replicas: 2
  selector: { matchLabels: { app: ingest } }
  template:
    metadata: { labels: { app: ingest-api } }
    spec:
      containers:
        - name: ingest
          image: ghcr.io/acme/ingest:latest
          env:
            - { name: DATABASE_URL, value: "postgres://app:S3cret@pg/ingest" }
          livenessProbe:
            exec: { command: ["sh", "-c", "pg_isready -h pg"] }
```

::: details Solution
1. Les labels du template (`ingest-api`) ne matchent pas le selector (`ingest`) : l'API refuse le Deployment.
2. `:latest` : pas de traçabilité, rollout non déclenché sur une nouvelle image, rollback impossible. → tag `sha-…`.
3. Secret en clair dans le manifest → Secret + `secretKeyRef` (et le Secret géré par External Secrets/SOPS).
4. Liveness qui teste **la DB** → redémarre tout si Postgres tombe. Et `sh`/`pg_isready` n'existent pas dans une image distroless.
5. Pas de `readinessProbe` ni de `startupProbe` : le trafic arrive avant que l'app soit prête.
6. Pas de `resources` (requests/limits) : HPA impossible, risque d'OOM du nœud.

Bonus : pas de `ports` nommés, pas de `preStop`, `replicas: 2` sans PDB.
:::

**3. OOMKilled.** Le pod de `billing-api` (Node, limite `512Mi`) est `OOMKilled` toutes les 3 h environ. `kubectl top` montre une mémoire qui monte doucement de 200 à 500 Mi. Hypothèses et actions ?

::: details Solution
Une montée lente et régulière = **fuite mémoire** probable (cache en mémoire sans borne, listeners accumulés, closures retenues, Map de sessions), pas un pic de charge.

1. Court terme : vérifier `--max-old-space-size` (à ~384 pour 512Mi). Sans lui, V8 peut viser un heap trop gros et le noyau tue le process avant que le GC ne réagisse.
2. Mesurer : métrique `nodejs_heap_size_used_bytes` (prom-client), heap snapshots à 1 h d'intervalle (`node --heapsnapshot-signal=SIGUSR2`) comparés dans Chrome DevTools.
3. Corriger la cause (LRU borné, `removeListener`). Augmenter la limite ne fait que retarder le crash.

Cf. [Performance Node](/dev/typescript/09-performance-node).
:::

**4. Écris les commandes.** a) Déployer l'image `sha-9e1d` sur le deployment `billing-api` du namespace `billing` et suivre le rollout. b) Ça casse : revenir en arrière. c) Accéder à l'API depuis ton laptop sans Ingress. d) Lister les pods qui ne sont pas `Running`.

::: details Solution
```bash
# a)
kubectl -n billing set image deploy/billing-api \
  api=ghcr.io/acme/billing-api:sha-9e1d
kubectl -n billing rollout status deploy/billing-api
# b)
kubectl -n billing rollout undo deploy/billing-api
# c)
kubectl -n billing port-forward svc/billing-api 3000:80
# d)
kubectl get pods -A --field-selector=status.phase!=Running
```

En GitOps, a) et b) se font par un commit (et un revert) dans le repo de config, sinon Argo CD réécrit ta modif manuelle.
:::

**5. L'HPA ne scale pas.** `kubectl get hpa` affiche `TARGETS: <unknown>/70%`. Deux causes possibles ?

::: details Solution
1. **metrics-server** absent ou en erreur : `kubectl top pods` échoue aussi.
2. Les conteneurs n'ont **pas de `requests.cpu`** : l'utilisation en pourcentage est incalculable (`missing request for cpu` dans `kubectl describe hpa`).

Aussi possible : le `scaleTargetRef` pointe sur un mauvais nom. `kubectl describe hpa billing-api` donne la condition exacte.
:::

## À retenir

- Kubernetes réconcilie un état déclaré : tu modifies des manifests, pas des conteneurs.
- Startup, readiness, liveness : trois probes, trois rôles ; la liveness ne teste jamais une dépendance.
- `requests` pour le scheduling et l'HPA, `limits.memory` obligatoire, prudence avec `limits.cpu`.
- Un Secret n'est pas chiffré ; une ConfigMap modifiée n'est pas rechargée.
- Rolling update sans erreur = readiness + `preStop` + graceful shutdown.
- `describe`, `logs --previous`, `get events` d'abord ; `rollout undo` pour revenir en arrière.
