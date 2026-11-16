# Structs, enums & match

Ce que tu vas apprendre : définir des structs et leurs méthodes, utiliser les enums algébriques (les unions discriminées de TS, en mieux), maîtriser `match`, `if let` et `let else`, et surtout modéliser un domaine de façon à ce que **les états invalides soient impossibles à représenter**.

## Structs

Une struct, c'est un `type`/`interface` TS dont les données sont réellement regroupées en mémoire.

```rust play
#[derive(Debug, Clone, PartialEq)]
struct Customer {
    id: u64,
    email: String,
    vip: bool,
}

fn main() {
    let c = Customer { id: 1, email: "ann@x.io".into(), vip: false };

    // "spread" : comme { ...c, vip: true } en TS
    let c2 = Customer { vip: true, ..c.clone() };

    println!("{c:?}\n{c2:#?}");
    println!("{}", c.email); // accès aux champs
}
```

Les variantes :

```rust
struct Meters(f64);          // tuple struct (utile pour les newtypes)
struct Marker;               // unit struct (aucune donnée)
```

`#[derive(...)]` génère des implémentations de traits : `Debug` (affichage `{:?}`), `Clone`, `PartialEq` (`==`), `Default`, `Hash`… On y revient au [chapitre 3](/dev/rust/03-traits-generics).

::: tip Mutabilité
La mutabilité est portée par la **variable**, pas par le champ : `let mut c = ...` rend tous les champs modifiables. Pas de `readonly` par champ comme en TS ; on encapsule plutôt avec des champs privés + méthodes.
:::

## `impl` : méthodes et constructeurs

```rust play
#[derive(Debug)]
struct Cart {
    items: Vec<(String, u64)>, // (sku, prix en centimes)
}

impl Cart {
    // fonction associée (≈ static) : pas de self
    fn new() -> Self {
        Self { items: Vec::new() }
    }

    // &mut self : la méthode modifie
    fn add(&mut self, sku: &str, price: u64) {
        self.items.push((sku.to_string(), price));
    }

    // &self : lecture seule
    fn total(&self) -> u64 {
        self.items.iter().map(|(_, p)| p).sum()
    }

    // self : consomme la struct
    fn checkout(self) -> Vec<String> {
        self.items.into_iter().map(|(sku, _)| sku).collect()
    }
}

fn main() {
    let mut cart = Cart::new();
    cart.add("TSHIRT", 1999);
    cart.add("MUG", 899);
    println!("total = {}", cart.total());
    let skus = cart.checkout(); // cart n'est plus utilisable
    println!("{skus:?}");
}
```

Le receveur dit tout : `&self` (lecture), `&mut self` (modification), `self` (consommation). C'est l'ownership du chapitre 1 appliqué aux méthodes. Pas de constructeur magique : par convention, `new()` est une fonction associée normale.

## Enums algébriques

En TS, tu écris une union discriminée :

```ts
type Payment =
  | { kind: "card"; last4: string }
  | { kind: "transfer"; iban: string }
  | { kind: "cash" };
```

En Rust, c'est natif, et chaque variante porte ses propres données :

```rust play
#[derive(Debug)]
enum Payment {
    Card { last4: String },
    Transfer { iban: String },
    Cash,
}

fn describe(p: &Payment) -> String {
    match p {
        Payment::Card { last4 } => format!("CB **** {last4}"),
        Payment::Transfer { iban } => format!("virement {iban}"),
        Payment::Cash => "espèces".to_string(),
    }
}

fn main() {
    let ps = [
        Payment::Card { last4: "4242".into() },
        Payment::Transfer { iban: "FR76...".into() },
        Payment::Cash,
    ];
    for p in &ps {
        println!("{}", describe(p));
    }
}
```

Différences clés avec TS :

- Le `match` est **exhaustif** : oublie une variante et ça ne compile pas (en TS, il faut l'astuce `never` pour l'obtenir).
- Pas de champ `kind` à écrire à la main : le discriminant est géré par le compilateur.
- Un enum a des méthodes (`impl Payment { ... }`) comme une struct.

## `Option<T>` : la fin de `null`

Rust n'a pas de `null`. Une valeur absente, c'est `Option<T>` :

```rust
enum Option<T> {
    Some(T),
    None,
}
```

C'est `T | undefined` avec `strictNullChecks`, mais **impossible à ignorer** : tu ne peux pas utiliser un `Option<Customer>` comme un `Customer`.

```rust play
fn find_discount(code: &str) -> Option<u32> {
    match code {
        "WELCOME" => Some(10),
        "VIP" => Some(25),
        _ => None,
    }
}

fn main() {
    // les équivalents de ?. et ?? en TS
    let pct = find_discount("VIP").unwrap_or(0);       // ?? 0
    let label = find_discount("NOPE")
        .map(|p| format!("-{p}%"))                     // ?.
        .unwrap_or_else(|| "aucune remise".into());
    println!("{pct} / {label}");

    if let Some(p) = find_discount("WELCOME") {
        println!("remise {p}%");
    }
}
```

| TS | Rust |
|---|---|
| `x ?? d` | `x.unwrap_or(d)` |
| `x?.foo` | `x.map(\|v\| v.foo)` |
| `x?.foo?.bar` | `x.and_then(\|v\| v.foo)` |
| `x!` | `x.unwrap()` (panic si `None`) |
| `if (x)` | `if let Some(v) = x` |

## `match` en détail

```rust play
fn classify(amount_cents: i64) -> &'static str {
    match amount_cents {
        i64::MIN..0 => "remboursement",
        0 => "gratuit",
        1..=999 => "petit panier",
        n if n % 100 == 0 => "montant rond",   // garde
        _ => "standard",                        // joker
    }
}

fn main() {
    for a in [-500, 0, 450, 5000, 1234] {
        println!("{a} → {}", classify(a));
    }

    let point = (0, 7);
    match point {
        (0, y) => println!("sur l'axe Y à {y}"),
        (x, 0) => println!("sur l'axe X à {x}"),
        _ => println!("ailleurs"),
    }

    // @ : nommer une valeur tout en la testant
    let qty = 42;
    match qty {
        n @ 1..=99 => println!("{n} articles"),
        _ => println!("hors limite"),
    }
}
```

- Les bras sont testés **dans l'ordre**, le premier qui matche gagne.
- `match` est une **expression** : il renvoie une valeur (comme un ternaire géant).
- `_` ignore ; `..` ignore le reste des champs (`Customer { id, .. }`).
- Un `match` sur une référence (`match &payment`) donne des références sur les champs : pas de move.

## `if let`, `let else`, let chains

Quand un seul cas t'intéresse, `match` est verbeux.

```rust play
fn parse_amount(input: &str) -> Option<u64> {
    // let else : "early return" si le pattern ne matche pas.
    // ≈ if (!x) return; en TS, mais avec déstructuration.
    let Some(raw) = input.strip_suffix("€") else {
        return None;
    };
    let Ok(n) = raw.trim().parse::<u64>() else {
        return None;
    };
    Some(n * 100)
}

fn main() {
    println!("{:?}", parse_amount("12 €"));  // Some(1200)
    println!("{:?}", parse_amount("12€"));   // Some(1200)
    println!("{:?}", parse_amount("abc€"));  // None

    let maybe = Some(1500u64);
    // let chains (édition 2024) : plusieurs conditions dans un if let
    if let Some(cents) = maybe
        && cents > 1000
    {
        println!("gros montant : {cents}");
    }
}
```

`let else` est devenu l'idiome standard pour valider en début de fonction : le « happy path » reste à gauche, sans indentation.


## Modéliser un domaine : rendre les états invalides impossibles

Version « TS classique » d'une commande :

```rust
struct Order {
    status: String,                // "pending" | "paid" | ...
    paid_at: Option<u64>,
    tracking_number: Option<String>,
    cancel_reason: Option<String>,
}
```

Problèmes : rien n'empêche `status = "pending"` avec un `tracking_number`, ou `"shipped"` sans. Chaque fonction doit re-vérifier. Avec un enum, **chaque état porte exactement ses données** :

```rust play
#[derive(Debug, Clone, PartialEq)]
enum OrderStatus {
    Pending,
    Paid { payment_id: String },
    Shipped { payment_id: String, tracking: String },
    Cancelled { reason: String },
}

#[derive(Debug)]
struct Order {
    id: u64,
    status: OrderStatus,
}

impl Order {
    fn ship(&mut self, tracking: &str) -> Result<(), String> {
        // on doit être Paid pour expédier : le match l'impose
        let OrderStatus::Paid { payment_id } = &self.status else {
            return Err(format!("commande {} non payée", self.id));
        };
        self.status = OrderStatus::Shipped {
            payment_id: payment_id.clone(),
            tracking: tracking.to_string(),
        };
        Ok(())
    }
}

fn main() {
    let mut o = Order { id: 7, status: OrderStatus::Pending };
    println!("{:?}", o.ship("COLIS-1")); // Err
    o.status = OrderStatus::Paid { payment_id: "pi_123".into() };
    println!("{:?}", o.ship("COLIS-1")); // Ok
    println!("{o:?}");
}
```

Un `tracking` sans paiement est maintenant **irreprésentable**. Plus besoin de `if (order.trackingNumber && order.status === "shipped")`.

### Aller plus loin : le typestate

On peut encoder l'état dans le **type** lui-même, pour que la transition invalide ne compile même pas :

```rust play
struct Pending;
struct Paid { payment_id: String }

struct Order<S> { id: u64, state: S }

impl Order<Pending> {
    fn pay(self, payment_id: &str) -> Order<Paid> {
        Order { id: self.id,
                state: Paid { payment_id: payment_id.into() } }
    }
}

impl Order<Paid> {
    fn receipt(&self) -> String {
        format!("#{} payée via {}", self.id, self.state.payment_id)
    }
}

fn main() {
    let o = Order { id: 1, state: Pending };
    // o.receipt(); // ne compile pas : pas de receipt() sur Pending
    let paid = o.pay("pi_42");
    println!("{}", paid.receipt());
}
```

Utile pour les builders et les protocoles (connexion non authentifiée → authentifiée). Pour des états stockés en base et chargés dynamiquement, l'enum reste plus pratique.

## Newtype : des types qui ont du sens

En TS, `type UserId = string` est un simple alias : rien n'empêche de passer un `OrderId` à la place. En Rust, une tuple struct d'un champ crée un **vrai type distinct**, sans coût à l'exécution :

```rust play
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct UserId(u64);
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct OrderId(u64);

#[derive(Debug)]
struct Email(String);

impl Email {
    // "parse, don't validate" : un Email existant est forcément valide
    fn parse(raw: &str) -> Result<Email, String> {
        let raw = raw.trim().to_lowercase();
        match raw.split_once('@') {
            Some((u, d)) if !u.is_empty() && d.contains('.') => {
                Ok(Email(raw))
            }
            _ => Err(format!("email invalide : {raw}")),
        }
    }
    fn as_str(&self) -> &str {
        &self.0
    }
}

fn cancel(order: OrderId, by: UserId) {
    println!("{order:?} annulée par {by:?}");
}

fn main() {
    let u = UserId(1);
    let o = OrderId(99);
    cancel(o, u);
    // cancel(u, o); // ne compile pas : types inversés détectés
    println!("{:?}", Email::parse(" Ann@X.io "));
    println!("{:?}", Email::parse("pas-un-email").map(|e| e.0));
    let e = Email::parse("bob@y.fr").unwrap();
    println!("{}", e.as_str());
}
```

Le champ `.0` est privé hors du module si tu ne mets pas `pub` : personne ne peut construire un `Email` sans passer par `parse`. C'est la base du « parse, don't validate ».

## Cas réel : un webhook de paiement

Un fournisseur de paiement (type Stripe) t'envoie des événements. Tu les convertis tout de suite en un enum, et le reste du code ne manipule plus jamais de JSON brut :

```rust play
#[derive(Debug)]
enum PaymentEvent {
    Succeeded { order_id: u64, amount_cents: u64 },
    Failed { order_id: u64, code: String },
    Refunded { order_id: u64, amount_cents: u64 },
}

fn handle(ev: &PaymentEvent) -> String {
    match ev {
        PaymentEvent::Succeeded { order_id, amount_cents }
            if *amount_cents >= 100_000 =>
        {
            format!("#{order_id} payée, gros montant : revue manuelle")
        }
        PaymentEvent::Succeeded { order_id, .. } => {
            format!("#{order_id} payée → préparer l'expédition")
        }
        PaymentEvent::Failed { order_id, code } => {
            format!("#{order_id} échec {code} → email au client")
        }
        PaymentEvent::Refunded { order_id, amount_cents } => {
            format!("#{order_id} remboursée de {amount_cents}")
        }
    }
}

fn main() {
    let events = [
        PaymentEvent::Succeeded { order_id: 1, amount_cents: 4999 },
        PaymentEvent::Succeeded { order_id: 2, amount_cents: 250_000 },
        PaymentEvent::Failed { order_id: 3, code: "card_declined".into() },
        PaymentEvent::Refunded { order_id: 1, amount_cents: 4999 },
    ];
    for e in &events {
        println!("{}", handle(e));
    }
}
```

Le jour où le fournisseur ajoute `Disputed`, tu ajoutes la variante et le compilateur te liste **tous** les `match` à mettre à jour. En TS, tu le découvres en prod.

## Pièges classiques

- **`_ =>` partout** : tu perds l'exhaustivité. Préfère lister les variantes, pour que l'ajout d'une variante casse la compilation là où il faut.
- **Des `Option` en vrac dans une struct** pour représenter des états : remplace par un enum.
- **`unwrap()` sur un `Option` venant de l'utilisateur** : panic garanti un jour. `let else`, `?` ou `unwrap_or`.
- **`match` sur une valeur possédée** qui déplace les champs : matche sur `&valeur` si tu veux la réutiliser.
- **Alias au lieu de newtype** (`type UserId = u64;`) : en Rust aussi, un alias ne protège de rien.
- **Question d'entretien** : « Quelle est la taille d'un `Option<&T>` ? » → la même qu'un `&T` : le compilateur utilise le pointeur nul pour `None` (*niche optimization*).

## Défis

### 1. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
enum Plan { Free, Pro, Enterprise }

fn monthly_price(p: Plan) -> u32 {
    match p {
        Plan::Free => 0,
        Plan::Pro => 29,
    }
}

fn main() {
    println!("{}", monthly_price(Plan::Enterprise));
}
```

::: details Solution
E0004 : `match` non exhaustif, `Plan::Enterprise` n'est pas couvert. Ajoute le bras manquant (`Plan::Enterprise => 499`). C'est exactement le comportement qu'on veut quand un nouveau plan est ajouté au produit.
:::

### 2. Que affiche ce code ?

```rust play
fn main() {
    let codes = [Some(3), None, Some(12), Some(0)];
    for c in codes {
        let msg = match c {
            Some(0) => "zéro",
            Some(n) if n > 10 => "grand",
            Some(_) => "petit",
            None => "rien",
        };
        print!("{msg} ");
    }
}
```

::: details Solution
`petit rien grand zéro`. Les bras sont testés dans l'ordre : `Some(0)` doit être avant `Some(_)`, sinon il ne serait jamais atteint (le compilateur avertit d'un bras inaccessible).
:::

### 3. Exercice : machine à états d'une commande

Implémente `transition` : elle consomme l'état courant et un événement, et renvoie le nouvel état ou une erreur. Règles :
- `Pending` + `Pay(id)` → `Paid`
- `Paid` + `Ship(tracking)` → `Shipped`
- `Pending` ou `Paid` + `Cancel` → `Cancelled`
- tout le reste → `Err("transition invalide")`

```rust play
#[derive(Debug, PartialEq)]
pub enum State {
    Pending,
    Paid { payment_id: String },
    Shipped { payment_id: String, tracking: String },
    Cancelled,
}

pub enum Event {
    Pay(String),
    Ship(String),
    Cancel,
}

pub fn transition(s: State, e: Event) -> Result<State, String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn happy_path() {
        let s = transition(State::Pending, Event::Pay("pi_1".into()));
        let s = transition(s.unwrap(), Event::Ship("T1".into()));
        assert_eq!(s, Ok(State::Shipped {
            payment_id: "pi_1".into(),
            tracking: "T1".into(),
        }));
    }
    #[test]
    fn cancel_paid() {
        let paid = State::Paid { payment_id: "pi_1".into() };
        assert_eq!(transition(paid, Event::Cancel),
                   Ok(State::Cancelled));
    }
    #[test]
    fn invalid() {
        assert!(transition(State::Pending,
                           Event::Ship("T".into())).is_err());
        assert!(transition(State::Cancelled, Event::Cancel).is_err());
    }
}
```

::: details Solution
```rust play
#[derive(Debug, PartialEq)]
pub enum State {
    Pending,
    Paid { payment_id: String },
    Shipped { payment_id: String, tracking: String },
    Cancelled,
}

pub enum Event {
    Pay(String),
    Ship(String),
    Cancel,
}

pub fn transition(s: State, e: Event) -> Result<State, String> {
    match (s, e) {
        (State::Pending, Event::Pay(payment_id)) => {
            Ok(State::Paid { payment_id })
        }
        (State::Paid { payment_id }, Event::Ship(tracking)) => {
            Ok(State::Shipped { payment_id, tracking })
        }
        (State::Pending | State::Paid { .. }, Event::Cancel) => {
            Ok(State::Cancelled)
        }
        _ => Err("transition invalide".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn happy_path() {
        let s = transition(State::Pending, Event::Pay("pi_1".into()));
        let s = transition(s.unwrap(), Event::Ship("T1".into()));
        assert_eq!(s, Ok(State::Shipped {
            payment_id: "pi_1".into(),
            tracking: "T1".into(),
        }));
    }
    #[test]
    fn cancel_paid() {
        let paid = State::Paid { payment_id: "pi_1".into() };
        assert_eq!(transition(paid, Event::Cancel),
                   Ok(State::Cancelled));
    }
    #[test]
    fn invalid() {
        assert!(transition(State::Pending,
                           Event::Ship("T".into())).is_err());
        assert!(transition(State::Cancelled, Event::Cancel).is_err());
    }
}
```

Matcher sur le **tuple** `(état, événement)` donne une table de transitions lisible. Comme on consomme `s` et `e`, on **déplace** `payment_id` et `tracking` dans le nouvel état : zéro clone. Le `|` combine plusieurs patterns dans un bras.
:::

### 4. Exercice : parser une commande de back-office

Un outil interne reçoit des lignes texte. Parse-les en `Command` (utilise `let else` / `split_whitespace`) :
- `"refund <order_id> <cents>"` → `Refund`
- `"ban <email>"` → `Ban`
- tout le reste (y compris nombres invalides ou arguments en trop) → `None`

```rust play
#[derive(Debug, PartialEq)]
pub enum Command {
    Refund { order_id: u64, cents: u64 },
    Ban { email: String },
}

pub fn parse(line: &str) -> Option<Command> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok() {
        assert_eq!(parse("refund 42 1500"),
            Some(Command::Refund { order_id: 42, cents: 1500 }));
        assert_eq!(parse("  ban  bob@x.io "),
            Some(Command::Ban { email: "bob@x.io".into() }));
    }
    #[test]
    fn ko() {
        assert_eq!(parse("refund 42"), None);
        assert_eq!(parse("refund abc 10"), None);
        assert_eq!(parse("ban a b"), None);
        assert_eq!(parse(""), None);
    }
}
```

::: details Solution
```rust play
#[derive(Debug, PartialEq)]
pub enum Command {
    Refund { order_id: u64, cents: u64 },
    Ban { email: String },
}

pub fn parse(line: &str) -> Option<Command> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    match parts.as_slice() {
        ["refund", id, cents] => {
            let Ok(order_id) = id.parse() else { return None };
            let Ok(cents) = cents.parse() else { return None };
            Some(Command::Refund { order_id, cents })
        }
        ["ban", email] => Some(Command::Ban {
            email: email.to_string(),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok() {
        assert_eq!(parse("refund 42 1500"),
            Some(Command::Refund { order_id: 42, cents: 1500 }));
        assert_eq!(parse("  ban  bob@x.io "),
            Some(Command::Ban { email: "bob@x.io".into() }));
    }
    #[test]
    fn ko() {
        assert_eq!(parse("refund 42"), None);
        assert_eq!(parse("refund abc 10"), None);
        assert_eq!(parse("ban a b"), None);
        assert_eq!(parse(""), None);
    }
}
```

Les **slice patterns** (`["refund", id, cents]`) vérifient à la fois la longueur et le premier mot. `parse()` infère le type cible (`u64`) depuis le champ de la struct. Variante plus courte : `id.parse().ok()?` (le `?` marche aussi sur `Option`).
:::

### 5. Mini-scénario : revue de code

Un collègue modélise un abonnement SaaS ainsi :

```rust
struct Subscription {
    is_trial: bool,
    trial_ends_at: Option<u64>,
    is_cancelled: bool,
    cancelled_at: Option<u64>,
    stripe_sub_id: Option<String>,
}
```

Combien d'états possibles ? Propose un meilleur modèle.

::: details Solution
2 × 2 × 2 × 2 × 2 = 32 combinaisons « shape-wise », dont la plupart absurdes (trial annulé sans date, actif sans `stripe_sub_id`…). Modèle :

```rust
enum Subscription {
    Trial { ends_at: u64 },
    Active { stripe_sub_id: String },
    Cancelled { stripe_sub_id: String, at: u64 },
}
```

3 états, chacun avec exactement ses données. En base, tu peux garder des colonnes nullables : la conversion ligne SQL → enum se fait **une fois**, à la frontière (repository), avec une erreur si la ligne est incohérente.
:::

## À retenir

- `&self` / `&mut self` / `self` : l'ownership appliqué aux méthodes.
- Les enums portent des données par variante : c'est l'union discriminée de TS, exhaustive par défaut.
- `Option<T>` remplace `null` ; `unwrap_or`, `map`, `and_then`, `if let`, `let else`.
- `match` est une expression exhaustive : patterns, gardes `if`, `@`, `|`, slice patterns.
- Modélise les états avec des enums : un état invalide doit être **irreprésentable**.
- Newtype (`struct UserId(u64)`) + constructeur `parse` : des types qui garantissent leurs invariants.
