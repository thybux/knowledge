# Smart pointers

Ce que tu vas apprendre : `Box`, `Rc`, `Arc`, `RefCell`, `Cell`, `Mutex`/`RwLock`, `Weak` et `Cow`, ce qu'est l'*interior mutability*, et surtout **lequel choisir** selon la situation, avec un arbre de décision.

## Pourquoi des « smart pointers » ?

Les règles du chapitre 1 (un propriétaire, `&` XOR `&mut`, vérifié à la compilation) couvrent 90 % du code. Les 10 % restants :

- une valeur de taille inconnue ou récursive → `Box` ;
- **plusieurs propriétaires** (un graphe, un cache partagé) → `Rc` / `Arc` ;
- **muter à travers une référence partagée** → `RefCell` / `Cell` / `Mutex`.

Un smart pointer est une struct qui possède une donnée et implémente `Deref` (tu l'utilises comme une référence, `*p` ou `p.method()`) et `Drop` (nettoyage automatique).

En TS, **tout** objet est déjà un `Rc<RefCell<T>>` géré par le GC : partagé et mutable de partout. Rust te fait choisir explicitement, et ne te fait payer que ce que tu utilises.

## `Box<T>` : une valeur sur le heap

```rust play
// 1. Types récursifs : sans Box, taille infinie
#[derive(Debug)]
enum Expr {
    Num(f64),
    Add(Box<Expr>, Box<Expr>),
    Mul(Box<Expr>, Box<Expr>),
}

fn eval(e: &Expr) -> f64 {
    match e {
        Expr::Num(n) => *n,
        Expr::Add(a, b) => eval(a) + eval(b),
        Expr::Mul(a, b) => eval(a) * eval(b),
    }
}

trait Rule { fn check(&self, cents: u64) -> bool; }
struct MaxAmount(u64);
impl Rule for MaxAmount {
    fn check(&self, c: u64) -> bool { c <= self.0 }
}

fn main() {
    // (2 + 3) * 4 : prix * quantité avec frais
    use Expr::*;
    let e = Mul(Box::new(Add(Box::new(Num(2.0)),
                             Box::new(Num(3.0)))),
                Box::new(Num(4.0)));
    println!("{}", eval(&e));

    // 2. Trait objects : taille inconnue à la compilation
    let rules: Vec<Box<dyn Rule>> = vec![Box::new(MaxAmount(10_000))];
    println!("{}", rules.iter().all(|r| r.check(5_000)));
}
```

`Box` a un seul propriétaire, comme une valeur normale ; il ajoute juste une indirection. Un troisième usage : déplacer une **très grosse** struct sans copier des kilo-octets sur la stack.

## `Rc<T>` : plusieurs propriétaires (un seul thread)

`Rc` (*reference counted*) compte les propriétaires. `Rc::clone` **ne copie pas la donnée** : il incrémente un compteur. La valeur est libérée quand le dernier `Rc` disparaît.

```rust play
use std::rc::Rc;

#[derive(Debug)]
struct Template { body: String }

struct Email { to: String, tpl: Rc<Template> }

fn main() {
    let tpl = Rc::new(Template { body: "Bonjour {name}".into() });

    let emails: Vec<Email> = ["ann", "bob", "zoe"]
        .iter()
        .map(|to| Email { to: to.to_string(), tpl: Rc::clone(&tpl) })
        .collect();

    println!("propriétaires : {}", Rc::strong_count(&tpl)); // 4
    for e in &emails {
        println!("{} ← {}", e.to, e.tpl.body);
    }
    drop(emails);
    println!("propriétaires : {}", Rc::strong_count(&tpl)); // 1
}
```

::: tip Écris `Rc::clone(&x)` plutôt que `x.clone()`
Les deux font la même chose, mais `Rc::clone` signale au lecteur que c'est un clone **bon marché** (compteur), pas une copie profonde.
:::

Un `Rc<T>` ne donne qu'un accès **en lecture** (`&T`) : avec plusieurs propriétaires, une mutation violerait la règle `&` XOR `&mut`. Pour muter, il faut l'interior mutability.

## `Arc<T>` : `Rc` thread-safe

`Arc` (*atomic reference counted*) est identique à `Rc`, mais son compteur utilise des opérations atomiques : il peut être partagé entre threads. Un peu plus cher, donc `Rc` quand tu es sur un seul thread, `Arc` sinon. Le compilateur t'empêche de te tromper : `Rc` n'est pas `Send` ([chapitre 8](/dev/rust/08-concurrence)).

Dans un serveur (Axum, Tokio), tu verras `Arc` partout : l'état partagé entre handlers (`Arc<AppState>`), une config, un pool de connexions.

## Interior mutability : `Cell` et `RefCell`

Parfois tu as besoin de muter une donnée alors que tu n'as qu'une `&` : un compteur de cache dans une méthode `&self`, un graphe partagé. L'*interior mutability* déplace la vérification **de la compilation vers l'exécution**.

### `Cell<T>` : pour les petites valeurs `Copy`

```rust play
use std::cell::Cell;

struct Cache {
    hits: Cell<u32>, // modifiable via &self
}

impl Cache {
    fn get(&self, _key: &str) -> Option<&str> {
        self.hits.set(self.hits.get() + 1);
        None
    }
}

fn main() {
    let c = Cache { hits: Cell::new(0) };
    c.get("a");
    c.get("b");
    println!("hits = {}", c.hits.get());
}
```

`Cell` ne te donne jamais de référence vers l'intérieur : tu fais `get` (copie) et `set` (remplace). Donc aucun risque d'aliasing, aucun coût.

### `RefCell<T>` : le borrow checker à l'exécution

```rust play
use std::cell::RefCell;
use std::rc::Rc;

fn main() {
    // un journal d'audit partagé par plusieurs composants
    let audit = Rc::new(RefCell::new(Vec::<String>::new()));

    let billing = Rc::clone(&audit);
    let shipping = Rc::clone(&audit);

    billing.borrow_mut().push("facture #1 émise".into());
    shipping.borrow_mut().push("colis #1 expédié".into());

    println!("{:?}", audit.borrow());
    println!("{} entrées", audit.borrow().len());
}
```

`borrow()` renvoie un `Ref<T>` (comme un `&T`), `borrow_mut()` un `RefMut<T>` (comme un `&mut T`). Les règles sont les mêmes qu'à la compilation, mais vérifiées **au moment de l'appel** :

```rust
let log = RefCell::new(vec![1]);
let r = log.borrow();          // lecteur actif
log.borrow_mut().push(2);      // PANIC : already borrowed
```

::: warning `Rc<RefCell<T>>` n'est pas « le mode JS »
C'est un outil légitime (graphes, arbres avec parents, observers), mais si tout ton code en est plein, tu as recréé un tas d'objets mutables partagés, avec des panics au lieu d'erreurs de compilation. Commence toujours par te demander si un ownership clair (un propriétaire + des `&mut` ponctuels) suffit.
:::

## `Mutex<T>` et `RwLock<T>` : interior mutability entre threads

Mêmes idées que `RefCell`, mais thread-safe : au lieu de paniquer, un thread **attend** que la donnée soit libre.

| Mono-thread | Multi-thread |
|---|---|
| `Rc<T>` | `Arc<T>` |
| `Cell<T>` | atomiques (`AtomicU64`…) |
| `RefCell<T>` | `Mutex<T>` / `RwLock<T>` |

```rust play
use std::sync::{Arc, Mutex};
use std::thread;

fn main() {
    let processed = Arc::new(Mutex::new(Vec::new()));
    let handles: Vec<_> = (1..=3)
        .map(|id| {
            let processed = Arc::clone(&processed);
            thread::spawn(move || {
                processed.lock().unwrap().push(id);
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    let mut v = processed.lock().unwrap().clone();
    v.sort();
    println!("{v:?}");
}
```

`RwLock` autorise plusieurs lecteurs simultanés ou un écrivain : intéressant pour une donnée lue très souvent et écrite rarement (config, cache). On creuse au [chapitre 8](/dev/rust/08-concurrence).

## `Weak<T>` : casser les cycles

Deux `Rc` qui se pointent mutuellement ne descendent jamais à zéro : **fuite mémoire**. `Weak` est une référence non-propriétaire : elle ne maintient pas la valeur en vie, et `upgrade()` renvoie `Option<Rc<T>>` (`None` si la valeur a été libérée).

Cas typique : un arbre où les enfants connaissent leur parent.

```rust play
use std::cell::RefCell;
use std::rc::{Rc, Weak};

#[derive(Debug)]
struct Category {
    name: String,
    parent: RefCell<Weak<Category>>,     // ne possède PAS le parent
    children: RefCell<Vec<Rc<Category>>>, // possède les enfants
}

fn new_cat(name: &str) -> Rc<Category> {
    Rc::new(Category {
        name: name.into(),
        parent: RefCell::new(Weak::new()),
        children: RefCell::new(vec![]),
    })
}

fn main() {
    let home = new_cat("Maison");
    let kitchen = new_cat("Cuisine");
    *kitchen.parent.borrow_mut() = Rc::downgrade(&home);
    home.children.borrow_mut().push(Rc::clone(&kitchen));

    let parent = kitchen.parent.borrow().upgrade();
    println!("parent de cuisine : {:?}", parent.map(|p| p.name.clone()));
    println!("strong={} weak={}",
             Rc::strong_count(&home), Rc::weak_count(&home));
}
```

Autres usages : un cache qui ne doit pas empêcher la libération, des observers qui se désabonnent automatiquement.

## `Cow<'a, T>` : copier seulement si nécessaire

`Cow` (*clone on write*) est soit un emprunt (`Borrowed`), soit une valeur possédée (`Owned`). Parfait pour une fonction qui **modifie rarement** son entrée :

```rust play
use std::borrow::Cow;

// 99 % des SKU sont déjà propres : on évite l'allocation
fn normalize_sku(raw: &str) -> Cow<'_, str> {
    if raw.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()
                           || c == '-') {
        Cow::Borrowed(raw)
    } else {
        Cow::Owned(raw.trim().to_ascii_uppercase().replace(' ', "-"))
    }
}

fn main() {
    for s in ["MUG-42", " mug 42 "] {
        let n = normalize_sku(s);
        let kind = match &n {
            Cow::Borrowed(_) => "emprunté",
            Cow::Owned(_) => "alloué",
        };
        println!("{n:?} ({kind})"); // Cow implémente Deref<Target=str>
    }
}
```

Tu croiseras `Cow` dans `String::from_utf8_lossy`, dans serde (`#[serde(borrow)] Cow<'a, str>`) et dans les APIs de parsing.

## Arbre de décision

```text
Un seul propriétaire ?
├─ oui → valeur normale
│        taille inconnue / récursif / dyn Trait ? → Box<T>
└─ non, plusieurs propriétaires
   ├─ un seul thread → Rc<T>
   │    besoin de muter ? → Rc<RefCell<T>> (ou Rc<Cell<T>> si Copy)
   └─ plusieurs threads → Arc<T>
        besoin de muter ?
        ├─ compteur / flag → Arc<AtomicXxx>
        ├─ lectures >> écritures → Arc<RwLock<T>>
        └─ sinon → Arc<Mutex<T>>

Cycle possible (parent ↔ enfant) ? → Weak<T> pour le lien retour
Emprunter ou posséder selon le cas ? → Cow<'a, T>
Muter via &self, mono-thread, sans partage ? → Cell / RefCell
```

## Cas réel : config rechargeable à chaud

Un service lit des feature flags par tenant à **chaque requête** et les recharge toutes les 30 secondes. Lectures très fréquentes, écritures rares : `RwLock`. Et on ne garde jamais le verrou pendant le traitement : on clone un `Arc` vers un **snapshot** immuable.

```rust play
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

#[derive(Debug)]
struct Flags { enabled: HashMap<String, bool> }

#[derive(Clone)]
struct FlagStore {
    current: Arc<RwLock<Arc<Flags>>>,
}

impl FlagStore {
    fn snapshot(&self) -> Arc<Flags> {
        // verrou tenu quelques nanosecondes : juste un Arc::clone
        Arc::clone(&self.current.read().unwrap())
    }
    fn reload(&self, new: Flags) {
        *self.current.write().unwrap() = Arc::new(new);
    }
}

fn handle_request(store: &FlagStore, tenant: &str) -> &'static str {
    let flags = store.snapshot(); // cohérent pendant toute la requête
    match flags.enabled.get(tenant) {
        Some(true) => "nouveau checkout",
        _ => "ancien checkout",
    }
}

fn main() {
    let store = FlagStore { current: Arc::new(RwLock::new(Arc::new(
        Flags { enabled: HashMap::from([("acme".into(), false)]) },
    ))) };
    println!("{}", handle_request(&store, "acme"));
    store.reload(Flags {
        enabled: HashMap::from([("acme".into(), true)]),
    });
    println!("{}", handle_request(&store, "acme"));
}
```

Une requête en cours garde son ancien snapshot même si un reload a lieu : pas d'état incohérent à mi-requête. (La crate `arc-swap` fait la même chose sans verrou, si un jour la contention se voit dans les profils.)

## Pièges classiques

- **`Rc<RefCell<T>>` par réflexe** pour contourner le borrow checker : tu échanges des erreurs de compilation contre des panics.
- **Cycles de `Rc`** : fuite mémoire silencieuse. Liens retour en `Weak`.
- **Garder un `borrow_mut()` / `lock()` trop longtemps** : panics (`RefCell`) ou contention et deadlocks (`Mutex`). Réduis la portée avec un bloc `{ }`.
- **`Arc<Mutex<T>>` pour un simple compteur** : un `AtomicU64` suffit.
- **`Box<Vec<T>>`** : inutile, `Vec` est déjà un pointeur vers le heap.
- **Question d'entretien** : « Différence entre `Rc` et `Arc` ? » → compteur non atomique vs atomique ; `Rc` n'est pas `Send`.

## Défis

### 1. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
enum Json {
    Null,
    Number(f64),
    Array(Vec<Json>),
    Wrapped(Json),
}

fn main() {
    let _ = Json::Null;
}
```

::: details Solution
E0072 : `Wrapped(Json)` rend le type récursif de **taille infinie** (un `Json` contient un `Json` qui contient…). Solution : `Wrapped(Box<Json>)`. Note que `Array(Vec<Json>)` passe : un `Vec` est déjà une indirection vers le heap, de taille fixe (3 mots).
:::

### 2. Que se passe-t-il ?

```rust
use std::cell::RefCell;

fn main() {
    let cart = RefCell::new(vec![100, 200]);
    let items = cart.borrow();
    if items.len() < 3 {
        cart.borrow_mut().push(300);
    }
    println!("{:?}", cart.borrow());
}
```

::: details Solution
Ça **compile**, mais ça **panique** à l'exécution : `RefCell already borrowed`. `items` (un `Ref`) est encore vivant quand on appelle `borrow_mut()`. Contrairement aux références normales, un `Ref` vit jusqu'à la fin de son scope (il a un `Drop`), le NLL ne le raccourcit pas.

Correction : `let len = cart.borrow().len();` (le `Ref` temporaire meurt à la fin de l'instruction), ou `drop(items)` avant le `borrow_mut()`. `try_borrow_mut()` permet de gérer le conflit sans panic.
:::

### 3. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
use std::rc::Rc;
use std::thread;

fn main() {
    let config = Rc::new(String::from("prod"));
    let c = Rc::clone(&config);
    let h = thread::spawn(move || println!("{c}"));
    h.join().unwrap();
}
```

::: details Solution
E0277 : `Rc<String>` cannot be sent between threads safely. Le compteur de `Rc` n'est pas atomique : deux threads qui le modifient en même temps le corrompraient. `Rc` n'implémente donc pas `Send`. Remplace par `Arc` (`std::sync::Arc`), le reste du code est identique.
:::

### 4. Exercice : `Cow` pour normaliser des téléphones

Supprime les espaces, points et tirets d'un numéro. Si le numéro est déjà propre, **n'alloue pas** (renvoie `Cow::Borrowed`).

```rust play
use std::borrow::Cow;

pub fn clean_phone(raw: &str) -> Cow<'_, str> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn already_clean_is_borrowed() {
        assert!(matches!(clean_phone("+33612345678"),
                         Cow::Borrowed("+33612345678")));
    }
    #[test]
    fn dirty_is_owned() {
        let c = clean_phone("06 12.34-56 78");
        assert!(matches!(c, Cow::Owned(_)));
        assert_eq!(c, "0612345678");
    }
}
```

::: details Solution
```rust play
use std::borrow::Cow;

pub fn clean_phone(raw: &str) -> Cow<'_, str> {
    let is_sep = |c: char| matches!(c, ' ' | '.' | '-');
    if raw.contains(is_sep) {
        Cow::Owned(raw.chars().filter(|&c| !is_sep(c)).collect())
    } else {
        Cow::Borrowed(raw)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn already_clean_is_borrowed() {
        assert!(matches!(clean_phone("+33612345678"),
                         Cow::Borrowed("+33612345678")));
    }
    #[test]
    fn dirty_is_owned() {
        let c = clean_phone("06 12.34-56 78");
        assert!(matches!(c, Cow::Owned(_)));
        assert_eq!(c, "0612345678");
    }
}
```

`str::contains` accepte une closure comme pattern. Sur un import de millions de lignes déjà propres, ça économise autant d'allocations.
:::

### 5. Exercice : réservation de stock via `&self`

Un `Inventory` est partagé (en lecture) par plusieurs composants d'un même thread, mais `reserve` doit pouvoir décrémenter le stock. Implémente-le avec `RefCell`, sans changer les signatures.

```rust play
use std::cell::RefCell;
use std::collections::HashMap;

pub struct Inventory {
    stock: RefCell<HashMap<String, u32>>,
}

impl Inventory {
    pub fn new(items: &[(&str, u32)]) -> Self {
        let map = items.iter().map(|(k, v)| (k.to_string(), *v));
        Self { stock: RefCell::new(map.collect()) }
    }

    /// Réserve `qty` unités si possible. Renvoie true si OK.
    pub fn reserve(&self, sku: &str, qty: u32) -> bool {
        todo!()
    }

    pub fn available(&self, sku: &str) -> u32 {
        todo!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserve() {
        let inv = Inventory::new(&[("MUG", 3)]);
        let shared = &inv; // seulement des & partagées
        assert!(shared.reserve("MUG", 2));
        assert!(!shared.reserve("MUG", 2));
        assert!(!shared.reserve("NOPE", 1));
        assert_eq!(inv.available("MUG"), 1);
        assert_eq!(inv.available("NOPE"), 0);
    }
}
```

::: details Solution
```rust play
use std::cell::RefCell;
use std::collections::HashMap;

pub struct Inventory {
    stock: RefCell<HashMap<String, u32>>,
}

impl Inventory {
    pub fn new(items: &[(&str, u32)]) -> Self {
        let map = items.iter().map(|(k, v)| (k.to_string(), *v));
        Self { stock: RefCell::new(map.collect()) }
    }

    pub fn reserve(&self, sku: &str, qty: u32) -> bool {
        let mut stock = self.stock.borrow_mut();
        match stock.get_mut(sku) {
            Some(n) if *n >= qty => {
                *n -= qty;
                true
            }
            _ => false,
        }
    }

    pub fn available(&self, sku: &str) -> u32 {
        self.stock.borrow().get(sku).copied().unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserve() {
        let inv = Inventory::new(&[("MUG", 3)]);
        let shared = &inv;
        assert!(shared.reserve("MUG", 2));
        assert!(!shared.reserve("MUG", 2));
        assert!(!shared.reserve("NOPE", 1));
        assert_eq!(inv.available("MUG"), 1);
        assert_eq!(inv.available("NOPE"), 0);
    }
}
```

Le `RefMut` vit jusqu'à la fin de `reserve`, et aucune autre méthode n'est appelée pendant ce temps : pas de risque de panic. Pour un serveur multi-thread, remplace `RefCell` par `Mutex` : le code est presque identique (`lock().unwrap()` au lieu de `borrow_mut()`).
:::

### 6. Mini-scénario : choisir le bon pointeur

Pour chaque besoin, quel type choisis-tu ?

1. Un AST de règles de pricing, `Rule::And(Rule, Rule)`.
2. Un pool de connexions BDD partagé par tous les handlers Axum.
3. Un compteur de requêtes incrémenté par tous les threads.
4. Un graphe de dépendances entre jobs, mono-thread, avec liens enfant → parent.
5. Une map de sessions lue à chaque requête et modifiée au login/logout.

::: details Solution
1. `Box<Rule>` : type récursif, un seul propriétaire.
2. `Arc<Pool>` (le `PgPool` de SQLx est déjà un `Arc` en interne : il suffit de le cloner).
3. `Arc<AtomicU64>` avec `fetch_add(1, Ordering::Relaxed)` : pas besoin de `Mutex`.
4. `Rc<Job>` pour les liens possédants, `Weak<Job>` pour les liens retour, `RefCell` pour muter les listes.
5. `Arc<RwLock<HashMap<..>>>` (ou une crate concurrente comme `dashmap`) ; en multi-instance, ça part dans Redis.
:::

## À retenir

- `Box` : heap + un seul propriétaire (récursif, `dyn Trait`).
- `Rc` / `Arc` : plusieurs propriétaires, clone = incrément de compteur ; `Arc` pour les threads.
- `Cell` / `RefCell` : muter via `&`, vérifié à l'exécution (panic si conflit) ; `Mutex` / `RwLock` en multi-thread.
- `Weak` casse les cycles (liens parent, caches).
- `Cow` : n'alloue que quand il faut modifier.
- Ownership simple d'abord ; les smart pointers sont des outils ciblés, pas un mode par défaut.
