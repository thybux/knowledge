# Gestion d'erreurs

Ce que tu vas apprendre : `Result` et l'opérateur `?`, écrire des types d'erreur propres, choisir entre `thiserror` (bibliothèques) et `anyhow` (applications), convertir les erreurs entre couches avec `From`, et savoir quand `panic!` est acceptable.

## Pas d'exceptions : des valeurs

En TS, une erreur est **lancée** et peut venir de n'importe où ; la signature ne dit rien :

```ts
async function chargeCustomer(id: string): Promise<Receipt> {
  // peut throw : réseau, carte refusée, JSON invalide… qui sait ?
}
```

En Rust, une opération qui peut échouer **renvoie** un `Result` :

```rust
enum Result<T, E> {
    Ok(T),
    Err(E),
}
```

L'erreur fait partie du type. Impossible de l'ignorer par accident : un `Result` non utilisé déclenche un warning (`#[must_use]`), et tu ne peux pas accéder au `T` sans traiter le cas `Err`.

```rust play
fn parse_qty(s: &str) -> Result<u32, String> {
    let n: u32 = s.trim().parse()
        .map_err(|e| format!("'{s}' n'est pas un nombre : {e}"))?;
    if n == 0 {
        return Err("la quantité doit être > 0".into());
    }
    Ok(n)
}

fn main() {
    for input in ["3", "0", "abc"] {
        match parse_qty(input) {
            Ok(n) => println!("ok : {n}"),
            Err(e) => println!("erreur : {e}"),
        }
    }
}
```

## L'opérateur `?`

`?` veut dire : « si c'est `Err`, **renvoie-la** immédiatement (après conversion) ; sinon, donne-moi la valeur ».

```rust
let n = s.parse::<u32>()?;
// équivaut à
let n = match s.parse::<u32>() {
    Ok(v) => v,
    Err(e) => return Err(From::from(e)),
};
```

Trois choses à noter :

1. `?` ne marche que dans une fonction qui renvoie `Result` (ou `Option`, pour `?` sur un `Option`).
2. Il appelle `From::from(e)` : c'est ce qui permet de **convertir** automatiquement une erreur de bas niveau en erreur de ta couche.
3. C'est l'équivalent d'un `await` pour les erreurs : la propagation est **visible** à chaque point d'échec, contrairement à un `throw` implicite.

`main` peut aussi renvoyer un `Result` :

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cfg = std::fs::read_to_string("config.toml")?;
    println!("{} octets", cfg.len());
    Ok(())
}
```

## Les méthodes utiles

| Méthode | Effet |
|---|---|
| `map_err(f)` | transforme l'erreur |
| `ok()` | `Result<T, E>` → `Option<T>` |
| `ok_or(e)` | `Option<T>` → `Result<T, E>` |
| `unwrap_or(d)` / `unwrap_or_default()` | valeur de secours |
| `and_then(f)` | enchaîne une opération faillible |
| `expect("msg")` | panic avec message si `Err` |

```rust play
fn find_price(sku: &str) -> Option<u64> {
    match sku { "MUG" => Some(899), _ => None }
}

fn total(skus: &[&str]) -> Result<u64, String> {
    let mut sum = 0;
    for sku in skus {
        sum += find_price(sku)
            .ok_or_else(|| format!("SKU inconnu : {sku}"))?;
    }
    Ok(sum)
}

fn main() {
    println!("{:?}", total(&["MUG", "MUG"]));
    println!("{:?}", total(&["MUG", "TSHIRT"]));
}
```

## Un vrai type d'erreur

`String` comme type d'erreur, c'est l'équivalent de `throw "oops"` : impossible pour l'appelant de distinguer les cas. Un enum d'erreur permet de **réagir** différemment (retry sur timeout, 404 sur not found…).

À la main, il faut implémenter `Debug`, `Display` et `std::error::Error` :

```rust play
use std::fmt;

#[derive(Debug)]
enum PaymentError {
    CardDeclined { code: String },
    InsufficientFunds,
    Timeout,
}

impl fmt::Display for PaymentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CardDeclined { code } => {
                write!(f, "carte refusée ({code})")
            }
            Self::InsufficientFunds => write!(f, "fonds insuffisants"),
            Self::Timeout => write!(f, "délai dépassé"),
        }
    }
}

impl std::error::Error for PaymentError {}

fn main() {
    let errs = [PaymentError::Timeout,
                PaymentError::CardDeclined { code: "05".into() }];
    for e in &errs {
        let retryable = matches!(e, PaymentError::Timeout);
        println!("{e} (retry : {retryable})");
    }
}
```

## `thiserror` : les erreurs de bibliothèque

C'est verbeux. La crate `thiserror` génère `Display`, `Error` et les `From` via des attributs :

```rust play
use thiserror::Error;

#[derive(Debug, Error)]
enum ImportError {
    #[error("ligne {line} : champ manquant `{field}`")]
    MissingField { line: usize, field: &'static str },

    #[error("montant invalide")]
    BadAmount(#[from] std::num::ParseIntError),

    #[error("lecture du fichier")]
    Io(#[from] std::io::Error),
}

fn parse_amount(s: &str) -> Result<i64, ImportError> {
    Ok(s.parse::<i64>()?) // ParseIntError → ImportError via #[from]
}

fn main() {
    println!("{}", parse_amount("12x").unwrap_err());
    let e = ImportError::MissingField { line: 3, field: "email" };
    println!("{e}");

    // la cause d'origine reste accessible via source()
    use std::error::Error;
    let e = parse_amount("abc").unwrap_err();
    println!("{e} ← cause : {}", e.source().unwrap());
}
```

- `#[error("...")]` : le message `Display`, avec interpolation des champs.
- `#[from]` : génère `impl From<ParseIntError> for ImportError`, donc `?` convertit tout seul, et la cause est exposée via `source()`.
- `#[error(transparent)]` : délègue `Display` et `source` à l'erreur interne.

::: tip Ne répète pas la cause dans le message
`#[error("montant invalide : {0}")]` + `#[from]` affiche la cause deux fois quand on imprime la chaîne complète. Convention : le message décrit **ta** couche, la cause est dans `source()`.
:::

## `anyhow` : les erreurs d'application

Dans un binaire (CLI, worker, `main` d'un serveur), tu n'as souvent pas besoin de matcher sur les erreurs : tu veux les **remonter avec du contexte** et les afficher. `anyhow::Error` est un « n'importe quelle erreur » avec contexte :

```rust play
use anyhow::{bail, Context, Result};

fn load_rate(raw: &str) -> Result<f64> {
    let rate: f64 = raw.parse()
        .with_context(|| format!("taux invalide : {raw:?}"))?;
    if !(0.0..=1.0).contains(&rate) {
        bail!("taux hors limites : {rate}");
    }
    Ok(rate)
}

fn run() -> Result<()> {
    let r = load_rate("1,5").context("chargement de la config TVA")?;
    println!("taux {r}");
    Ok(())
}

fn main() {
    if let Err(e) = run() {
        // {:#} : toute la chaîne de contexte sur une ligne
        println!("erreur : {e:#}");
        // {:?} : format multi-lignes "Caused by:"
        println!("---\n{e:?}");
    }
}
```

### Lequel choisir ?

| | `thiserror` | `anyhow` |
|---|---|---|
| Pour | bibliothèques, couches métier | binaires, `main`, scripts |
| L'appelant peut matcher | oui (enum) | non (type opaque*) |
| Ajout de contexte | variantes dédiées | `.context(...)` |
| Équivalent TS | `class NotFoundError extends Error` | `throw new Error(..., { cause })` |

\* `anyhow::Error::downcast_ref::<T>()` existe mais c'est un aveu : si tu dois matcher, il te faut un enum.

Dans un vrai projet, tu utilises **les deux** : `thiserror` dans les crates/modules métier, `anyhow` au sommet (le binaire).

## `panic!` vs `Result`

Un `panic!` arrête le thread courant (et le programme si c'est le thread principal) en déroulant la pile. C'est pour les **bugs**, pas pour les erreurs attendues.

| Situation | Choix |
|---|---|
| Entrée utilisateur invalide | `Result` |
| Réseau, BDD, fichier | `Result` |
| Invariant interne violé (bug) | `panic!` / `unreachable!` |
| Config absente au démarrage | `expect("...")` acceptable |
| Tests, prototypes | `unwrap()` OK |

```rust
// OK : si ça échoue, c'est un bug de déploiement, autant crasher
// tout de suite au démarrage avec un message clair
let db_url = std::env::var("DATABASE_URL")
    .expect("DATABASE_URL doit être défini");

// PAS OK : un client peut envoyer n'importe quoi
let qty: u32 = body.qty.parse().unwrap(); // un panic par requête
```

::: warning `expect` plutôt que `unwrap`
Si tu dois paniquer, écris **pourquoi** ça ne devrait jamais arriver : `expect("regex statique valide")`. Le message apparaît dans le panic et sauve du temps au débogage.
:::

::: info Panics dans un serveur
Avec Axum, chaque connexion tourne dans sa propre tâche Tokio : un panic dans un handler tue cette tâche, pas le serveur. Ce n'est pas une raison pour paniquer : le client voit la connexion coupée (sauf si tu ajoutes `CatchPanicLayer` de `tower-http`, qui renvoie un 500), et un panic pendant qu'un `Mutex` std est verrouillé l'**empoisonne**.
:::

## Cas réel : les couches d'une API de commandes

Chaque couche a son propre type d'erreur, et `From` fait le pont :

```text
SQL / réseau  →  RepoError  →  OrderError  →  réponse HTTP
 (sqlx::Error)    (infra)      (métier)       (status + JSON)
```

```rust play
use thiserror::Error;

// --- couche infra (repository)
#[derive(Debug, Error)]
enum RepoError {
    #[error("ligne introuvable")]
    NotFound,
    #[error("connexion BDD perdue")]
    Connection,
}

// --- couche métier
#[derive(Debug, Error)]
enum OrderError {
    #[error("commande {0} introuvable")]
    NotFound(u64),
    #[error("commande déjà expédiée")]
    AlreadyShipped,
    #[error("erreur technique")]
    Repo(#[source] RepoError),
}

fn find_status(id: u64) -> Result<&'static str, RepoError> {
    match id {
        1 => Ok("shipped"),
        2 => Ok("paid"),
        3 => Err(RepoError::Connection),
        _ => Err(RepoError::NotFound),
    }
}

fn cancel(id: u64) -> Result<(), OrderError> {
    // traduction explicite : NotFound infra → NotFound métier
    let status = find_status(id).map_err(|e| match e {
        RepoError::NotFound => OrderError::NotFound(id),
        other => OrderError::Repo(other),
    })?;
    if status == "shipped" {
        return Err(OrderError::AlreadyShipped);
    }
    Ok(())
}

// --- couche HTTP : mapping vers un status code
fn to_http(e: &OrderError) -> (u16, String) {
    match e {
        OrderError::NotFound(_) => (404, e.to_string()),
        OrderError::AlreadyShipped => (409, e.to_string()),
        // ne jamais fuiter le détail technique au client
        OrderError::Repo(_) => (500, "erreur interne".into()),
    }
}

fn main() {
    for id in [1, 2, 3, 99] {
        match cancel(id) {
            Ok(()) => println!("#{id} → 200 annulée"),
            Err(e) => {
                let (code, msg) = to_http(&e);
                println!("#{id} → {code} {msg}  (log: {e:?})");
            }
        }
    }
}
```

Points de design :

- Ici, `map_err` plutôt que `#[from]` : `RepoError::NotFound` doit devenir une erreur **métier**, pas une erreur technique. `#[from]` est parfait quand la conversion est mécanique.
- Le client reçoit un message neutre pour les 500 ; le détail part dans les **logs**.
- Dans Axum, `to_http` devient un `impl IntoResponse for OrderError` ([chapitre 10](/dev/rust/10-api-axum-sqlx)).

## Pièges classiques

- **`unwrap()` en prod** sur des données externes : chaque `unwrap` est un panic potentiel. `clippy::unwrap_used` peut l'interdire.
- **`String` comme type d'erreur** dans une lib : l'appelant ne peut rien en faire.
- **Un enum d'erreur géant pour toute l'app** : chaque fonction semble pouvoir tout renvoyer. Un type par module/couche.
- **Perdre la cause** : `map_err(|_| MyError::Db)` jette l'erreur d'origine. Garde-la en `#[source]` ou logue-la.
- **Fuiter des détails internes** (SQL, stack) dans les réponses HTTP.
- **`Box<dyn Error>` dans un code async multi-thread** : il faut `Box<dyn Error + Send + Sync>` (ou `anyhow::Error`, qui l'est déjà).
- **Question d'entretien** : « Que fait `?` exactement ? » → `match` + early return + `From::from` sur l'erreur.

## Défis

### 1. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
fn main() {
    let port: u16 = "8080".parse()?;
    println!("{port}");
}
```

::: details Solution
E0277 : `?` ne peut être utilisé que dans une fonction qui renvoie `Result` ou `Option`, or `main` renvoie `()`. Solution : `fn main() -> Result<(), Box<dyn std::error::Error>>` (et `Ok(())` à la fin), ou `anyhow::Result<()>`.
:::

### 2. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
#[derive(Debug)]
enum ConfigError { Missing }

fn port(raw: Option<&str>) -> Result<u16, ConfigError> {
    let s = raw.ok_or(ConfigError::Missing)?;
    let p = s.parse::<u16>()?;
    Ok(p)
}

fn main() {
    println!("{:?}", port(Some("80")));
}
```

::: details Solution
E0277 : `?` doit convertir `ParseIntError` en `ConfigError`, mais aucun `impl From<ParseIntError> for ConfigError` n'existe. Deux options : ajouter une variante `Invalid(ParseIntError)` avec `impl From` (ou `#[from]` de `thiserror`), ou `s.parse::<u16>().map_err(|_| ConfigError::Invalid)?`.
:::

### 3. Que affiche ce code ?

```rust play
use anyhow::{Context, Result};

fn read() -> Result<u32> {
    let n: u32 = "x".parse().context("lecture du quota")?;
    Ok(n)
}

fn main() {
    let e = read().context("démarrage du worker").unwrap_err();
    println!("{e}");
    println!("{e:#}");
}
```

::: details Solution
```text
démarrage du worker
démarrage du worker: lecture du quota: invalid digit found in string
```

`{}` n'affiche que le contexte le plus externe ; `{:#}` affiche toute la chaîne séparée par `: `. C'est le format à utiliser dans les logs d'un binaire.
:::

### 4. Exercice : valider un import

Parse des lignes `"email,montant_cents"`. Renvoie toutes les lignes valides, ou la **première** erreur avec son numéro de ligne (1-based). Un montant négatif ou non numérique est invalide.

```rust play
use thiserror::Error;

#[derive(Debug, Error, PartialEq)]
pub enum ImportError {
    #[error("ligne {line} : format attendu email,montant")]
    BadFormat { line: usize },
    #[error("ligne {line} : montant invalide")]
    BadAmount { line: usize },
}

pub fn import(lines: &[&str]) -> Result<Vec<(String, u64)>, ImportError> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok() {
        let r = import(&["a@x.io,100", "b@y.io,250"]).unwrap();
        assert_eq!(r, vec![("a@x.io".into(), 100),
                           ("b@y.io".into(), 250)]);
    }
    #[test]
    fn first_error_wins() {
        let e = import(&["a@x.io,1", "oops", "b,zz"]).unwrap_err();
        assert_eq!(e, ImportError::BadFormat { line: 2 });
        assert_eq!(e.to_string(),
                   "ligne 2 : format attendu email,montant");
    }
    #[test]
    fn bad_amount() {
        let e = import(&["a@x.io,-5"]).unwrap_err();
        assert_eq!(e.to_string(), "ligne 1 : montant invalide");
    }
}
```

::: details Solution
```rust play
use thiserror::Error;

#[derive(Debug, Error, PartialEq)]
pub enum ImportError {
    #[error("ligne {line} : format attendu email,montant")]
    BadFormat { line: usize },
    #[error("ligne {line} : montant invalide")]
    BadAmount { line: usize },
}

pub fn import(lines: &[&str]) -> Result<Vec<(String, u64)>, ImportError> {
    lines
        .iter()
        .enumerate()
        .map(|(i, l)| {
            let line = i + 1;
            let (email, amount) = l
                .split_once(',')
                .ok_or(ImportError::BadFormat { line })?;
            let amount = amount
                .trim()
                .parse::<u64>()
                .map_err(|_| ImportError::BadAmount { line })?;
            Ok((email.trim().to_string(), amount))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok() {
        let r = import(&["a@x.io,100", "b@y.io,250"]).unwrap();
        assert_eq!(r, vec![("a@x.io".into(), 100),
                           ("b@y.io".into(), 250)]);
    }
    #[test]
    fn first_error_wins() {
        let e = import(&["a@x.io,1", "oops", "b,zz"]).unwrap_err();
        assert_eq!(e, ImportError::BadFormat { line: 2 });
        assert_eq!(e.to_string(),
                   "ligne 2 : format attendu email,montant");
    }
    #[test]
    fn bad_amount() {
        let e = import(&["a@x.io,-5"]).unwrap_err();
        assert_eq!(e.to_string(), "ligne 1 : montant invalide");
    }
}
```

L'astuce : `collect()` sait transformer un itérateur de `Result<T, E>` en `Result<Vec<T>, E>`, en s'arrêtant à la première erreur. Le `?` dans la closure renvoie depuis **la closure** (qui renvoie un `Result`), pas depuis `import`.
:::

### 5. Exercice : conversion entre couches avec `From`

Implémente `From<DbError> for ApiError` (une `DbError::UniqueViolation` devient `ApiError::Conflict`, le reste `ApiError::Internal`), puis `status()`. Grâce à `From`, `create_user` peut utiliser `?` directement.

```rust play
#[derive(Debug, PartialEq)]
pub enum DbError { UniqueViolation, Timeout }

#[derive(Debug, PartialEq)]
pub enum ApiError { Conflict, Internal }

impl From<DbError> for ApiError {
    fn from(e: DbError) -> Self { todo!() }
}

impl ApiError {
    pub fn status(&self) -> u16 { todo!() }
}

fn insert(email: &str) -> Result<u64, DbError> {
    match email {
        "taken@x.io" => Err(DbError::UniqueViolation),
        "slow@x.io" => Err(DbError::Timeout),
        _ => Ok(1),
    }
}

pub fn create_user(email: &str) -> Result<u64, ApiError> {
    let id = insert(email)?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mapping() {
        assert_eq!(create_user("new@x.io"), Ok(1));
        let e = create_user("taken@x.io").unwrap_err();
        assert_eq!((e.status(), e), (409, ApiError::Conflict));
        let e = create_user("slow@x.io").unwrap_err();
        assert_eq!(e.status(), 500);
    }
}
```

::: details Solution
```rust play
#[derive(Debug, PartialEq)]
pub enum DbError { UniqueViolation, Timeout }

#[derive(Debug, PartialEq)]
pub enum ApiError { Conflict, Internal }

impl From<DbError> for ApiError {
    fn from(e: DbError) -> Self {
        match e {
            DbError::UniqueViolation => ApiError::Conflict,
            DbError::Timeout => ApiError::Internal,
        }
    }
}

impl ApiError {
    pub fn status(&self) -> u16 {
        match self {
            ApiError::Conflict => 409,
            ApiError::Internal => 500,
        }
    }
}

fn insert(email: &str) -> Result<u64, DbError> {
    match email {
        "taken@x.io" => Err(DbError::UniqueViolation),
        "slow@x.io" => Err(DbError::Timeout),
        _ => Ok(1),
    }
}

pub fn create_user(email: &str) -> Result<u64, ApiError> {
    let id = insert(email)?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mapping() {
        assert_eq!(create_user("new@x.io"), Ok(1));
        let e = create_user("taken@x.io").unwrap_err();
        assert_eq!((e.status(), e), (409, ApiError::Conflict));
        let e = create_user("slow@x.io").unwrap_err();
        assert_eq!(e.status(), 500);
    }
}
```

C'est exactement le pattern d'une vraie API : la contrainte `UNIQUE` de PostgreSQL (code `23505`) devient un `409 Conflict`. En vrai, tu loguerais le `Timeout` avant de le transformer en `Internal`.
:::

## À retenir

- Les erreurs sont des valeurs : `Result<T, E>` dans la signature, impossible à ignorer.
- `?` = early return + conversion via `From` ; `collect()` sait agréger des `Result`.
- `thiserror` pour les erreurs typées des libs et couches métier ; `anyhow` + `.context()` dans les binaires.
- Une erreur par couche, traduite à la frontière ; garde la cause (`#[source]`, `#[from]`).
- `panic!` pour les bugs et invariants ; jamais pour une entrée utilisateur.
- Côté HTTP : mappe chaque variante vers un status, ne fuite jamais le détail technique.
