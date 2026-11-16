# Async & Tokio

Ce que tu vas apprendre : ce qu'est vraiment une `Future` (et pourquoi elle est différente d'une `Promise`), le runtime Tokio, `spawn`, `join!` / `select!`, la différence entre tâches et threads, les channels Tokio, les timeouts, la cancellation, et les pièges qui font tomber les serveurs en prod (bloquer le runtime, `Mutex` std vs Tokio).

## Pourquoi l'async

Un serveur passe l'essentiel de son temps à **attendre** : la BDD, un appel HTTP, le disque. Un thread OS par requête coûte cher (mémoire, context switches). L'async permet à **quelques threads** de gérer des **milliers** de tâches : quand une tâche attend, le thread en exécute une autre.

C'est exactement le modèle de Node… à deux différences près :

1. Le runtime n'est pas inclus dans le langage : tu choisis une crate. **Tokio** est le standard de fait (Axum, SQLx, reqwest, tonic reposent dessus).
2. Le runtime Tokio par défaut est **multi-thread** : tes tâches tournent en parallèle sur tous les cœurs. D'où `Send` partout.

## `Future` : paresseuse, contrairement à `Promise`

```rust
trait Future {
    type Output;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>)
        -> Poll<Self::Output>; // Poll::Ready(v) ou Poll::Pending
}
```

Une `async fn` est compilée en **machine à états** qui implémente `Future`. Chaque `.await` est un point où elle peut rendre la main (`Pending`) ; le runtime la re-`poll` quand l'I/O est prête (via le `Waker` dans `cx`).

La différence qui piège tous les devs JS :

```ts
const p = sendEmail(); // en JS : l'envoi DÉMARRE ici
await other();
await p;
```

```rust
let f = send_email(); // en Rust : RIEN ne se passe
other().await;
f.await;              // l'envoi démarre seulement ici
```

Une `Future` ne fait rien tant qu'on ne l'`await` pas (ou qu'on ne la `spawn` pas). C'est ce qui rend la **cancellation** simple : drop la future, et le travail s'arrête.

## Le runtime Tokio

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
```

```rust play
use std::time::Duration;
use tokio::time::sleep;

async fn fetch_price(sku: &str) -> u64 {
    sleep(Duration::from_millis(50)).await; // simule un appel HTTP
    sku.len() as u64 * 100
}

#[tokio::main] // crée le runtime multi-thread et exécute main
async fn main() {
    let p = fetch_price("MUG").await;
    println!("prix : {p}");
}
```

`#[tokio::main]` est une macro qui transforme ton `main` en : « construis un runtime, puis `block_on(ton_code)` ». Pour les tests : `#[tokio::test]`.

## Concurrence : `join!` et `spawn`

Deux façons d'exécuter plusieurs futures **en même temps** :

```rust play
use std::time::{Duration, Instant};
use tokio::time::sleep;

async fn call(name: &str, ms: u64) -> String {
    sleep(Duration::from_millis(ms)).await;
    format!("{name} ok")
}

#[tokio::main]
async fn main() {
    let t = Instant::now();
    // séquentiel : ~300 ms
    let a = call("stock", 100).await;
    let b = call("prix", 200).await;
    println!("{a}, {b} en {:?}", t.elapsed());

    let t = Instant::now();
    // concurrent, même tâche : ~200 ms (≈ Promise.all)
    let (a, b) = tokio::join!(call("stock", 100), call("prix", 200));
    println!("{a}, {b} en {:?}", t.elapsed());

    // nouvelle tâche, peut tourner sur un autre thread
    let handle = tokio::spawn(async { call("reco", 50).await });
    let r = handle.await.unwrap(); // JoinError si la tâche a paniqué
    println!("{r}");
}
```

| | `join!` | `tokio::spawn` |
|---|---|---|
| Où ça tourne | dans la tâche courante | nouvelle tâche indépendante |
| Parallélisme CPU | non (concurrence seulement) | oui (multi-thread) |
| Contraintes | aucune | `'static + Send` |
| Si on drop le parent | tout est annulé | la tâche continue |

- `try_join!` s'arrête à la première erreur (≈ `Promise.all` qui rejette).
- Pour un nombre **dynamique** de tâches : `tokio::task::JoinSet`.

`spawn` exige `'static + Send`, comme `thread::spawn` : la tâche peut migrer entre threads et survivre à l'appelant. Donc `move` + données possédées ou `Arc`.

## Tâches vs threads

| | Thread OS | Tâche Tokio |
|---|---|---|
| Coût | ~Mo de stack, syscall | quelques centaines d'octets |
| Combien | centaines | centaines de milliers |
| Ordonnancement | préemptif (OS) | coopératif (aux `.await`) |
| Pour | calcul CPU, code bloquant | I/O |

**Coopératif** est le mot clé : une tâche ne rend la main qu'aux `.await`. Une tâche qui calcule pendant 2 secondes sans `.await` **monopolise** un thread du runtime.

## `select!` : la course

`select!` attend plusieurs futures et exécute la branche de **la première** qui termine ; les autres sont **annulées** (drop).

```rust play
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::sleep;

#[tokio::main]
async fn main() {
    let (tx, mut rx) = mpsc::channel::<&str>(16);
    tokio::spawn(async move {
        for job in ["email", "pdf", "webhook"] {
            sleep(Duration::from_millis(30)).await;
            if tx.send(job).await.is_err() { break; }
        }
    });

    let shutdown = sleep(Duration::from_millis(80)); // signal d'arrêt
    tokio::pin!(shutdown); // réutilisée à chaque tour : il faut la pin

    loop {
        tokio::select! {
            Some(job) = rx.recv() => println!("traite {job}"),
            _ = &mut shutdown => {
                println!("arrêt propre");
                break;
            }
            else => break, // toutes les branches désactivées
        }
    }
}
```

::: warning Cancel safety
Quand une branche gagne, les autres futures sont **drop au milieu de leur exécution**. Si l'une d'elles avait lu la moitié d'un message, il est perdu. La doc Tokio indique pour chaque méthode si elle est *cancel safe* : `mpsc::Receiver::recv` l'est, `AsyncReadExt::read_exact` ne l'est pas. Dans une boucle `select!`, n'utilise que des opérations cancel safe, ou garde la future hors de la boucle.
:::

## Timeouts et cancellation

En Rust async, **annuler = drop la future**. Un timeout n'est donc qu'un `select!` contre un `sleep` :

```rust play
use std::time::Duration;
use tokio::time::{sleep, timeout};

async fn slow_partner_api() -> u32 {
    sleep(Duration::from_secs(5)).await;
    42
}

#[tokio::main]
async fn main() {
    match timeout(Duration::from_millis(100), slow_partner_api()).await {
        Ok(v) => println!("réponse {v}"),
        Err(_elapsed) => println!("timeout : on sert le cache"),
    }
    // la future slow_partner_api a été drop : la requête est abandonnée
}
```

En JS, `Promise.race([fetch(), timeout()])` laisse le `fetch` tourner en arrière-plan (sauf `AbortController`). En Rust, le perdant est vraiment arrêté.

Une tâche `spawn` n'est **pas** annulée quand on drop son `JoinHandle` : il faut `handle.abort()`, ou un signal coopératif (`CancellationToken` de `tokio-util`, un `watch` channel) pour un arrêt propre.

## Les channels Tokio

| Channel | Producteurs → consommateurs | Usage |
|---|---|---|
| `mpsc` | N → 1 | file de jobs, acteur |
| `oneshot` | 1 → 1, une valeur | réponse à une requête |
| `broadcast` | N → N, chacun reçoit tout | événements, invalidation de cache |
| `watch` | 1 → N, dernière valeur | config, état, signal d'arrêt |

`mpsc::channel(n)` est **toujours borné** : `send().await` attend s'il est plein (backpressure). La combinaison `mpsc` + `oneshot` donne le pattern **acteur** : une tâche possède un état, les autres lui envoient des messages avec un canal de réponse. Zéro `Mutex`.

## Les pièges qui tuent un serveur

### 1. Bloquer le runtime

```rust
async fn handler() {
    std::thread::sleep(Duration::from_secs(1)); // KO : bloque le thread
    let hash = bcrypt_hash(password);          // KO : 200 ms de CPU
    let data = std::fs::read("big.csv");       // KO : I/O bloquante
}
```

Le runtime a quelques threads (un par cœur). Bloque-les, et **toutes** les autres requêtes attendent : latence qui explose, health checks qui timeout. Les solutions :

```rust
tokio::time::sleep(d).await;                      // sleep async
let hash = tokio::task::spawn_blocking(move || {  // pool dédié
    bcrypt_hash(&password)
}).await?;
let data = tokio::fs::read("big.csv").await?;     // fs async
```

Règle : entre deux `.await`, pas plus de ~10–100 µs de travail. Au-delà : `spawn_blocking` (code bloquant) ou `rayon` (calcul parallèle lourd).

### 2. `Mutex` std vs `Mutex` Tokio

- `std::sync::Mutex` : **correct et plus rapide** en async **si** le verrou n'est jamais tenu pendant un `.await`. C'est le cas le plus courant (mettre à jour une map en mémoire).
- `tokio::sync::Mutex` : nécessaire seulement si tu dois garder le verrou **pendant** un `.await` (ex. sérialiser l'accès à une connexion). Plus lent.

Le compilateur t'aide : un `std::sync::MutexGuard` n'est pas `Send`, donc le garder à travers un `.await` dans une tâche `spawn` ne compile pas (« future cannot be sent between threads safely »).

```rust
// OK : verrou relâché avant l'await
let n = {
    let mut g = state.counter.lock().unwrap();
    *g += 1;
    *g
};
save(n).await;
```

### 3. Spawn sans limite

`for item in items { tokio::spawn(process(item)); }` sur 1 million d'items = 1 million de tâches qui tapent la BDD en même temps. Limite la concurrence avec un `Semaphore` (ou `buffer_unordered` de la crate `futures`).

## Cas réel : agréger des fournisseurs avec un budget de latence

Une page produit d'un e-commerce appelle 3 services (stock, prix, avis). Budget : 150 ms. Si les avis sont lents, on affiche la page sans eux ; si le prix échoue, c'est une erreur.

```rust play
use std::time::Duration;
use tokio::time::{sleep, timeout};

async fn stock(sku: &str) -> Result<u32, String> {
    sleep(Duration::from_millis(40)).await;
    Ok(sku.len() as u32)
}
async fn price(_sku: &str) -> Result<u64, String> {
    sleep(Duration::from_millis(60)).await;
    Ok(1999)
}
async fn reviews(_sku: &str) -> Result<f32, String> {
    sleep(Duration::from_millis(500)).await; // service lent
    Ok(4.5)
}

#[derive(Debug)]
struct ProductPage { stock: u32, price: u64, rating: Option<f32> }

async fn product_page(sku: &str) -> Result<ProductPage, String> {
    let budget = Duration::from_millis(150);
    let (stock, price, rating) = tokio::join!(
        stock(sku),
        price(sku),
        timeout(budget, reviews(sku)), // optionnel : borné
    );
    Ok(ProductPage {
        stock: stock?,
        price: price?,
        // Err(timeout) ou Ok(Err(..)) → None : dégradation gracieuse
        rating: rating.ok().and_then(|r| r.ok()),
    })
}

#[tokio::main]
async fn main() {
    let t = std::time::Instant::now();
    let page = product_page("MUG-42").await;
    println!("{page:?} en {:?}", t.elapsed()); // ~150 ms, pas 500
}
```

Les trois appels partent en même temps ; le plus lent est borné ; un échec critique remonte avec `?`. C'est la base du pattern *fan-out / budget de latence* des BFF (backend for frontend).

## Pièges classiques

- **Oublier `.await`** : la future n'est jamais exécutée (warning `unused_must_use`, lis-le).
- **Bloquer le runtime** : `std::thread::sleep`, `std::fs`, CPU lourd dans un handler.
- **`tokio::sync::Mutex` par défaut** : le `std::sync::Mutex` est préférable s'il n'est pas tenu à travers un `.await`.
- **Croire que drop un `JoinHandle` annule la tâche** : non, `abort()`.
- **`select!` dans une boucle avec une future non cancel safe** : données perdues.
- **Spawn illimité** : sature la BDD et la mémoire ; `Semaphore`.
- **Mélanger les runtimes** (`block_on` dans une tâche Tokio) : panic « Cannot start a runtime from within a runtime ».
- **Question d'entretien** : « Différence entre une `Future` Rust et une `Promise` JS ? » → paresseuse (poll-based) vs eager ; annulation par drop.

## Défis

### 1. Que affiche ce code ?

```rust play
async fn send_email(to: &str) {
    println!("email envoyé à {to}");
}

#[tokio::main]
async fn main() {
    let f = send_email("ann@x.io");
    println!("avant");
    f.await;
    println!("après");
}
```

::: details Solution
```text
avant
email envoyé à ann@x.io
après
```

Appeler une `async fn` ne fait que **construire** la future ; le corps s'exécute au premier `.await`. En JS, l'email partirait avant `avant`.
:::

### 2. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
use std::sync::{Arc, Mutex};

async fn persist(_n: u32) {}

#[tokio::main]
async fn main() {
    let total = Arc::new(Mutex::new(0u32));
    let t = Arc::clone(&total);
    tokio::spawn(async move {
        let mut g = t.lock().unwrap();
        *g += 1;
        persist(*g).await;
    }).await.unwrap();
}
```

::: details Solution
« future cannot be sent between threads safely » : le `MutexGuard` de `std` (non `Send`) est encore vivant au moment du `.await`. La tâche pourrait reprendre sur un autre thread avec le verrou tenu. Correction : relâcher le verrou avant l'await.

```rust
let n = { let mut g = t.lock().unwrap(); *g += 1; *g };
persist(n).await;
```

Passer à `tokio::sync::Mutex` compile aussi, mais garder un verrou pendant de l'I/O est rarement ce que tu veux.
:::

### 3. Exercice : appels avec timeout individuel

Lance tous les appels **en parallèle**, chacun avec un timeout de `limit_ms`. Renvoie les résultats dans l'ordre d'entrée : `Some(valeur)` si l'appel a répondu à temps, `None` sinon. `call(ms)` simule un appel qui prend `ms` millisecondes. Le tout doit prendre ~`limit_ms`, pas la somme.

```rust play
use std::time::Duration;
use tokio::time::{sleep, timeout};

async fn call(ms: u64) -> u64 {
    sleep(Duration::from_millis(ms)).await;
    ms
}

pub async fn call_all(delays: Vec<u64>, limit_ms: u64) -> Vec<Option<u64>> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[tokio::test]
    async fn timeouts() {
        let t = Instant::now();
        let r = call_all(vec![10, 300, 20, 300, 30], 100).await;
        assert_eq!(r, vec![Some(10), None, Some(20), None, Some(30)]);
        assert!(t.elapsed() < Duration::from_millis(250));
    }
}
```

::: details Solution
```rust play
use std::time::Duration;
use tokio::time::{sleep, timeout};

async fn call(ms: u64) -> u64 {
    sleep(Duration::from_millis(ms)).await;
    ms
}

pub async fn call_all(delays: Vec<u64>, limit_ms: u64) -> Vec<Option<u64>> {
    let limit = Duration::from_millis(limit_ms);
    let handles: Vec<_> = delays
        .into_iter()
        .map(|d| tokio::spawn(async move {
            timeout(limit, call(d)).await.ok()
        }))
        .collect(); // collect AVANT d'await : tout part en même temps
    let mut out = Vec::with_capacity(handles.len());
    for h in handles {
        out.push(h.await.unwrap());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[tokio::test]
    async fn timeouts() {
        let t = Instant::now();
        let r = call_all(vec![10, 300, 20, 300, 30], 100).await;
        assert_eq!(r, vec![Some(10), None, Some(20), None, Some(30)]);
        assert!(t.elapsed() < Duration::from_millis(250));
    }
}
```

Les tâches démarrent dès le `spawn` ; attendre les handles dans l'ordre préserve l'ordre des résultats. Avec la crate `futures`, `join_all` ferait la même chose sans spawn (concurrence dans une seule tâche).
:::

### 4. Exercice : un acteur sans `Mutex`

Implémente un compteur de quotas par tenant sous forme d'**acteur** : une tâche possède la `HashMap`, les clients lui envoient des messages `mpsc` avec un `oneshot` pour la réponse. `incr` renvoie la nouvelle valeur.

```rust play
use std::collections::HashMap;
use tokio::sync::{mpsc, oneshot};

enum Msg {
    Incr { tenant: String, reply: oneshot::Sender<u64> },
}

#[derive(Clone)]
pub struct QuotaHandle {
    tx: mpsc::Sender<Msg>,
}

impl QuotaHandle {
    pub fn spawn() -> Self {
        let (tx, mut rx) = mpsc::channel::<Msg>(64);
        tokio::spawn(async move {
            let mut counts: HashMap<String, u64> = HashMap::new();
            // TODO : boucle de réception des messages
            let _ = (&mut rx, &mut counts);
            todo!()
        });
        Self { tx }
    }

    pub async fn incr(&self, tenant: &str) -> u64 {
        todo!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn counts_per_tenant() {
        let q = QuotaHandle::spawn();
        let mut tasks = vec![];
        for _ in 0..50 {
            let q = q.clone();
            tasks.push(tokio::spawn(async move { q.incr("acme").await }));
        }
        for t in tasks { t.await.unwrap(); }
        assert_eq!(q.incr("acme").await, 51);
        assert_eq!(q.incr("globex").await, 1);
    }
}
```

::: details Solution
```rust play
use std::collections::HashMap;
use tokio::sync::{mpsc, oneshot};

enum Msg {
    Incr { tenant: String, reply: oneshot::Sender<u64> },
}

#[derive(Clone)]
pub struct QuotaHandle {
    tx: mpsc::Sender<Msg>,
}

impl QuotaHandle {
    pub fn spawn() -> Self {
        let (tx, mut rx) = mpsc::channel::<Msg>(64);
        tokio::spawn(async move {
            let mut counts: HashMap<String, u64> = HashMap::new();
            // s'arrête quand tous les QuotaHandle sont drop
            while let Some(msg) = rx.recv().await {
                match msg {
                    Msg::Incr { tenant, reply } => {
                        let c = counts.entry(tenant).or_insert(0);
                        *c += 1;
                        let _ = reply.send(*c); // client parti : ignoré
                    }
                }
            }
        });
        Self { tx }
    }

    pub async fn incr(&self, tenant: &str) -> u64 {
        let (reply, rx) = oneshot::channel();
        let msg = Msg::Incr { tenant: tenant.to_string(), reply };
        self.tx.send(msg).await.expect("acteur arrêté");
        rx.await.expect("acteur arrêté")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn counts_per_tenant() {
        let q = QuotaHandle::spawn();
        let mut tasks = vec![];
        for _ in 0..50 {
            let q = q.clone();
            tasks.push(tokio::spawn(async move { q.incr("acme").await }));
        }
        for t in tasks { t.await.unwrap(); }
        assert_eq!(q.incr("acme").await, 51);
        assert_eq!(q.incr("globex").await, 1);
    }
}
```

L'état n'est touché que par une seule tâche : pas de verrou, pas de data race, et les messages sont traités dans l'ordre. Le channel borné donne la backpressure. C'est le pattern recommandé dans le tutoriel Tokio pour partager une ressource (une connexion, un état métier).
:::

### 5. Exercice : consommer jusqu'à l'arrêt

Additionne les valeurs reçues sur `rx` jusqu'à ce que `shutdown` reçoive un signal **ou** que le channel soit fermé. Utilise `tokio::select!`.

```rust play
use tokio::sync::{mpsc, oneshot};

pub async fn run(mut rx: mpsc::Receiver<u32>,
                 mut shutdown: oneshot::Receiver<()>) -> u32 {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn stops_on_close() {
        let (tx, rx) = mpsc::channel(8);
        let (_stop, shutdown) = oneshot::channel();
        for v in [1, 2, 3] { tx.send(v).await.unwrap(); }
        drop(tx);
        assert_eq!(run(rx, shutdown).await, 6);
    }

    #[tokio::test]
    async fn stops_on_shutdown() {
        let (tx, rx) = mpsc::channel(8);
        let (stop, shutdown) = oneshot::channel();
        let h = tokio::spawn(run(rx, shutdown));
        tx.send(10).await.unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        stop.send(()).unwrap();
        assert_eq!(h.await.unwrap(), 10); // tx toujours vivant
    }
}
```

::: details Solution
```rust play
use tokio::sync::{mpsc, oneshot};

pub async fn run(mut rx: mpsc::Receiver<u32>,
                 mut shutdown: oneshot::Receiver<()>) -> u32 {
    let mut total = 0;
    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Some(v) => total += v,
                None => break, // tous les émetteurs sont drop
            },
            _ = &mut shutdown => break,
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn stops_on_close() {
        let (tx, rx) = mpsc::channel(8);
        let (_stop, shutdown) = oneshot::channel();
        for v in [1, 2, 3] { tx.send(v).await.unwrap(); }
        drop(tx);
        assert_eq!(run(rx, shutdown).await, 6);
    }

    #[tokio::test]
    async fn stops_on_shutdown() {
        let (tx, rx) = mpsc::channel(8);
        let (stop, shutdown) = oneshot::channel();
        let h = tokio::spawn(run(rx, shutdown));
        tx.send(10).await.unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        stop.send(()).unwrap();
        assert_eq!(h.await.unwrap(), 10);
    }
}
```

`&mut shutdown` : on **emprunte** la future oneshot pour pouvoir la re-sonder à chaque tour (un `oneshot::Receiver` est `Unpin`, donc pas besoin de `pin!`). `rx.recv()` est cancel safe : si `shutdown` gagne, aucun message n'est perdu. C'est le squelette d'un worker avec **graceful shutdown**.
:::

### 6. Exercice : limiter la concurrence

Traite tous les jobs (chacun prend 20 ms) avec **au plus `max` en parallèle**, grâce à un `tokio::sync::Semaphore`. La fonction renvoie le nombre de jobs traités ; le test mesure la concurrence maximale observée.

```rust play
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::sync::Semaphore;

pub async fn process_all(jobs: usize, max: usize,
                         in_flight: Arc<AtomicUsize>,
                         peak: Arc<AtomicUsize>) -> usize {
    todo!()
}

// appelé par chaque job : ne pas modifier
async fn job(in_flight: &AtomicUsize, peak: &AtomicUsize) {
    let now = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
    peak.fetch_max(now, Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(20)).await;
    in_flight.fetch_sub(1, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn bounded() {
        let (f, p) = (Arc::default(), Arc::new(AtomicUsize::new(0)));
        let n = process_all(20, 3, f, Arc::clone(&p)).await;
        assert_eq!(n, 20);
        assert_eq!(p.load(Ordering::SeqCst), 3);
    }
}
```

::: details Solution
```rust play
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

pub async fn process_all(jobs: usize, max: usize,
                         in_flight: Arc<AtomicUsize>,
                         peak: Arc<AtomicUsize>) -> usize {
    let sem = Arc::new(Semaphore::new(max));
    let mut set = JoinSet::new();
    for _ in 0..jobs {
        // attend un permis AVANT de spawn : backpressure
        let permit = Arc::clone(&sem).acquire_owned().await.unwrap();
        let (f, p) = (Arc::clone(&in_flight), Arc::clone(&peak));
        set.spawn(async move {
            job(&f, &p).await;
            drop(permit); // libère la place
        });
    }
    let mut done = 0;
    while let Some(r) = set.join_next().await {
        r.unwrap();
        done += 1;
    }
    done
}

async fn job(in_flight: &AtomicUsize, peak: &AtomicUsize) {
    let now = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
    peak.fetch_max(now, Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(20)).await;
    in_flight.fetch_sub(1, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn bounded() {
        let (f, p) = (Arc::default(), Arc::new(AtomicUsize::new(0)));
        let n = process_all(20, 3, f, Arc::clone(&p)).await;
        assert_eq!(n, 20);
        assert_eq!(p.load(Ordering::SeqCst), 3);
    }
}
```

`acquire_owned` renvoie un permis possédé (`'static`) qu'on peut déplacer dans la tâche ; il est rendu au `drop`. Acquérir **avant** le `spawn` évite de créer 1 million de tâches en attente. `JoinSet` collecte les résultats au fil de l'eau.
:::

## À retenir

- Une `Future` est paresseuse : rien ne se passe sans `.await` ou `spawn` ; l'annuler = la drop.
- Tokio = runtime multi-thread à ordonnancement **coopératif** : ne bloque jamais entre deux `.await` (`spawn_blocking` sinon).
- `join!` = concurrence dans la tâche ; `spawn` = tâche indépendante (`'static + Send`) ; `select!` = la première gagne, les autres sont annulées.
- `timeout` borne n'importe quelle future ; attention à la *cancel safety* dans `select!`.
- Channels : `mpsc` (jobs, acteurs), `oneshot` (réponse), `broadcast`, `watch` ; bornés = backpressure.
- `std::sync::Mutex` si le verrou n'est jamais tenu à travers un `.await` ; sinon `tokio::sync::Mutex`, ou mieux, un acteur.
