# Architecture : une lib, des binaires

Ce que tu vas apprendre : organiser un crate de service en **une bibliothèque + plusieurs binaires minces**, découper les modules par responsabilité, garder l'environnement hors de la lib (et pourquoi c'est la clé de la testabilité), valider une config typée au démarrage, masquer les secrets, et placer `thiserror` et `anyhow` au bon étage.

## Un crate, une lib, plusieurs binaires

Tu as deux jobs (`sync` et `scraper`) qui partagent 80 % du code : client HTTP, broker, logs, config. Trois options :

| Option | Pour | Contre |
|---|---|---|
| Deux crates séparés | isolation totale | code partagé copié ou publié à part |
| Workspace (3 crates) | frontières strictes, builds parallèles | plus de `Cargo.toml`, versions à aligner |
| **Un crate : lib + `src/bin/`** | un seul `Cargo.toml`, un seul `Cargo.lock`, une seule image | toutes les deps compilées pour tous les binaires |

Pour deux ou trois CLI d'une même équipe, la troisième est la plus simple. Cargo trouve tout seul la lib (`src/lib.rs`) et chaque binaire (`src/bin/<nom>.rs`) : pas besoin de sections `[lib]` ni `[[bin]]`.

```text
catalog-jobs/
├── Cargo.toml
├── src/
│   ├── lib.rs            # déclare les modules
│   ├── bin/
│   │   ├── sync.rs       # binaire mince
│   │   └── scraper.rs    # binaire mince
│   ├── config.rs         # lecture + validation
│   ├── http.rs           # client HTTP + http/retry.rs
│   ├── broker.rs         # publication AMQP
│   ├── messages.rs       # payloads publiés (serde)
│   ├── state.rs          # SQLite de l'incrémental
│   ├── logging.rs        # tracing
│   └── commands/         # la logique de chaque job
│       ├── sync.rs
│       └── scraper.rs
└── tests/                # tests d'intégration (API pub)
```

Le workspace devient le bon choix quand un morceau doit être **publié** seul, ou quand les temps de compilation explosent (le [chapitre 12](/dev/rust/12-tests-et-outillage) montre la mise en place).

::: info Modules sans `mod.rs`
Depuis l'édition 2018, `src/http.rs` + `src/http/retry.rs` remplace `src/http/mod.rs`. Choisis une forme et tiens-la dans tout le crate : mélanger les deux rend l'arborescence illisible.
:::

## Des modules par responsabilité, pas par couche

Un module = une chose que tu peux expliquer en une phrase, avec sa propre erreur :

| Module | Responsabilité | Erreur |
|---|---|---|
| `http` | parler HTTP, retry | `HttpError` |
| `broker` | publier avec confirmation | `BrokerError` |
| `state` | lire/écrire l'état local | `anyhow` (interne) |
| `messages` | la forme exacte du JSON publié | `serde_json::Error` |
| `commands` | enchaîner le tout pour un job | `anyhow::Error` |

L'anti-pattern : `utils.rs`, `helpers.rs`, `common/`. Dans six mois personne ne sait ce qu'il y a dedans.

La visibilité suit le même principe. Dans `lib.rs`, n'exporte que ce que les binaires et les tests d'intégration utilisent :

```rust
// src/lib.rs
pub mod cli;        // utilisé par src/bin/*
pub mod commands;   // idem
pub mod config;
pub mod logging;

pub(crate) mod broker;   // détail interne
pub(crate) mod http;
pub(crate) mod messages;
pub(crate) mod state;
```

`pub(crate)` = visible partout dans le crate, invisible dehors. Un binaire de `src/bin/` est un **autre crate** qui dépend de la lib : il ne voit que le `pub`. C'est une bonne contrainte, elle te force à garder une API d'entrée petite.

## Le binaire est mince

Le binaire ne fait que câbler. Toute la logique vit dans la lib, parce que la lib se teste et le `main` non.

```rust
// src/bin/sync.rs
use std::process::ExitCode;
use clap::Parser;
use catalog_jobs::{cli, commands::sync, config};

#[derive(Parser)]
struct Args {
    #[arg(long)]
    provider: String,
    #[arg(long, default_value_t = 0)]
    limit: u64,
}

fn main() -> ExitCode {
    let args = Args::parse(); // usage invalide : sortie 2
    let env = config::process_env();
    let cfg = match sync::Config::load(env, &args.provider) {
        Ok(cfg) => cfg,
        Err(e) => {
            eprintln!("configuration invalide :\n{e}");
            return ExitCode::from(2);
        }
    };
    let (_guard, rt) = match cli::start(&cfg.logging) {
        Ok(started) => started,
        Err(code) => return code,
    };
    let result = rt.block_on(sync::run(&cfg, args.limit));
    cli::exit_code(&result)
}
```

Trois détails qui comptent :

- **Pas de `#[tokio::main]`** : on construit le runtime à la main après avoir lu la config et installé les logs. Tant qu'il n'y a qu'un thread, modifier l'environnement (charger un `.env`) est sûr ; après, non.
- **`_guard`** est gardé jusqu'à la fin de `main` : son `Drop` vide les buffers (logs, Sentry). Pas de `std::process::exit()` au milieu : il sort sans exécuter les `Drop`.
- **`main` renvoie `ExitCode`**, pas `Result` : on choisit le code (0, 1, 2) au lieu de laisser Rust afficher un `Debug` et sortir en 1.

Le parsing des arguments avec clap est couvert au [chapitre 11](/dev/rust/11-cli-clap).

## La lib ne lit jamais l'environnement

C'est la règle qui change tout. Aucun module de la lib n'appelle `std::env::var`. Seul le binaire lit l'environnement, une fois, et passe une `HashMap` :

```rust
// src/config.rs
use std::collections::HashMap;

/// Seul point de contact avec l'environnement du processus.
pub fn process_env() -> HashMap<String, String> {
    std::env::vars_os()
        .filter_map(|(k, v)| {
            Some((k.into_string().ok()?, v.into_string().ok()?))
        })
        .collect()
}
```

Pourquoi ce détour :

1. **Les tests tournent en parallèle**, dans le même processus. Si deux tests posent `BROKER_URL` avec des valeurs différentes, ils se marchent dessus. Avec une `HashMap` passée en argument, chaque test a la sienne.
2. **En édition 2024, `std::env::set_var` est `unsafe`.** Modifier l'environnement pendant qu'un autre thread le lit est une data race au niveau de la libc. Un test qui fait `set_var` dans un runtime multi-thread est un bug qui attend son heure.
3. **La config devient une valeur** : tu peux la construire, l'afficher, la comparer dans un test.

C'est exactement le pattern d'un `parseEnv(schema, process.env)` côté TS, où la source est injectée.

::: warning Le `.env` se charge avant le runtime
Une option `--env-file .env.staging` (avec la crate `dotenvy`) **écrit** dans l'environnement du processus. Fais-le en tout début de `main`, avant de créer le runtime Tokio et ses threads. Pour la même raison que `set_var` est `unsafe`.
:::

## Une config typée, validée au démarrage

Lire une variable au moment où on en a besoin, c'est découvrir à la 3e heure du job que `S3_BUCKET` manque. On lit et on valide **tout** au démarrage, et on accumule les erreurs pour les montrer d'un coup :

```rust
pub struct EnvReader {
    vars: HashMap<String, String>,
    errors: Vec<String>,
}

impl EnvReader {
    pub fn require(&mut self, name: &str) -> String {
        let v = self.vars.get(name).cloned().unwrap_or_default();
        if v.is_empty() {
            self.errors.push(format!("{name} manquante"));
        }
        v
    }

    pub fn finish(self) -> Result<(), ConfigError> {
        if self.errors.is_empty() {
            return Ok(());
        }
        Err(ConfigError(self.errors))
    }
}
```

Chaque job a sa struct de config, construite par un `load` :

```rust
pub struct Config {
    pub broker_url: String,
    pub creds: Credentials,
    pub page_size: u64,
}

impl Config {
    pub fn load(vars: HashMap<String, String>)
        -> Result<Self, ConfigError>
    {
        let mut env = EnvReader::new(vars);
        let cfg = Self {
            broker_url: env.require("BROKER_URL"),
            creds: env.credentials("SUPPLIER"),
            page_size: env.uint("PAGE_SIZE", 1000),
        };
        env.finish()?; // toutes les erreurs, ou rien
        Ok(cfg)
    }
}
```

La sortie du job sur une config invalide :

```text
sync : configuration invalide :
BROKER_URL manquante
SUPPLIER_PASSWORD manquante
PAGE_SIZE="abc" invalide : entier positif attendu
```

Une exécution suffit pour tout corriger. Et le code de sortie est **2** (usage/config), distinct de **1** (le job a échoué) : Kubernetes peut ne pas réessayer un job mal configuré (chapitre 6).

::: tip Alternatives
`envy` ou `config` désérialisent l'environnement dans une struct via serde. Pratique, mais les messages d'erreur s'arrêtent à la première variable et le mapping des noms est implicite. Un lecteur maison de 100 lignes est plus explicite ; au-delà de 20 variables, une crate se justifie.
:::

## Les secrets ne passent jamais par `Debug`

`#[derive(Debug)]` sur une struct qui contient un mot de passe, c'est un mot de passe dans les logs au premier `tracing::debug!(?cfg)`. Ou dans Sentry, au premier panic qui affiche la struct. On écrit `Debug` à la main :

```rust
pub const MASK: &str = "***";

#[derive(Clone)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>)
        -> std::fmt::Result
    {
        f.debug_struct("Credentials")
            .field("username", &self.username)
            .field("password", &MASK)
            .finish()
    }
}
```

Une URL AMQP `amqp://user:motdepasse@host` est aussi un secret : même traitement pour toute struct qui la porte. Et un test par struct, qui casse si quelqu'un remet le `derive` :

```rust
#[test]
fn debug_hides_password() {
    let c = Credentials {
        username: "u".into(),
        password: "s3cret".into(),
    };
    assert!(!format!("{c:?}").contains("s3cret"));
}
```

Alternative : la crate `secrecy` (`SecretString`), qui rend l'accès explicite (`expose_secret()`). Plus robuste, mais une dépendance et un peu de bruit à chaque usage.

## `thiserror` dans la lib, `anyhow` dans les commandes

La règle générale est au [chapitre 5](/dev/rust/05-gestion-erreurs). Appliquée à un service :

- **Un enum `thiserror` par module d'infrastructure** (`HttpError`, `BrokerError`). L'appelant doit pouvoir **décider** : réessayer, sauter l'élément, arrêter le job.
- **`anyhow::Result` + `.context()` dans `commands/`**, là où on ne fait plus que remonter l'erreur avec du contexte métier.

```rust
#[derive(Debug, thiserror::Error)]
pub enum BrokerError {
    #[error("connexion impossible après {attempts} essais")]
    Connect { attempts: u32, last: String },
    #[error("queue {queue:?} introuvable")]
    QueueMissing { queue: String },
    #[error("message refusé (nack) sur {queue:?}")]
    Nacked { queue: String },
}
```

Remarque l'absence d'URL dans les messages : l'URL contient le mot de passe. Les variantes portent ce qui sert à **décider** (`Nacked` = ralentir, `QueueMissing` = arrêter), pas tout le contexte du monde.

Côté commande :

```rust
use anyhow::Context;

let broker = Broker::connect(cfg.broker.clone())
    .await
    .context("connexion au broker")?;
db.mark_published(view.id)
    .with_context(|| format!("marquage de la vue {}", view.id))?;
```

Et une seule fonction transforme le résultat final en code de sortie, en affichant toute la chaîne :

```rust
pub fn exit_code<T>(result: &anyhow::Result<T>) -> ExitCode {
    match result {
        Ok(_) => ExitCode::SUCCESS,
        Err(e) => {
            // {:#} : "contexte: cause: cause racine"
            tracing::error!(error = format!("{e:#}"), "échec");
            ExitCode::FAILURE
        }
    }
}
```

Pour reconnaître une erreur précise au milieu d'une chaîne `anyhow` (par exemple « run déjà en cours » qui doit sortir en 2 et non en 1) : `e.chain().any(|c| c.is::<AlreadyRunning>())`.

## Jamais d'`unwrap()` hors tests

Un `unwrap()` dans un job de nuit, c'est un panic à 3 h, sans contexte, sur la seule ligne mal formée du fichier. Dans la lib et les binaires :

| Au lieu de | Écris |
|---|---|
| `x.unwrap()` sur une entrée externe | `?` avec un type d'erreur |
| `x.unwrap()` sur un invariant | `x.expect("raison de l'invariant")`, rarement |
| `v[i]` sur un index calculé | `v.get(i)` |
| `a as u32` sur un `u64` | `u32::try_from(a)` |
| `d.as_millis() as i64` | `i64::try_from(..).unwrap_or(i64::MAX)` |

Clippy peut l'imposer. Dans `Cargo.toml` :

```toml
[lints.clippy]
unwrap_used = "deny"
```

et dans `clippy.toml`, pour garder les tests lisibles :

```toml
allow-unwrap-in-tests = true
```

Dans les tests, `unwrap()` et `expect()` sont parfaits : un panic **est** un échec de test.

## Un trait pour chaque frontière qu'on veut simuler

Dernière brique : pour tester la boucle d'un job sans RabbitMQ, on met un trait devant le broker. Une seule implémentation réelle, un faux dans les tests :

```rust
pub trait Publisher {
    fn publish<T: serde::Serialize + Sync>(
        &self,
        queue: &str,
        msg_type: &str,
        payload: &T,
    ) -> impl std::future::Future<
        Output = Result<(), BrokerError>,
    >;
}
```

La forme `-> impl Future` plutôt que `async fn` dans un trait public : rustc avertit (`async_fn_in_trait`) parce qu'une `async fn` de trait ne permet pas à l'appelant d'exiger que la future soit `Send`. Dans un trait interne (`pub(crate)`), `async fn` suffit.

Le coût : une indirection et des génériques (`mq: &impl Publisher`) dans les signatures. Ne le fais que pour les frontières que tu veux vraiment simuler (réseau, broker, stockage), pas « au cas où ». Le chapitre 7 montre le faux.

## Cas réel

Le crate du fil rouge, après six mois :

- `src/bin/sync.rs` : 60 lignes. Parse, config, logs, runtime, `run`, code de sortie.
- `src/bin/scraper.rs` : 80 lignes, avec deux sous-commandes clap.
- La lib : une vingtaine de modules, chacun avec ses tests en bas de fichier.
- `tests/cli.rs` lance les **vrais binaires** (`env!("CARGO_BIN_EXE_sync")`) avec un environnement vide et vérifie le contrat avec l'orchestrateur : config manquante → sortie 2 et la liste de toutes les variables manquantes sur stderr.

Un incident évité par cette structure : un développeur ajoute un champ `api_key` à la config du fournisseur avec `#[derive(Debug)]`. Le test `debug_hides_*` de la struct parente échoue en CI. Sans lui, la clé partait dans Sentry au premier `error!(?cfg)`.

## Pièges classiques

- **`std::env::var` au fond d'un module** : test impossible à isoler, valeur lue au mauvais moment. Lis tout à l'entrée.
- **`set_var` dans un test** : `unsafe` en édition 2024 pour une bonne raison. Injecte une `HashMap`.
- **Charger le `.env` après `#[tokio::main]`** : les threads du runtime existent déjà.
- **Valider paresseusement** : le job échoue à la 3e heure sur une variable absente.
- **`#[derive(Debug)]` sur une struct à secret** : fuite dans les logs, Sentry, les messages de panic.
- **`process::exit()` au milieu du code** : les `Drop` ne s'exécutent pas, les logs bufferisés sont perdus.
- **Un seul enum d'erreur pour tout le crate** : chaque fonction semble pouvoir tout renvoyer, plus personne ne sait quoi traiter.
- **Question d'entretien** : « Pourquoi une lib + des binaires plutôt qu'un `main.rs` ? » → la logique se teste via la lib, les tests d'intégration n'ont accès qu'à l'API `pub`, plusieurs binaires partagent le code sans workspace.
- **Question d'entretien** : « `thiserror` ou `anyhow` ? » → `thiserror` quand l'appelant doit distinguer les cas, `anyhow` quand il ne fait que propager et afficher.

## Défis

### 1. Exercice : une config qui liste toutes ses erreurs

Implémente `load` : `BROKER_URL` obligatoire, `PAGE_SIZE` facultatif (défaut 1000, entier strictement positif). Toutes les erreurs sont rendues ensemble, dans l'ordre de lecture.

```rust play
use std::collections::HashMap;

#[derive(Debug, PartialEq)]
pub struct Config {
    pub broker_url: String,
    pub page_size: u64,
}

pub fn load(vars: &HashMap<&str, &str>)
    -> Result<Config, Vec<String>>
{
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults() {
        let v = HashMap::from([("BROKER_URL", "amqp://h")]);
        let c = load(&v).unwrap();
        assert_eq!(c.page_size, 1000);
    }

    #[test]
    fn all_errors_at_once() {
        let v = HashMap::from([("PAGE_SIZE", "0")]);
        let e = load(&v).unwrap_err();
        assert_eq!(e, vec![
            "BROKER_URL manquante".to_string(),
            "PAGE_SIZE=\"0\" invalide".to_string(),
        ]);
    }

    #[test]
    fn empty_counts_as_missing() {
        let v = HashMap::from([("BROKER_URL", "")]);
        assert!(load(&v).is_err());
    }
}
```

::: details Solution
```rust play
use std::collections::HashMap;

#[derive(Debug, PartialEq)]
pub struct Config {
    pub broker_url: String,
    pub page_size: u64,
}

pub fn load(vars: &HashMap<&str, &str>)
    -> Result<Config, Vec<String>>
{
    let mut errors = Vec::new();
    let get = |k: &str| {
        vars.get(k).copied().filter(|v| !v.is_empty())
    };
    let broker_url = get("BROKER_URL").unwrap_or_default();
    if broker_url.is_empty() {
        errors.push("BROKER_URL manquante".to_string());
    }
    let page_size = match get("PAGE_SIZE") {
        None => 1000,
        Some(raw) => match raw.parse::<u64>() {
            Ok(n) if n > 0 => n,
            _ => {
                errors.push(format!("PAGE_SIZE={raw:?} invalide"));
                1000
            }
        },
    };
    if !errors.is_empty() {
        return Err(errors);
    }
    Ok(Config { broker_url: broker_url.into(), page_size })
}

fn main() {
    let v = HashMap::from([("PAGE_SIZE", "abc")]);
    println!("{:?}", load(&v));
}
```

Le point clé : on **continue** après la première erreur, avec une valeur de repli, pour pouvoir signaler la suivante. Le `Result` n'est tranché qu'à la fin.
:::

### 2. Exercice : masquer le secret

`#[derive(Debug)]` fait fuiter le mot de passe. Remplace-le par un `Debug` écrit à la main qui affiche `***`, sans changer les tests.

```rust play
#[derive(Debug)]
pub struct BrokerConfig {
    pub url: String,
    pub max_attempts: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_hides_url() {
        let c = BrokerConfig {
            url: "amqp://u:mdp-secret@h".into(),
            max_attempts: 5,
        };
        let s = format!("{c:?}");
        assert!(!s.contains("mdp-secret"), "{s}");
        assert!(s.contains("max_attempts: 5"), "{s}");
    }
}
```

::: details Solution
```rust play
pub struct BrokerConfig {
    pub url: String,
    pub max_attempts: u32,
}

impl std::fmt::Debug for BrokerConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>)
        -> std::fmt::Result
    {
        f.debug_struct("BrokerConfig")
            .field("url", &"***")
            .field("max_attempts", &self.max_attempts)
            .finish()
    }
}

fn main() {
    let c = BrokerConfig {
        url: "amqp://u:p@h".into(),
        max_attempts: 5,
    };
    println!("{c:?}"); // BrokerConfig { url: "***", ... }
}
```

On masque toute l'URL, pas seulement le mot de passe : parser l'URL pour n'en cacher qu'une partie est une source de bugs (et l'hôte d'un broker interne n'a rien à faire dans un log public non plus).
:::

### 3. Question : pourquoi ce test est-il instable ?

```rust
#[test]
fn reads_page_size() {
    unsafe { std::env::set_var("PAGE_SIZE", "50") };
    assert_eq!(Config::from_env().page_size, 50);
}

#[test]
fn default_page_size() {
    unsafe { std::env::remove_var("PAGE_SIZE") };
    assert_eq!(Config::from_env().page_size, 1000);
}
```

::: details Solution
`cargo test` lance les tests **en parallèle**, dans des threads d'un même processus. L'environnement est global au processus : `remove_var` du second test peut s'exécuter entre le `set_var` et la lecture du premier. Le test passe ou échoue selon l'ordonnancement.

Pire : lire et écrire l'environnement depuis deux threads est une data race dans la libc, d'où le `unsafe` imposé par l'édition 2024. Correctif : `Config::load(vars: HashMap<..>)`, chaque test construit sa `HashMap`. `--test-threads=1` masque le problème au lieu de le corriger.
:::

### 4. Mini-scénario : quel type d'erreur ?

Le module `http` renvoie une erreur sur un 503. La boucle du scraper doit réessayer plus tard sur un 503, sauter la page sur un 404, et arrêter tout le job sur un 401 (session perdue). Quel type d'erreur pour `http`, et pourquoi pas `anyhow::Error` ?

::: details Solution
Un enum `thiserror` (`HttpError::Status { status, .. }`, `Network`, ...) avec des méthodes de classement (`is_transient()`, `is_auth()`). L'appelant fait un `match` exhaustif et le compilateur l'avertit si une variante apparaît.

Avec `anyhow::Error`, l'appelant devrait faire `downcast_ref::<reqwest::Error>()` ou, pire, chercher « 503 » dans le message : fragile, et invisible au compilateur. `anyhow` est très bien **au-dessus**, dans `commands/`, quand plus personne ne décide rien.
:::

## À retenir

- Un crate = une lib qui contient toute la logique + des binaires minces dans `src/bin/`.
- Seul le binaire lit l'environnement ; la lib reçoit une `HashMap` ou une struct. Tests parallèles sûrs, `set_var` évité.
- Config validée **entièrement** au démarrage, toutes les erreurs d'un coup, sortie en 2.
- Tout secret a un `Debug` écrit à la main et un test qui le vérifie.
- `thiserror` là où l'appelant décide, `anyhow` + `.context()` là où on ne fait que remonter.
- Pas d'`unwrap()` hors tests ; un trait seulement devant les frontières à simuler.
