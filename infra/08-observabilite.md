# Observabilité

Ce que tu vas apprendre : instrumenter une API Node et un service Rust avec des logs structurés, des métriques Prometheus et des traces OpenTelemetry, choisir quoi mesurer (RED, USE), définir des SLO et écrire des alertes qui réveillent seulement quand il faut.

## Les trois signaux

| Signal | Répond à | Coût |
|---|---|---|
| **Logs** | Que s'est-il passé pour *cette* requête ? | Élevé (volume) |
| **Métriques** | Combien, à quelle vitesse, quelle tendance ? | Faible |
| **Traces** | Où passe le temps dans *ce* parcours distribué ? | Moyen (échantillonné) |

Le workflow d'incident type : une **alerte** sur une métrique → le **dashboard** montre quand et quelle route → une **trace** lente montre quel appel → les **logs** de ce span donnent l'erreur exacte. Les trois signaux sont liés par un **`trace_id`** commun.

## Logs structurés

Un log est un **événement JSON**, pas une phrase. On le filtre et on l'agrège dans Loki, Elasticsearch, Datadog…

```json
{"level":"error","time":"2026-11-16T09:12:03.120Z",
 "service":"billing-api","trace_id":"4bf92f35…",
 "tenant_id":"acme","invoice_id":"inv_812",
 "err":{"type":"StripeError","message":"card_declined"},
 "msg":"invoice payment failed"}
```

Règles :

- **Niveaux** : `error` = action humaine nécessaire, `warn` = anormal mais géré, `info` = événements métier, `debug` = désactivé en prod.
- Champs **stables et nommés** (`tenant_id`, `invoice_id`), pas d'interpolation dans `msg` : `"invoice paid"` + champ, pas `"invoice inv_812 paid"`.
- Toujours un identifiant de corrélation : `trace_id` (ou `request_id`).
- **Jamais** de secrets ni de données perso en clair : tokens, mots de passe, numéros de carte, emails selon ta politique RGPD. Utilise la redaction.
- Logs sur **stdout** : Docker, systemd ou K8s les collectent. L'app n'écrit pas de fichiers.

### Node : pino

```ts
import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "billing-api" },
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "*.password",
    "*.cardNumber",
  ],
});

log.info({ invoiceId, tenantId }, "invoice paid");
log.error({ err, invoiceId }, "invoice payment failed");
```

Fastify utilise pino nativement (`Fastify({ logger: … })`) et ajoute un logger par requête (`req.log`) avec un `reqId`. pino est très rapide car il sérialise en JSON sans formatage ; le joli affichage en dev passe par `pino-pretty` dans un pipe, pas dans l'app.

### Rust : tracing

`tracing` structure les logs en **spans** (une unité de travail avec durée et champs) et **events** (un point dans le temps).

```rust play
use tracing::{info, instrument, warn};

#[derive(Debug)]
struct Event {
    tenant: String,
    kind: String,
}

#[instrument(skip(ev), fields(tenant = %ev.tenant, kind = %ev.kind))]
fn ingest(ev: &Event) -> Result<u64, String> {
    if ev.kind.is_empty() {
        warn!("événement sans type, rejeté");
        return Err("missing kind".into());
    }
    let id = 42;
    info!(event_id = id, "événement stocké");
    Ok(id)
}

fn main() {
    tracing_subscriber::fmt().with_target(false).init();
    let ok = Event { tenant: "acme".into(), kind: "click".into() };
    let ko = Event { tenant: "acme".into(), kind: String::new() };
    let _ = ingest(&ok);
    let _ = ingest(&ko);
}
```

En prod : `tracing_subscriber::fmt().json()` (feature `json`) + `EnvFilter` (feature `env-filter`, `RUST_LOG=info,sqlx=warn`). Avec Axum, `tower_http::trace::TraceLayer` crée un span par requête. `#[instrument]` ajoute tous les arguments en champs par défaut : `skip` ceux qui sont gros ou sensibles.

## Métriques avec Prometheus

Prometheus **scrape** (récupère par HTTP) `/metrics` sur chaque instance toutes les 15–30 s et stocke des séries temporelles.

Les types :

| Type | Exemple | Question |
|---|---|---|
| Counter | `http_requests_total` | Combien depuis le début ? (→ `rate`) |
| Gauge | `queue_jobs_pending` | Combien maintenant ? |
| Histogram | `http_request_duration_seconds` | Distribution, percentiles |

### Node : prom-client

```ts
import client from "prom-client";

client.collectDefaultMetrics(); // heap, event loop lag, GC

export const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Durée des requêtes HTTP",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

app.addHook("onResponse", async (req, reply) => {
  httpDuration
    .labels(req.method, req.routeOptions.url ?? "unknown",
      String(reply.statusCode))
    .observe(reply.elapsedTime / 1000);
});

app.get("/metrics", async (_req, reply) => {
  reply.type(client.register.contentType);
  return client.register.metrics();
});
```

`/metrics` ne doit pas être public : port séparé ou filtré par le proxy.

### Rust : metrics + exporter Prometheus

```rust
use metrics::{counter, histogram};
use metrics_exporter_prometheus::PrometheusBuilder;

// au démarrage : expose /metrics sur :9000
PrometheusBuilder::new()
    .with_http_listener(([0, 0, 0, 0], 9000))
    .install()?;

// dans le handler
counter!("ingest_events_total", "tenant" => tenant.clone())
    .increment(1);
histogram!("ingest_batch_size").record(batch.len() as f64);
```

(Attention, `tenant` en label n'est acceptable que si tu as quelques dizaines de tenants : voir cardinalité plus bas.)

### PromQL de base

```text
# débit par route
sum by (route) (rate(http_requests_total[5m]))

# taux d'erreurs 5xx
sum(rate(http_requests_total{status=~"5.."}[5m]))
  / sum(rate(http_requests_total[5m]))

# p99 de latence
histogram_quantile(0.99,
  sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
```

- Toujours `rate()` sur un counter : sa valeur brute ne veut rien dire (et repart à 0 au redémarrage, ce que `rate` gère).
- Les percentiles se calculent **depuis l'histogramme**, côté Prometheus. Ne fais jamais la moyenne de p99 calculés par instance.

::: danger Cardinalité
Chaque combinaison unique de labels crée une série. `user_id`, `invoice_id`, une URL brute (`/invoices/inv_812`) ou un message d'erreur en label = des millions de séries, Prometheus qui explose en mémoire. Labels = valeurs **bornées** : méthode, **route template** (`/invoices/:id`), code HTTP, nom de queue.
:::

## RED et USE : quoi mesurer

**RED** pour chaque **service** (ce que voit l'utilisateur) :

- **Rate** : requêtes par seconde.
- **Errors** : taux d'erreurs.
- **Duration** : latence (p50, p95, p99).

**USE** pour chaque **ressource** (CPU, mémoire, disque, pool DB, queue) :

- **Utilization** : % du temps occupé (CPU 80 %, pool 18/20).
- **Saturation** : travail en attente (runqueue, requêtes en attente d'une connexion, jobs en queue).
- **Errors** : erreurs de la ressource (timeouts d'acquisition, erreurs disque).

Spécifiques Node : **event loop lag** (`nodejs_eventloop_lag_p99_seconds`), heap. Spécifiques worker : âge du plus vieux job, durée de traitement, taux d'échec, nombre de retries.

## Traces avec OpenTelemetry

Une **trace** = l'arbre des **spans** d'une requête à travers les services. Le contexte se propage via le header W3C `traceparent` :

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             ver-trace_id----------------------- span_id--------- flags
```

```text
POST /invoices/inv_812/pay           480 ms  billing-api
├─ SELECT invoice                      4 ms  pg
├─ POST api.stripe.com/payment_intents 410 ms  http
└─ LPUSH jobs:email                    1 ms  redis
   └─ send-invoice-email (worker)    1.2 s  worker
```

**OpenTelemetry** (OTel) est le standard vendor-neutral : SDK dans l'app, export en **OTLP** vers un **collector**, qui envoie à Tempo, Jaeger, Honeycomb, Datadog…

### Node

```ts
// instrumentation.ts, chargé AVANT l'app
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations }
  from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter }
  from "@opentelemetry/exporter-trace-otlp-http";

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

```bash
OTEL_SERVICE_NAME=billing-api \
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
node --import ./dist/instrumentation.js dist/main.js
```

L'auto-instrumentation couvre HTTP, Fastify/Express, `pg`, `ioredis`, et ajoute `trace_id` dans les logs pino.

::: tip Zero-code et ESM
Variante sans fichier : `node --import @opentelemetry/auto-instrumentations-node/register dist/main.js`, configurée uniquement par les variables `OTEL_*`. Si ton app est en **ESM** (`"type": "module"`), l'instrumentation des modules importés demande en plus le hook ESM d'OpenTelemetry : suis la section ESM de la doc OTel JS, sinon tu n'auras que les spans HTTP de base.
:::

Span manuel pour une étape métier :

```ts
import { trace, SpanStatusCode } from "@opentelemetry/api";
const tracer = trace.getTracer("billing");

await tracer.startActiveSpan("compute-vat", async (span) => {
  try {
    span.setAttribute("invoice.lines", lines.length);
    return computeVat(lines);
  } catch (e) {
    span.recordException(e as Error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw e;
  } finally {
    span.end();
  }
});
```

### Rust

Avec `tracing`, tes spans `#[instrument]` deviennent des spans OTel grâce à la couche `tracing-opentelemetry` (crates `opentelemetry`, `opentelemetry_sdk`, `opentelemetry-otlp`) branchée sur le même `tracing_subscriber::registry()`. Les API de ces crates évoluent encore souvent : suis l'exemple du README de la version que tu installes. Propage `traceparent` en entrée (middleware) et sur les appels sortants `reqwest`.

### Échantillonnage

Tracer 100 % des requêtes coûte cher à fort trafic. **Head sampling** (décider au début, ex. 10 %) est simple ; **tail sampling** dans le collector (garder 100 % des traces en erreur ou lentes, 5 % du reste) est ce qu'on veut vraiment pour déboguer.

## SLI, SLO, error budget

- **SLI** (indicator) : une mesure du point de vue utilisateur. « Part des requêtes `POST /payments` réussies en moins de 500 ms ».
- **SLO** (objective) : la cible. « 99,9 % sur 30 jours glissants ».
- **Error budget** : 100 % − SLO. 99,9 % sur 30 jours = **43 min** d'indisponibilité tolérée (ou 0,1 % des requêtes).

| SLO | Budget / 30 j |
|---|---|
| 99 % | 7 h 12 |
| 99,9 % | 43 min |
| 99,99 % | 4 min 19 |

Le budget sert à **décider** : budget consommé → on gèle les features risquées et on fiabilise ; budget intact → on peut déployer plus vite. Un SLO de 100 % est une erreur : rien ne l'atteint, et ça interdit tout changement.

## Alerting

Une bonne alerte est **actionnable**, **urgente** et porte sur un **symptôme utilisateur**. « CPU à 85 % » n'est pas une alerte de page : si les utilisateurs ne souffrent pas, ça peut attendre lundi.

Alerte sur le **burn rate** du budget (consommation plus rapide que prévu), sur deux fenêtres pour éviter les faux positifs :

```yaml
groups:
  - name: billing-api-slo
    rules:
      - alert: BillingApiErrorBudgetBurn
        expr: |
          (
            sum(rate(http_requests_total{job="billing-api",status=~"5.."}[1h]))
            / sum(rate(http_requests_total{job="billing-api"}[1h]))
          ) > (14.4 * 0.001)
          and
          (
            sum(rate(http_requests_total{job="billing-api",status=~"5.."}[5m]))
            / sum(rate(http_requests_total{job="billing-api"}[5m]))
          ) > (14.4 * 0.001)
        labels:
          severity: page
        annotations:
          summary: "billing-api brûle son budget d'erreurs"
          runbook: "https://wiki.interne/runbooks/billing-api"
```

`14.4 × 0.001` : à ce rythme, 2 % du budget mensuel part en 1 h (consommé entièrement en ~2 jours). La fenêtre 5 m confirme que c'est **encore** en cours.

Autres alertes utiles pour un dev back :

- certificat TLS qui expire dans < 14 jours ;
- disque > 85 % ;
- âge du plus vieux job en queue > 10 min ;
- aucun backup réussi depuis 26 h ;
- **dead man's switch** : une alerte qui doit toujours tirer, pour vérifier que l'alerting lui-même marche.

Chaque alerte a un **runbook** : quoi regarder, quoi faire. Une alerte ignorée trois fois doit être corrigée ou supprimée.

## Cas réel

Le worker d'envoi de factures de `billing-api` « marchait » selon les dashboards : CPU bas, aucun log d'erreur. Un client signale ne pas avoir reçu ses factures depuis 3 jours.

Ce qui manquait, et qui a été ajouté :

1. Métrique `jobs_oldest_pending_age_seconds{queue="email"}` : elle aurait montré une queue bloquée depuis 3 jours. Alerte à 10 min.
2. Un `try/catch` avalait l'erreur SMTP et marquait le job comme fait. → log `error` structuré avec `job_id`, `tenant_id`, + counter `jobs_failed_total{queue,reason}`.
3. Traces : propagation du `traceparent` dans le payload du job, pour relier le `POST /invoices` d'origine à l'envoi du mail.
4. SLI : « factures envoyées moins de 15 min après émission », SLO 99,5 %.

## Pièges classiques

- Logs texte non parsables, ou `console.log` d'objets entiers avec des secrets.
- Labels à forte cardinalité (`user_id`, URL brute).
- Moyenne de latence au lieu de percentiles : la moyenne cache le p99 qui souffre.
- Alertes sur les causes (CPU, RAM) plutôt que sur les symptômes (erreurs, latence) : fatigue d'alerte.
- Liveness/health check qui ne teste rien d'utile, ou exposé dans les métriques comme du trafic réel (fausse le taux d'erreurs).
- Instrumentation OTel chargée **après** l'app : rien n'est auto-instrumenté.
- `/metrics` exposé publiquement.

## Défis

**1. Trouve les 5 problèmes de ces logs.**

```ts
console.log(`User ${user.email} paid invoice ${id}`);
console.log("payment payload", req.body); // contient la carte
try { await sendMail(inv); } catch (e) { console.log(e); }
logger.info(`slow request ${ms}ms on ${req.url}`);
logger.error("error");
```

::: details Solution
1. Texte interpolé : impossible de filtrer par `invoice_id`. → `log.info({ invoiceId: id, userId: user.id }, "invoice paid")`.
2. Email en clair (donnée perso) dans les logs. → identifiant interne.
3. `req.body` avec la carte : fuite de données sensibles (PCI-DSS !). → ne jamais logguer de payload brut, `redact`.
4. Erreur avalée et loggée en `log` (niveau info) sans contexte : le job paraît réussi. → `log.error({ err: e, invoiceId }, …)` puis relancer/marquer en échec.
5. `logger.error("error")` : aucun contexte, inexploitable. Et la latence en log au lieu d'un histogramme : une **métrique** est faite pour ça.
:::

**2. Écris les requêtes PromQL.** a) Requêtes/s de `billing-api` par code HTTP. b) p95 de latence de la route `/invoices/:id`. c) Ratio d'erreurs 5xx sur 10 min. d) Le nombre d'instances qui ne répondent pas au scrape.

::: details Solution
```text
# a)
sum by (status) (rate(http_requests_total{job="billing-api"}[5m]))
# b)
histogram_quantile(0.95, sum by (le) (
  rate(http_request_duration_seconds_bucket{
    job="billing-api", route="/invoices/:id"}[5m])))
# c)
sum(rate(http_requests_total{job="billing-api",status=~"5.."}[10m]))
  / sum(rate(http_requests_total{job="billing-api"}[10m]))
# d)
count(up{job="billing-api"} == 0)
```
:::

**3. Prometheus OOM.** Après le déploiement d'une nouvelle version, la mémoire de Prometheus passe de 2 Go à 14 Go en une journée. Le diff contient : `labelNames: ["method", "path", "status"]` avec `path = req.url`. Explique.

::: details Solution
`req.url` contient les IDs et la query string (`/invoices/inv_812?expand=lines`) : chaque URL unique crée une nouvelle série, multipliée par méthodes, statuts et **buckets** de l'histogramme (×10). Cardinalité explosive.

Correctif : le **template de route** (`req.routeOptions.url` dans Fastify → `/invoices/:id`), et une valeur `unknown` pour les 404. Vérifier avec `topk(10, count by (__name__)({__name__=~".+"}))` ou la page TSDB status de Prometheus.
:::

**4. Calcule.** Ton SLO de disponibilité est 99,5 % sur 30 jours. Combien de minutes de panne totale peux-tu avoir ? Un incident a déjà coûté 2 h ce mois-ci : que reste-t-il, et que décide l'équipe ?

::: details Solution
30 j × 24 h × 60 = 43 200 min. 0,5 % → **216 min** (3 h 36). Après 2 h (120 min), il reste **96 min**, soit ~44 % du budget.

Décision raisonnable : ralentir les déploiements risqués (migrations lourdes, gros refactos) jusqu'à la fin de la fenêtre, prioriser les actions du post-mortem. Si le budget tombe à 0 : gel des features, uniquement de la fiabilité.
:::

**5. Alerte inutile.** L'équipe reçoit chaque nuit l'alerte `HighCPU: cpu > 80% for 5m` sur le worker Rust, pendant le batch d'ingestion de 2 h du matin. Personne ne fait rien et tout va bien. Que proposes-tu ?

::: details Solution
C'est une alerte sur une **cause**, pas un symptôme : un batch CPU-bound qui utilise le CPU, c'est le comportement attendu. Elle crée de la fatigue d'alerte (et la vraie alerte sera ignorée).

Supprimer ce page. La remplacer par des alertes sur ce qui compte : le batch se **termine** avant 6 h (métrique `ingest_batch_last_success_timestamp_seconds`, alerte si `time() - x > 26h`), taux d'événements rejetés, âge des données. Garder le CPU en dashboard (USE), éventuellement en ticket non urgent si la saturation dure en journée.
:::

## À retenir

- Logs JSON avec champs stables, `trace_id`, zéro secret ; métriques pour compter, traces pour localiser.
- RED pour les services, USE pour les ressources.
- Histogrammes + `histogram_quantile` pour les percentiles ; labels à cardinalité bornée.
- OpenTelemetry + OTLP pour les traces ; charger l'instrumentation avant l'app.
- SLO = cible chiffrée côté utilisateur ; l'error budget arbitre vitesse vs fiabilité.
- Alertes sur les symptômes, en burn rate, avec un runbook.
