# Défis Rust

Ce que tu vas apprendre : 9 exercices Rust « de vraie app » (parsing, état, erreurs, conversions, structures) du niveau qu'on te demande en live coding ou en take-home mid.

## Comment les faire

Chaque défi est un programme complet : squelette avec des `todo!()` **et** des tests. Clique sur « Ouvrir dans Rust Playground », puis choisis **Test** (menu à côté de *Run*). Tous les tests doivent passer.

- Ne modifie pas les tests (sauf pour en ajouter).
- Commence par faire **compiler** sans `todo!()` dans la fonction visée, puis fais passer les tests un par un.
- Une fois vert : `cargo clippy` mentalement. Y a-t-il un `.clone()` inutile ? un `unwrap()` qui peut paniquer ?

::: tip En local
`cargo new --lib defis && cd defis`, colle le code dans `src/lib.rs`, puis `cargo test`. `cargo watch -x test` (ou `bacon`) relance les tests à chaque sauvegarde.
:::

Seule la bibliothèque standard est utilisée : en entretien, on attend souvent que tu saches faire sans `thiserror` ni `regex`, puis que tu dises ce que tu utiliserais en prod.

## 1. Parser de logs

**Contexte** : une CLI interne qui lit les logs d'un service et compte les erreurs par module, pour un rapport d'incident.

Format d'une ligne : `<timestamp> <LEVEL> <target> <message...>`. Le message peut contenir des espaces. Les lignes invalides sont ignorées par `errors_by_target`.

```text
2026-03-01T10:00:00Z ERROR payments charge failed
-> LogLine { level: Error, target: "payments",
             msg: "charge failed", .. }
```

```rust play
use std::collections::BTreeMap;
use std::str::FromStr;

#[derive(Debug, PartialEq)]
pub enum Level { Debug, Info, Warn, Error }

#[derive(Debug, PartialEq)]
pub enum ParseError { MissingField, UnknownLevel(String) }

impl FromStr for Level {
    type Err = ParseError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        todo!("DEBUG | INFO | WARN | ERROR")
    }
}

#[derive(Debug, PartialEq)]
pub struct LogLine<'a> {
    pub ts: &'a str,
    pub level: Level,
    pub target: &'a str,
    pub msg: &'a str, // le reste de la ligne
}

// Format : "<ts> <LEVEL> <target> <message...>"
pub fn parse_line(line: &str) -> Result<LogLine<'_>, ParseError> {
    todo!()
}

// Ignore les lignes invalides ; ne compte que les ERROR.
pub fn errors_by_target(logs: &str) -> BTreeMap<&str, usize> {
    todo!()
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_line() {
        let l = parse_line(
            "2026-03-01T10:00:00Z ERROR payments charge failed",
        )
        .unwrap();
        assert_eq!(l.level, Level::Error);
        assert_eq!(l.target, "payments");
        assert_eq!(l.msg, "charge failed");
    }

    #[test]
    fn rejects_bad_lines() {
        assert_eq!(parse_line(""), Err(ParseError::MissingField));
        assert_eq!(
            parse_line("2026-03-01T10:00:00Z FATAL api boom"),
            Err(ParseError::UnknownLevel("FATAL".into()))
        );
    }

    #[test]
    fn counts_errors_by_target() {
        let logs = "\
t1 ERROR payments timeout
t2 INFO api GET /health
garbage
t3 ERROR payments declined
t4 ERROR auth bad token";
        let c = errors_by_target(logs);
        assert_eq!(c.get("payments"), Some(&2));
        assert_eq!(c.get("auth"), Some(&1));
        assert_eq!(c.get("api"), None);
    }
}
```

::: details Solution
Remplace le code au-dessus du module `tests` par :

```rust
use std::collections::BTreeMap;
use std::str::FromStr;

#[derive(Debug, PartialEq)]
pub enum Level { Debug, Info, Warn, Error }

#[derive(Debug, PartialEq)]
pub enum ParseError { MissingField, UnknownLevel(String) }

impl FromStr for Level {
    type Err = ParseError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "DEBUG" => Ok(Level::Debug),
            "INFO" => Ok(Level::Info),
            "WARN" => Ok(Level::Warn),
            "ERROR" => Ok(Level::Error),
            other => Err(ParseError::UnknownLevel(other.to_string())),
        }
    }
}

#[derive(Debug, PartialEq)]
pub struct LogLine<'a> {
    pub ts: &'a str,
    pub level: Level,
    pub target: &'a str,
    pub msg: &'a str,
}

pub fn parse_line(line: &str) -> Result<LogLine<'_>, ParseError> {
    let mut it = line.splitn(4, ' ');
    let mut next = || it.next().filter(|s| !s.is_empty());
    let ts = next().ok_or(ParseError::MissingField)?;
    let level = next().ok_or(ParseError::MissingField)?.parse()?;
    let target = next().ok_or(ParseError::MissingField)?;
    let msg = next().ok_or(ParseError::MissingField)?;
    Ok(LogLine { ts, level, target, msg })
}

pub fn errors_by_target(logs: &str) -> BTreeMap<&str, usize> {
    let mut counts = BTreeMap::new();
    for line in logs.lines().filter_map(|l| parse_line(l).ok()) {
        if line.level == Level::Error {
            *counts.entry(line.target).or_insert(0) += 1;
        }
    }
    counts
}
```

Points clés :

- `splitn(4, ' ')` : le 4e morceau garde tout le reste, espaces compris.
- `LogLine<'a>` **emprunte** la ligne (`&'a str`) au lieu d'allouer 3 `String` par ligne : sur 10 Go de logs, ça compte. Le prix : la `LogLine` ne peut pas survivre au texte. Voir [Lifetimes](/dev/rust/04-lifetimes).
- `impl FromStr` permet `.parse()?` : le `?` convertit directement car `Err = ParseError`.
- `filter_map(|l| parse_line(l).ok())` : on jette les erreurs proprement. En prod, compte-les aussi.
- `BTreeMap` donne une sortie triée et stable (rapport lisible, tests déterministes).
:::

## 2. Compteur de mots

**Contexte** : l'outil de modération d'un forum veut les termes les plus fréquents des signalements de la semaine.

```text
top_words("Le chat. Le chien ! le CHAT", 2)
-> [("le", 3), ("chat", 2)]
```

```rust play
use std::collections::HashMap;

// Mots = suites de caractères alphanumériques (unicode),
// en minuscules. "l'oiseau" -> "l", "oiseau".
// Tri : nombre décroissant, puis ordre alphabétique.
pub fn top_words(text: &str, n: usize) -> Vec<(String, usize)> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    todo!()
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_and_sorts() {
        let text = "Le chat. Le chien ! le CHAT, l'oiseau";
        assert_eq!(
            top_words(text, 2),
            vec![("le".to_string(), 3), ("chat".to_string(), 2)]
        );
    }

    #[test]
    fn ties_are_alphabetical() {
        let got = top_words("b a c b a c", 3);
        let words: Vec<&str> =
            got.iter().map(|(w, _)| w.as_str()).collect();
        assert_eq!(words, ["a", "b", "c"]);
    }

    #[test]
    fn empty_and_small_n() {
        assert!(top_words("  ... !! ", 5).is_empty());
        assert_eq!(top_words("x y", 10).len(), 2);
    }
}
```

::: details Solution
Remplace le code au-dessus du module `tests` par :

```rust
use std::collections::HashMap;

pub fn top_words(text: &str, n: usize) -> Vec<(String, usize)> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for w in text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
    {
        *counts.entry(w.to_lowercase()).or_default() += 1;
    }
    let mut v: Vec<(String, usize)> = counts.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    v.truncate(n);
    v
}
```

Points clés :

- `entry(...).or_default()` : une seule recherche dans la map, et le pattern `*... += 1` est l'idiome Rust du compteur.
- `split` avec une closure `|c: char| ...` découpe sur tout ce qui n'est pas alphanumérique, **unicode compris** (`é` est alphanumérique).
- Tri stable et total : `cmp` sur le compte inversé, puis `then_with` sur le mot. Sans le second critère, l'ordre des ex æquo dépend du hash : tests flaky.
- Relance : pour un top-k sur des millions de mots, un tas binaire (`BinaryHeap` de taille k) donne O(n log k) au lieu de O(n log n). Voir [Heap & top-k](/interview/01-algo/09-heap-top-k).
:::

## 3. Machine à états de commande

**Contexte** : le cycle de vie d'une commande e-commerce. Le but est de rendre les transitions **illégales impossibles à oublier** : le `match` exhaustif te force à traiter chaque cas.

```text
Pending --Pay--> Paid --Ship--> Shipped --Deliver--> Delivered
   |              |
   +----Cancel----+--> Cancelled
```

```rust play
#[derive(Debug, Clone, PartialEq)]
pub enum OrderState {
    Pending,
    Paid { payment_id: String },
    Shipped { tracking: String },
    Delivered,
    Cancelled { reason: String },
}

#[derive(Debug)]
pub enum OrderEvent {
    Pay { payment_id: String },
    Ship { tracking: String },
    Deliver,
    Cancel { reason: String },
}

#[derive(Debug, PartialEq)]
pub struct TransitionError {
    pub from: &'static str,  // "pending", "paid", ...
    pub event: &'static str, // "pay", "ship", ...
}

impl OrderState {
    // Pending -Pay-> Paid -Ship-> Shipped -Deliver-> Delivered
    // Cancel possible depuis Pending et Paid uniquement.
    pub fn apply(self, ev: OrderEvent) -> Result<Self, TransitionError> {
        todo!()
    }

    pub fn is_terminal(&self) -> bool {
        todo!()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use OrderEvent as E;

    #[test]
    fn happy_path() {
        let s = OrderState::Pending
            .apply(E::Pay { payment_id: "pi_1".into() })
            .and_then(|s| s.apply(E::Ship { tracking: "TRK".into() }))
            .and_then(|s| s.apply(E::Deliver))
            .unwrap();
        assert_eq!(s, OrderState::Delivered);
    }

    #[test]
    fn cancel_only_before_shipping() {
        let paid = OrderState::Paid { payment_id: "pi_1".into() };
        let c = paid.apply(E::Cancel { reason: "client".into() });
        assert_eq!(
            c,
            Ok(OrderState::Cancelled { reason: "client".into() })
        );
        let shipped = OrderState::Shipped { tracking: "T".into() };
        assert!(shipped.apply(E::Cancel { reason: "x".into() }).is_err());
    }

    #[test]
    fn invalid_transition_reports_state() {
        let err = OrderState::Pending.apply(E::Deliver).unwrap_err();
        assert_eq!(err.from, "pending");
        assert_eq!(err.event, "deliver");
    }

    #[test]
    fn terminal_states() {
        assert!(OrderState::Delivered.is_terminal());
        assert!(!OrderState::Pending.is_terminal());
    }
}
```

::: details Solution
Remplace le code au-dessus du module `tests` par :

```rust
#[derive(Debug, Clone, PartialEq)]
pub enum OrderState {
    Pending,
    Paid { payment_id: String },
    Shipped { tracking: String },
    Delivered,
    Cancelled { reason: String },
}

#[derive(Debug)]
pub enum OrderEvent {
    Pay { payment_id: String },
    Ship { tracking: String },
    Deliver,
    Cancel { reason: String },
}

#[derive(Debug, PartialEq)]
pub struct TransitionError {
    pub from: &'static str,
    pub event: &'static str,
}

impl OrderState {
    pub fn apply(self, ev: OrderEvent) -> Result<Self, TransitionError> {
        use OrderEvent as E;
        use OrderState as S;
        match (self, ev) {
            (S::Pending, E::Pay { payment_id }) => {
                Ok(S::Paid { payment_id })
            }
            (S::Paid { .. }, E::Ship { tracking }) => {
                Ok(S::Shipped { tracking })
            }
            (S::Shipped { .. }, E::Deliver) => Ok(S::Delivered),
            (S::Pending | S::Paid { .. }, E::Cancel { reason }) => {
                Ok(S::Cancelled { reason })
            }
            (s, e) => Err(TransitionError {
                from: s.name(),
                event: e.name(),
            }),
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Delivered | Self::Cancelled { .. })
    }

    fn name(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Paid { .. } => "paid",
            Self::Shipped { .. } => "shipped",
            Self::Delivered => "delivered",
            Self::Cancelled { .. } => "cancelled",
        }
    }
}

impl OrderEvent {
    fn name(&self) -> &'static str {
        match self {
            Self::Pay { .. } => "pay",
            Self::Ship { .. } => "ship",
            Self::Deliver => "deliver",
            Self::Cancel { .. } => "cancel",
        }
    }
}
```

Points clés :

- `match (self, ev)` sur un **tuple** : une ligne par transition légale, puis un fourre-tout `(s, e) => Err(...)`.
- `apply(self, ...)` **consomme** l'état : impossible de garder une référence à l'ancien état par erreur. Les données (`payment_id`) sont déplacées sans clone.
- Le pattern `S::Pending | S::Paid { .. }` évite de dupliquer la branche `Cancel`.
- Relance : persister en base → une colonne `status` (enum Postgres ou `CHECK`), et un `UPDATE ... WHERE id = $1 AND status = 'paid'` pour que deux workers ne fassent pas la même transition. Voir [Structs, enums & pattern matching](/dev/rust/02-structs-enums-pattern-matching).
- Alternative « typestate » : `Order<Paid>` et `Order<Shipped>` comme types distincts, la transition illégale ne **compile** même pas. Super pour une API de lib, lourd quand l'état vient de la base.
:::

## 4. Implémenter `Iterator`

**Contexte** : un job d'export appelle une API paginée (`?offset=&limit=`). On veut un itérateur de pages pour écrire `for page in Pages::new(total, 100) { ... }` et profiter de tous les adaptateurs (`map`, `take`, `sum`).

```text
Pages::new(10, 3)
-> Page{1, offset 0, limit 3}, Page{2, 3, 3},
   Page{3, 6, 3}, Page{4, 9, 1}
```

```rust play
#[derive(Debug, PartialEq)]
pub struct Page {
    pub number: u64, // commence à 1
    pub offset: u64,
    pub limit: u64,  // la dernière page peut être partielle
}

pub struct Pages {
    total: u64,
    per_page: u64,
    next_offset: u64,
}

impl Pages {
    pub fn new(total: u64, per_page: u64) -> Self {
        assert!(per_page > 0);
        Pages { total, per_page, next_offset: 0 }
    }
}

impl Iterator for Pages {
    type Item = Page;

    fn next(&mut self) -> Option<Page> {
        todo!()
    }

    // Bonus : taille exacte -> permet ExactSizeIterator.
    fn size_hint(&self) -> (usize, Option<usize>) {
        todo!()
    }
}

impl ExactSizeIterator for Pages {}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_pages() {
        let v: Vec<Page> = Pages::new(4, 2).collect();
        assert_eq!(
            v,
            [
                Page { number: 1, offset: 0, limit: 2 },
                Page { number: 2, offset: 2, limit: 2 },
            ]
        );
    }

    #[test]
    fn last_page_is_partial() {
        let last = Pages::new(10, 3).last().unwrap();
        assert_eq!(last, Page { number: 4, offset: 9, limit: 1 });
    }

    #[test]
    fn works_with_adapters() {
        let total: u64 = Pages::new(1000, 100).map(|p| p.limit).sum();
        assert_eq!(total, 1000);
        assert_eq!(Pages::new(0, 50).count(), 0);
    }

    #[test]
    fn size_hint_is_exact() {
        let mut p = Pages::new(10, 3);
        assert_eq!(p.size_hint(), (4, Some(4)));
        p.next();
        assert_eq!(p.len(), 3);
    }
}
```

::: details Solution
Remplace le code au-dessus du module `tests` par :

```rust
#[derive(Debug, PartialEq)]
pub struct Page {
    pub number: u64,
    pub offset: u64,
    pub limit: u64,
}

pub struct Pages {
    total: u64,
    per_page: u64,
    next_offset: u64,
}

impl Pages {
    pub fn new(total: u64, per_page: u64) -> Self {
        assert!(per_page > 0);
        Pages { total, per_page, next_offset: 0 }
    }
}

impl Iterator for Pages {
    type Item = Page;

    fn next(&mut self) -> Option<Page> {
        if self.next_offset >= self.total {
            return None;
        }
        let offset = self.next_offset;
        let limit = self.per_page.min(self.total - offset);
        self.next_offset += limit;
        Some(Page { number: offset / self.per_page + 1, offset, limit })
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let left = self.total - self.next_offset;
        let n = left.div_ceil(self.per_page) as usize;
        (n, Some(n))
    }
}

impl ExactSizeIterator for Pages {}
```

Points clés :

- Il suffit d'implémenter `next` : `map`, `sum`, `last`, `count`… viennent gratuitement du trait.
- `size_hint` exact permet `ExactSizeIterator` (`.len()`) et aide `collect` à pré-allouer.
- `div_ceil` (stable depuis Rust 1.73) évite le classique `(a + b - 1) / b` qui peut déborder.
- Relance : rendre l'itérateur paresseux sur de vraies requêtes HTTP → c'est un `Stream` async (`futures::stream::unfold`), pas un `Iterator`. Voir [Collections & itérateurs](/dev/rust/06-collections-iterateurs).
:::

## 5. Rate limiter token bucket

**Contexte** : limiter chaque clé d'API à des rafales de 10 requêtes, rechargées à 5 par seconde. L'horloge est **injectée** (`now_ms`) pour que les tests soient instantanés et déterministes.

```text
capacity 2, 2 jetons/s, plein à t=0
t=0 ok, t=0 ok, t=100 refusé (+0,2), t=500 ok (+1)
```

```rust play
pub struct TokenBucket {
    capacity: f64,
    refill_per_sec: f64,
    tokens: f64,
    last_ms: u64,
}

impl TokenBucket {
    // Le seau démarre plein. `now_ms` : horloge injectée.
    pub fn new(capacity: u32, refill_per_sec: f64, now_ms: u64) -> Self {
        TokenBucket {
            capacity: capacity as f64,
            refill_per_sec,
            tokens: capacity as f64,
            last_ms: now_ms,
        }
    }

    // Recharge selon le temps écoulé (sans dépasser capacity),
    // puis consomme 1 jeton si possible.
    pub fn try_acquire(&mut self, now_ms: u64) -> bool {
        todo!()
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn burst_then_refuse() {
        let mut b = TokenBucket::new(3, 1.0, 0);
        assert!(b.try_acquire(0));
        assert!(b.try_acquire(0));
        assert!(b.try_acquire(0));
        assert!(!b.try_acquire(0));
    }

    #[test]
    fn refills_over_time() {
        let mut b = TokenBucket::new(2, 2.0, 0); // 2 jetons/s
        assert!(b.try_acquire(0) && b.try_acquire(0));
        assert!(!b.try_acquire(100)); // +0.2 jeton
        assert!(b.try_acquire(500)); // +1 jeton au total
        assert!(!b.try_acquire(500));
    }

    #[test]
    fn never_exceeds_capacity() {
        let mut b = TokenBucket::new(2, 10.0, 0);
        let ok = (0..5).filter(|_| b.try_acquire(60_000)).count();
        assert_eq!(ok, 2);
    }

    #[test]
    fn clock_going_backwards_is_safe() {
        let mut b = TokenBucket::new(1, 1.0, 1_000);
        assert!(b.try_acquire(1_000));
        assert!(!b.try_acquire(500));
    }
}
```

::: details Solution
Remplace le code au-dessus du module `tests` par :

```rust
pub struct TokenBucket {
    capacity: f64,
    refill_per_sec: f64,
    tokens: f64,
    last_ms: u64,
}

impl TokenBucket {
    pub fn new(capacity: u32, refill_per_sec: f64, now_ms: u64) -> Self {
        TokenBucket {
            capacity: capacity as f64,
            refill_per_sec,
            tokens: capacity as f64,
            last_ms: now_ms,
        }
    }

    pub fn try_acquire(&mut self, now_ms: u64) -> bool {
        // saturating_sub : une horloge qui recule ne crée rien
        let elapsed = now_ms.saturating_sub(self.last_ms) as f64;
        self.last_ms = self.last_ms.max(now_ms);
        let refill = elapsed / 1000.0 * self.refill_per_sec;
        self.tokens = (self.tokens + refill).min(self.capacity);
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}
```

Points clés :

- Recharge **paresseuse** : pas de timer, on calcule les jetons gagnés depuis `last_ms` au moment de la demande. Coût O(1), aucun thread.
- `.min(self.capacity)` : sans plafond, un client inactif une heure accumulerait des milliers de jetons.
- `saturating_sub` : une horloge qui recule (NTP) ne doit pas paniquer (`u64` underflow en debug) ni créer de jetons. En prod, utilise `std::time::Instant` (monotone), pas `SystemTime`.
- Relance : un `HashMap<ApiKey, TokenBucket>` derrière un `Mutex` pour plusieurs clients, puis Redis quand il y a plusieurs instances. C'est tout le sujet de [Rate limiter](/interview/03-system-design/03-rate-limiter).
:::

## 6. Cache LRU simple

**Contexte** : cacher en mémoire les 1000 derniers profils utilisateurs lus, en évinçant le moins récemment utilisé.

```text
cap 2 : put a, put b, get a, put c
-> b est évincé (a a été utilisé plus récemment)
```

```rust play
use std::collections::{HashMap, VecDeque};
use std::hash::Hash;

// Version simple : HashMap + VecDeque d'ordre d'usage.
// (get/put en O(capacity) : suffisant pour un petit cache.)
pub struct Lru<K, V> {
    cap: usize,
    map: HashMap<K, V>,
    order: VecDeque<K>, // front = plus ancien, back = plus récent
}

impl<K: Hash + Eq + Clone, V> Lru<K, V> {
    pub fn new(cap: usize) -> Self {
        assert!(cap > 0);
        Lru { cap, map: HashMap::new(), order: VecDeque::new() }
    }

    pub fn get(&mut self, k: &K) -> Option<&V> {
        todo!()
    }

    pub fn put(&mut self, k: K, v: V) {
        todo!()
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evicts_least_recently_used() {
        let mut c = Lru::new(2);
        c.put("a", 1);
        c.put("b", 2);
        assert_eq!(c.get(&"a"), Some(&1)); // a devient récent
        c.put("c", 3); // évince b
        assert_eq!(c.get(&"b"), None);
        assert_eq!(c.get(&"a"), Some(&1));
        assert_eq!(c.get(&"c"), Some(&3));
    }

    #[test]
    fn put_updates_and_refreshes() {
        let mut c = Lru::new(2);
        c.put("a", 1);
        c.put("b", 2);
        c.put("a", 10); // a récent, valeur mise à jour
        c.put("c", 3); // évince b
        assert_eq!(c.get(&"a"), Some(&10));
        assert_eq!(c.get(&"b"), None);
        assert_eq!(c.len(), 2);
    }

    #[test]
    fn capacity_one() {
        let mut c = Lru::new(1);
        c.put(1, "x");
        c.put(2, "y");
        assert_eq!(c.get(&1), None);
        assert_eq!(c.get(&2), Some(&"y"));
    }
}
```

::: details Solution
Remplace le code au-dessus du module `tests` par :

```rust
use std::collections::{HashMap, VecDeque};
use std::hash::Hash;

pub struct Lru<K, V> {
    cap: usize,
    map: HashMap<K, V>,
    order: VecDeque<K>,
}

impl<K: Hash + Eq + Clone, V> Lru<K, V> {
    pub fn new(cap: usize) -> Self {
        assert!(cap > 0);
        Lru { cap, map: HashMap::new(), order: VecDeque::new() }
    }

    fn touch(&mut self, k: &K) {
        if let Some(i) = self.order.iter().position(|x| x == k) {
            let key = self.order.remove(i).unwrap();
            self.order.push_back(key);
        }
    }

    pub fn get(&mut self, k: &K) -> Option<&V> {
        if !self.map.contains_key(k) {
            return None;
        }
        self.touch(k);
        self.map.get(k)
    }

    pub fn put(&mut self, k: K, v: V) {
        if self.map.insert(k.clone(), v).is_some() {
            self.touch(&k);
            return;
        }
        self.order.push_back(k);
        if self.map.len() > self.cap {
            if let Some(old) = self.order.pop_front() {
                self.map.remove(&old);
            }
        }
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }
}
```

Points clés :

- `get` prend `&mut self` : lire **modifie** l'ordre d'usage. C'est pour ça qu'un LRU partagé entre threads demande un `Mutex` (pas un `RwLock`).
- Le borrow checker interdit de garder `self.map.get(k)` puis d'appeler `self.touch(k)` : on vérifie d'abord, on touche, puis on relit.
- `insert` renvoie l'ancienne valeur : `is_some()` distingue mise à jour et insertion.
- Complexité O(capacity) à cause de `position`. La version O(1) utilise une liste doublement chaînée + `HashMap` vers les nœuds (en Rust : indices dans un `Vec` plutôt que des pointeurs). En prod : la crate `lru` ou `moka` (TTL, concurrent). Voir [Design de structures](/interview/01-algo/13-design-structures).
:::

## 7. Mini parser d'expressions

**Contexte** : un back-office permet de saisir des formules de prix (`base * 2 - (remise + 5)`). On commence par les entiers et les 4 opérations.

```text
eval("2 + 3 * 4")   -> Ok(14)
eval("(2 + 3) * 4") -> Ok(20)
eval("1 / 0")       -> Err(DivByZero)
eval("1 2")         -> Err(Unexpected('2'))
```

```rust play
// Grammaire (descente récursive) :
//   expr   = term (("+" | "-") term)*
//   term   = factor (("*" | "/") factor)*
//   factor = nombre | "-" factor | "(" expr ")"
#[derive(Debug, PartialEq)]
pub enum EvalError {
    UnexpectedEnd,
    Unexpected(char),
    DivByZero,
}

struct Parser<'a> {
    chars: std::iter::Peekable<std::str::Chars<'a>>,
}

impl Parser<'_> {
    // Renvoie le prochain caractère non-espace sans le consommer.
    fn peek(&mut self) -> Option<char> {
        while self.chars.next_if(|c| c.is_whitespace()).is_some() {}
        self.chars.peek().copied()
    }
    fn expr(&mut self) -> Result<i64, EvalError> { todo!() }
    fn term(&mut self) -> Result<i64, EvalError> { todo!() }
    fn factor(&mut self) -> Result<i64, EvalError> { todo!() }
}

pub fn eval(src: &str) -> Result<i64, EvalError> {
    let mut p = Parser { chars: src.chars().peekable() };
    let v = p.expr()?;
    // Il ne doit rien rester après l'expression.
    match p.peek() {
        None => Ok(v),
        Some(c) => Err(EvalError::Unexpected(c)),
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn precedence_and_parens() {
        assert_eq!(eval("2 + 3 * 4"), Ok(14));
        assert_eq!(eval("(2 + 3) * 4"), Ok(20));
        assert_eq!(eval("10 - 4 - 3"), Ok(3)); // gauche à droite
        assert_eq!(eval("100 / 10 / 5"), Ok(2));
    }

    #[test]
    fn unary_minus() {
        assert_eq!(eval("-3 + 5"), Ok(2));
        assert_eq!(eval("2 * -(1 + 1)"), Ok(-4));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("1 / 0"), Err(EvalError::DivByZero));
        assert_eq!(eval("1 +"), Err(EvalError::UnexpectedEnd));
        assert_eq!(eval("(1 + 2"), Err(EvalError::UnexpectedEnd));
        assert_eq!(eval("1 2"), Err(EvalError::Unexpected('2')));
        assert_eq!(eval("2 $ 3"), Err(EvalError::Unexpected('$')));
    }
}
```

::: details Solution
Remplace le code au-dessus du module `tests` par :

```rust
#[derive(Debug, PartialEq)]
pub enum EvalError {
    UnexpectedEnd,
    Unexpected(char),
    DivByZero,
}

struct Parser<'a> {
    chars: std::iter::Peekable<std::str::Chars<'a>>,
}

impl Parser<'_> {
    fn peek(&mut self) -> Option<char> {
        while self.chars.next_if(|c| c.is_whitespace()).is_some() {}
        self.chars.peek().copied()
    }

    fn expr(&mut self) -> Result<i64, EvalError> {
        let mut acc = self.term()?;
        while let Some(op @ ('+' | '-')) = self.peek() {
            self.chars.next();
            let rhs = self.term()?;
            acc = if op == '+' { acc + rhs } else { acc - rhs };
        }
        Ok(acc)
    }

    fn term(&mut self) -> Result<i64, EvalError> {
        let mut acc = self.factor()?;
        while let Some(op @ ('*' | '/')) = self.peek() {
            self.chars.next();
            let rhs = self.factor()?;
            acc = match op {
                '*' => acc * rhs,
                _ if rhs == 0 => return Err(EvalError::DivByZero),
                _ => acc / rhs,
            };
        }
        Ok(acc)
    }

    fn factor(&mut self) -> Result<i64, EvalError> {
        match self.peek() {
            None => Err(EvalError::UnexpectedEnd),
            Some('-') => {
                self.chars.next();
                Ok(-self.factor()?)
            }
            Some('(') => {
                self.chars.next();
                let v = self.expr()?;
                match self.peek() {
                    Some(')') => {
                        self.chars.next();
                        Ok(v)
                    }
                    Some(c) => Err(EvalError::Unexpected(c)),
                    None => Err(EvalError::UnexpectedEnd),
                }
            }
            Some(c) if c.is_ascii_digit() => {
                let mut n: i64 = 0;
                let digit = char::is_ascii_digit;
                while let Some(d) = self.chars.next_if(digit) {
                    n = n * 10 + d.to_digit(10).unwrap() as i64;
                }
                Ok(n)
            }
            Some(c) => Err(EvalError::Unexpected(c)),
        }
    }
}

pub fn eval(src: &str) -> Result<i64, EvalError> {
    let mut p = Parser { chars: src.chars().peekable() };
    let v = p.expr()?;
    match p.peek() {
        None => Ok(v),
        Some(c) => Err(EvalError::Unexpected(c)),
    }
}
```

Points clés :

- **Une fonction par niveau de priorité** : `expr` (+, −) appelle `term` (×, ÷) qui appelle `factor`. La priorité vient de la structure des appels, pas de règles ad hoc.
- La boucle `while` dans `expr`/`term` donne l'associativité à **gauche** (`10 - 4 - 3 = 3`). Une récursion `term op expr` donnerait `10 - (4 - 3) = 9` : bug classique.
- `Peekable::next_if` consomme seulement si le prédicat est vrai : idéal pour lire un nombre chiffre par chiffre.
- `while let Some(op @ ('+' | '-'))` : binding `@` + or-pattern.
- Relances : débordement (`checked_mul`/`checked_add` → `EvalError::Overflow`), variables (passer un `&HashMap<&str, i64>`), et séparer tokenizer et parser quand la grammaire grossit.
:::

## 8. Agrégation avec erreurs typées

**Contexte** : importer un CSV de transactions exporté par la banque. On veut des erreurs **précises** (quelle ligne, quelle cause) pour le support, sans `thiserror` (std uniquement).

```text
"t1,alice,1000\nt2,bob,dix"
-> Err : "ligne 2 : montant invalide
         (invalid digit found in string)"
```

```rust play
use std::collections::BTreeMap;
use std::fmt;
use std::num::ParseIntError;

// "à la thiserror", mais avec std uniquement.
#[derive(Debug, PartialEq)]
pub enum LedgerError {
    Columns { line: usize },
    Parse { line: usize, source: ParseIntError },
    Duplicate(String),
    Overdraft { account: String, tx: String },
}

impl fmt::Display for LedgerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // "ligne 2 : 3 colonnes attendues"
        // "ligne 2 : montant invalide (<cause>)"
        // "transaction en double : t1"
        // "solde négatif pour a (tx t2)"
        todo!()
    }
}

impl std::error::Error for LedgerError {
    // Bonus : renvoie la ParseIntError d'origine pour Parse.
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        todo!()
    }
}

// CSV "id,compte,montant_en_centimes" (montant signé).
// Lignes vides ignorées. Première erreur -> on arrête.
pub fn apply(csv: &str) -> Result<BTreeMap<String, i64>, LedgerError> {
    todo!()
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_balances() {
        let csv = "t1,alice,1000\nt2,bob,500\nt3,alice,-250\n";
        let b = apply(csv).unwrap();
        assert_eq!(b["alice"], 750);
        assert_eq!(b["bob"], 500);
    }

    #[test]
    fn reports_line_and_cause() {
        let err = apply("t1,alice,10\nt2,bob,dix").unwrap_err();
        assert!(matches!(err, LedgerError::Parse { line: 2, .. }));
        assert_eq!(
            err.to_string(),
            "ligne 2 : montant invalide (invalid digit found in string)"
        );
        assert!(std::error::Error::source(&err).is_some());
    }

    #[test]
    fn duplicates_and_overdraft() {
        let dup = apply("t1,a,10\nt1,a,10").unwrap_err();
        assert_eq!(dup, LedgerError::Duplicate("t1".into()));
        let od = apply("t1,a,10\nt2,a,-11").unwrap_err();
        assert_eq!(od.to_string(), "solde négatif pour a (tx t2)");
    }

    #[test]
    fn wrong_column_count() {
        let err = apply("t1,a").unwrap_err();
        assert_eq!(err, LedgerError::Columns { line: 1 });
    }
}
```

::: details Solution
Remplace le code au-dessus du module `tests` par :

```rust
use std::collections::{BTreeMap, HashSet};
use std::fmt;
use std::num::ParseIntError;

#[derive(Debug, PartialEq)]
pub enum LedgerError {
    Columns { line: usize },
    Parse { line: usize, source: ParseIntError },
    Duplicate(String),
    Overdraft { account: String, tx: String },
}

impl fmt::Display for LedgerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Columns { line } => {
                write!(f, "ligne {line} : 3 colonnes attendues")
            }
            Self::Parse { line, source } => {
                write!(f, "ligne {line} : montant invalide ({source})")
            }
            Self::Duplicate(id) => {
                write!(f, "transaction en double : {id}")
            }
            Self::Overdraft { account, tx } => {
                write!(f, "solde négatif pour {account} (tx {tx})")
            }
        }
    }
}

impl std::error::Error for LedgerError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Parse { source, .. } => Some(source),
            _ => None,
        }
    }
}

pub fn apply(csv: &str) -> Result<BTreeMap<String, i64>, LedgerError> {
    let mut balances = BTreeMap::new();
    let mut seen = HashSet::new();
    for (i, raw) in csv.lines().enumerate() {
        let line = i + 1;
        if raw.trim().is_empty() {
            continue;
        }
        let cols: Vec<&str> = raw.split(',').map(str::trim).collect();
        let [id, account, amount] = cols[..] else {
            return Err(LedgerError::Columns { line });
        };
        let amount: i64 = amount
            .parse()
            .map_err(|source| LedgerError::Parse { line, source })?;
        if !seen.insert(id.to_string()) {
            return Err(LedgerError::Duplicate(id.to_string()));
        }
        let bal = balances.entry(account.to_string()).or_insert(0);
        *bal += amount;
        if *bal < 0 {
            return Err(LedgerError::Overdraft {
                account: account.to_string(),
                tx: id.to_string(),
            });
        }
    }
    Ok(balances)
}
```

Points clés :

- Une erreur de lib = un `enum` + `Display` + `std::error::Error`. `source()` chaîne la cause d'origine : `anyhow` ou un logger peut afficher toute la chaîne.
- `map_err(|source| LedgerError::Parse { line, source })?` : on enrichit l'erreur avec le contexte (la ligne) au moment où on l'a.
- `let [id, account, amount] = cols[..] else { ... }` : slice pattern + `let-else`, beaucoup plus propre que `cols.get(0)`, `cols.get(1)`…
- `HashSet::insert` renvoie `false` si déjà présent : détection de doublon en une opération.
- Avec `thiserror`, tout le `impl Display` + `source` se réduit à `#[error("ligne {line} : montant invalide ({source})")]` et `#[source]`. Voir [Gestion d'erreurs](/dev/rust/05-gestion-erreurs).
- Relance : « et si on veut toutes les erreurs, pas la première ? » → accumuler dans un `Vec<LedgerError>` et renvoyer `Err(errors)` à la fin.
:::

## 9. `From` / `TryFrom` aux frontières

**Contexte** : une API reçoit un JSON non fiable (`RawUser`). Le reste du code ne manipule que des types du domaine **valides par construction** (`Email`, `Role`, `age: u8`). Principe : *parse, don't validate*.

```text
RawUser { " Ana@X.io ", 30, "admin" }
-> User { Email("ana@x.io"), 30, Role::Admin }
RawUser { "a@b.c", 300, "admin" } -> Err(Age(300))
```

```rust play
// Frontière : JSON non fiable -> types du domaine.
pub struct RawUser { pub email: String, pub age: i64, pub role: String }

#[derive(Debug, PartialEq)]
pub struct Email(String); // invariant : trim, minuscules, contient '@'

impl Email {
    pub fn as_str(&self) -> &str { &self.0 }
}

#[derive(Debug, PartialEq)]
pub enum Role { Admin, Member }

#[derive(Debug)]
pub struct User { pub email: Email, pub age: u8, pub role: Role }

pub struct PublicUser { pub display: String } // "ana@… (admin)"

#[derive(Debug, PartialEq)]
pub enum UserError { Email, Age(i64), Role(String) }

impl TryFrom<&str> for Email {
    type Error = UserError;
    fn try_from(s: &str) -> Result<Self, Self::Error> { todo!() }
}

impl TryFrom<&str> for Role {
    type Error = UserError;
    fn try_from(s: &str) -> Result<Self, Self::Error> { todo!() }
}

impl TryFrom<RawUser> for User {
    type Error = UserError;
    // Astuce : u8::try_from(i64) existe déjà.
    fn try_from(r: RawUser) -> Result<Self, Self::Error> { todo!() }
}

impl From<User> for PublicUser {
    // Format : "<partie locale>@… (<rôle>)", ex. "ana@… (admin)".
    fn from(u: User) -> Self { todo!() }
}
#[cfg(test)]
mod tests {
    use super::*;

    fn raw(email: &str, age: i64, role: &str) -> RawUser {
        RawUser { email: email.into(), age, role: role.into() }
    }

    #[test]
    fn valid_conversion() {
        let u = User::try_from(raw(" Ana@X.io ", 30, "admin")).unwrap();
        assert_eq!(u.email.as_str(), "ana@x.io");
        assert_eq!(u.age, 30);
        assert_eq!(u.role, Role::Admin);
    }

    #[test]
    fn invalid_fields() {
        let e = User::try_from(raw("nope", 30, "admin")).unwrap_err();
        assert_eq!(e, UserError::Email);
        let e = User::try_from(raw("a@b.c", 300, "admin")).unwrap_err();
        assert_eq!(e, UserError::Age(300));
        let e = User::try_from(raw("a@b.c", 20, "root")).unwrap_err();
        assert_eq!(e, UserError::Role("root".into()));
    }

    #[test]
    fn into_public_view() {
        let u: User = raw("a@b.c", 20, "member").try_into().unwrap();
        let p: PublicUser = u.into(); // grâce à From<User>
        assert_eq!(p.display, "a@… (member)");
    }

    #[test]
    fn role_from_str() {
        assert_eq!(Role::try_from("member"), Ok(Role::Member));
    }
}
```

::: details Solution
Remplace le code au-dessus du module `tests` par :

```rust
pub struct RawUser { pub email: String, pub age: i64, pub role: String }

#[derive(Debug, PartialEq)]
pub struct Email(String);

impl Email {
    pub fn as_str(&self) -> &str { &self.0 }
}

#[derive(Debug, PartialEq)]
pub enum Role { Admin, Member }

#[derive(Debug)]
pub struct User { pub email: Email, pub age: u8, pub role: Role }

pub struct PublicUser { pub display: String }

#[derive(Debug, PartialEq)]
pub enum UserError { Email, Age(i64), Role(String) }

impl TryFrom<&str> for Email {
    type Error = UserError;
    fn try_from(s: &str) -> Result<Self, Self::Error> {
        let s = s.trim().to_lowercase();
        match s.split_once('@') {
            Some((l, d)) if !l.is_empty() && d.contains('.') => {
                Ok(Email(s))
            }
            _ => Err(UserError::Email),
        }
    }
}

impl TryFrom<&str> for Role {
    type Error = UserError;
    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s {
            "admin" => Ok(Role::Admin),
            "member" => Ok(Role::Member),
            other => Err(UserError::Role(other.to_string())),
        }
    }
}

impl TryFrom<RawUser> for User {
    type Error = UserError;
    fn try_from(r: RawUser) -> Result<Self, Self::Error> {
        Ok(User {
            email: Email::try_from(r.email.as_str())?,
            age: u8::try_from(r.age)
                .map_err(|_| UserError::Age(r.age))?,
            role: Role::try_from(r.role.as_str())?,
        })
    }
}

impl From<User> for PublicUser {
    fn from(u: User) -> Self {
        let local = u.email.as_str().split('@').next().unwrap_or("");
        let role = match u.role {
            Role::Admin => "admin",
            Role::Member => "member",
        };
        PublicUser { display: format!("{local}@… ({role})") }
    }
}
```

Points clés :

- Le champ d'`Email` est **privé** : hors du module, la seule façon d'en obtenir un est `TryFrom`, donc tout `Email` est valide. Une fonction qui reçoit un `Email` n'a plus rien à vérifier.
- `TryFrom` pour ce qui peut échouer, `From` pour ce qui ne peut pas (`User` → `PublicUser`). Implémenter `From<A> for B` donne `a.into()` gratuitement, et `TryFrom` donne `try_into()`.
- `u8::try_from(i64)` : la std fournit déjà les conversions numériques faillibles. Ne fais jamais `r.age as u8` : `300 as u8` vaut `44`, silencieusement.
- Relance : avec serde, `#[serde(try_from = "RawUser")]` sur `User` applique cette validation directement à la désérialisation.
:::

## Pièges classiques

- Mettre `.unwrap()` partout pour « aller vite » : en entretien Rust, c'est le premier truc relevé. Utilise `?` et des erreurs typées.
- `.clone()` pour calmer le borrow checker sans comprendre pourquoi il râle. Explique plutôt le conflit (emprunt mutable pendant un emprunt partagé) et restructure.
- `as` pour convertir des entiers : troncature silencieuse. Préfère `try_from`.
- Oublier les cas limites dans les tests : entrée vide, capacité 1, horloge qui recule, ex æquo.
- `HashMap` dans une sortie testée ou affichée : ordre non déterministe. `BTreeMap` ou un tri explicite.
- Récursion à droite dans un parser (mauvaise associativité).

## Défis

1. Pourquoi ce code ne compile pas, et comment le corriger sans `clone` ?

```rust
fn first_error(logs: &str) -> &str {
    let owned = logs.to_uppercase();
    owned.lines().next().unwrap_or("")
}
```

2. Ajoute à l'exercice 5 une méthode `retry_after_ms(&self) -> u64` qui dit dans combien de temps un jeton sera disponible (pour l'en-tête `Retry-After`).
3. Dans l'exercice 6, pourquoi `get(&self, ...)` (sans `mut`) est impossible avec cette conception ? Quelle structure le permettrait quand même ?

::: details Solution
1. `owned` est une `String` locale détruite à la fin de la fonction ; on renvoie une référence vers elle (*dangling*). Soit on renvoie une `String` (`.to_string()` sur la ligne), soit on travaille directement sur `logs` (qui vit plus longtemps que la fonction) et on compare sans tenir compte de la casse : `logs.lines().find(|l| l.to_uppercase().contains("ERROR"))`.
2. Si `tokens >= 1.0` → 0. Sinon `((1.0 - tokens) / refill_per_sec * 1000.0).ceil() as u64`. Attention : ça suppose que `tokens` a été mis à jour pour `now` ; idéalement la méthode prend aussi `now_ms`.
3. `get` modifie `order` → il faut `&mut self`. Avec de l'**interior mutability** (`RefCell<VecDeque<K>>` en mono-thread, `Mutex` en multi-thread), `get(&self)` devient possible. C'est ce que font les caches concurrents. Voir [Smart pointers](/dev/rust/07-smart-pointers).
:::

## À retenir

- Les exercices Rust de mid testent : `enum` + `match` exhaustif, erreurs typées avec `?`, emprunts plutôt que clones, traits standards (`Iterator`, `FromStr`, `From`/`TryFrom`, `Display`).
- Injecte l'horloge et les entrées : tes tests sont instantanés et déterministes.
- Les types du domaine valides par construction suppriment des familles entières de bugs.
- Lis les messages du compilateur à voix haute en entretien : c'est un signal positif, pas une faiblesse.
- Termine en citant la crate prod (`thiserror`, `lru`/`moka`, `governor`, `nom`/`pest`) et pourquoi tu as fait sans.
