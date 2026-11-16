<script setup>
import minStack from "./challenges/min-stack";
import lruCache from "./challenges/lru-cache";
import trie from "./challenges/trie";
import rateLimiter from "./challenges/sliding-window-rate-limiter";
import timeMap from "./challenges/time-based-key-value-store";
</script>

# Structures à concevoir

Ce que tu vas apprendre : répondre aux questions « implémente une classe qui… » en combinant deux structures simples pour tenir une contrainte de complexité, et reconnaître quand ces exercices tombent (souvent plus en entretien « backend » qu'en pur algo).

<Progress :ids="['min-stack', 'lru-cache', 'trie', 'sliding-window-rate-limiter', 'time-based-key-value-store']" />

## Le pattern : une contrainte, deux structures

Ces exercices donnent une API (`get`, `put`, `allow`…) et une contrainte (« O(1) », « O(log n) »). Aucune structure standard ne la tient seule. La solution est presque toujours une **composition** :

| Problème | Composition |
|---|---|
| Min Stack | pile + min courant par entrée |
| LRU Cache | hash map + liste doublement chaînée |
| Trie | arbre dont chaque nœud est une map |
| Rate limiter | hash map + file de timestamps |
| Time-based KV | hash map + tableau trié + binary search |

La méthode, à dérouler à voix haute :

1. **Lister les opérations** et la complexité visée pour chacune.
2. **Choisir l'état** : quelles structures, et surtout quel **invariant** elles respectent (« la tête de liste est l'élément le plus récent »).
3. **Écrire chaque méthode** en maintenant l'invariant. Chaque mutation touche toutes les structures concernées.
4. **Dérouler un scénario** à la main avec les cas limites : vide, capacité 1, clé mise à jour, doublons.

### Template TS

```ts
class Design {
  // 1. L'état. Écris l'invariant en commentaire :
  //    il guide toutes les méthodes.
  // INVARIANT : index.get(k) pointe sur le nœud de k
  //             dans order, et order est trié par récence.
  private index = new Map<number, Node>();
  private order = new LinkedList();

  constructor(private capacity: number) {}

  read(key: number): number {
    const node = this.index.get(key);
    if (!node) return -1;       // cas absent en premier
    this.order.moveToFront(node); // maintenir l'invariant
    return node.value;
  }

  write(key: number, value: number): void {
    // toute mutation met à jour index ET order
  }
}
```

### Équivalent Rust

En Rust, la question de fond est **qui possède quoi**. Une liste doublement chaînée avec des pointeurs (`Rc<RefCell<Node>>` dans les deux sens) est pénible et sujette aux cycles. L'astuce standard : stocker les nœuds dans un `Vec` et utiliser des **indices** comme pointeurs (une « arena »). Le borrow checker ne voit que des `usize`.

```rust play
const NIL: usize = usize::MAX;

struct Node { val: i32, prev: usize, next: usize }

struct List { nodes: Vec<Node>, head: usize }

impl List {
    fn push_front(&mut self, val: i32) -> usize {
        let i = self.nodes.len();
        let next = self.head;
        self.nodes.push(Node { val, prev: NIL, next });
        if next != NIL {
            self.nodes[next].prev = i;
        }
        self.head = i;
        i // l'indice sert de "pointeur" stable
    }
}

fn main() {
    let mut l = List { nodes: Vec::new(), head: NIL };
    l.push_front(1);
    let i = l.push_front(2);
    let n = &l.nodes[i];
    println!("{} -> {}", n.val, l.nodes[n.next].val); // 2 -> 1
}
```

On retrouve ce pattern dans la vraie vie : `slab`, `slotmap`, les arenas de compilateurs. Voir aussi [Smart pointers](/dev/rust/07-smart-pointers) pour comprendre pourquoi `Rc<RefCell>` est à éviter ici.

## Comment le reconnaître

- « Implémente la classe `X` avec les méthodes… » : format LeetCode « design », les tests appellent une séquence d'opérations.
- « en O(1) en moyenne » : hash map quasi obligatoire, plus une structure pour l'**ordre** (liste, pile).
- « le moins récemment utilisé », « éviction » : LRU (liste + map).
- « préfixe », « autocomplétion », « mots qui commencent par » : Trie.
- « au plus N par fenêtre », « par seconde », « par utilisateur » : rate limiter, file de timestamps par clé.
- « à l'instant t », « version la plus récente avant » : historique trié + [binary search](/interview/01-algo/05-binary-search).
- « minimum / maximum en O(1) avec pop » : pile augmentée.

## Quand ils tombent en entretien

- **Entretiens backend / mid-senior** : LRU Cache et rate limiter sont parmi les questions les plus posées, parce qu'ils parlent directement de production (cache applicatif, protection d'API). On enchaîne souvent sur le system design : « et si on a 10 serveurs ? » → Redis, voir [Rate limiter](/interview/03-system-design/03-rate-limiter).
- **Live coding de 45 min** : un exercice design remplace souvent deux petits algos. L'intervieweur regarde la clarté de l'état et des invariants autant que la complexité.
- **Questions de suivi typiques** : thread-safety (« et si deux requêtes appellent `put` en même temps ? »), mémoire (« le rate limiter garde-t-il des clients inactifs pour toujours ? »), TTL, LFU au lieu de LRU.
- **Trie** : plus rare en tant que tel, mais base de Word Search II, autocomplétion, routage d'URL par préfixe.

## Cas réel

**API de paiement** : devant `POST /charges`, deux briques de ce chapitre.

1. **Rate limiter par marchand** : 100 requêtes par fenêtre glissante de 1 s, par clé d'API. Une version mémoire (celle du défi) suffit sur une instance unique ; derrière un load balancer, on passe sur Redis avec un sorted set par clé (`ZREMRANGEBYSCORE` pour purger, `ZCARD` pour compter, dans un script Lua ou un `MULTI` pour l'atomicité).
2. **Cache LRU** des configurations marchands (frais, devises autorisées) lues à chaque requête : on évite un aller-retour base, borné en mémoire. En Node, la lib `lru-cache` fait exactement ça (avec TTL en plus) ; en Rust, la crate `lru` ou `moka` (concurrent, avec TTL).

```ts
// middleware simplifié (Express/Fastify-like)
const limiter = new RateLimiter(100, 1_000);

function rateLimit(req: Req, res: Res, next: () => void) {
  const key = req.headers["x-api-key"] ?? req.ip;
  if (!limiter.allow(String(key), Date.now())) {
    res.status(429).set("Retry-After", "1").end();
    return;
  }
  next();
}
```

Le défi passe le timestamp **en argument** au lieu d'appeler `Date.now()` dedans : c'est aussi ce que tu veux en prod, pour tester sans fake timers (injection de l'horloge, voir [Tests](/dev/typescript/08-tests)).

## Pièges classiques

- **Oublier une des deux structures** : supprimer de la map sans retirer de la liste (ou l'inverse). Chaque mutation doit toucher les deux.
- **LRU : `put` sur une clé existante** doit mettre à jour la valeur **et** la rendre la plus récente, sans éviction.
- **LRU en O(n)** : un tableau de clés avec `indexOf`/`splice` marche mais rate la contrainte O(1). Annonce-le si tu le fais.
- **Min Stack avec une seule variable `min`** : après un `pop` du minimum, tu ne sais plus quel était le précédent.
- **Trie : `search` vs `startsWith`** : `search` exige le marqueur de fin de mot (`end`), sinon `"app"` est trouvé après avoir inséré `"apple"`.
- **Rate limiter : fuite mémoire** : une map par client jamais purgée grossit indéfiniment. En prod : purge périodique ou TTL.
- **Bornes de fenêtre** : `]t - w, t]` ou `[t - w, t]` ? Une requête pile à `t - w` compte-t-elle ? Clarifie.
- **TimeMap : recherche linéaire** : les timestamps sont croissants, donc le tableau est trié ; binary search attendue.

## Défis

### 1. Min Stack

Implémente une pile avec `push(val)`, `pop()`, `top()` et `getMin()` (le minimum actuel de la pile), toutes en O(1). `pop`, `top` et `getMin` ne sont jamais appelés sur une pile vide.

```
push(-2), push(0), push(-3)
getMin() -> -3
pop()
top()    -> 0
getMin() -> -2
```

Problème équivalent sur LeetCode : Min Stack (155).

<Challenge :data="minStack" />

::: details Explication
Chaque entrée de la pile stocke `[valeur, min de la pile jusqu'à elle]`. Le min au sommet est toujours le min global, et après un `pop` le nouveau sommet porte le bon min « d'avant ». Toutes les opérations sont O(1), espace O(n).

Variante économe : une seconde pile qui ne reçoit une valeur que si elle est `<=` au min courant (le `<=` est indispensable pour les doublons du minimum).

```rust play
struct MinStack {
    items: Vec<(i32, i32)>, // (valeur, min jusqu'ici)
}

impl MinStack {
    fn new() -> Self {
        Self { items: Vec::new() }
    }
    fn push(&mut self, val: i32) {
        let min = self.items.last().map_or(val, |&(_, m)| m.min(val));
        self.items.push((val, min));
    }
    fn pop(&mut self) {
        self.items.pop();
    }
    fn top(&self) -> i32 {
        self.items.last().unwrap().0
    }
    fn get_min(&self) -> i32 {
        self.items.last().unwrap().1
    }
}

fn main() {
    let mut s = MinStack::new();
    s.push(-2);
    s.push(0);
    println!("{}", s.get_min());
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn leetcode() {
        let mut s = MinStack::new();
        s.push(-2);
        s.push(0);
        s.push(-3);
        assert_eq!(s.get_min(), -3);
        s.pop();
        assert_eq!(s.top(), 0);
        assert_eq!(s.get_min(), -2);
    }
    #[test]
    fn duplicates() {
        let mut s = MinStack::new();
        s.push(1);
        s.push(1);
        s.pop();
        assert_eq!(s.get_min(), 1);
    }
}
```

En vrai code, `top` retournerait `Option<i32>` plutôt que de paniquer ; ici on suit le contrat LeetCode.
:::

### 2. LRU Cache

Un cache de capacité fixe. `get(key)` retourne la valeur ou `-1`. `put(key, value)` insère ou met à jour ; si la taille dépasse la capacité, on évince la clé **la moins récemment utilisée**. `get` et `put` comptent tous deux comme une utilisation. Vise O(1) pour les deux.

```
LRUCache(2)
put(1, 1), put(2, 2)
get(1)    -> 1    (1 devient le plus récent)
put(3, 3)         (évince 2)
get(2)    -> -1
put(4, 4)         (évince 1)
get(1) -> -1, get(3) -> 3, get(4) -> 4
```

Problème équivalent sur LeetCode : LRU Cache (146).

<Challenge :data="lruCache" />

::: details Explication
**En TS**, une `Map` garantit l'ordre d'insertion. « Rendre récent » = `delete` puis `set` (la clé passe en dernier) ; « le plus ancien » = `map.keys().next().value`. Tout est O(1). C'est accepté en entretien si tu expliques **pourquoi** ça marche ; certains intervieweurs demanderont alors la version « à la main ».

**La version classique** (attendue dans tous les langages) : une hash map `clé → nœud` et une liste doublement chaînée triée par récence. `get` : trouver le nœud via la map, le détacher, le remettre en tête. `put` : idem, ou créer un nœud en tête ; si on dépasse, retirer la queue et sa clé de la map. Le nœud stocke sa **clé** pour pouvoir la supprimer de la map lors de l'éviction.

**En Rust**, un `HashMap` + `VecDeque` de clés est tentant, mais déplacer une clé au milieu d'une `VecDeque` est O(n). La version O(1) utilise la liste chaînée par indices dans un `Vec` (vue plus haut) ; à l'éviction, on **recycle** le slot de la queue, donc le `Vec` ne dépasse jamais la capacité.

```rust play
use std::collections::HashMap;

const NIL: usize = usize::MAX;

struct Node { key: i32, val: i32, prev: usize, next: usize }

struct LRUCache {
    cap: usize,
    map: HashMap<i32, usize>, // clé -> indice dans nodes
    nodes: Vec<Node>,
    head: usize, // le plus récent
    tail: usize, // le plus ancien
}

impl LRUCache {
    fn new(capacity: usize) -> Self {
        assert!(capacity > 0);
        Self {
            cap: capacity,
            map: HashMap::with_capacity(capacity),
            nodes: Vec::with_capacity(capacity),
            head: NIL,
            tail: NIL,
        }
    }

    fn unlink(&mut self, i: usize) {
        let (p, n) = (self.nodes[i].prev, self.nodes[i].next);
        if p != NIL { self.nodes[p].next = n } else { self.head = n }
        if n != NIL { self.nodes[n].prev = p } else { self.tail = p }
    }

    fn push_front(&mut self, i: usize) {
        self.nodes[i].prev = NIL;
        self.nodes[i].next = self.head;
        if self.head != NIL { self.nodes[self.head].prev = i }
        self.head = i;
        if self.tail == NIL { self.tail = i }
    }

    fn get(&mut self, key: i32) -> i32 {
        let Some(&i) = self.map.get(&key) else { return -1 };
        self.unlink(i);
        self.push_front(i);
        self.nodes[i].val
    }

    fn put(&mut self, key: i32, value: i32) {
        if let Some(&i) = self.map.get(&key) {
            self.nodes[i].val = value;
            self.unlink(i);
            self.push_front(i);
            return;
        }
        let i = if self.nodes.len() < self.cap {
            let node = Node { key, val: value, prev: NIL, next: NIL };
            self.nodes.push(node);
            self.nodes.len() - 1
        } else {
            let t = self.tail; // recycle le slot du plus ancien
            self.unlink(t);
            self.map.remove(&self.nodes[t].key);
            self.nodes[t].key = key;
            self.nodes[t].val = value;
            t
        };
        self.map.insert(key, i);
        self.push_front(i);
    }
}

fn main() {
    let mut c = LRUCache::new(2);
    c.put(1, 1);
    println!("{}", c.get(1));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn leetcode() {
        let mut c = LRUCache::new(2);
        c.put(1, 1);
        c.put(2, 2);
        assert_eq!(c.get(1), 1);
        c.put(3, 3);
        assert_eq!(c.get(2), -1);
        c.put(4, 4);
        assert_eq!(c.get(1), -1);
        assert_eq!(c.get(3), 3);
        assert_eq!(c.get(4), 4);
    }
    #[test]
    fn capacity_one() {
        let mut c = LRUCache::new(1);
        c.put(1, 1);
        c.put(2, 2);
        assert_eq!(c.get(1), -1);
        assert_eq!(c.get(2), 2);
    }
    #[test]
    fn update_counts_as_use() {
        let mut c = LRUCache::new(2);
        c.put(1, 1);
        c.put(2, 2);
        c.put(1, 10);
        c.put(3, 3);
        assert_eq!(c.get(1), 10);
        assert_eq!(c.get(2), -1);
    }
}
```

Complexité : O(1) amorti pour `get` et `put` (hash map), O(capacité) en espace. Note que `get` prend `&mut self` : lire modifie l'ordre. C'est pour ça qu'un cache LRU partagé entre threads demande un `Mutex` même pour les lectures.
:::

### 3. Implement Trie

Un arbre de préfixes sur des mots en minuscules. `insert(word)` ; `search(word)` : ce mot exact a-t-il été inséré ? `startsWith(prefix)` : au moins un mot inséré commence-t-il par `prefix` ?

```
insert("apple")
search("apple")   -> true
search("app")     -> false  (préfixe, pas un mot)
startsWith("app") -> true
insert("app")
search("app")     -> true
```

Problème équivalent sur LeetCode : Implement Trie (Prefix Tree) (208).

<Challenge :data="trie" />

::: details Explication
Chaque nœud a des enfants indexés par caractère et un booléen `end` (« un mot se termine ici »). `insert` descend en créant les nœuds manquants puis pose `end = true`. `search` et `startsWith` partagent la même descente (`walk`) : `search` exige `end`, `startsWith` exige seulement que le chemin existe. Le préfixe vide correspond à la racine : `startsWith("")` est vrai.

Complexité : O(L) par opération (L = longueur du mot), indépendamment du nombre de mots stockés. Espace : O(total des caractères insérés) au pire.

Pour `a-z` uniquement, un tableau de 26 enfants (`[Option<Box<Node>>; 26]`) est plus rapide qu'une map mais consomme plus de mémoire par nœud.

```rust play
use std::collections::HashMap;

#[derive(Default)]
struct Node {
    children: HashMap<char, Node>,
    end: bool,
}

#[derive(Default)]
struct Trie {
    root: Node,
}

impl Trie {
    fn new() -> Self {
        Self::default()
    }
    fn insert(&mut self, word: &str) {
        let mut node = &mut self.root;
        for ch in word.chars() {
            node = node.children.entry(ch).or_default();
        }
        node.end = true;
    }
    fn walk(&self, s: &str) -> Option<&Node> {
        let mut node = &self.root;
        for ch in s.chars() {
            node = node.children.get(&ch)?;
        }
        Some(node)
    }
    fn search(&self, word: &str) -> bool {
        self.walk(word).is_some_and(|n| n.end)
    }
    fn starts_with(&self, prefix: &str) -> bool {
        self.walk(prefix).is_some()
    }
}

fn main() {
    let mut t = Trie::new();
    t.insert("apple");
    println!("{}", t.starts_with("app"));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn leetcode() {
        let mut t = Trie::new();
        t.insert("apple");
        assert!(t.search("apple"));
        assert!(!t.search("app"));
        assert!(t.starts_with("app"));
        t.insert("app");
        assert!(t.search("app"));
    }
    #[test]
    fn empty() {
        let t = Trie::new();
        assert!(!t.search("a"));
        assert!(!t.starts_with("a"));
    }
    #[test]
    fn longer_than_inserted() {
        let mut t = Trie::new();
        t.insert("car");
        assert!(!t.search("cart"));
        assert!(!t.starts_with("cart"));
    }
}
```

`entry(ch).or_default()` renvoie un `&mut Node` qui remplace `node` à chaque tour : la réaffectation d'une référence mutable dans une boucle passe le borrow checker sans `unsafe`.
:::

### 4. Rate limiter à fenêtre glissante

`RateLimiter(limit, windowMs)`. `allow(clientId, timestampMs)` retourne `true` si la requête est acceptée. Un client a droit à au plus `limit` requêtes **acceptées** sur toute fenêtre glissante : une requête à `t` compte les requêtes acceptées dans `]t - windowMs, t]`. Les requêtes refusées ne consomment pas de quota. Les timestamps d'un même client arrivent dans l'ordre croissant (égalités possibles).

```
RateLimiter(3, 1000)
allow("a", 0)   -> true
allow("a", 100) -> true
allow("a", 200) -> true
allow("a", 300) -> false  (3 déjà dans ]-700, 300])
allow("a", 1000)-> true   (0 sort : ]0, 1000])
allow("b", 300) -> true   (quota par client)
```

Problème équivalent sur LeetCode : proche de Design Hit Counter (362, premium) et Logger Rate Limiter (359, premium).

<Challenge :data="rateLimiter" />

::: details Explication
Algorithme « sliding window log » : par client, une file des timestamps acceptés (du plus ancien au plus récent). À chaque appel : retirer en tête tout ce qui est `<= t - windowMs`, puis accepter seulement si la file contient moins de `limit` éléments (et alors y ajouter `t`).

Chaque timestamp est ajouté une fois et retiré au plus une fois : O(1) **amorti** par appel. Espace : O(limit) par client actif.

En TS, `splice(0, k)` sur un tableau est O(taille) ; c'est acceptable ici car la file est bornée par `limit`. Pour une vraie file O(1), garde un indice de tête ou une structure circulaire. En Rust, `VecDeque` fait le travail.

Comparaison rapide avec les autres algos (détails dans [Rate limiter](/interview/03-system-design/03-rate-limiter)) :

| Algo | Mémoire / client | Précision |
|---|---|---|
| Fenêtre fixe | 1 compteur | rafale ×2 au bord |
| Sliding log | `limit` timestamps | exacte |
| Sliding counter | 2 compteurs | approximée |
| Token bucket | 2 nombres | autorise des rafales |

```rust play
use std::collections::{HashMap, VecDeque};

struct RateLimiter {
    limit: usize,
    window_ms: u64,
    logs: HashMap<String, VecDeque<u64>>,
}

impl RateLimiter {
    fn new(limit: usize, window_ms: u64) -> Self {
        Self { limit, window_ms, logs: HashMap::new() }
    }
    fn allow(&mut self, client_id: &str, timestamp_ms: u64) -> bool {
        let log = self.logs.entry(client_id.to_string()).or_default();
        // purge ]t - w, t] ; écrit sans soustraction (u64)
        while log.front().is_some_and(|&t| t + self.window_ms <= timestamp_ms) {
            log.pop_front();
        }
        if log.len() >= self.limit {
            return false;
        }
        log.push_back(timestamp_ms);
        true
    }
}

fn main() {
    let mut rl = RateLimiter::new(3, 1000);
    println!("{}", rl.allow("a", 0));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        let mut rl = RateLimiter::new(3, 1000);
        assert!(rl.allow("a", 0));
        assert!(rl.allow("a", 100));
        assert!(rl.allow("a", 200));
        assert!(!rl.allow("a", 300));
    }
    #[test]
    fn boundary_excluded() {
        let mut rl = RateLimiter::new(1, 1000);
        assert!(rl.allow("a", 0));
        assert!(!rl.allow("a", 999));
        assert!(rl.allow("a", 1000));
    }
    #[test]
    fn per_client() {
        let mut rl = RateLimiter::new(1, 1000);
        assert!(rl.allow("a", 0));
        assert!(rl.allow("b", 0));
        assert!(!rl.allow("a", 10));
    }
    #[test]
    fn rejected_not_counted() {
        let mut rl = RateLimiter::new(2, 100);
        assert!(rl.allow("a", 0));
        assert!(rl.allow("a", 50));
        assert!(!rl.allow("a", 60));
        assert!(!rl.allow("a", 99));
        assert!(rl.allow("a", 100));
    }
}
```

Le `t + window <= now` au lieu de `t <= now - window` évite un underflow de `u64` quand `now < window` (panique en debug). `client_id.to_string()` alloue à chaque appel ; pour éviter ça, `get_mut` d'abord puis `insert` seulement si absent.
:::

### 5. Time Based Key-Value Store

`TimeMap` avec `set(key, value, timestamp)` et `get(key, timestamp)`. `get` retourne la valeur associée au plus grand timestamp `<= timestamp` pour cette clé, ou `""` s'il n'y en a pas. Pour une même clé, les `set` arrivent avec des timestamps strictement croissants.

```
set("foo", "bar", 1)
get("foo", 1)  -> "bar"
get("foo", 3)  -> "bar"
set("foo", "bar2", 4)
get("foo", 4)  -> "bar2"
get("foo", 0)  -> ""
```

Problème équivalent sur LeetCode : Time Based Key-Value Store (981).

<Challenge :data="timeMap" />

::: details Explication
Une map `clé → liste de (timestamp, valeur)`. Comme les timestamps arrivent croissants, un simple `push` garde la liste **triée** : pas besoin de la retrier. `get` fait une binary search du dernier élément `<= timestamp` (« upper bound - 1 »).

Complexité : `set` O(1) amorti, `get` O(log n) avec n = nombre de versions de la clé. Espace O(total des `set`).

C'est le principe du MVCC des bases de données et des stores versionnés : on garde l'historique, on lit « la version visible à l'instant t » (voir [Transactions & isolation](/bdd/04-transactions-isolation)).

```rust play
use std::collections::HashMap;

struct TimeMap {
    store: HashMap<String, Vec<(u64, String)>>,
}

impl TimeMap {
    fn new() -> Self {
        Self { store: HashMap::new() }
    }
    fn set(&mut self, key: &str, value: &str, timestamp: u64) {
        self.store
            .entry(key.to_string())
            .or_default()
            .push((timestamp, value.to_string()));
    }
    fn get(&self, key: &str, timestamp: u64) -> String {
        let Some(list) = self.store.get(key) else {
            return String::new();
        };
        // nb d'éléments avec ts <= timestamp
        let n = list.partition_point(|(ts, _)| *ts <= timestamp);
        if n == 0 { String::new() } else { list[n - 1].1.clone() }
    }
}

fn main() {
    let mut tm = TimeMap::new();
    tm.set("foo", "bar", 1);
    println!("{}", tm.get("foo", 3));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn leetcode() {
        let mut tm = TimeMap::new();
        tm.set("foo", "bar", 1);
        assert_eq!(tm.get("foo", 1), "bar");
        assert_eq!(tm.get("foo", 3), "bar");
        tm.set("foo", "bar2", 4);
        assert_eq!(tm.get("foo", 4), "bar2");
        assert_eq!(tm.get("foo", 5), "bar2");
    }
    #[test]
    fn missing() {
        let mut tm = TimeMap::new();
        assert_eq!(tm.get("x", 10), "");
        tm.set("k", "v", 5);
        assert_eq!(tm.get("k", 4), "");
    }
    #[test]
    fn between() {
        let mut tm = TimeMap::new();
        tm.set("k", "a", 10);
        tm.set("k", "b", 20);
        tm.set("k", "c", 30);
        assert_eq!(tm.get("k", 25), "b");
        assert_eq!(tm.get("k", 15), "a");
    }
}
```

`partition_point` est la binary search « générique » de la lib standard : elle retourne le premier indice où le prédicat devient faux. Si les timestamps pouvaient arriver dans le désordre, une `BTreeMap<u64, String>` par clé avec `range(..=t).next_back()` ferait l'affaire en O(log n).
:::

## À retenir

- Un exercice « design » = une contrainte de complexité que tu tiens en **composant** deux structures simples.
- Écris l'**invariant** de ton état avant le code ; chaque méthode le maintient, chaque mutation touche toutes les structures.
- LRU = hash map + liste doublement chaînée ; en TS la `Map` ordonnée suffit (explique pourquoi), en Rust une liste par indices dans un `Vec`.
- Rate limiter sliding log = file de timestamps par client, purge en tête, O(1) amorti ; pense à la mémoire des clients inactifs.
- Historique trié + binary search pour « la valeur à l'instant t » (`partition_point` en Rust).
- Prépare les questions de suivi : concurrence, distribution (Redis), TTL, éviction LFU.
