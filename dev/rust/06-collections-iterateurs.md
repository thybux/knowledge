# Collections & itérateurs

Ce que tu vas apprendre : les collections de la std et quand utiliser laquelle, l'API `entry` de `HashMap`, les itérateurs (paresseux et zéro-coût), les trois sortes de closures (`Fn`, `FnMut`, `FnOnce`), et les réflexes de performance. C'est aussi la boîte à outils de tes sessions LeetCode.

## Choisir sa collection

| Besoin | Rust | Équivalent TS |
|---|---|---|
| Liste ordonnée, accès par index | `Vec<T>` | `Array` |
| Clé → valeur, ordre quelconque | `HashMap<K, V>` | `Map` |
| Ensemble, test d'appartenance | `HashSet<T>` | `Set` |
| Clé → valeur **triées** | `BTreeMap<K, V>` | — |
| File (push/pop aux 2 bouts) | `VecDeque<T>` | `Array` + `shift` (O(n)) |
| File de priorité | `BinaryHeap<T>` | — |

Par défaut : `Vec` et `HashMap`. `BTreeMap` quand tu as besoin d'ordre (affichage trié, requêtes par plage). `VecDeque` pour les files FIFO et fenêtres glissantes. `LinkedList` existe, mais ne l'utilise presque jamais.

## `Vec<T>`

```rust play
fn main() {
    let mut v: Vec<u32> = Vec::with_capacity(4); // 1 seule alloc
    v.extend([5, 3, 8, 3, 1]);
    v.push(9);

    v.sort();              // tri stable, en place
    v.dedup();             // supprime les doublons CONSÉCUTIFS
    v.retain(|&x| x != 8); // filter en place
    println!("{v:?}");     // [1, 3, 5, 9]

    println!("{:?}", v.get(10));         // None, pas de panic
    println!("{:?}", v.binary_search(&5)); // Ok(2) (vec trié)
    println!("{:?}", v.iter().position(|&x| x > 3)); // Some(2)

    let last = v.pop();    // Option<u32>
    println!("{last:?} reste {}", v.len());
}
```

- `v[i]` panique hors limites ; `v.get(i)` renvoie un `Option`.
- `sort_by_key(|o| o.created_at)`, `sort_by(|a, b| b.total.cmp(&a.total))` pour trier des structs.
- `sort_unstable` est un peu plus rapide si l'ordre des égaux importe peu.
- Les flottants n'implémentent pas `Ord` (à cause de `NaN`) : `v.sort_by(|a, b| a.total_cmp(b))`.

## `HashMap` et l'API `entry`

En TS, compter des occurrences :

```ts
counts.set(k, (counts.get(k) ?? 0) + 1);
```

En Rust, l'API `entry` fait ça en **un seul lookup** :

```rust play
use std::collections::HashMap;

fn main() {
    let events = ["login", "pay", "login", "logout", "login"];

    let mut counts: HashMap<&str, u32> = HashMap::new();
    for e in events {
        *counts.entry(e).or_insert(0) += 1;
    }
    println!("{counts:?}");

    // regrouper : clé → Vec
    let orders = [("acme", 120), ("globex", 50), ("acme", 30)];
    let mut by_tenant: HashMap<&str, Vec<u32>> = HashMap::new();
    for (tenant, amount) in orders {
        by_tenant.entry(tenant).or_default().push(amount);
    }
    println!("{:?}", by_tenant.get("acme"));

    // modifier si présent, insérer sinon
    let mut stock = HashMap::from([("MUG", 3)]);
    stock.entry("MUG").and_modify(|q| *q -= 1).or_insert(0);
    println!("{stock:?}");
}
```

| Méthode | Effet |
|---|---|
| `get(&k)` | `Option<&V>` |
| `insert(k, v)` | renvoie l'ancienne valeur (`Option<V>`) |
| `remove(&k)` | `Option<V>` |
| `entry(k).or_insert(v)` | `&mut V`, insère si absent |
| `entry(k).or_default()` | idem avec `Default` |
| `contains_key(&k)` | `bool` |

::: info L'ordre d'itération d'une `HashMap` est aléatoire
Et il change d'une exécution à l'autre (le hash est randomisé contre les attaques DoS). Ne compte jamais dessus, ni dans tes tests : utilise `BTreeMap` ou trie avant d'afficher.
:::

Pour être une clé, un type doit implémenter `Eq + Hash` : `#[derive(PartialEq, Eq, Hash)]` sur ta struct. Les `f64` ne peuvent pas être des clés.

## `HashSet`, `BTreeMap`, `VecDeque`

```rust play
use std::collections::{BTreeMap, HashSet, VecDeque};

fn main() {
    // HashSet : appartenance en O(1)
    let banned: HashSet<&str> = ["spam.io", "evil.com"].into();
    println!("{}", banned.contains("spam.io"));

    let a: HashSet<u32> = [1, 2, 3].into();
    let b: HashSet<u32> = [2, 3, 4].into();
    let mut common: Vec<_> = a.intersection(&b).collect();
    common.sort();
    println!("{common:?}"); // [2, 3]

    // BTreeMap : clés triées, requêtes par plage
    let mut daily: BTreeMap<&str, u32> = BTreeMap::new();
    daily.insert("2026-03-02", 40);
    daily.insert("2026-03-01", 10);
    daily.insert("2026-03-10", 7);
    for (day, n) in daily.range("2026-03-01".."2026-03-05") {
        println!("{day} : {n}");
    }

    // VecDeque : file FIFO efficace
    let mut jobs: VecDeque<&str> = VecDeque::new();
    jobs.push_back("email");
    jobs.push_back("invoice");
    jobs.push_front("urgent");
    while let Some(j) = jobs.pop_front() {
        print!("{j} ");
    }
    println!();
}
```

## Itérateurs : les bases

Trois façons d'itérer sur une collection :

| Appel | Donne | La collection après |
|---|---|---|
| `v.iter()` / `for x in &v` | `&T` | intacte |
| `v.iter_mut()` / `for x in &mut v` | `&mut T` | modifiée |
| `v.into_iter()` / `for x in v` | `T` | consommée |

Et les adaptateurs, que tu connais déjà de JS :

```rust play
fn main() {
    let amounts = vec![1200, -300, 4500, 0, 80];

    let total_positive: i64 = amounts
        .iter()
        .filter(|&&a| a > 0) // &&: iter() donne &i64, filter &&i64
        .sum();

    let labels: Vec<String> = amounts
        .iter()
        .enumerate()
        .map(|(i, a)| format!("#{i}:{a}"))
        .collect();

    let biggest = amounts.iter().max();
    let any_refund = amounts.iter().any(|&a| a < 0);
    let first_big = amounts.iter().find(|&&a| a > 1000);

    println!("{total_positive} {labels:?}");
    println!("{biggest:?} {any_refund} {first_big:?}");

    // fold = reduce avec valeur initiale
    let (pos, neg) = amounts.iter().fold((0, 0), |(p, n), &a| {
        if a >= 0 { (p + a, n) } else { (p, n + a) }
    });
    println!("+{pos} {neg}");
}
```

| JS | Rust |
|---|---|
| `map`, `filter` | `map`, `filter` |
| `reduce(f, init)` | `fold(init, f)` |
| `find`, `some`, `every` | `find`, `any`, `all` |
| `flatMap` | `flat_map` |
| `slice(0, n)` | `take(n)` |
| `entries()` | `enumerate()` |
| — | `zip`, `chain`, `skip_while`, `windows`, `chunks`, `rev` |
| — | `filter_map` (filter + map sur un `Option`) |

### `collect` et le turbofish

`collect()` peut produire presque n'importe quelle collection ; il faut lui dire laquelle :

```rust play
use std::collections::{HashMap, HashSet};

fn main() {
    let words = ["b", "a", "b", "c"];
    let v: Vec<&str> = words.iter().copied().collect();
    let s = words.iter().collect::<HashSet<_>>(); // turbofish ::<>
    let m: HashMap<&str, usize> =
        words.iter().map(|w| (*w, w.len())).collect();
    let joined = words.join("-");
    let text: String = words.iter().copied().collect();
    let parsed: Result<Vec<u32>, _> =
        ["1", "2", "x"].iter().map(|s| s.parse::<u32>()).collect();
    println!("{v:?} {} {m:?} {joined} {text} {parsed:?}", s.len());
}
```

## Paresseux et zéro-coût

Différence fondamentale avec JS : `arr.map(f).filter(g)` en JS crée **deux tableaux intermédiaires**. En Rust, les adaptateurs sont **paresseux** : rien ne se passe tant qu'un consommateur (`collect`, `sum`, `for`, `count`…) ne tire pas les éléments, un par un, à travers toute la chaîne.

```rust play
fn main() {
    let first_two: Vec<u32> = (1..)          // itérateur infini !
        .map(|n| {
            println!("calcul de {n}");
            n * n
        })
        .filter(|sq| sq % 2 == 1)
        .take(2)
        .collect();
    println!("{first_two:?}"); // calcule seulement 1, 2, 3
}
```

Le compilateur fusionne la chaîne en une seule boucle, souvent aussi rapide (voire plus, grâce à l'élimination des bounds checks) qu'une boucle `for` écrite à la main : c'est ce qu'on appelle une **abstraction zéro-coût**.

## Closures : `Fn`, `FnMut`, `FnOnce`

Une closure capture son environnement. Selon **ce qu'elle fait** des variables capturées, elle implémente un ou plusieurs traits :

| Trait | La closure… | Appelable |
|---|---|---|
| `Fn` | lit ses captures (`&`) | autant de fois qu'on veut |
| `FnMut` | modifie ses captures (`&mut`) | plusieurs fois, pas en parallèle |
| `FnOnce` | consomme ses captures (move) | une seule fois |

Tout `Fn` est aussi `FnMut`, tout `FnMut` est aussi `FnOnce`. Quand tu écris une fonction qui accepte une closure, demande le trait **le moins exigeant** dont tu as besoin.

```rust play
fn retry<F: FnMut() -> Result<u32, String>>(mut f: F, n: u32)
    -> Result<u32, String> {
    let mut last = Err("jamais appelé".to_string());
    for _ in 0..n {
        last = f();
        if last.is_ok() { break; }
    }
    last
}

fn main() {
    let rate = 20;
    let with_tax = |p: u32| p * (100 + rate) / 100; // Fn : lit `rate`
    println!("{}", with_tax(100));

    let mut attempts = 0;
    let r = retry(|| {                    // FnMut : modifie `attempts`
        attempts += 1;
        if attempts < 3 { Err("timeout".into()) } else { Ok(attempts) }
    }, 5);
    println!("{r:?} après {attempts} essais");

    let report = String::from("rapport.pdf");
    let send = move || report;  // FnOnce : rend la String capturée
    let file = send();
    // send(); // erreur : déjà consommée
    println!("{file}");
}
```

`move` force la capture **par valeur** (indispensable pour les threads et tâches async) ; ça ne détermine pas à lui seul le trait : une closure `move` qui ne fait que lire reste `Fn`.

## Performance : les réflexes

- **`with_capacity`** quand tu connais la taille : évite les réallocations successives.
- **Ne `collect()` pas au milieu** d'une chaîne pour itérer à nouveau ensuite : garde l'itérateur.
- **`iter()` plutôt que `into_iter().cloned()`** si tu n'as pas besoin de posséder.
- **`HashMap` avec clés `&str`** quand la map ne survit pas aux données sources : zéro allocation.
- **`sort_unstable`** et **`retain`** (en place) plutôt que de reconstruire un `Vec`.
- Le hasher par défaut (SipHash) est résistant au DoS mais pas le plus rapide. Pour des clés internes de confiance sur un chemin chaud, des crates comme `rustc-hash` (FxHash) ou `ahash` sont courantes. Mesure avant ([chapitre 12](/dev/rust/12-tests-et-outillage)).

## Cas réel : rapport de revenus par tenant

Un SaaS multi-tenant veut, chaque nuit, le top 3 des tenants par revenu net (paiements moins remboursements), en ignorant les tenants de test :

```rust play
use std::collections::{HashMap, HashSet};

struct Tx<'a> { tenant: &'a str, cents: i64, kind: Kind }
enum Kind { Payment, Refund }

fn top_tenants<'a>(txs: &[Tx<'a>], excluded: &HashSet<&str>, n: usize)
    -> Vec<(&'a str, i64)> {
    let mut revenue: HashMap<&str, i64> = HashMap::new();
    for tx in txs.iter().filter(|t| !excluded.contains(t.tenant)) {
        let signed = match tx.kind {
            Kind::Payment => tx.cents,
            Kind::Refund => -tx.cents,
        };
        *revenue.entry(tx.tenant).or_insert(0) += signed;
    }
    let mut ranked: Vec<_> = revenue.into_iter().collect();
    // revenu décroissant, puis nom pour un ordre déterministe
    ranked.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    ranked.truncate(n);
    ranked
}

fn main() {
    use Kind::*;
    let txs = [
        Tx { tenant: "acme", cents: 50_000, kind: Payment },
        Tx { tenant: "globex", cents: 80_000, kind: Payment },
        Tx { tenant: "acme", cents: 40_000, kind: Payment },
        Tx { tenant: "globex", cents: 30_000, kind: Refund },
        Tx { tenant: "test-tenant", cents: 999_999, kind: Payment },
        Tx { tenant: "initech", cents: 10_000, kind: Payment },
        Tx { tenant: "hooli", cents: 10_000, kind: Payment },
    ];
    let excluded = HashSet::from(["test-tenant"]);
    for (t, c) in top_tenants(&txs, &excluded, 3) {
        println!("{t:<8} {:>8.2} €", c as f64 / 100.0);
    }
}
```

`then` sur un `Ordering` donne un tri multi-critères, l'équivalent du `a.x - b.x || a.y.localeCompare(b.y)` de JS. Le tri secondaire rend la sortie **déterministe** malgré l'ordre aléatoire de la `HashMap`.

## Pièges classiques

- **Compter sur l'ordre d'une `HashMap`** (tests qui passent « parfois »).
- **`dedup()` sur un `Vec` non trié** : il ne supprime que les doublons consécutifs.
- **Itérateur jamais consommé** : `v.iter().map(...)` seul ne fait rien (le compilateur avertit : `unused_must_use`).
- **`for x in v` puis réutiliser `v`** : `into_iter` l'a consommé. `for x in &v`.
- **`v.iter().map(...).collect::<Vec<_>>().len()`** : `count()` suffit, sans allocation.
- **Modifier une collection pendant qu'on l'itère** : refusé par le borrow checker. `retain`, ou collecter les changements puis les appliquer.
- **Question d'entretien** : « Différence entre `Fn`, `FnMut`, `FnOnce` ? » → ce que la closure fait de ses captures : lire, modifier, consommer.

## Défis

### 1. Que affiche ce code ?

```rust play
fn main() {
    let ids = vec![1, 2, 3];
    let _doubled = ids.iter().map(|x| {
        println!("traitement {x}");
        x * 2
    });
    println!("fin");
}
```

::: details Solution
Seulement `fin`. Les itérateurs sont paresseux : sans consommateur (`collect`, `for`, `sum`…), la closure n'est jamais appelée. Sans le `let _doubled =`, le compilateur émettrait un warning `unused_must_use` : *iterators are lazy and do nothing unless consumed*. Piège classique quand on fait un `map` pour ses effets de bord : utilise `for` ou `for_each`.
:::

### 2. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
fn run_twice<F: Fn()>(f: F) {
    f();
    f();
}

fn main() {
    let mut log: Vec<&str> = Vec::new();
    run_twice(|| log.push("tick"));
    println!("{log:?}");
}
```

::: details Solution
E0596 : la closure modifie `log`, elle est donc `FnMut`, mais `run_twice` exige `Fn` (lecture seule). Correction : `fn run_twice<F: FnMut()>(mut f: F)`. Demande toujours le trait le moins exigeant compatible avec ton usage.
:::

### 3. Exercice : top K des endpoints

À partir de lignes `"GET /api/orders"`, renvoie les `k` chemins les plus appelés (méthode ignorée), par nombre décroissant puis ordre alphabétique en cas d'égalité.

```rust play
pub fn top_paths(lines: &[&str], k: usize) -> Vec<(String, usize)> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn top() {
        let logs = ["GET /orders", "POST /orders", "GET /me",
                    "GET /health", "GET /me", "GET /orders"];
        assert_eq!(top_paths(&logs, 2), vec![
            ("/orders".to_string(), 3),
            ("/me".to_string(), 2),
        ]);
    }
    #[test]
    fn ties_alphabetical() {
        let logs = ["GET /b", "GET /a", "GET /c"];
        assert_eq!(top_paths(&logs, 2), vec![
            ("/a".to_string(), 1), ("/b".to_string(), 1)]);
    }
    #[test]
    fn ignores_garbage() {
        assert!(top_paths(&["nimportequoi"], 5).is_empty());
    }
}
```

::: details Solution
```rust play
use std::collections::HashMap;

pub fn top_paths(lines: &[&str], k: usize) -> Vec<(String, usize)> {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for line in lines {
        if let Some((_, path)) = line.split_once(' ') {
            *counts.entry(path).or_default() += 1;
        }
    }
    let mut v: Vec<(&str, usize)> = counts.into_iter().collect();
    v.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    v.into_iter()
        .take(k)
        .map(|(p, n)| (p.to_string(), n))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn top() {
        let logs = ["GET /orders", "POST /orders", "GET /me",
                    "GET /health", "GET /me", "GET /orders"];
        assert_eq!(top_paths(&logs, 2), vec![
            ("/orders".to_string(), 3),
            ("/me".to_string(), 2),
        ]);
    }
    #[test]
    fn ties_alphabetical() {
        let logs = ["GET /b", "GET /a", "GET /c"];
        assert_eq!(top_paths(&logs, 2), vec![
            ("/a".to_string(), 1), ("/b".to_string(), 1)]);
    }
    #[test]
    fn ignores_garbage() {
        assert!(top_paths(&["nimportequoi"], 5).is_empty());
    }
}
```

Les clés `&str` empruntent les lignes : aucune allocation pendant le comptage, on ne crée des `String` que pour les `k` résultats. Complexité O(n + m log m) avec m chemins distincts ; avec un `BinaryHeap` de taille k, on descend à O(n + m log k) (cf. [Heap & top K](/interview/01-algo/09-heap-top-k)).
:::

### 4. Exercice : dédoublonner des emails

Supprime les doublons **insensibles à la casse** en gardant la **première** occurrence et l'ordre d'origine (contrairement à `sort` + `dedup`).

```rust play
pub fn dedupe_emails(emails: Vec<String>) -> Vec<String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_first_and_order() {
        let input = vec!["Bob@x.io", "ann@y.io", "bob@X.io", "zoe@z.io"]
            .into_iter().map(String::from).collect();
        assert_eq!(dedupe_emails(input),
                   vec!["Bob@x.io", "ann@y.io", "zoe@z.io"]);
    }
    #[test]
    fn empty() {
        assert!(dedupe_emails(vec![]).is_empty());
    }
}
```

::: details Solution
```rust play
use std::collections::HashSet;

pub fn dedupe_emails(emails: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    emails
        .into_iter()
        // insert renvoie false si la valeur était déjà présente
        .filter(|e| seen.insert(e.to_lowercase()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_first_and_order() {
        let input = vec!["Bob@x.io", "ann@y.io", "bob@X.io", "zoe@z.io"]
            .into_iter().map(String::from).collect();
        assert_eq!(dedupe_emails(input),
                   vec!["Bob@x.io", "ann@y.io", "zoe@z.io"]);
    }
    #[test]
    fn empty() {
        assert!(dedupe_emails(vec![]).is_empty());
    }
}
```

`HashSet::insert` renvoie un `bool` : l'astuce classique pour un « unique » en une passe. La closure de `filter` est `FnMut` (elle modifie `seen`). On consomme le `Vec` d'entrée : aucune `String` d'origine n'est copiée.
:::

### 5. Exercice : rate limiter à fenêtre glissante

Autorise au plus `max` requêtes sur les `window_ms` dernières millisecondes. `now_ms` est croissant. Utilise un `VecDeque` des timestamps acceptés.

```rust play
use std::collections::VecDeque;

pub struct RateLimiter {
    window_ms: u64,
    max: usize,
    hits: VecDeque<u64>,
}

impl RateLimiter {
    pub fn new(window_ms: u64, max: usize) -> Self {
        Self { window_ms, max, hits: VecDeque::new() }
    }

    pub fn allow(&mut self, now_ms: u64) -> bool {
        todo!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sliding() {
        let mut rl = RateLimiter::new(1000, 2);
        assert!(rl.allow(0));
        assert!(rl.allow(100));
        assert!(!rl.allow(500));  // 2 hits dans la fenêtre
        assert!(rl.allow(1000));  // le hit à 0 est sorti
        assert!(!rl.allow(1050));
        assert!(rl.allow(2100));
    }
}
```

::: details Solution
```rust play
use std::collections::VecDeque;

pub struct RateLimiter {
    window_ms: u64,
    max: usize,
    hits: VecDeque<u64>,
}

impl RateLimiter {
    pub fn new(window_ms: u64, max: usize) -> Self {
        Self { window_ms, max, hits: VecDeque::new() }
    }

    pub fn allow(&mut self, now_ms: u64) -> bool {
        // fenêtre = ]now - window, now]
        while let Some(&oldest) = self.hits.front() {
            if oldest + self.window_ms <= now_ms {
                self.hits.pop_front();
            } else {
                break;
            }
        }
        if self.hits.len() < self.max {
            self.hits.push_back(now_ms);
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sliding() {
        let mut rl = RateLimiter::new(1000, 2);
        assert!(rl.allow(0));
        assert!(rl.allow(100));
        assert!(!rl.allow(500));
        assert!(rl.allow(1000));
        assert!(!rl.allow(1050));
        assert!(rl.allow(2100));
    }
}
```

Chaque timestamp entre et sort une fois : O(1) amorti par appel, O(max) en mémoire. En prod multi-instances, la même logique vit dans Redis (sorted set) : voir [Rate limiter](/interview/03-system-design/03-rate-limiter).
:::

### 6. Exercice : revenu par jour, trié

Agrège des transactions `(jour, cents)` en un total par jour, **trié par jour**, et renvoie uniquement les jours entre `from` et `to` inclus.

```rust play
use std::collections::BTreeMap;

pub fn daily(txs: &[(&str, i64)], from: &str, to: &str)
    -> Vec<(String, i64)> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range() {
        let txs = [("2026-01-03", 10), ("2026-01-01", 5),
                   ("2026-01-03", 7), ("2026-01-09", 1),
                   ("2026-01-02", -2)];
        assert_eq!(daily(&txs, "2026-01-02", "2026-01-03"), vec![
            ("2026-01-02".to_string(), -2),
            ("2026-01-03".to_string(), 17),
        ]);
    }
}
```

::: details Solution
```rust play
use std::collections::BTreeMap;

pub fn daily(txs: &[(&str, i64)], from: &str, to: &str)
    -> Vec<(String, i64)> {
    let mut by_day: BTreeMap<&str, i64> = BTreeMap::new();
    for &(day, cents) in txs {
        *by_day.entry(day).or_insert(0) += cents;
    }
    by_day
        .range(from..=to)
        .map(|(d, c)| (d.to_string(), *c))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range() {
        let txs = [("2026-01-03", 10), ("2026-01-01", 5),
                   ("2026-01-03", 7), ("2026-01-09", 1),
                   ("2026-01-02", -2)];
        assert_eq!(daily(&txs, "2026-01-02", "2026-01-03"), vec![
            ("2026-01-02".to_string(), -2),
            ("2026-01-03".to_string(), 17),
        ]);
    }
}
```

Les dates ISO 8601 se trient correctement en tant que chaînes, et `BTreeMap::range` fait une requête par plage en O(log n + k). C'est le même principe qu'un index B-tree en base ([Index & EXPLAIN](/bdd/03-index-et-explain)).
:::

## À retenir

- `Vec` et `HashMap` par défaut ; `BTreeMap` pour l'ordre, `VecDeque` pour les files, `HashSet` pour l'appartenance.
- `entry().or_insert()` / `or_default()` : compter et grouper en un lookup.
- `iter()` emprunte, `iter_mut()` modifie, `into_iter()` consomme.
- Les itérateurs sont paresseux et fusionnés en une boucle : zéro-coût, pas de tableaux intermédiaires.
- `collect()` construit n'importe quelle collection, y compris `Result<Vec<_>, _>`.
- Closures : `Fn` (lit), `FnMut` (modifie), `FnOnce` (consomme) ; demande le moins exigeant.
