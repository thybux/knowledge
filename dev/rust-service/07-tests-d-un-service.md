# Tester un service

Ce que tu vas apprendre : tester un service qui parle au réseau **sans** dépendre du réseau. Où placer chaque test, un faux serveur HTTP avec `wiremock`, un faux broker derrière un trait, l'horloge de Tokio en pause pour tester des backoffs de 30 minutes en 1 ms, les fixtures et les golden files, des tests contre un vrai RabbitMQ en CI, les tests du binaire lui-même, et `make check` (fmt + clippy `-D warnings`) comme porte d'entrée de la CI.

Les bases (`#[test]`, `#[cfg(test)]`, `tests/`, doc-tests, clippy, workspace, nextest) sont au [chapitre 12 du parcours Rust](/dev/rust/12-tests-et-outillage). Ici, on parle de ce qui est propre à un service.

## Quel test pour quoi

| Ce qu'on teste | Où | Avec quoi |
|---|---|---|
| une règle pure (backoff, verdict, slug, parsing d'un nombre) | bas du fichier, `mod tests` | rien : entrées → sortie |
| le parsing d'une page HTML | bas du fichier | fixture HTML + golden JSON |
| le client HTTP (retry, statuts, cookies) | bas de `http.rs` | `wiremock` |
| la boucle d'un job (publication, bilan, `--limit`) | bas du fichier de la commande | faux `Publisher`, faux stockage |
| la forme des messages publiés | `messages.rs` | fixtures écrites à la main |
| le vrai broker (confirms, nack, reconnexion) | `broker.rs` | vrai RabbitMQ, sauté sans `BROKER_URL` |
| le contrat du binaire (flags, codes de sortie) | `tests/cli.rs` | le binaire compilé |

Deux conventions qui rendent le crate lisible :

- **Les tests unitaires sont en bas du fichier** qu'ils testent, dans `#[cfg(test)] mod tests`. Ils voient les fonctions privées : pas besoin de rendre un item `pub` « pour le test ».
- **`tests/` ne passe que par l'API `pub`**. Si un test d'intégration a besoin d'un item privé, c'est un test unitaire mal rangé.

Les aides partagées vont dans un module `#[cfg(test)] pub(crate) mod test_support;` (compilé seulement en test) et, pour `tests/`, dans `tests/common/mod.rs` (la forme `mod.rs` évite que cargo le prenne pour un fichier de test à part).

## Un faux serveur HTTP avec `wiremock`

`wiremock` démarre un vrai serveur HTTP local sur un port aléatoire. Ton client y fait de vraies requêtes : pool, timeouts, en-têtes, tout est exercé.

```toml
[dev-dependencies]
wiremock = "0.6"
tokio = { version = "1", features = ["macros", "rt",
          "rt-multi-thread", "time", "test-util"] }
```

```rust
use wiremock::matchers::method;
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Répond `statuses` dans l'ordre, puis 200 "ok".
async fn serve_statuses(statuses: &[u16]) -> MockServer {
    let server = MockServer::start().await;
    for s in statuses {
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(*s))
            .up_to_n_times(1)
            .mount(&server)
            .await;
    }
    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(200).set_body_string("ok"),
        )
        .mount(&server)
        .await;
    server
}
```

`up_to_n_times(1)` : le mock ne répond qu'une fois, puis laisse la main au suivant. Les mocks sont essayés **dans l'ordre de montage**, d'où la séquence 503, 503, 200.

```rust
#[tokio::test]
async fn retry_then_success() {
    let server = serve_statuses(&[503, 503]).await;
    let got = test_client()
        .get_text(&server.uri(), &Values::new())
        .await
        .expect("GET");
    assert_eq!(got, "ok");
    let reqs = server.received_requests().await.unwrap();
    assert_eq!(reqs.len(), 3);
}

#[tokio::test]
async fn client_error_is_not_retried() {
    let server = serve_statuses(&[404]).await;
    let err = test_client()
        .get_text(&server.uri(), &Values::new())
        .await
        .expect_err("404");
    assert_eq!(status_code(&err), Some(404));
    let reqs = server.received_requests().await.unwrap();
    assert_eq!(reqs.len(), 1, "un 404 n'est pas retenté");
}
```

Ce qu'on vérifie : le **nombre de requêtes reçues** par le serveur, pas les appels internes du client. C'est le comportement observable depuis le site tiers, donc celui qui compte.

`test_client()` construit le client avec un backoff de 1 ms : on teste le nombre d'essais, pas les vraies secondes. D'autres matchers utiles : `path("/list")`, `header("referer", "...")`, `body_string("start=40")` (vérifier qu'un POST rejoué renvoie le **même** corps). `Mock::expect(n)` fait échouer le test au `drop` du serveur si le mock n'a pas été appelé exactement `n` fois.

Alternatives : `mockito` (API plus simple, serveur partagé), `httpmock`. Toutes font la même chose ; choisis-en une pour tout le crate.

## Tester l'annulation

Un test qui vérifie qu'un job annulé n'attend pas la fin de son backoff d'une heure :

```rust
#[tokio::test]
async fn cancel_during_backoff() {
    let server = serve_always(503).await;
    let client = HttpClient::new(HttpConfig {
        backoff_base: Duration::from_secs(3600),
        ..HttpConfig::default()
    })
    .unwrap();
    let start = std::time::Instant::now();
    let res = tokio::time::timeout(
        Duration::from_millis(50),
        client.get_text(&server.uri(), &Values::new()),
    )
    .await;
    assert!(res.is_err(), "le timeout interrompt l'attente");
    assert!(start.elapsed() < Duration::from_secs(5));
}
```

`timeout` drop la future au bout de 50 ms, en plein `sleep` d'une heure. Le test prouve que l'annulation par `drop` (chapitre 5) fonctionne dans la vraie boucle de retry.

## Un faux broker derrière un trait

La boucle de synchro dépend de `impl Publisher` (chapitre 1). En test, un faux qui **enregistre** les messages :

```rust
use std::cell::RefCell;

#[derive(Default)]
pub struct Recorder {
    pub sent: RefCell<Vec<(String, serde_json::Value)>>,
}

impl Publisher for Recorder {
    async fn publish<T: Serialize + ?Sized + Sync>(
        &self, queue: &str, _kind: &str, payload: &T,
    ) -> Result<(), BrokerError> {
        let v = serde_json::to_value(payload).unwrap();
        self.sent.borrow_mut().push((queue.into(), v));
        Ok(())
    }
}
```

`RefCell` suffit : tout se passe sur le thread du test (`#[tokio::test]` utilise par défaut un runtime *current thread*), et la méthode prend `&self`. Pas besoin de `Mutex`.

Un faux qui **refuse** les N premiers appels teste la politique de nack sans RabbitMQ :

```rust
struct FullQueue { nacks: Cell<u32>, calls: Cell<u32> }

impl Publisher for FullQueue {
    async fn publish<T: Serialize + ?Sized + Sync>(
        &self, queue: &str, _: &str, _: &T,
    ) -> Result<(), BrokerError> {
        self.calls.set(self.calls.get() + 1);
        if self.calls.get() <= self.nacks.get() {
            return Err(BrokerError::Nacked { queue: queue.into() });
        }
        Ok(())
    }
}
```

On vérifie le **résultat** (messages enregistrés, nombre d'appels, erreur rendue), pas « la méthode X a été appelée avec Y ». Un mock qui vérifie la forme des appels casse à chaque refactoring et ne prouve rien du comportement.

## L'horloge en pause

`publish_retrying_nacks` attend jusqu'à 30 minutes. Un test qui attend vraiment 30 minutes ne sera jamais lancé. Tokio a une **horloge virtuelle** :

```rust
#[tokio::test(start_paused = true)]
async fn nack_is_republished_with_growing_waits() {
    let mq = full_queue(5);
    let started = tokio::time::Instant::now();
    publish_retrying_nacks(
        &mq, NackBackoff::default(), "q", "supplier-a", &1,
    )
    .await
    .expect("accepté au 6e essai");
    assert_eq!(mq.calls.get(), 6);
    // 5 + 10 + 20 + 40 + 60 s, en temps virtuel
    assert_eq!(started.elapsed(), Duration::from_secs(135));
}
```

Mécanisme : avec `start_paused = true` (feature `test-util`), le temps de Tokio ne s'écoule pas tout seul. Quand toutes les tâches sont en attente d'un timer, le runtime **avance l'horloge** directement jusqu'au prochain timer. Le test s'exécute en quelques microsecondes, et `elapsed()` est **exact** (pas de « à peu près 135 s »).

Limites :

- seulement `tokio::time` (`sleep`, `timeout`, `interval`, `Instant`) : `std::time::Instant` et `SystemTime` ne sont pas virtualisés ;
- pas avec un vrai réseau : une tâche qui attend une socket n'est pas « en attente d'un timer », l'horloge peut sauter pendant une vraie I/O. Garde `start_paused` pour les tests sans `wiremock` ni broker ;
- runtime *current thread* uniquement.

Pour `SystemTime` (la fraîcheur du chapitre 4), passe `now` en paramètre : c'est l'injection d'horloge.

## Fixtures et golden files

Le parsing HTML d'un portail est la partie la plus fragile : le jour où le fournisseur change son gabarit, il faut le voir **immédiatement**, et voir **quoi**.

- **Fixture** : une page HTML réelle, sauvegardée une fois dans `tests/fixtures/` (anonymisée : pas d'identifiants, pas de prix confidentiels si le dépôt est partagé).
- **Golden file** : la sortie attendue du parsing de cette fixture, en JSON indenté, versionnée à côté.

```rust
pub fn assert_golden_bytes<T: Serialize>(name: &str, v: &T) {
    let mut actual = serde_json::to_vec_pretty(v).unwrap();
    actual.push(b'\n');
    let path = fixture_path(name);
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        std::fs::write(&path, &actual).unwrap();
        return;
    }
    let want = std::fs::read(&path).unwrap();
    assert!(actual == want,
        "sortie différente du golden {name}\nobtenu :\n{}",
        String::from_utf8_lossy(&actual));
}
```

```rust
#[test]
fn parses_parts_table() {
    let html = fixture("portal/parts_table.html");
    let parts = parse_parts(&html).unwrap();
    assert_golden_bytes("portal/parts_table.golden.json",
                        &parts);
}
```

Le workflow : tu modifies le parser, tu lances `UPDATE_GOLDEN=1 cargo test`, et tu **relis le diff git** du golden avant de commiter. C'est cette relecture qui fait le test : un golden régénéré sans lecture ne vérifie plus rien.

`fixture_path` part de `env!("CARGO_MANIFEST_DIR")` (la racine du crate, figée à la compilation) : le test trouve ses fichiers quel que soit le dossier d'où on lance `cargo test`.

Deux formes de comparaison :

| Comparaison | Quand |
|---|---|
| **octet par octet** (JSON indenté) | sorties de **ton** code (parsing) : tout changement doit se voir dans le diff |
| **par contenu** (`serde_json::Value`) | contrat avec un autre langage (chapitre 3) : l'ordre des clés et l'indentation ne font pas partie du contrat |

Rappel du chapitre 3 : pour un **contrat**, la fixture est écrite à la main d'après le schéma du consumer, jamais générée par `UPDATE_GOLDEN`. Les deux mécanismes coexistent, pour deux usages différents.

Le *snapshot testing* avec la crate `insta` (`cargo insta review`) est la version outillée du même principe : revue interactive des différences, snapshots inline.

## Contre un vrai RabbitMQ

Certaines garanties ne se prouvent pas avec un faux : qu'un nack arrive vraiment sur une queue pleine en `reject-publish`, que la reconnexion marche, qu'une déclaration passive ignore bien les arguments. On teste contre un vrai broker, **sauté** s'il n'est pas là :

```rust
async fn connect_for_test() -> Option<Broker> {
    let Ok(url) = std::env::var("BROKER_URL") else {
        eprintln!("BROKER_URL absente : test sauté");
        return None;
    };
    Some(Broker::connect(BrokerConfig::new(url)).await.unwrap())
}

#[tokio::test]
async fn full_queue_is_nacked() {
    let Some(b) = connect_for_test().await else { return };
    let q = declare_full_queue(&b, 1).await; // max-length 1
    b.publish(&q, "test", &1).await.expect("premier");
    let err = b.publish(&q, "test", &2).await.unwrap_err();
    assert!(matches!(err, BrokerError::Nacked { .. }));
    delete_queue(&b, &q).await;
}
```

Règles :

- **Une queue jetable par test**, au nom unique (préfixe + horodatage en nanosecondes) : les tests tournent en parallèle sur le même broker.
- **Le test crée sa queue** (rôle du TS en production) : c'est le seul endroit où le code Rust déclare activement, et c'est écrit dans un commentaire.
- **Nettoyage en fin de test**, et des queues qui ne survivent pas (`auto_delete` ou suppression explicite).
- **Lire `BROKER_URL` ici est acceptable** : c'est du code de test, pas de la lib.

En local : `docker run -d -p 5672:5672 rabbitmq:4-alpine`, puis `BROKER_URL=amqp://guest:guest@localhost:5672/%2f cargo test`. En CI, un *service container* (plus bas). Une alternative est `testcontainers` (le test démarre son propre conteneur) : plus autonome, mais plus lent et dépendant de Docker sur la machine de test.

::: warning Un test « sauté » est vert
Sans `BROKER_URL`, ces tests passent sans rien vérifier. Vérifie que la CI pose bien la variable (et lis la sortie : le `eprintln!` est visible avec `cargo test -- --nocapture`), sinon tu crois avoir une couverture que tu n'as pas.
:::

## Tester le binaire lui-même

Le contrat avec Kubernetes (flags, codes de sortie) se teste sur le **vrai binaire**. Cargo compile les binaires avant les tests d'intégration et expose leur chemin :

```rust
// tests/cli.rs
use std::process::{Command, Output};

const SYNC: &str = env!("CARGO_BIN_EXE_sync");

fn run(args: &[&str]) -> Output {
    Command::new(SYNC)
        .args(args)
        .env_clear() // aucun secret du poste ne fuit
        .output()
        .expect("lancement du binaire")
}

#[test]
fn invalid_config_lists_every_error_and_exits_2() {
    let out = run(&["--provider", "supplier-a"]);
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    for var in ["BROKER_URL", "SUPPLIER_PASSWORD"] {
        assert!(stderr.contains(var), "{stderr}");
    }
}
```

`env_clear()` : sans lui, le binaire hérite de ton environnement (et de ton `BROKER_URL` de dev) ; le test passerait chez toi et échouerait en CI, ou l'inverse.

## `make check` et la CI

Un `Makefile` court garde les commandes identiques entre ton poste et la CI :

```make
check:
	cargo fmt --check
	cargo clippy --all-targets --locked -- -D warnings

test:
	cargo test --locked
```

| Commande | Rôle |
|---|---|
| `cargo fmt --check` | échoue sur un fichier non formaté, sans le modifier |
| `clippy --all-targets` | lint aussi les tests, exemples et benchs (pas seulement la lib) |
| `-D warnings` | tout avertissement devient une erreur : la CI ne laisse rien passer |
| `--locked` | refuse un `Cargo.lock` pas à jour |

La toolchain est figée dans `rust-toolchain.toml` (`channel = "1.95.0"`, composants `rustfmt` et `clippy`) : même compilateur en local, en CI et dans l'image Docker. Sans ça, une nouvelle version de clippy en CI fait échouer un build qui passe chez toi.

Le job de CI :

```yaml
rust:
  runs-on: ubuntu-latest
  container: { image: rust:1.95-bookworm }
  services:
    rabbitmq: { image: rabbitmq:4-alpine }
  steps:
    - uses: actions/checkout@v4
    - run: rustup component add rustfmt clippy
    - uses: Swatinem/rust-cache@v2
    - run: cargo fmt --check
    - run: cargo clippy --all-targets --locked -- -D warnings
    - run: cargo test --locked
      env:
        BROKER_URL: amqp://guest:guest@rabbitmq:5672/%2f
    - run: cargo build --release --locked
```

Le job tourne **dans** un conteneur `rust:*` : le service `rabbitmq` est joignable par son nom, sans exposer de port sur l'hôte. `Swatinem/rust-cache` met en cache `~/.cargo` et `target/` par `Cargo.lock` : sans cache, chaque CI recompile toutes les dépendances. Le `build --release` final vérifie que le profil de production compile (LTO, `codegen-units = 1`), ce que `cargo test` (profil debug) ne fait pas.

## Cas réel

Le fournisseur change le gabarit de sa page de pièces : une colonne « remise » apparaît entre « prix » et « stock ». Le scraper ne plante pas : il lit la remise comme le stock.

Ce qui l'attrape : le test golden `parses_parts_table` sur la **nouvelle** fixture (sauvegardée après le premier run suspect) montre un diff où tous les stocks valent « -10 % ». On corrige le parser, `UPDATE_GOLDEN=1`, on relit le diff (les stocks redeviennent des entiers), on commite fixture et golden. L'**ancienne** fixture reste aussi, avec son golden : le parser doit lire les deux gabarits pendant la transition.

Sans golden, le bug serait parti en production, et le consumer aurait écrit des stocks à zéro sur des milliers de pièces.

## Pièges classiques

- **Mocker la forme des appels** (`expect_call_with`) au lieu de vérifier le résultat : le test casse au refactoring et ne prouve rien.
- **De vraies secondes dans un test** : suite lente, puis désactivée. Backoff de 1 ms ou horloge en pause.
- **`start_paused` avec un vrai serveur** : l'horloge saute pendant les I/O, résultats faux.
- **Golden régénéré sans relire le diff** : le test ne vérifie plus rien.
- **Fixture de contrat générée depuis le code** : vérifie que le code est égal à lui-même.
- **Fixture avec des données réelles** (identifiants, PII) commitée dans le dépôt.
- **Tests broker sautés en CI** parce que `BROKER_URL` n'est pas posée : vert, mais vide.
- **Queues de test au nom fixe** : collisions entre tests parallèles.
- **Test du binaire sans `env_clear()`** : dépend de l'environnement du poste.
- **Clippy sans `--all-targets`** : les tests ne sont pas lintés.
- **Question d'entretien** : « Faux, stub, mock : quelle différence ? » → un stub renvoie des réponses figées, un faux (*fake*) est une implémentation simplifiée qui marche (broker en mémoire), un mock vérifie les appels reçus. Préfère les faux : ils testent le comportement.
- **Question d'entretien** : « Comment tester un retry avec un délai de 30 minutes ? » → injecter le délai (base de 1 ms en test) ou l'horloge virtuelle de Tokio (`start_paused`), et vérifier le nombre d'essais et la durée virtuelle.

## Défis

### 1. Exercice : un faux publisher qui enregistre

Version synchrone du pattern, std seule. Implémente `Publisher` pour `Recorder` (enregistre `(queue, body)`) et `sync_all`, qui publie chaque produit et s'arrête après `limit` publications (0 = tout).

```rust play
use std::cell::RefCell;

pub trait Publisher {
    fn publish(&self, queue: &str, body: &str)
        -> Result<(), String>;
}

#[derive(Default)]
pub struct Recorder { pub sent: RefCell<Vec<(String, String)>> }

impl Publisher for Recorder {
    fn publish(&self, queue: &str, body: &str)
        -> Result<(), String> {
        todo!()
    }
}

pub fn sync_all(mq: &impl Publisher, products: &[&str],
                limit: usize) -> Result<usize, String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publishes_everything() {
        let mq = Recorder::default();
        assert_eq!(sync_all(&mq, &["A", "B", "C"], 0), Ok(3));
        let sent = mq.sent.borrow();
        assert_eq!(sent[0], ("upsert_product".into(), "A".into()));
    }

    #[test]
    fn stops_at_limit() {
        let mq = Recorder::default();
        assert_eq!(sync_all(&mq, &["A", "B", "C"], 2), Ok(2));
        assert_eq!(mq.sent.borrow().len(), 2);
    }
}
```

::: details Solution
```rust play
use std::cell::RefCell;

pub trait Publisher {
    fn publish(&self, queue: &str, body: &str)
        -> Result<(), String>;
}

#[derive(Default)]
pub struct Recorder { pub sent: RefCell<Vec<(String, String)>> }

impl Publisher for Recorder {
    fn publish(&self, queue: &str, body: &str)
        -> Result<(), String> {
        self.sent.borrow_mut()
            .push((queue.to_string(), body.to_string()));
        Ok(())
    }
}

pub fn sync_all(mq: &impl Publisher, products: &[&str],
                limit: usize) -> Result<usize, String> {
    let mut published = 0;
    for p in products {
        if limit > 0 && published >= limit {
            break;
        }
        mq.publish("upsert_product", p)?;
        published += 1;
    }
    Ok(published)
}

fn main() {
    let mq = Recorder::default();
    println!("{:?}", sync_all(&mq, &["A", "B"], 1));
    println!("{:?}", mq.sent.borrow());
}
```

Le test vérifie ce qui a été **publié**, pas « `publish` a été appelée deux fois avec tels arguments ». Si demain `sync_all` publie par lots, le test reste valable tant que les messages sont les mêmes.
:::

### 2. Exercice : une horloge injectée

Le `Pacer` du chapitre 2, en version synchrone et testable : l'horloge est un trait. Implémente `wait` (renvoie la durée à attendre et note l'instant de la requête) et fais passer le test avec la fausse horloge.

```rust play
use std::cell::Cell;
use std::time::Duration;

pub trait Clock { fn now(&self) -> Duration; }

pub struct FakeClock(pub Cell<Duration>);
impl Clock for FakeClock {
    fn now(&self) -> Duration { self.0.get() }
}

#[derive(Default)]
pub struct Pacer { last: Option<Duration> }

impl Pacer {
    /// Attente avant la requête ; la requête part à now+attente.
    pub fn wait(&mut self, clock: &impl Clock, gap: Duration)
        -> Duration {
        todo!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const MS: fn(u64) -> Duration = Duration::from_millis;

    #[test]
    fn spacing() {
        let c = FakeClock(Cell::new(MS(0)));
        let mut p = Pacer::default();
        assert_eq!(p.wait(&c, MS(200)), MS(0), "premier");
        c.0.set(MS(50));
        assert_eq!(p.wait(&c, MS(200)), MS(150));
        c.0.set(MS(1000)); // temps passé ailleurs
        assert_eq!(p.wait(&c, MS(200)), MS(0));
    }
}
```

::: details Solution
```rust play
use std::cell::Cell;
use std::time::Duration;

pub trait Clock { fn now(&self) -> Duration; }

pub struct FakeClock(pub Cell<Duration>);
impl Clock for FakeClock {
    fn now(&self) -> Duration { self.0.get() }
}

#[derive(Default)]
pub struct Pacer { last: Option<Duration> }

impl Pacer {
    pub fn wait(&mut self, clock: &impl Clock, gap: Duration)
        -> Duration {
        let now = clock.now();
        let wait = match self.last {
            Some(prev) => (prev + gap).saturating_sub(now),
            None => Duration::ZERO,
        };
        self.last = Some(now + wait);
        wait
    }
}

fn main() {
    let c = FakeClock(Cell::new(Duration::ZERO));
    let mut p = Pacer::default();
    p.wait(&c, Duration::from_millis(200));
    println!("{:?}", p.wait(&c, Duration::from_millis(200)));
}
```

On note `now + wait` (l'instant où la requête part vraiment), pas `now` : sinon la requête suivante calculerait son écart depuis un instant trop tôt. En async, `start_paused` évite d'écrire ce trait : l'horloge de Tokio est déjà injectable.
:::

### 3. Exercice : un faux serveur HTTP en std

Pas de `wiremock` dans le Playground ? On en écrit un minuscule avec `TcpListener`. Le test démarre un serveur qui répond une suite de statuts. Implémente `fetch_with_retry` : réessaie sur 429 et 5xx jusqu'à `max` essais, renvoie `(statut final, essais)`.

```rust play
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

fn get_status(addr: &str) -> std::io::Result<u16> {
    let mut s = TcpStream::connect(addr)?;
    s.write_all(b"GET / HTTP/1.1\r\nHost: t\r\n\
                  Connection: close\r\n\r\n")?;
    let mut line = String::new();
    BufReader::new(s).read_line(&mut line)?;
    line.split_whitespace().nth(1)
        .and_then(|c| c.parse().ok())
        .ok_or_else(|| std::io::Error::other("statut"))
}

pub fn fetch_with_retry(addr: &str, max: u32) -> (u16, u32) {
    todo!() // utilise get_status
}

fn serve(statuses: Vec<u16>) -> (String, thread::JoinHandle<usize>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap().to_string();
    let h = thread::spawn(move || {
        for status in &statuses {
            let (s, _) = l.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut line = String::new();
            while r.read_line(&mut line).unwrap() > 2 {
                line.clear(); // lit jusqu'à la ligne vide
            }
            let mut s = s;
            write!(s, "HTTP/1.1 {status} X\r\n\
                       Content-Length: 0\r\n\r\n").unwrap();
        }
        statuses.len()
    });
    (addr, h)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_then_succeeds() {
        let (addr, server) = serve(vec![503, 429, 200]);
        assert_eq!(fetch_with_retry(&addr, 5), (200, 3));
        assert_eq!(server.join().unwrap(), 3);
    }

    #[test]
    fn not_found_is_final() {
        let (addr, server) = serve(vec![404]);
        assert_eq!(fetch_with_retry(&addr, 5), (404, 1));
        assert_eq!(server.join().unwrap(), 1);
    }
}
```

::: details Solution
```rust play
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;

fn get_status(addr: &str) -> std::io::Result<u16> {
    let mut s = TcpStream::connect(addr)?;
    s.write_all(b"GET / HTTP/1.1\r\nHost: t\r\n\
                  Connection: close\r\n\r\n")?;
    let mut line = String::new();
    BufReader::new(s).read_line(&mut line)?;
    line.split_whitespace().nth(1)
        .and_then(|c| c.parse().ok())
        .ok_or_else(|| std::io::Error::other("statut"))
}

pub fn fetch_with_retry(addr: &str, max: u32) -> (u16, u32) {
    let mut attempt = 1;
    loop {
        // une erreur réseau compte comme un 503 (transitoire)
        let status = get_status(addr).unwrap_or(503);
        let transient = status == 429 || status >= 500;
        if !transient || attempt >= max {
            return (status, attempt);
        }
        attempt += 1;
    }
}

fn main() {
    // sans serveur : 3 essais, tous en erreur réseau
    println!("{:?}", fetch_with_retry("127.0.0.1:9", 3));
}
```

Ce que le faux serveur prouve : le **nombre de requêtes reçues** (la valeur rendue par `join`). Si ton client réessayait un 404, le second test bloquerait (le serveur n'accepte qu'une connexion) : un test qui pend est aussi un échec, mais un mauvais. `wiremock` gère tout ça (timeouts, comptage, matchers) ; c'est pour ça qu'on l'utilise en vrai.
:::

### 4. Question : pourquoi ce test passe en local et échoue en CI ?

```rust
#[tokio::test]
async fn backoff_waits_two_seconds() {
    let start = std::time::Instant::now();
    retry_twice_with_1s_backoff().await;
    assert!(start.elapsed() >= Duration::from_secs(2));
    assert!(start.elapsed() < Duration::from_millis(2100));
}
```

::: details Solution
Le test mesure de **vraies** secondes avec une borne haute serrée. Sur un runner de CI chargé, l'ordonnanceur peut prendre 100 ms de plus : le test échoue au hasard (*flaky*). Et il coûte 2 s à chaque exécution.

Correctif : `#[tokio::test(start_paused = true)]`, `tokio::time::Instant` à la place de `std::time::Instant`, et une égalité **exacte** sur la durée virtuelle. Le test devient instantané et déterministe. (Attention : `std::time::Instant` n'est pas virtualisé, le test resterait faux avec lui.)
:::

## À retenir

- Règle pure : test unitaire sans rien. Réseau : faux serveur (`wiremock`). Broker : faux derrière un trait, plus quelques tests contre un vrai RabbitMQ.
- On vérifie le résultat observable (requêtes reçues, messages publiés), pas la forme des appels.
- Délais longs : backoff réduit en test, ou horloge Tokio en pause (`start_paused`, `tokio::time::Instant`) ; jamais de vraies secondes.
- Golden files pour le parsing (régénérés, diff relu) ; fixtures de contrat écrites à la main.
- Le binaire se teste aussi (`CARGO_BIN_EXE_*`, `env_clear()`, codes de sortie).
- `make check` = `fmt --check` + `clippy --all-targets -D warnings`, toolchain figée, même commande en local et en CI.
