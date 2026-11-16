# Traits & generics

Ce que tu vas apprendre : écrire et implémenter des traits (les « interfaces » de Rust), écrire du code générique avec des bounds, choisir entre generics et `dyn Trait`, et connaître les traits de la std que tout code Rust idiomatique implémente.

## Un trait, c'est un contrat de comportement

En TS :

```ts
interface Notifier {
  send(to: string, msg: string): void;
  name(): string;
}
class EmailNotifier implements Notifier { /* ... */ }
```

En Rust, on sépare la **donnée** (struct) du **comportement** (trait), et on relie les deux avec `impl Trait for Type` :

```rust play
trait Notifier {
    fn send(&self, to: &str, msg: &str) -> String;

    // méthode par défaut : les implémenteurs peuvent la garder
    fn name(&self) -> &'static str {
        "inconnu"
    }
}

struct Email { from: String }
struct Sms;

impl Notifier for Email {
    fn send(&self, to: &str, msg: &str) -> String {
        format!("[mail {} → {to}] {msg}", self.from)
    }
    fn name(&self) -> &'static str { "email" }
}

impl Notifier for Sms {
    fn send(&self, to: &str, msg: &str) -> String {
        format!("[sms → {to}] {msg}")
    }
}

fn main() {
    let e = Email { from: "noreply@shop.io".into() };
    println!("{} ({})", e.send("ann@x.io", "Commande expédiée"),
             e.name());
    println!("{} ({})", Sms.send("+336...", "Code: 1234"), Sms.name());
}
```

Différence majeure avec TS : le typage TS est **structurel** (un objet qui a les bonnes méthodes est un `Notifier`), Rust est **nominal** : il faut un `impl Notifier for X` explicite. En échange, tu peux implémenter **ton** trait sur des types existants, même `String` ou `Vec<T>`.

## Generics et bounds

Une fonction générique avec un *bound* (contrainte) :

```rust play
use std::fmt::Display;

// T: Display  ≈  <T extends Displayable> en TS
fn log_all<T: Display>(items: &[T]) {
    for (i, it) in items.iter().enumerate() {
        println!("{i}: {it}");
    }
}

// plusieurs bounds : clause where, plus lisible
fn max_of<T>(items: &[T]) -> Option<&T>
where
    T: PartialOrd,
{
    let mut best = items.first()?;
    for it in items {
        if it > best {
            best = it;
        }
    }
    Some(best)
}

fn main() {
    log_all(&["a", "b"]);
    log_all(&[3.5, 1.0]);
    println!("{:?}", max_of(&[3, 9, 2]));
    println!("{:?}", max_of::<i32>(&[]));
}
```

::: info Ce qui se passe à la compilation : la monomorphisation
`log_all::<&str>` et `log_all::<f64>` deviennent **deux fonctions distinctes** dans le binaire, chacune optimisée pour son type. Zéro coût à l'exécution (pas de lookup), mais un binaire plus gros et une compilation plus lente. En TS, les generics sont effacés à la compilation : il n'existe qu'une seule fonction JS.
:::

### `impl Trait` : la syntaxe courte

```rust
// en argument : sucre pour un generic anonyme
fn notify(n: &impl Notifier, to: &str) { /* ... */ }
// équivaut à
fn notify<N: Notifier>(n: &N, to: &str) { /* ... */ }

// en retour : « je renvoie UN type concret qui implémente Iterator,
// mais je ne te dis pas lequel »
fn even_ids(ids: &[u64]) -> impl Iterator<Item = &u64> {
    ids.iter().filter(|id| *id % 2 == 0)
}
```

`impl Trait` en retour est indispensable pour renvoyer des itérateurs ou des closures, dont le type exact est innommable.

::: warning Un seul type concret
`-> impl Trait` doit renvoyer **le même type** dans toutes les branches. Pour renvoyer tantôt un `Email`, tantôt un `Sms`, il faut `Box<dyn Notifier>` (voir plus bas).
:::

## Trait objects : `dyn Trait`

Quand tu veux une collection **hétérogène** (des `Email` et des `Sms` dans le même `Vec`), il faut du dispatch dynamique :

```rust play
trait Notifier {
    fn send(&self, to: &str) -> String;
}
struct Email;
struct Slack { channel: String }

impl Notifier for Email {
    fn send(&self, to: &str) -> String { format!("mail → {to}") }
}
impl Notifier for Slack {
    fn send(&self, to: &str) -> String {
        format!("slack #{} → @{to}", self.channel)
    }
}

fn main() {
    // Box<dyn Notifier> : pointeur vers "n'importe quoi qui
    // implémente Notifier" + sa vtable
    let channels: Vec<Box<dyn Notifier>> = vec![
        Box::new(Email),
        Box::new(Slack { channel: "ops".into() }),
    ];
    for c in &channels {
        println!("{}", c.send("ann"));
    }
}
```

Un `&dyn Trait` / `Box<dyn Trait>` est un *fat pointer* : pointeur vers la donnée + pointeur vers une **vtable** (table des méthodes). L'appel passe par cette table : c'est ce que fait JS pour *chaque* appel de méthode.

### Static vs dynamic dispatch

| | Generics / `impl Trait` | `dyn Trait` |
|---|---|---|
| Résolution | compilation | exécution (vtable) |
| Perf | inlining possible | indirection, pas d'inlining |
| Collection hétérogène | non | oui |
| Taille binaire | grossit (1 copie/type) | une seule copie |

Règle pratique : **generics par défaut** ; `dyn` quand tu as besoin d'hétérogénéité (plugins, liste de handlers, stratégie choisie à l'exécution) ou pour réduire les temps de compilation. Le coût d'une vtable est négligeable devant un appel réseau.

### Compatibilité `dyn`

Tous les traits ne peuvent pas devenir `dyn` (la doc dit *dyn compatible*, anciennement *object safe*). Interdits notamment : une méthode générique (`fn f<T>(&self, t: T)`), une méthode qui renvoie `Self`, ou un bound `Self: Sized` sur le trait. Logique : la vtable doit avoir un nombre fini d'entrées de type connu.

## Associated types

Un trait peut déclarer un **type associé**, choisi par chaque implémentation. L'exemple roi : `Iterator`.

```rust
trait Iterator {
    type Item;                       // type associé
    fn next(&mut self) -> Option<Self::Item>;
    // + ~70 méthodes par défaut : map, filter, sum...
}
```

Pourquoi pas `trait Iterator<T>` ? Avec un paramètre générique, un type pourrait implémenter `Iterator<u32>` **et** `Iterator<String>` : il faudrait l'annoter partout. Avec un type associé, il y a **une seule** implémentation par type, et `Item` est déduit.

```rust play
// Implémenter Iterator : seul next() est obligatoire,
// on récupère map/filter/sum/collect gratuitement.
struct Retry {
    attempt: u32,
    max: u32,
    base_ms: u64,
}

impl Iterator for Retry {
    type Item = u64; // délai avant la prochaine tentative

    fn next(&mut self) -> Option<u64> {
        if self.attempt >= self.max {
            return None;
        }
        let delay = self.base_ms * 2u64.pow(self.attempt);
        self.attempt += 1;
        Some(delay)
    }
}

fn main() {
    let backoff = Retry { attempt: 0, max: 5, base_ms: 100 };
    let delays: Vec<u64> = backoff.collect();
    println!("{delays:?}"); // [100, 200, 400, 800, 1600]
    let total: u64 = Retry { attempt: 0, max: 5, base_ms: 100 }.sum();
    println!("attente max : {total} ms");
}
```

## Les traits de la std à connaître

| Trait | Sert à | Dérivable ? |
|---|---|---|
| `Debug` | `{:?}`, logs de debug | oui |
| `Display` | `{}`, affichage utilisateur | non |
| `Clone` / `Copy` | duplication | oui |
| `PartialEq` / `Eq` | `==` | oui |
| `PartialOrd` / `Ord` | `<`, tri | oui |
| `Hash` | clé de `HashMap` | oui |
| `Default` | valeur par défaut | oui |
| `From` / `Into` | conversions | non |
| `AsRef` | emprunt « souple » | non |
| `Iterator` | itération | non |

### `Display` et `Debug`

```rust play
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq)]
struct Money {
    cents: i64,
}

impl fmt::Display for Money {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let sign = if self.cents < 0 { "-" } else { "" };
        let abs = self.cents.abs();
        write!(f, "{sign}{}.{:02} €", abs / 100, abs % 100)
    }
}

fn main() {
    let m = Money { cents: 123_456 };
    println!("{m}");    // 1234.56 €   (Display : pour l'humain)
    println!("{m:?}");  // Money { cents: 123456 } (Debug : pour toi)
    let s: String = m.to_string(); // gratuit grâce à Display
    println!("{s}");
}
```

`Display` donne automatiquement `.to_string()` (via le trait `ToString`). C'est l'équivalent d'un `toString()` en TS, mais typé.

### `From` / `Into` : conversions

```rust play
#[derive(Debug)]
struct UserId(u64);

impl From<u64> for UserId {
    fn from(v: u64) -> Self {
        UserId(v)
    }
}

// Implémenter From donne Into gratuitement
fn load(id: impl Into<UserId>) -> UserId {
    id.into()
}

fn main() {
    let a = UserId::from(7);
    let b: UserId = 8.into();
    let c = load(9u64);
    println!("{a:?} {b:?} {c:?}");

    // la std en est pleine :
    let s: String = "abc".into();       // From<&str> for String
    let big: i64 = i64::from(42i32);    // conversion sans perte
    println!("{s} {big}");
}
```

Règle : **implémente `From`**, jamais `Into` directement. `From` sert aussi à l'opérateur `?` pour convertir les erreurs ([chapitre 5](/dev/rust/05-gestion-erreurs)). Pour une conversion qui peut échouer : `TryFrom` / `TryInto`.

### `Default`

```rust play
#[derive(Debug, Default)]
struct RetryConfig {
    max_attempts: u32,   // 0
    base_ms: u64,        // 0
    jitter: bool,        // false
    name: String,        // ""
}

#[derive(Debug)]
struct HttpConfig { timeout_ms: u64, retries: u32 }

impl Default for HttpConfig {
    fn default() -> Self {
        Self { timeout_ms: 5_000, retries: 3 }
    }
}

fn main() {
    let r = RetryConfig { max_attempts: 5, ..Default::default() };
    println!("{r:?}");
    println!("{:?}", HttpConfig::default());
}
```

### `AsRef` : accepter plusieurs formes

```rust play
use std::path::Path;

// accepte &str, String, &Path, PathBuf...
fn file_name<P: AsRef<Path>>(p: P) -> String {
    p.as_ref()
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn main() {
    println!("{}", file_name("exports/orders.csv"));
    println!("{}", file_name(String::from("/tmp/a.json")));
}
```

## Orphan rule

Tu peux écrire `impl Trait for Type` seulement si **le trait ou le type est défini dans ta crate**.

- `impl Display for Money` : OK (`Money` est à toi).
- `impl MyTrait for Vec<u8>` : OK (`MyTrait` est à toi).
- `impl Display for Vec<u8>` : **interdit** (ni l'un ni l'autre n'est à toi).

Pourquoi : si deux crates pouvaient implémenter `Display for Vec<u8>` différemment, laquelle choisir ? La solution de contournement est… le **newtype** du chapitre 2 :

```rust
struct Csv(Vec<String>);
impl std::fmt::Display for Csv { /* ... */ } // OK : Csv est à toi
```

## Cas réel : abstraire un fournisseur de paiement

Dans une API de paiement, tu veux pouvoir tester la logique métier sans appeler Stripe. Le trait est le **port**, les implémentations sont les **adapters** :

```rust play
#[derive(Debug, PartialEq)]
enum ChargeError {
    Declined,
    Network,
}

trait PaymentGateway {
    fn charge(&self, customer: &str, cents: u64)
        -> Result<String, ChargeError>;
}

// En prod : appelle l'API HTTP (simplifié ici)
struct Stripe { api_key: String }
impl PaymentGateway for Stripe {
    fn charge(&self, customer: &str, cents: u64)
        -> Result<String, ChargeError> {
        let _ = (&self.api_key, customer, cents);
        Ok("ch_live_123".into())
    }
}

// En test : comportement scripté
struct FakeGateway { decline_above: u64 }
impl PaymentGateway for FakeGateway {
    fn charge(&self, _c: &str, cents: u64)
        -> Result<String, ChargeError> {
        if cents > self.decline_above {
            Err(ChargeError::Declined)
        } else {
            Ok(format!("ch_fake_{cents}"))
        }
    }
}

// Logique métier générique : static dispatch, testable
fn checkout<G: PaymentGateway>(g: &G, cart_cents: u64)
    -> Result<String, ChargeError> {
    let fees = cart_cents / 100; // 1 % de frais
    g.charge("cus_1", cart_cents + fees)
}

fn main() {
    let prod = Stripe { api_key: "sk_live".into() };
    println!("{:?}", checkout(&prod, 5000));
    let fake = FakeGateway { decline_above: 10_000 };
    println!("{:?}", checkout(&fake, 5000));
    println!("{:?}", checkout(&fake, 50_000));
}
```

Si la passerelle est choisie **à l'exécution** (par tenant, par pays), on stockera plutôt un `Box<dyn PaymentGateway>` (ou `Arc<dyn PaymentGateway>` dans un état partagé, cf. [chapitre 10](/dev/rust/10-api-axum-sqlx)).

::: info Et les méthodes `async` dans un trait ?
Depuis Rust 1.75, `async fn` dans un trait est stable. Limite : un tel trait n'est pas utilisable en `dyn` tel quel. Pour du `dyn` async, la crate `async-trait` (qui boxe les futures) reste courante. Voir [Async & Tokio](/dev/rust/09-async-tokio).
:::

## Pièges classiques

- **Penser en héritage.** Pas d'héritage de structs en Rust. On compose (une struct contient une autre) et on partage le comportement par traits. Un trait peut exiger un autre (`trait Admin: User`), c'est un *supertrait*, pas de l'héritage de données.
- **`Box<dyn Trait>` partout** par réflexe Java/TS : generics d'abord.
- **Oublier un bound** : `T` sans `PartialOrd` ne supporte pas `>`. Le compilateur te le dit (E0369).
- **Implémenter `Into` au lieu de `From`.**
- **Confondre `Display` et `Debug`** : `Debug` pour les logs dev, `Display` pour ce que voit l'utilisateur (messages d'erreur inclus).
- **Question d'entretien** : « différence entre `impl Trait` et `dyn Trait` ? » → type concret unique résolu à la compilation vs type effacé derrière une vtable.

## Défis

### 1. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
fn largest<T>(items: &[T]) -> &T {
    let mut best = &items[0];
    for it in items {
        if it > best {
            best = it;
        }
    }
    best
}

fn main() {
    println!("{}", largest(&[1, 5, 3]));
}
```

::: details Solution
E0369 : `>` n'est pas défini pour un `T` quelconque. Il faut un bound : `fn largest<T: PartialOrd>(items: &[T]) -> &T`. Les generics Rust sont vérifiés **à la définition** : tu ne peux utiliser que ce que les bounds promettent (contrairement aux templates C++).
:::

### 2. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
trait Notifier { fn send(&self) -> String; }
struct Email;
struct Sms;
impl Notifier for Email { fn send(&self) -> String { "mail".into() } }
impl Notifier for Sms { fn send(&self) -> String { "sms".into() } }

fn pick(urgent: bool) -> impl Notifier {
    if urgent { Sms } else { Email }
}

fn main() {
    println!("{}", pick(true).send());
}
```

::: details Solution
E0308 : `impl Notifier` en retour désigne **un seul** type concret, or les deux branches renvoient `Sms` et `Email`. Solution : `fn pick(urgent: bool) -> Box<dyn Notifier>` et `if urgent { Box::new(Sms) } else { Box::new(Email) }`.
:::

### 3. Exercice : `Display` pour un montant multi-devises

Implémente `Display` pour `Price` : `cents` en unité + 2 décimales, suivi de la devise. Négatifs avec un `-` devant.

```rust play
use std::fmt;

pub struct Price {
    pub cents: i64,
    pub currency: &'static str,
}

impl fmt::Display for Price {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        todo!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats() {
        let p = |c, cur| Price { cents: c, currency: cur }.to_string();
        assert_eq!(p(1250, "EUR"), "12.50 EUR");
        assert_eq!(p(5, "USD"), "0.05 USD");
        assert_eq!(p(-199, "EUR"), "-1.99 EUR");
        assert_eq!(p(0, "JPY"), "0.00 JPY");
    }
}
```

::: details Solution
```rust play
use std::fmt;

pub struct Price {
    pub cents: i64,
    pub currency: &'static str,
}

impl fmt::Display for Price {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let sign = if self.cents < 0 { "-" } else { "" };
        let abs = self.cents.unsigned_abs();
        write!(f, "{sign}{}.{:02} {}", abs / 100, abs % 100,
               self.currency)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats() {
        let p = |c, cur| Price { cents: c, currency: cur }.to_string();
        assert_eq!(p(1250, "EUR"), "12.50 EUR");
        assert_eq!(p(5, "USD"), "0.05 USD");
        assert_eq!(p(-199, "EUR"), "-1.99 EUR");
        assert_eq!(p(0, "JPY"), "0.00 JPY");
    }
}
```

`{:02}` complète avec des zéros. `unsigned_abs()` évite le débordement de `abs()` sur `i64::MIN`. (Le yen n'a pas de centimes en vrai : un vrai système stocke l'exposant par devise.)
:::

### 4. Exercice : un itérateur de pagination

Une API renvoie `total` éléments, par pages de `per_page`. Implémente `Iterator` pour `Pages` : chaque élément est `(offset, limit)`, la dernière page pouvant être plus petite.

```rust play
pub struct Pages {
    pub total: u64,
    pub per_page: u64,
    pub offset: u64,
}

impl Iterator for Pages {
    type Item = (u64, u64);

    fn next(&mut self) -> Option<Self::Item> {
        todo!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages() {
        let p = Pages { total: 25, per_page: 10, offset: 0 };
        assert_eq!(p.collect::<Vec<_>>(),
                   vec![(0, 10), (10, 10), (20, 5)]);
    }
    #[test]
    fn empty() {
        let p = Pages { total: 0, per_page: 10, offset: 0 };
        assert_eq!(p.count(), 0);
    }
    #[test]
    fn adapters_for_free() {
        let p = Pages { total: 95, per_page: 10, offset: 0 };
        let sum: u64 = p.map(|(_, l)| l).sum();
        assert_eq!(sum, 95);
    }
}
```

::: details Solution
```rust play
pub struct Pages {
    pub total: u64,
    pub per_page: u64,
    pub offset: u64,
}

impl Iterator for Pages {
    type Item = (u64, u64);

    fn next(&mut self) -> Option<Self::Item> {
        if self.offset >= self.total || self.per_page == 0 {
            return None;
        }
        let limit = self.per_page.min(self.total - self.offset);
        let page = (self.offset, limit);
        self.offset += limit;
        Some(page)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages() {
        let p = Pages { total: 25, per_page: 10, offset: 0 };
        assert_eq!(p.collect::<Vec<_>>(),
                   vec![(0, 10), (10, 10), (20, 5)]);
    }
    #[test]
    fn empty() {
        let p = Pages { total: 0, per_page: 10, offset: 0 };
        assert_eq!(p.count(), 0);
    }
    #[test]
    fn adapters_for_free() {
        let p = Pages { total: 95, per_page: 10, offset: 0 };
        let sum: u64 = p.map(|(_, l)| l).sum();
        assert_eq!(sum, 95);
    }
}
```

Une seule méthode écrite, et `collect`, `count`, `map`, `sum` viennent gratuitement. Le garde `per_page == 0` évite une boucle infinie.
:::

### 5. Exercice : règles de prix dynamiques

Un back-office configure une liste de règles de prix, appliquées dans l'ordre. Implémente le trait pour `PercentOff` et `MinPrice`, puis `apply_all`.

```rust play
pub trait PricingRule {
    fn apply(&self, cents: u64) -> u64;
}

pub struct PercentOff(pub u64); // remise en %
pub struct MinPrice(pub u64);   // prix plancher

impl PricingRule for PercentOff {
    fn apply(&self, cents: u64) -> u64 { todo!() }
}
impl PricingRule for MinPrice {
    fn apply(&self, cents: u64) -> u64 { todo!() }
}

pub fn apply_all(rules: &[Box<dyn PricingRule>], cents: u64) -> u64 {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chain() {
        let rules: Vec<Box<dyn PricingRule>> =
            vec![Box::new(PercentOff(50)), Box::new(MinPrice(800))];
        assert_eq!(apply_all(&rules, 1000), 800);
        assert_eq!(apply_all(&rules, 3000), 1500);
        assert_eq!(apply_all(&[], 1234), 1234);
    }
}
```

::: details Solution
```rust play
pub trait PricingRule {
    fn apply(&self, cents: u64) -> u64;
}

pub struct PercentOff(pub u64);
pub struct MinPrice(pub u64);

impl PricingRule for PercentOff {
    fn apply(&self, cents: u64) -> u64 {
        cents * (100 - self.0.min(100)) / 100
    }
}
impl PricingRule for MinPrice {
    fn apply(&self, cents: u64) -> u64 {
        cents.max(self.0)
    }
}

pub fn apply_all(rules: &[Box<dyn PricingRule>], cents: u64) -> u64 {
    rules.iter().fold(cents, |acc, r| r.apply(acc))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chain() {
        let rules: Vec<Box<dyn PricingRule>> =
            vec![Box::new(PercentOff(50)), Box::new(MinPrice(800))];
        assert_eq!(apply_all(&rules, 1000), 800);
        assert_eq!(apply_all(&rules, 3000), 1500);
        assert_eq!(apply_all(&[], 1234), 1234);
    }
}
```

Ici `dyn` est le bon choix : la liste est hétérogène et construite à l'exécution (depuis la config). `fold` enchaîne les règles : c'est un `reduce` avec valeur initiale.
:::

## À retenir

- Trait = contrat de comportement, implémenté explicitement (`impl Trait for Type`), typage nominal.
- Generics + bounds = static dispatch (monomorphisation, zéro coût) ; `dyn Trait` = vtable, pour l'hétérogène.
- `impl Trait` en argument = generic anonyme ; en retour = un type concret caché (itérateurs, closures).
- Types associés (`type Item`) quand il n'y a qu'une implémentation sensée par type.
- Implémente `Display`, `From`, `Default` sur tes types ; dérive `Debug`, `Clone`, `PartialEq`.
- Orphan rule : le trait ou le type doit être à toi ; sinon, newtype.
