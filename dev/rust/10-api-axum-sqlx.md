# API Axum + SQLx

Ce que tu vas apprendre : construire de bout en bout un vrai service HTTP de gestion de commandes, multi-tenant, avec **Axum 0.8**, **SQLx 0.9** et **PostgreSQL** : router, extractors, état partagé, erreurs converties en réponses HTTP, migrations, logs structurés avec `tracing`, et tests d'intégration sur une vraie base.

::: info Pas de Playground ici
Axum et SQLx ne sont pas disponibles sur le Rust Playground, et SQLx vérifie tes requêtes contre une vraie base **à la compilation**. Ce code a été compilé et testé en local avec Rust 1.95 et PostgreSQL 18. Lance-le chez toi (voir « Lancer le projet »).
:::

## Le service qu'on construit

Une API de commandes pour un SaaS e-commerce multi-tenant :

| Méthode | Route | Effet |
|---|---|---|
| `GET` | `/health` | health check |
| `POST` | `/orders` | créer une commande (201) |
| `GET` | `/orders?status=paid&limit=20` | lister |
| `GET` | `/orders/{id}` | détail (404 si absente) |
| `POST` | `/orders/{id}/pay` | `pending` → `paid` (409 sinon) |

Chaque requête porte un en-tête `X-Tenant-Id` : un tenant ne voit **jamais** les commandes d'un autre.

Si tu as fait la [version TS](/dev/typescript/07-api-reelle), compare : Express/Fastify ↔ Axum, Prisma/Kysely ↔ SQLx, Zod ↔ serde + validation, pino ↔ tracing.

## 1. Le projet

```toml
[package]
name = "orders-api"
version = "0.1.0"
edition = "2024"

[dependencies]
anyhow = "1"
axum = "0.8"
chrono = { version = "0.4", features = ["serde"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sqlx = { version = "0.9", features = [
  "runtime-tokio", "tls-rustls-ring-webpki", "postgres",
  "macros", "migrate", "chrono",
] }
thiserror = "2"
tokio = { version = "1", features = ["full"] }
tower-http = { version = "0.7", features = ["trace"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

[dev-dependencies]
http-body-util = "0.1"
tower = { version = "0.5", features = ["util"] }
```

L'arborescence :

```text
orders-api/
├── Cargo.toml
├── .env                  # DATABASE_URL=postgres://...
├── migrations/
│   └── 20260101120000_create_orders.sql
├── src/
│   ├── main.rs           # démarrage : logs, pool, migrations, serve
│   ├── lib.rs            # AppState + router (testable)
│   ├── error.rs          # AppError → réponse HTTP
│   ├── tenant.rs         # extractor X-Tenant-Id
│   └── orders.rs         # modèles + handlers
└── tests/
    └── api.rs            # tests d'intégration
```

::: tip `lib.rs` + `main.rs`
Mettre le router dans la **bibliothèque** (`lib.rs`) et ne garder que le démarrage dans `main.rs` permet aux tests d'intégration (`tests/`) d'importer `orders_api::app` et de l'appeler sans ouvrir de port.
:::

## 2. La migration

```bash
cargo install sqlx-cli --no-default-features --features rustls,postgres
sqlx migrate add create_orders
```

```sql
-- migrations/20260101120000_create_orders.sql
CREATE TABLE orders (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id      TEXT        NOT NULL,
    customer_email TEXT        NOT NULL,
    amount_cents   BIGINT      NOT NULL CHECK (amount_cents > 0),
    status         TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'cancelled')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX orders_tenant_created_idx
    ON orders (tenant_id, created_at DESC);
```

- Montants en **centimes entiers** (`BIGINT`), jamais en flottant.
- Les `CHECK` sont la dernière ligne de défense : même un bug applicatif ne peut pas insérer un statut inconnu.
- L'index `(tenant_id, created_at DESC)` sert exactement la requête de liste (filtre par tenant, tri par date). Voir [Index & EXPLAIN](/bdd/03-index-et-explain).
- `sqlx migrate run` applique les migrations ; l'app les applique aussi au démarrage (section 7). En prod, réfléchis à qui les lance : [Migrations en prod](/bdd/08-migrations-orm-en-prod).

## 3. L'état partagé et le router

```rust
// src/lib.rs
pub mod error;
pub mod orders;
pub mod tenant;

use axum::Router;
use axum::routing::{get, post};
use sqlx::PgPool;
use tower_http::trace::TraceLayer;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/orders", post(orders::create).get(orders::list))
        .route("/orders/{id}", get(orders::get_one))
        .route("/orders/{id}/pay", post(orders::pay))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
```

- **`AppState` est cloné pour chaque requête** : il doit être bon marché à cloner. `PgPool` est déjà un `Arc` en interne ; pour d'autres champs lourds, mets-les derrière un `Arc`. C'est le [chapitre 7](/dev/rust/07-smart-pointers) en action.
- Les paramètres de chemin s'écrivent `{id}` depuis Axum 0.8 (avant : `:id`).
- `.layer(...)` ajoute un middleware **Tower** à toutes les routes : `TraceLayer` logue chaque requête (méthode, URI, status, latence).
- Pas de variable globale pour la connexion BDD : l'état est **injecté**, ce qui rend l'app testable.

## 4. Les handlers et les extractors

Un handler Axum est une simple `async fn`. Ses **arguments** sont des *extractors* : Axum sait les construire à partir de la requête, et renvoie automatiquement une erreur si l'extraction échoue.

| Extractor | Extrait | Si échec |
|---|---|---|
| `State<AppState>` | l'état partagé | (compile-time) |
| `Path<i64>` | `/orders/{id}` | 400 |
| `Query<ListParams>` | `?status=paid` | 400 |
| `Json<CreateOrder>` | le body JSON | 400 / 415 / 422 |
| `HeaderMap` | les en-têtes | — |

Le type de retour doit implémenter `IntoResponse` : `String`, `Json<T>`, `(StatusCode, Json<T>)`, et `Result<T, E>` si `T` et `E` l'implémentent.

### Les modèles

```rust
// src/orders.rs
use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::AppError;
use crate::tenant::Tenant;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Order {
    pub id: i64,
    pub customer_email: String,
    pub amount_cents: i64,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateOrder {
    pub customer_email: String,
    pub amount_cents: i64,
}

#[derive(Debug, Deserialize)]
pub struct ListParams {
    pub status: Option<String>,
    pub limit: Option<i64>,
}
```

`Deserialize` en entrée, `Serialize` en sortie : c'est ton schéma Zod, mais vérifié à la compilation. Un champ manquant ou du mauvais type est rejeté **avant** d'entrer dans ton handler.

### La validation métier

serde valide la **forme** ; les règles métier se vérifient ensuite :

```rust
impl CreateOrder {
    fn validate(&self) -> Result<(), AppError> {
        if !self.customer_email.contains('@') {
            return Err(AppError::Validation("email invalide".into()));
        }
        if self.amount_cents <= 0 {
            return Err(AppError::Validation(
                "amount_cents doit être > 0".into(),
            ));
        }
        Ok(())
    }
}
```

(Pour des règles nombreuses, la crate `validator` génère ce code via des attributs. Pour un domaine riche, préfère les newtypes du [chapitre 2](/dev/rust/02-structs-enums-pattern-matching) : `Email::parse`.)

### Créer une commande

```rust
#[tracing::instrument(skip(state, body))]
pub async fn create(
    State(state): State<AppState>,
    Tenant(tenant): Tenant,
    Json(body): Json<CreateOrder>,
) -> Result<(StatusCode, Json<Order>), AppError> {
    body.validate()?;
    let order = sqlx::query_as!(
        Order,
        r#"INSERT INTO orders (tenant_id, customer_email, amount_cents)
           VALUES ($1, $2, $3)
           RETURNING id, customer_email, amount_cents, status,
                     created_at"#,
        tenant,
        body.customer_email.trim().to_lowercase(),
        body.amount_cents,
    )
    .fetch_one(&state.db)
    .await?;
    tracing::info!(order_id = order.id, "commande créée");
    Ok((StatusCode::CREATED, Json(order)))
}
```

::: warning L'extractor du body doit être le dernier
Le body ne peut être lu qu'une fois : `Json`, `String`, `Bytes`… doivent être le **dernier** argument. Sinon, erreur peu lisible : « the trait `Handler<_, _>` is not implemented ». Ajoute `#[axum::debug_handler]` (feature `macros`) sur le handler pour obtenir un message clair.
:::

### `query_as!` : du SQL vérifié à la compilation

`sqlx::query_as!` se connecte à la base pointée par `DATABASE_URL` **pendant la compilation** et vérifie :

- que la requête est du SQL valide pour ton schéma ;
- que les types des paramètres (`$1`, `$2`…) correspondent ;
- que les colonnes renvoyées correspondent aux champs de `Order` (noms, types, nullabilité).

Une faute de frappe dans un nom de colonne devient une erreur de `cargo build`. Les paramètres sont **toujours bindés** : pas d'injection SQL possible.

::: tip En CI, sans base : le mode offline
`cargo sqlx prepare` enregistre les métadonnées des requêtes dans un dossier `.sqlx/` à committer. Avec `SQLX_OFFLINE=true`, la compilation utilise ces fichiers au lieu de la base. La CI vérifie avec `cargo sqlx prepare --check` qu'ils sont à jour.
:::

Les variantes : `query!` (struct anonyme), `query_scalar!` (une seule colonne), et les versions **fonctions** sans `!` (`sqlx::query_as::<_, Order>(...)`) vérifiées seulement à l'exécution, nécessaires pour du SQL dynamique.

### Lire, lister

```rust
pub async fn get_one(
    State(state): State<AppState>,
    Tenant(tenant): Tenant,
    Path(id): Path<i64>,
) -> Result<Json<Order>, AppError> {
    let order = sqlx::query_as!(
        Order,
        r#"SELECT id, customer_email, amount_cents, status, created_at
           FROM orders WHERE id = $1 AND tenant_id = $2"#,
        id,
        tenant,
    )
    .fetch_optional(&state.db) // Option<Order>
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(order))
}
```

Le `AND tenant_id = $2` est l'isolation multi-tenant : on renvoie **404** (et non 403) pour une commande d'un autre tenant, pour ne même pas révéler qu'elle existe.

```rust
pub async fn list(
    State(state): State<AppState>,
    Tenant(tenant): Tenant,
    Query(p): Query<ListParams>,
) -> Result<Json<Vec<Order>>, AppError> {
    let limit = p.limit.unwrap_or(20).clamp(1, 100);
    let orders = sqlx::query_as!(
        Order,
        r#"SELECT id, customer_email, amount_cents, status, created_at
           FROM orders
           WHERE tenant_id = $1
             AND ($2::text IS NULL OR status = $2)
           ORDER BY created_at DESC
           LIMIT $3"#,
        tenant,
        p.status,   // Option<String> → NULL si absent
        limit,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(orders))
}
```

`clamp(1, 100)` : un client ne peut pas demander 10 millions de lignes. Le filtre optionnel `($2::text IS NULL OR ...)` évite de construire du SQL dynamique pour un cas simple.

### Une transition d'état atomique

```rust
pub async fn pay(
    State(state): State<AppState>,
    Tenant(tenant): Tenant,
    Path(id): Path<i64>,
) -> Result<Json<Order>, AppError> {
    // ne réussit que si la commande est encore pending
    let updated = sqlx::query_as!(
        Order,
        r#"UPDATE orders SET status = 'paid'
           WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
           RETURNING id, customer_email, amount_cents, status,
                     created_at"#,
        id,
        tenant,
    )
    .fetch_optional(&state.db)
    .await?;

    match updated {
        Some(order) => Ok(Json(order)),
        None => {
            // 404 ou 409 ? on regarde si elle existe
            let status = sqlx::query_scalar!(
                "SELECT status FROM orders
                 WHERE id = $1 AND tenant_id = $2",
                id,
                tenant,
            )
            .fetch_optional(&state.db)
            .await?;
            match status {
                None => Err(AppError::NotFound),
                Some(s) => Err(AppError::Conflict(format!(
                    "commande au statut '{s}', paiement impossible"
                ))),
            }
        }
    }
}
```

Pourquoi pas `SELECT` puis `UPDATE` ? Parce que deux requêtes concurrentes pourraient lire `pending` toutes les deux et payer deux fois (*race condition check-then-act*). Le `UPDATE ... WHERE status = 'pending'` est **atomique** : une seule gagne. Voir [Transactions & isolation](/bdd/04-transactions-isolation).

## 5. Un extractor custom : le tenant

N'importe quel type qui implémente `FromRequestParts` devient un extractor. Ici, on lit et valide l'en-tête `X-Tenant-Id` une fois pour toutes :

```rust
// src/tenant.rs
use axum::extract::FromRequestParts;
use axum::http::request::Parts;

use crate::error::AppError;

pub struct Tenant(pub String);

impl<S: Send + Sync> FromRequestParts<S> for Tenant {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        let value = parts
            .headers
            .get("x-tenant-id")
            .and_then(|v| v.to_str().ok())
            .filter(|v| !v.is_empty())
            .ok_or(AppError::MissingTenant)?;
        Ok(Tenant(value.to_owned()))
    }
}
```

Un handler qui prend `Tenant(tenant): Tenant` **ne peut pas** être appelé sans tenant valide : la règle est garantie par le type, pas par un `if` qu'on oublie. Depuis Axum 0.8, plus besoin de `#[async_trait]` (async fn dans les traits est stable). En vrai, le tenant viendrait d'un JWT vérifié, avec le même mécanisme.

## 6. Les erreurs → réponses HTTP

Le [chapitre 5](/dev/rust/05-gestion-erreurs) appliqué : un enum d'erreur, et un `impl IntoResponse` qui fait le mapping.

```rust
// src/error.rs
use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("ressource introuvable")]
    NotFound,
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    Conflict(String),
    #[error("en-tête X-Tenant-Id manquant")]
    MissingTenant,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}
```

```rust
impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::Validation(_) => StatusCode::UNPROCESSABLE_ENTITY,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::MissingTenant => StatusCode::BAD_REQUEST,
            AppError::Db(e) => {
                // détail dans les logs, message neutre au client
                tracing::error!(error = %e, "erreur base de données");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        let msg = match status {
            StatusCode::INTERNAL_SERVER_ERROR => "erreur interne".into(),
            _ => self.to_string(),
        };
        (status, Json(json!({ "error": msg }))).into_response()
    }
}
```

Grâce à `#[from] sqlx::Error`, chaque `.await?` sur une requête SQL convertit l'erreur automatiquement. Les handlers restent lisibles : que des `?`, aucun `try/catch`.

::: warning Les rejets d'extractors ont leur propre format
Si le JSON est invalide, c'est `Json` qui rejette, **avant** ton handler, avec une réponse texte (`Failed to deserialize the JSON body...`). Pour un format d'erreur uniforme, implémente `From<JsonRejection> for AppError` et utilise ton propre extractor (`#[derive(FromRequest)] #[from_request(via(Json), rejection(AppError))]` avec la feature `macros`).
:::

## 7. `main` : logs, pool, migrations, arrêt propre

```rust
// src/main.rs
use std::time::Duration;

use anyhow::Context;
use orders_api::{AppState, app};
use sqlx::postgres::PgPoolOptions;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=debug".into()),
        )
        .init();

    let url = std::env::var("DATABASE_URL")
        .context("DATABASE_URL manquant")?;
    let db = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(3))
        .connect(&url)
        .await
        .context("connexion à PostgreSQL")?;

    sqlx::migrate!().run(&db).await.context("migrations")?;

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    tracing::info!("écoute sur {}", listener.local_addr()?);
    axum::serve(listener, app(AppState { db }))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c().await.expect("handler Ctrl+C");
    tracing::info!("arrêt demandé, on termine les requêtes en cours");
}
```

- `anyhow` au sommet (binaire), `thiserror` dans la lib : la règle du chapitre 5.
- `max_connections` : chaque instance ouvre au plus 10 connexions. Avec 5 pods, ça fait 50 : à comparer au `max_connections` de PostgreSQL (100 par défaut).
- `acquire_timeout` : si le pool est saturé, on échoue vite au lieu d'empiler les requêtes.
- `sqlx::migrate!()` **embarque** les fichiers `migrations/` dans le binaire à la compilation.
- `with_graceful_shutdown` : à l'arrêt (déploiement Kubernetes, `SIGTERM`), le serveur arrête d'accepter des connexions et termine les requêtes en cours. En prod, écoute aussi `SIGTERM` via `tokio::signal::unix`.

### `tracing` : des logs structurés

`tracing` est l'équivalent de pino, avec en plus des **spans** (des contextes imbriqués) :

```rust
#[tracing::instrument(skip(state, body))]   // span "create" + args
pub async fn create(...) { ... }

tracing::info!(order_id = order.id, "commande créée"); // champ typé
tracing::error!(error = %e, "erreur base de données"); // %: Display
```

Chaque log émis pendant une requête porte le contexte du span (méthode, URI, args du handler). En prod, remplace le format texte par du JSON (`.json()`, feature `json` de `tracing-subscriber`) ou exporte vers OpenTelemetry : voir [Observabilité](/infra/08-observabilite).

## 8. Tests d'intégration

Le meilleur rapport effort/confiance pour une API : de **vraies** requêtes HTTP contre une **vraie** base.

```rust
// tests/api.rs
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use orders_api::{AppState, app};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt; // pour .oneshot()

async fn call(pool: &PgPool, method: &str, uri: &str,
              body: Option<Value>) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-tenant-id", "acme")
        .header("content-type", "application/json")
        .body(match body {
            Some(b) => Body::from(b.to_string()),
            None => Body::empty(),
        })
        .unwrap();
    let res = app(AppState { db: pool.clone() })
        .oneshot(req) // appelle le router sans ouvrir de port
        .await
        .unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}
```

```rust
// #[sqlx::test] crée une base VIERGE par test,
// applique les migrations, et la supprime après
#[sqlx::test]
async fn create_then_pay(pool: PgPool) {
    let body = json!({ "customer_email": "Ann@X.io",
                       "amount_cents": 4999 });
    let (status, order) =
        call(&pool, "POST", "/orders", Some(body)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(order["customer_email"], "ann@x.io");
    assert_eq!(order["status"], "pending");

    let id = order["id"].as_i64().unwrap();
    let uri = format!("/orders/{id}/pay");
    let (status, paid) = call(&pool, "POST", &uri, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(paid["status"], "paid");

    // payer deux fois → 409
    let (status, err) = call(&pool, "POST", &uri, None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(err["error"].as_str().unwrap().contains("paid"));
}

#[sqlx::test]
async fn validation_and_not_found(pool: PgPool) {
    let bad = json!({ "customer_email": "nope", "amount_cents": 10 });
    let (status, _) = call(&pool, "POST", "/orders", Some(bad)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, _) = call(&pool, "GET", "/orders/999", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
```

- `Router` implémente le trait `Service` de Tower : `oneshot` lui envoie une requête en mémoire. Rapide, pas de port, pas de flakiness réseau.
- `#[sqlx::test]` isole chaque test dans sa propre base : ils tournent **en parallèle** sans se marcher dessus. Il faut que l'utilisateur de `DATABASE_URL` ait le droit `CREATEDB`.

## Lancer le projet

```bash
docker run -d --name orders-pg -e POSTGRES_PASSWORD=pg \
  -e POSTGRES_DB=orders -p 5432:5432 postgres:18
echo 'DATABASE_URL=postgres://postgres:pg@localhost:5432/orders' > .env
sqlx migrate run          # la base doit exister AVANT la compilation
cargo test                # tests d'intégration
cargo run                 # http://localhost:3000

curl -XPOST localhost:3000/orders -H 'x-tenant-id: acme' \
  -H 'content-type: application/json' \
  -d '{"customer_email":"a@b.io","amount_cents":100}'
```

Les macros SQLx lisent `.env` toutes seules. Pour un setup complet (API + Postgres), voir [Docker Compose](/infra/04-docker-compose).

## Pièges classiques

- **Compiler sans base migrée** : `query!` échoue avec « relation does not exist ». Lance `sqlx migrate run` d'abord, ou utilise le mode offline.
- **Oublier le filtre tenant** dans une requête : fuite de données entre clients. Fais-en un type (`Tenant`) obligatoire, et teste l'isolation. PostgreSQL offre aussi le Row Level Security ([Postgres avancé](/bdd/05-postgres-avance)).
- **Check-then-act** (`SELECT` puis `UPDATE`) pour une transition d'état : race condition. `UPDATE ... WHERE status = ...` ou transaction avec `SELECT ... FOR UPDATE`.
- **Fuiter l'erreur SQL** au client : message neutre + `tracing::error!`.
- **Body extractor pas en dernier** : erreur de trait illisible ; `#[axum::debug_handler]`.
- **Code bloquant dans un handler** (hash bcrypt, gros calcul) : `spawn_blocking` ([chapitre 9](/dev/rust/09-async-tokio)).
- **Pas de `LIMIT`** sur une liste : un client peut faire tomber la base.

## Défis

### 1. Question : pourquoi `$2::text` ?

Dans la requête de liste, pourquoi faut-il écrire `$2::text IS NULL` et pas simplement `$2 IS NULL` ?

::: details Solution
PostgreSQL doit connaître le type de chaque paramètre au moment de **préparer** la requête. Dans `$2 IS NULL`, rien n'indique le type de `$2` (ce pourrait être n'importe quoi). Le cast `::text` le fixe, et SQLx en déduit que le paramètre Rust doit être une `Option<String>` (ou `&str`). Sans lui, la préparation échoue : `could not determine data type of parameter $2`.
:::

### 2. Exercice : annuler une commande

Ajoute `POST /orders/{id}/cancel` : une commande `pending` ou `paid` devient `cancelled`. Si elle n'existe pas ou est déjà annulée → 409. Une seule requête SQL.

::: details Solution
```rust
pub async fn cancel(
    State(state): State<AppState>,
    Tenant(tenant): Tenant,
    Path(id): Path<i64>,
) -> Result<Json<Order>, AppError> {
    sqlx::query_as!(
        Order,
        r#"UPDATE orders SET status = 'cancelled'
           WHERE id = $1 AND tenant_id = $2
             AND status IN ('pending', 'paid')
           RETURNING id, customer_email, amount_cents, status,
                     created_at"#,
        id,
        tenant,
    )
    .fetch_optional(&state.db)
    .await?
    .map(Json)
    .ok_or_else(|| AppError::Conflict(
        "commande introuvable ou déjà annulée".into(),
    ))
}
```

Et dans le router : `.route("/orders/{id}/cancel", post(orders::cancel))`. `.map(Json)` : le constructeur d'une tuple struct est une fonction, on peut le passer directement à `map`. En vrai, annuler une commande `paid` déclencherait un remboursement : on publierait un événement dans la même transaction (pattern *outbox*).
:::

### 3. Exercice : création idempotente

Un client mobile renvoie sa requête après un timeout réseau : il ne faut pas créer deux commandes. Ajoute une colonne `idempotency_key` unique par tenant, lis l'en-tête `Idempotency-Key`, et en cas de rejeu renvoie la commande existante avec un **200** (au lieu de 201).

::: details Solution
Migration :

```sql
ALTER TABLE orders ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX orders_tenant_idem_key
    ON orders (tenant_id, idempotency_key);
```

(Les `NULL` ne sont pas considérés égaux par un index unique : les commandes sans clé ne sont pas contraintes.)

Handler :

```rust
use axum::http::HeaderMap;

pub async fn create_idempotent(
    State(state): State<AppState>,
    Tenant(tenant): Tenant,
    headers: HeaderMap,
    Json(body): Json<CreateOrder>, // toujours en dernier
) -> Result<(StatusCode, Json<Order>), AppError> {
    body.validate()?;
    let key = headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);

    let res = sqlx::query_as!(
        Order,
        r#"INSERT INTO orders
             (tenant_id, customer_email, amount_cents, idempotency_key)
           VALUES ($1, $2, $3, $4)
           RETURNING id, customer_email, amount_cents, status,
                     created_at"#,
        tenant,
        body.customer_email.trim().to_lowercase(),
        body.amount_cents,
        key,
    )
    .fetch_one(&state.db)
    .await;

    match res {
        Ok(order) => Ok((StatusCode::CREATED, Json(order))),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            let existing = sqlx::query_as!(
                Order,
                r#"SELECT id, customer_email, amount_cents, status,
                          created_at
                   FROM orders
                   WHERE tenant_id = $1 AND idempotency_key = $2"#,
                tenant,
                key,
            )
            .fetch_one(&state.db)
            .await?;
            Ok((StatusCode::OK, Json(existing)))
        }
        Err(e) => Err(e.into()),
    }
}
```

On laisse la base arbitrer (contrainte `UNIQUE`) plutôt que de vérifier avant d'insérer : c'est correct même avec deux requêtes simultanées. Une vraie implémentation vérifierait aussi que le body rejoué est identique à l'original. Approfondis dans [Paiements & idempotence](/interview/03-system-design/05-paiements-idempotence).
:::

### 4. Pourquoi ça ne compile pas ?

```rust
async fn refund(
    Json(body): Json<Refund>,
    Path(id): Path<i64>,
) -> String {
    format!("{id} {}", body.cents)
}
// .route("/orders/{id}/refund", post(refund))
```

::: details Solution
E0277 : « the trait bound `fn(Json<Refund>, Path<i64>) -> ... : Handler<_, _>` is not satisfied ». `Json` consomme le body : il doit être le **dernier** argument. Inverse les deux. `#[axum::debug_handler]` sur la fonction donne un message explicite pointant le problème.
:::

### 5. Exercice : tester l'isolation des tenants

Écris un test d'intégration qui prouve qu'une commande créée par `acme` renvoie 404 quand `globex` la demande.

::: details Solution
```rust
#[sqlx::test]
async fn tenants_are_isolated(pool: PgPool) {
    let body = json!({ "customer_email": "a@x.io",
                       "amount_cents": 100 });
    let (_, order) = call(&pool, "POST", "/orders", Some(body)).await;
    let id = order["id"].as_i64().unwrap();

    let req = Request::builder()
        .uri(format!("/orders/{id}"))
        .header("x-tenant-id", "globex")
        .body(Body::empty())
        .unwrap();
    let res = app(AppState { db: pool.clone() })
        .oneshot(req)
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}
```

Ce genre de test est celui qui sauve une boîte SaaS : une régression d'isolation est un incident de sécurité, pas un bug. En pratique, on paramètre `call` avec le tenant plutôt que de dupliquer le builder.
:::

### 6. Question : `State` plutôt qu'une globale

Pourquoi ne pas stocker le pool dans une `static POOL: OnceLock<PgPool>` et s'en servir depuis les handlers ?

::: details Solution
Ça marche techniquement, mais : (1) les tests ne peuvent plus injecter **leur** base (avec `#[sqlx::test]`, chaque test a la sienne) ; (2) les dépendances d'un handler deviennent invisibles dans sa signature ; (3) tu ne peux pas lancer deux instances de l'app avec des configs différentes dans le même process. `State` rend les dépendances explicites et typées, comme l'injection de dépendances en TS, sans framework.
:::

## À retenir

- Axum : un handler = une `async fn` dont les arguments sont des extractors et le retour implémente `IntoResponse`.
- `AppState` (cloné par requête, champs en `Arc`/pool) injecté via `State` ; router dans `lib.rs` pour les tests.
- `sqlx::query_as!` vérifie SQL, types et nullabilité à la compilation ; mode offline (`.sqlx/`) pour la CI.
- Un `AppError` + `impl IntoResponse` : des handlers pleins de `?`, des status corrects, aucun détail interne exposé.
- Transitions d'état atomiques en SQL (`UPDATE ... WHERE status = ...`) ; contraintes `UNIQUE`/`CHECK` comme filet.
- `tracing` pour des logs structurés ; `#[sqlx::test]` + `oneshot` pour des tests d'intégration rapides et isolés.
