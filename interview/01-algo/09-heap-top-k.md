<script setup>
import lastStoneWeight from "./challenges/last-stone-weight";
import kthLargestElement from "./challenges/kth-largest-element";
import topKFrequent from "./challenges/top-k-frequent";
import kthLargestStream from "./challenges/kth-largest-stream";
import mergeKSorted from "./challenges/merge-k-sorted";
import medianDataStream from "./challenges/median-data-stream";
</script>

# Heap & top-K

Ce que tu vas apprendre : comment marche un heap, en écrire un en TypeScript (il n'y en a pas de natif), utiliser `BinaryHeap` en Rust, et reconnaître les 4 patterns qui en dépendent : top-K, fusion de K flux, deux heaps, ordonnancement.

<Progress :ids="['last-stone-weight', 'kth-largest-element', 'top-k-frequent', 'kth-largest-stream', 'merge-k-sorted', 'median-data-stream']" />

## Le heap en une image

Un **heap binaire** (tas) est un arbre binaire **complet** où chaque parent est ≤ ses enfants (min-heap) ou ≥ (max-heap). Conséquence : la racine est toujours le minimum (ou le maximum). Le reste n'est **pas** trié.

Il est stocké dans un simple tableau, sans pointeurs :

```
        1               index :  0  1  2  3  4  5
      /   \             valeur : 1  3  2  7  4  5
     3     2
    / \   /             parent(i) = (i - 1) >> 1
   7   4 5              enfants(i) = 2i + 1, 2i + 2
```

| Opération | Coût |
|---|---|
| `peek` (min/max) | O(1) |
| `push` | O(log n) |
| `pop` (retire la racine) | O(log n) |
| Construire depuis n valeurs | O(n) (heapify) |
| Chercher une valeur quelconque | O(n) |

Un heap n'est utile que si tu as besoin, **de façon répétée**, du plus petit (ou plus grand) élément d'un ensemble qui **change**. Si l'ensemble est fixe, un tri suffit.

## Une MinHeap en TypeScript

JavaScript n'a pas de file de priorité dans sa bibliothèque standard. En entretien, tu as trois options : demander si tu peux supposer qu'elle existe (souvent oui), utiliser un tri si n est petit, ou en écrire une en 3 minutes. Voici une version minimaliste, à savoir réécrire de tête :

```ts
class MinHeap<T> {
  private a: T[] = [];
  // less(x, y) = true si x doit sortir avant y
  constructor(private less: (x: T, y: T) => boolean) {}
  get size() { return this.a.length; }
  peek(): T | undefined { return this.a[0]; }

  push(v: T) {
    const a = this.a;
    a.push(v);                       // ajoute en bas…
    let i = a.length - 1;
    while (i > 0) {                  // …puis remonte (sift up)
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
```

```ts
  pop(): T | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0], last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;                   // le dernier prend la racine…
      let i = 0;
      for (;;) {                     // …puis redescend (sift down)
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
```

Le comparateur rend la classe universelle :

```ts
const minNums = new MinHeap<number>((a, b) => a < b);
const maxNums = new MinHeap<number>((a, b) => a > b); // max-heap
// tâches : priorité la plus haute d'abord, puis la plus ancienne
type Task = { prio: number; createdAt: number };
const tasks = new MinHeap<Task>((x, y) =>
  x.prio !== y.prio ? x.prio > y.prio : x.createdAt < y.createdAt,
);
```

Tous les défis de cette page qui en ont besoin te fournissent cette classe dans le starter.

## `BinaryHeap` en Rust

`std::collections::BinaryHeap` est un **max**-heap. Pour un min-heap, enveloppe les valeurs dans `std::cmp::Reverse`. Les tuples se comparent lexicographiquement : `(priorité, id)` trie par priorité puis par id.

```rust play
use std::cmp::Reverse;
use std::collections::BinaryHeap;

fn main() {
    let mut max = BinaryHeap::from([3, 1, 4, 1, 5]);
    assert_eq!(max.pop(), Some(5));
    assert_eq!(max.peek(), Some(&4));

    let mut min = BinaryHeap::new();
    for x in [3, 1, 4] { min.push(Reverse(x)); }
    let Reverse(smallest) = min.pop().unwrap();
    assert_eq!(smallest, 1);

    // (distance, nœud) : le plus proche d'abord
    let mut pq = BinaryHeap::from([Reverse((7u32, 'b')), Reverse((2, 'a'))]);
    println!("{:?}", pq.pop()); // Some(Reverse((2, 'a')))

    // tri des k plus petits : into_sorted_vec trie croissant
    println!("{:?}", max.into_sorted_vec()); // [1, 1, 3, 4]
}
```

Pour un type à toi, implémente `Ord` (et `PartialOrd`, `Eq`, `PartialEq`). Attention : **`f64` n'implémente pas `Ord`** (à cause de `NaN`), donc `BinaryHeap<f64>` ne compile pas. Utilise des entiers (centimes, millisecondes), `f64::total_cmp` dans un `Ord` manuel, ou un wrapper comme `ordered_float`.

```rust play
use std::cmp::Ordering;
use std::collections::BinaryHeap;

#[derive(Debug, PartialEq, Eq)]
struct Job { prio: u8, id: u64 }

impl Ord for Job {
    fn cmp(&self, o: &Self) -> Ordering {
        // prio haute d'abord, puis id le plus petit (le plus ancien)
        self.prio.cmp(&o.prio).then_with(|| o.id.cmp(&self.id))
    }
}
impl PartialOrd for Job {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

fn main() {
    let mut q = BinaryHeap::new();
    q.push(Job { prio: 1, id: 1 });
    q.push(Job { prio: 5, id: 3 });
    q.push(Job { prio: 5, id: 2 });
    while let Some(j) = q.pop() { println!("{j:?}"); } // 5/2, 5/3, 1/1
}
```

## Pattern 1 : top-K avec un heap de taille K

Pour les **K plus grands** éléments, garde un **min**-heap de taille K. Contre-intuitif mais logique : la racine est le plus petit des K meilleurs, donc le premier à éjecter quand un meilleur arrive.

```ts
function topK(nums: number[], k: number): number[] {
  const h = new MinHeap<number>((a, b) => a < b);
  for (const x of nums) {
    h.push(x);
    if (h.size > k) h.pop(); // éjecte le plus petit
  }
  const out: number[] = [];
  while (h.size) out.push(h.pop()!);
  return out; // croissant
}
```

Coût : **O(n log k)** temps, **O(k)** mémoire. Comparé au tri (O(n log n), O(n)), c'est surtout la mémoire qui compte : ça marche sur un **flux** que tu ne peux pas garder en entier.

| Approche | Temps | Quand |
|---|---|---|
| Trier | O(n log n) | n petit, simplicité |
| Heap de taille k | O(n log k) | Flux, k ≪ n |
| Quickselect | O(n) moyen, O(n²) pire | Tableau en mémoire, un seul k |
| Bucket sort (fréquences) | O(n) | Valeurs bornées |

## Pattern 2 : fusionner K flux triés

Tu as K sources déjà triées et tu veux une sortie triée. Mets **la tête de chaque source** dans un min-heap ; à chaque `pop`, pousse l'élément suivant de la même source. Le heap ne contient jamais plus de K éléments → **O(N log K)**.

C'est l'étape « merge » d'un tri externe, et ce que fait une base de données pour fusionner des fichiers SSTable (LSM-tree).

## Pattern 3 : deux heaps

Pour une **médiane** (ou n'importe quel percentile) sur un flux : un max-heap pour la moitié basse, un min-heap pour la moitié haute, équilibrés à ±1. La médiane se lit sur les racines en O(1), l'insertion coûte O(log n).

## Pattern 4 : ordonnancement

« Quelle est la prochaine chose à faire ? » quand les candidats changent : prochaine réunion qui se termine (salles de réunion, voir [Intervalles & greedy](/interview/01-algo/12-intervalles-greedy)), prochain nœud le plus proche ([Dijkstra](/interview/01-algo/08-graphes)), tâche la plus prioritaire, timer qui expire en premier.

## Comment le reconnaître

| Signal dans l'énoncé | Pattern |
|---|---|
| « les K plus grands / petits / fréquents / proches » | Heap de taille K |
| « K-ième plus grand » | Heap de taille K ou quickselect |
| « fusionner K listes / fichiers triés » | K-way merge |
| « médiane », « percentile » sur un flux | Deux heaps |
| « à chaque étape, prends le plus… » | Heap (souvent greedy) |
| « flux », « en temps réel », « `add` puis requête » | Heap dans une classe |
| Plus court chemin pondéré | Heap dans Dijkstra |

Contre-signal : si on te demande le min ou le max **une seule fois**, une boucle O(n) suffit. Si tu as besoin de **supprimer un élément arbitraire** ou de l'ordre complet, pense plutôt à un arbre trié (`BTreeMap` en Rust).

## Cas réel

**Worker de jobs avec priorités et délais.** Ton SaaS envoie des e-mails : les « reset password » doivent partir avant les newsletters, et les relances de paiement sont programmées « dans 3 jours ».

- File **prête** : un heap ordonné par `(priorité desc, createdAt asc)`. Le worker fait `pop` en boucle. Le `createdAt` en second critère évite la **famine** : à priorité égale, FIFO.
- File **différée** : un min-heap sur `runAt`. Une boucle regarde `peek()` : si `runAt <= now`, elle déplace le job vers la file prête ; sinon elle dort jusqu'à `runAt`. C'est exactement la structure qu'utilisent les timers de libuv (et donc `setTimeout` dans Node) : un min-heap de dates d'expiration.

En prod, la persistance est déléguée (Postgres avec `ORDER BY priority DESC, created_at LIMIT 1 FOR UPDATE SKIP LOCKED`, Redis sorted sets pour BullMQ), mais le raisonnement est le même — et c'est la question de suivi typique en entretien : « et si ça ne tient plus en mémoire ? ».

Autres usages : **top 10 des marchands** par volume dans un flux de paiements (heap de taille 10 sur des compteurs), **fusion des logs** de 50 pods déjà triés par timestamp (K-way merge), **p50/p99 de latence** d'un endpoint (deux heaps, ou un sketch approximatif comme t-digest quand le volume est énorme).

## Pièges classiques

- **Max-heap au lieu de min-heap** pour les K plus grands : tu gardes tout et tu perds l'avantage O(k) en mémoire.
- **Oublier que Rust a un max-heap** : `BinaryHeap<i32>` sort le plus grand. `Reverse` pour l'inverse.
- **`BinaryHeap<f64>`** : ne compile pas.
- **Itérer sur un heap** (`for x of heap.a` ou `heap.iter()`) en croyant que c'est trié : non, seule la racine est garantie.
- **`Array.sort()` sans comparateur** en JS : tri lexicographique (`[10, 9, 1].sort()` donne `[1, 10, 9]`). Toujours `(a, b) => a - b`.
- **Comparateur à égalité ambiguë** : pour des tâches, ajoute un critère de départage (id, date), sinon l'ordre est imprévisible.
- **Dire que construire un heap coûte O(n log n)** : avec heapify (sift down depuis le milieu), c'est O(n). `BinaryHeap::from(vec)` le fait.

## Défis

### 1. Poids de la dernière pierre

Tu as des pierres de poids `stones[i]`. À chaque tour, prends les **deux plus lourdes** `x ≤ y` et écrase-les : si `x === y` les deux disparaissent, sinon il reste une pierre de poids `y - x`. Retourne le poids de la dernière pierre, ou `0` s'il n'en reste aucune.

```
[2, 7, 4, 1, 8, 1]
8 et 7 → 1   : [2, 4, 1, 1, 1]
4 et 2 → 2   : [2, 1, 1, 1]
2 et 1 → 1   : [1, 1, 1]
1 et 1 → 0   : [1]               → 1
```

Problème équivalent sur LeetCode : Last Stone Weight.

<Challenge :data="lastStoneWeight" />

::: details Explication
« À chaque tour, prends les plus grands » sur un ensemble qui change = **max-heap**. Chaque tour fait 2 `pop` et au plus 1 `push`, et retire au moins une pierre.

**Complexité** : O(n log n) temps, O(n) mémoire. Retrier le tableau à chaque tour serait O(n² log n).

```rust play
use std::collections::BinaryHeap;

fn last_stone_weight(stones: &[u32]) -> u32 {
    let mut h = BinaryHeap::from(stones.to_vec()); // heapify O(n)
    while h.len() > 1 {
        let y = h.pop().unwrap();
        let x = h.pop().unwrap();
        if y != x { h.push(y - x); }
    }
    h.pop().unwrap_or(0)
}

fn main() {
    println!("{}", last_stone_weight(&[2, 7, 4, 1, 8, 1]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() { assert_eq!(last_stone_weight(&[2, 7, 4, 1, 8, 1]), 1); }
    #[test]
    fn empty() { assert_eq!(last_stone_weight(&[]), 0); }
    #[test]
    fn equal() { assert_eq!(last_stone_weight(&[3, 3]), 0); }
    #[test]
    fn heavy() { assert_eq!(last_stone_weight(&[1000, 1, 1, 1]), 997); }
}
```
:::

### 2. K-ième plus grand élément

Retourne le `k`-ième plus grand élément de `nums` **dans l'ordre trié** (les doublons comptent : dans `[3, 3, 2]`, le 2e plus grand est `3`). Essaie de faire mieux que trier.

```
[3, 2, 1, 5, 6, 4], k = 2           → 5
[3, 2, 3, 1, 2, 4, 5, 5, 6], k = 4  → 4
```

Problème équivalent sur LeetCode : Kth Largest Element in an Array.

<Challenge :data="kthLargestElement" />

::: details Explication
Min-heap de taille `k` : après avoir vu tout le tableau, il contient les `k` plus grands et sa racine est le plus petit d'entre eux, donc le `k`-ième plus grand.

**Complexité** : O(n log k) temps, O(k) mémoire.

À mentionner en entretien : **quickselect** (partition à la quicksort, on ne descend que d'un côté) est O(n) en moyenne mais O(n²) au pire, à moins de choisir le pivot au hasard. C'est ce que fait `select_nth_unstable` en Rust (avec une garantie O(n) au pire depuis Rust 1.77) :

```rust
let mut v = nums.to_vec();
let idx = v.len() - k;
*v.select_nth_unstable(idx).1
```

```rust play
use std::cmp::Reverse;
use std::collections::BinaryHeap;

fn find_kth_largest(nums: &[i32], k: usize) -> i32 {
    let mut h = BinaryHeap::with_capacity(k + 1);
    for &x in nums {
        h.push(Reverse(x));
        if h.len() > k { h.pop(); }
    }
    h.peek().unwrap().0
}

fn main() {
    println!("{}", find_kth_largest(&[3, 2, 1, 5, 6, 4], 2));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() { assert_eq!(find_kth_largest(&[3, 2, 1, 5, 6, 4], 2), 5); }
    #[test]
    fn dups() {
        assert_eq!(find_kth_largest(&[3, 2, 3, 1, 2, 4, 5, 5, 6], 4), 4);
    }
    #[test]
    fn single() { assert_eq!(find_kth_largest(&[1], 1), 1); }
    #[test]
    fn negatives() { assert_eq!(find_kth_largest(&[-1, -5, -3], 2), -3); }
}
```
:::

### 3. Les K éléments les plus fréquents

Retourne les `k` valeurs qui apparaissent le plus souvent dans `nums`, dans n'importe quel ordre. L'énoncé garantit que la réponse est unique (pas d'égalité à la frontière du top-K).

```
[1, 1, 1, 2, 2, 3], k = 2  → [1, 2]
[1], k = 1                 → [1]
```

Problème équivalent sur LeetCode : Top K Frequent Elements.

<Challenge :data="topKFrequent" />

::: details Explication
Deux étapes : compter avec une `Map` (O(n)), puis top-K sur les **paires (valeur, fréquence)** avec un min-heap de taille k ordonné par fréquence. Total **O(n + d log k)** avec d valeurs distinctes.

La solution **O(n)** à connaître : le **bucket sort**. Une fréquence est comprise entre 1 et n, donc crée `buckets[f]` = liste des valeurs de fréquence f, puis parcours les buckets de n vers 1 jusqu'à avoir k valeurs.

```rust play
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};

fn top_k_frequent(nums: &[i32], k: usize) -> Vec<i32> {
    let mut freq: HashMap<i32, usize> = HashMap::new();
    for &x in nums { *freq.entry(x).or_default() += 1; }
    // Reverse((fréquence, valeur)) : la moins fréquente en racine
    let mut h = BinaryHeap::new();
    for (v, f) in freq {
        h.push(Reverse((f, v)));
        if h.len() > k { h.pop(); }
    }
    h.into_iter().map(|Reverse((_, v))| v).collect()
}

fn main() {
    println!("{:?}", top_k_frequent(&[1, 1, 1, 2, 2, 3], 2));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sorted(mut v: Vec<i32>) -> Vec<i32> { v.sort(); v }
    #[test]
    fn basic() {
        assert_eq!(sorted(top_k_frequent(&[1, 1, 1, 2, 2, 3], 2)), [1, 2]);
    }
    #[test]
    fn single() { assert_eq!(top_k_frequent(&[1], 1), [1]); }
    #[test]
    fn negatives() { assert_eq!(top_k_frequent(&[-1, -1, 2], 1), [-1]); }
}
```
:::

### 4. K-ième plus grand d'un flux

Conçois une classe `KthLargest(k, nums)` : `nums` est l'état initial, puis `add(val)` ajoute une valeur et **retourne le k-ième plus grand** de toutes les valeurs vues jusqu'ici.

```
KthLargest(3, [4, 5, 8, 2])
add(3)  → 4    (valeurs : 2 3 4 5 8)
add(5)  → 5
add(10) → 5
add(9)  → 8
add(4)  → 8
```

Problème équivalent sur LeetCode : Kth Largest Element in a Stream.

<Challenge :data="kthLargestStream" />

::: details Explication
Même idée que le défi 2, mais le heap de taille k **vit dans l'objet**. Chaque `add` fait un `push`, éventuellement un `pop`, puis lit la racine.

Le constructeur réutilise `add` : moins de code, moins de bugs. Attention au cas « moins de k valeurs au départ » : le heap n'est simplement pas encore plein.

**Complexité** : O(log k) par `add`, O(k) mémoire. C'est l'archétype du « top-K sur un flux » : on ne stocke jamais tout le flux.

```rust play
use std::cmp::Reverse;
use std::collections::BinaryHeap;

struct KthLargest {
    k: usize,
    heap: BinaryHeap<Reverse<i32>>,
}

impl KthLargest {
    fn new(k: usize, nums: &[i32]) -> Self {
        let mut s = KthLargest { k, heap: BinaryHeap::new() };
        for &x in nums { s.add(x); }
        s
    }
    fn add(&mut self, val: i32) -> i32 {
        self.heap.push(Reverse(val));
        if self.heap.len() > self.k { self.heap.pop(); }
        self.heap.peek().map_or(i32::MIN, |r| r.0)
    }
}

fn main() {
    let mut s = KthLargest::new(3, &[4, 5, 8, 2]);
    println!("{}", s.add(3));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn leetcode_example() {
        let mut s = KthLargest::new(3, &[4, 5, 8, 2]);
        let got: Vec<i32> = [3, 5, 10, 9, 4].iter().map(|&v| s.add(v)).collect();
        assert_eq!(got, [4, 5, 5, 8, 8]);
    }
    #[test]
    fn starts_empty() {
        let mut s = KthLargest::new(1, &[]);
        assert_eq!(s.add(-3), -3);
        assert_eq!(s.add(-2), -2);
    }
}
```
:::

### 5. Fusionner K listes triées

On te donne `k` tableaux triés par ordre croissant. Retourne un seul tableau trié contenant tous leurs éléments. (Sur LeetCode ce sont des listes chaînées ; ici des tableaux pour se concentrer sur l'algo.)

```
[[1, 4, 5], [1, 3, 4], [2, 6]]  → [1, 1, 2, 3, 4, 4, 5, 6]
[]                              → []
```

Problème équivalent sur LeetCode : Merge k Sorted Lists.

<Challenge :data="mergeKSorted" />

::: details Explication
Pousse la tête de chaque liste non vide dans un min-heap, sous la forme `[valeur, indice de liste, indice dans la liste]`. À chaque `pop`, émets la valeur et pousse l'élément suivant de la **même** liste. Le heap contient au plus k éléments.

**Complexité** : O(N log k) temps (N = total d'éléments), O(k) mémoire en plus de la sortie.

Alternatives à citer : concaténer puis trier, O(N log N) ; fusionner les listes **deux par deux** comme dans un merge sort (diviser pour régner), O(N log k) aussi, sans heap. Fusionner une par une dans un accumulateur est le piège : O(N·k).

```rust play
use std::cmp::Reverse;
use std::collections::BinaryHeap;

fn merge_k_sorted(lists: &[Vec<i32>]) -> Vec<i32> {
    let mut h = BinaryHeap::new();
    for (i, l) in lists.iter().enumerate() {
        if let Some(&v) = l.first() { h.push(Reverse((v, i, 0))); }
    }
    let total = lists.iter().map(Vec::len).sum();
    let mut out = Vec::with_capacity(total);
    while let Some(Reverse((v, i, j))) = h.pop() {
        out.push(v);
        if let Some(&next) = lists[i].get(j + 1) {
            h.push(Reverse((next, i, j + 1)));
        }
    }
    out
}

fn main() {
    let l = vec![vec![1, 4, 5], vec![1, 3, 4], vec![2, 6]];
    println!("{:?}", merge_k_sorted(&l));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        let l = vec![vec![1, 4, 5], vec![1, 3, 4], vec![2, 6]];
        assert_eq!(merge_k_sorted(&l), [1, 1, 2, 3, 4, 4, 5, 6]);
    }
    #[test]
    fn empty() {
        assert!(merge_k_sorted(&[]).is_empty());
        assert!(merge_k_sorted(&[vec![]]).is_empty());
    }
    #[test]
    fn negatives() {
        let l = vec![vec![-3, 0], vec![-5, 10], vec![-4]];
        assert_eq!(merge_k_sorted(&l), [-5, -4, -3, 0, 10]);
    }
}
```
:::

### 6. Médiane d'un flux

Conçois `MedianFinder` avec `addNum(num)` et `findMedian()`. La médiane d'un nombre impair de valeurs est celle du milieu une fois triées ; pour un nombre pair, c'est la moyenne des deux du milieu.

```
addNum(1), addNum(2)  → findMedian() = 1.5
addNum(3)             → findMedian() = 2
```

Problème équivalent sur LeetCode : Find Median from Data Stream.

<Challenge :data="medianDataStream" />

::: details Explication
Coupe les valeurs en deux moitiés :

- `low` : **max**-heap de la moitié basse (sa racine = le plus grand des petits) ;
- `high` : **min**-heap de la moitié haute (sa racine = le plus petit des grands).

Invariants : tout élément de `low` ≤ tout élément de `high`, et `low.size` vaut `high.size` ou `high.size + 1`.

Pour insérer sans réfléchir aux cas : pousse dans `low`, transfère la racine de `low` vers `high` (ça garantit l'ordre), puis si `high` est devenu plus gros, rends sa racine à `low` (ça garantit la taille). La médiane est la racine de `low` (impair) ou la moyenne des deux racines (pair).

**Complexité** : O(log n) par `addNum`, O(1) par `findMedian`, O(n) mémoire.

Suivi classique : « et si toutes les valeurs sont entre 0 et 100 ? » → un tableau de 101 compteurs, médiane en O(100). « Et sur des milliards de valeurs ? » → structures approximatives (t-digest), comme dans les outils de monitoring.

```rust play
use std::cmp::Reverse;
use std::collections::BinaryHeap;

#[derive(Default)]
struct MedianFinder {
    low: BinaryHeap<i32>,           // max-heap
    high: BinaryHeap<Reverse<i32>>, // min-heap
}

impl MedianFinder {
    fn add_num(&mut self, num: i32) {
        self.low.push(num);
        let top = self.low.pop().unwrap();
        self.high.push(Reverse(top));
        if self.high.len() > self.low.len() {
            let Reverse(v) = self.high.pop().unwrap();
            self.low.push(v);
        }
    }
    fn find_median(&self) -> f64 {
        let lo = *self.low.peek().unwrap() as f64;
        if self.low.len() > self.high.len() { return lo; }
        let hi = self.high.peek().unwrap().0 as f64;
        (lo + hi) / 2.0
    }
}

fn main() {
    let mut m = MedianFinder::default();
    m.add_num(1);
    m.add_num(2);
    println!("{}", m.find_median());
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn example() {
        let mut m = MedianFinder::default();
        m.add_num(1);
        m.add_num(2);
        assert_eq!(m.find_median(), 1.5);
        m.add_num(3);
        assert_eq!(m.find_median(), 2.0);
    }
    #[test]
    fn decreasing() {
        let mut m = MedianFinder::default();
        for x in [3, 2, 1] { m.add_num(x); }
        assert_eq!(m.find_median(), 2.0);
    }
}
```
:::

## À retenir

- Un heap donne le min (ou max) en O(1) et insère/retire en O(log n) ; le reste n'est **pas** trié.
- En TS, pas de heap natif : sache réécrire une `MinHeap` avec comparateur (sift up / sift down) en 3 minutes.
- En Rust, `BinaryHeap` est un **max**-heap ; `Reverse` pour un min-heap, tuples pour les priorités composées, pas de `f64`.
- **K plus grands → min-heap de taille K** : O(n log k), O(k) mémoire, marche sur un flux.
- **K flux triés → heap des têtes**, O(N log k). **Médiane → deux heaps** équilibrés.
- Cite les alternatives : tri, quickselect (O(n) moyen), bucket sort quand les valeurs sont bornées.
