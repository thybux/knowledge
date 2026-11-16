# Binary search

<script setup>
import binarySearch from "./challenges/binary-search";
import searchRange from "./challenges/search-range";
import searchRotated from "./challenges/search-rotated";
import koko from "./challenges/koko-eating-bananas";
import splitArray from "./challenges/split-array-largest-sum";
</script>

<Progress :ids="['binary-search', 'search-range', 'search-rotated', 'koko-eating-bananas', 'split-array-largest-sum']" />

Ce que tu vas apprendre : écrire une binary search **sans off-by-one** grâce à un seul template (« premier indice où le prédicat devient vrai »), l'adapter aux tableaux tournés, et surtout la **binary search sur la réponse**, qui résout des problèmes qui n'ont pas l'air d'en être.

## L'idée

Sur un espace de recherche trié, on compare le milieu et on jette la moitié qui ne peut pas contenir la réponse. n → n/2 → n/4… : O(log n). Pour 10⁹ valeurs, ~30 étapes.

La version classique, intervalle **fermé** `[lo, hi]` :

```ts
function search(a: number[], target: number): number {
  let lo = 0;
  let hi = a.length - 1;
  while (lo <= hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (a[mid] === target) return mid;
    if (a[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
```

`lo + (hi - lo) / 2` plutôt que `(lo + hi) / 2` : en Rust/Java/C, la somme peut dépasser la capacité de l'entier. En JS les nombres sont des doubles, mais l'habitude est bonne.

## Le template universel : premier vrai

La plupart des variantes (« premier ≥ x », « dernier ≤ x », « plus petite vitesse qui suffit ») se ramènent à une seule question : on a un prédicat **monotone** sur `[lo, hi)`

```
faux faux faux VRAI VRAI VRAI
               ^ on veut cet indice
```

```ts
// Premier i dans [lo, hi) tel que ok(i), ou hi si aucun.
// Prérequis : ok est faux... faux, vrai... vrai.
function firstTrue(lo: number, hi: number, ok: (i: number) => boolean) {
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (ok(mid)) hi = mid; // mid est candidat : on garde [lo, mid]
    else lo = mid + 1; // mid exclu
  }
  return lo; // lo === hi
}

const a = [1, 3, 3, 3, 7];
firstTrue(0, a.length, (i) => a[i] >= 3); // 1 : lower bound
firstTrue(0, a.length, (i) => a[i] > 3); // 4 : upper bound
```

Pourquoi ça termine toujours : `mid < hi`, donc `hi = mid` réduit strictement l'intervalle, et `lo = mid + 1` aussi. Pas de boucle infinie, pas de `±1` à deviner.

En Rust, la std le fournit : `partition_point` (premier faux d'un prédicat « vrai… vrai, faux… faux »), et `binary_search` qui renvoie `Ok(i)` ou `Err(position d'insertion)`.

```rust play
fn first_true(mut lo: u64, mut hi: u64, ok: impl Fn(u64) -> bool) -> u64 {
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if ok(mid) { hi = mid } else { lo = mid + 1 }
    }
    lo
}

fn main() {
    let a = [1, 3, 3, 3, 7];
    // std : partition_point prend le prédicat "encore à gauche"
    let lower = a.partition_point(|&x| x < 3);
    let upper = a.partition_point(|&x| x <= 3);
    println!("{lower} {upper}"); // 1 4
    println!("{:?} {:?}", a.binary_search(&7), a.binary_search(&4));
    // Ok(4) Err(4) : 4 s'insérerait à l'indice 4

    // racine carrée entière : premier x tel que x*x > n, moins 1
    let n = 1_000_000_007u64;
    let r = first_true(0, n + 1, |x| x * x > n) - 1;
    println!("isqrt({n}) = {r}"); // 31622
}
```

## Binary search sur la réponse

Le vrai pouvoir du pattern. Quand l'énoncé demande « la **plus petite** valeur X telle que *quelque chose* est possible », et que :

1. si X marche, tout X' > X marche aussi (monotonie) ;
2. vérifier « X marche-t-il ? » est facile (souvent un glouton en O(n)) ;

alors on fait une binary search sur X entre une borne basse et une borne haute évidentes. Coût : O(n · log(plage)).

```ts
// Plus petite capacité de camion pour livrer tous les colis
// (dans l'ordre) en au plus `days` jours.
function shipWithinDays(weights: number[], days: number): number {
  const canShip = (cap: number) => {
    let d = 1;
    let load = 0;
    for (const w of weights) {
      if (load + w > cap) { d++; load = 0; }
      load += w;
    }
    return d <= days;
  };
  let lo = Math.max(...weights); // il faut au moins porter le plus lourd
  let hi = weights.reduce((s, w) => s + w, 0); // tout en un jour
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (canShip(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
```

Signaux : « minimiser le maximum », « maximiser le minimum », « plus petite vitesse / capacité / durée », et des valeurs jusqu'à 10⁹ (impossible de tout essayer, mais 30 essais suffisent).

## Comment le reconnaître

- Tableau **trié** (ou trié puis tourné) et O(log n) demandé.
- « Premier / dernier », « position d'insertion », « nombre d'éléments < x ».
- « Plus petit X tel que… », « minimiser le max », avec une fonction de test monotone → sur la réponse.
- Contraintes énormes sur les **valeurs** (10⁹) mais n raisonnable.
- Une fonction croissante qu'on peut évaluer mais pas inverser (racine, pic, seuil).

## Cas réel

**`git bisect`** est une binary search sur l'historique : le prédicat « le bug est présent au commit i » est faux… faux, vrai… vrai. Sur 1000 commits, 10 tests suffisent pour trouver celui qui a introduit la régression.

Même chose en prod pour **dimensionner** : « quel est le plus petit nombre de workers pour vider la file de 2 millions de jobs en moins d'une heure ? ». Si on sait simuler (ou estimer) « avec w workers, est-ce que ça passe ? », c'est une binary search sur w — exactement Koko (défi 4).

Et côté base de données : un index B-tree, c'est une recherche dichotomique généralisée sur des pages triées (voir [Index & EXPLAIN](/bdd/03-index-et-explain)). La pagination par curseur (`WHERE id > $last ORDER BY id LIMIT 50`) exploite ce tri, au lieu d'un `OFFSET` qui parcourt tout.

## Pièges classiques

- Mélanger les conventions : `while (lo <= hi)` avec `hi = mid` → boucle infinie. Choisis un template et garde-le.
- `hi = a.length - 1` sur un `usize` Rust avec un tableau vide → underflow. L'intervalle semi-ouvert `[0, len)` l'évite.
- Prédicat non monotone : la binary search renvoie n'importe quoi sans erreur.
- Bornes de la réponse trop serrées (oublier que `max(piles)` est toujours une réponse valide) ou trop larges sans besoin.
- Overflow dans la fonction de test (somme d'heures, `mid * mid`) : en Rust, passe en `u64`/`i64`.
- `Math.floor((lo + hi) / 2)` sur des négatifs : OK en JS, mais `(lo + hi) >> 1` casse au-delà de 2³¹.

## Défis

### 1. Binary Search

`nums` est trié, sans doublon. Retourne l'indice de `target`, ou `-1`. En O(log n).

- `nums = [-1, 0, 3, 5, 9, 12], target = 9` → `4`
- `nums = [-1, 0, 3, 5, 9, 12], target = 2` → `-1`

Problème équivalent sur LeetCode : Binary Search.

<Challenge :data="binarySearch" />

::: details Explication
Template intervalle fermé en TS, semi-ouvert en Rust (les `usize` ne peuvent pas passer sous 0, `hi = mid - 1` avec `mid = 0` paniquerait). Temps O(log n), espace O(1). En Rust idiomatique : `nums.binary_search(&target).ok()`.

```rust
fn search(nums: &[i32], target: i32) -> Option<usize> {
    // intervalle semi-ouvert [lo, hi) : pas de underflow sur usize
    let (mut lo, mut hi) = (0, nums.len());
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if nums[mid] == target {
            return Some(mid);
        } else if nums[mid] < target {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    None
}
```
:::

### 2. First and Last Position

`nums` est trié **avec doublons possibles**. Retourne `[premier, dernier]` indice de `target`, ou `[-1, -1]`. En O(log n), même si tout le tableau vaut `target`.

- `nums = [5, 7, 7, 8, 8, 10], target = 8` → `[3, 4]`
- `nums = [5, 7, 7, 8, 8, 10], target = 6` → `[-1, -1]`

Problème équivalent sur LeetCode : Find First and Last Position of Element in Sorted Array.

<Challenge :data="searchRange" />

::: details Explication
Deux « premier vrai » : `a = premier i avec nums[i] ≥ target`, puis `b = premier i avec nums[i] > target`. Si `a` est hors du tableau ou `nums[a] ≠ target`, absent. Sinon la réponse est `[a, b - 1]`. En TS, `lowerBound(target + 1)` donne `b` car les valeurs sont entières.

Le piège : trouver une occurrence puis « s'étendre » à gauche et à droite → O(n) si tout est égal. Temps O(log n), espace O(1).

```rust
// premier indice i tel que pred(nums[i]) est vrai
// (pred doit être faux... faux, vrai... vrai)
fn first_true(nums: &[i32], pred: impl Fn(i32) -> bool) -> usize {
    let (mut lo, mut hi) = (0, nums.len());
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if pred(nums[mid]) { hi = mid } else { lo = mid + 1 }
    }
    lo
}

fn search_range(nums: &[i32], target: i32) -> Option<(usize, usize)> {
    let a = first_true(nums, |x| x >= target);
    if a == nums.len() || nums[a] != target {
        return None;
    }
    let b = first_true(nums, |x| x > target);
    Some((a, b - 1))
}
```
:::

### 3. Search in Rotated Sorted Array

Un tableau trié sans doublon a été tourné : `[0, 1, 2, 4, 5, 6, 7]` → `[4, 5, 6, 7, 0, 1, 2]`. Retourne l'indice de `target` ou `-1`, en O(log n).

- `nums = [4, 5, 6, 7, 0, 1, 2], target = 0` → `4`
- `nums = [4, 5, 6, 7, 0, 1, 2], target = 3` → `-1`

Problème équivalent sur LeetCode : Search in Rotated Sorted Array.

<Challenge :data="searchRotated" />

::: details Explication
À chaque étape, **au moins une moitié est triée**. Si `nums[lo] ≤ nums[mid]`, c'est la gauche : `target` y est ssi `nums[lo] ≤ target < nums[mid]`, sinon on va à droite. Sinon, c'est la droite qui est triée : `target` y est ssi `nums[mid] < target ≤ nums[hi]`.

Temps O(log n), espace O(1). Avec des doublons (`[1, 1, 1, 0, 1]`), on ne sait plus quelle moitié est triée quand `nums[lo] = nums[mid]` : le pire cas devient O(n).

```rust
fn search_rotated(nums: &[i32], target: i32) -> Option<usize> {
    let (mut lo, mut hi) = (0, nums.len());
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if nums[mid] == target {
            return Some(mid);
        }
        if nums[lo] <= nums[mid] {
            // moitié gauche [lo, mid] triée
            if nums[lo] <= target && target < nums[mid] {
                hi = mid;
            } else {
                lo = mid + 1;
            }
        } else {
            // moitié droite [mid, hi) triée
            if nums[mid] < target && target <= nums[hi - 1] {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
    }
    None
}
```
:::

### 4. Koko Eating Bananas

Koko a des piles de bananes et `h` heures. À la vitesse `k`, chaque heure elle mange `k` bananes d'**une** pile (si la pile en a moins, elle finit la pile et attend l'heure suivante). Une pile `p` prend donc `ceil(p / k)` heures. Trouve le plus petit `k` entier qui lui permet de tout manger en `h` heures.

- `piles = [3, 6, 7, 11], h = 8` → `4`
- `piles = [30, 11, 23, 4, 20], h = 5` → `30`

Problème équivalent sur LeetCode : Koko Eating Bananas.

<Challenge :data="koko" />

::: details Explication
Binary search sur la réponse. `hours(k) = Σ ceil(p / k)` décroît quand `k` augmente : le prédicat `hours(k) ≤ h` est faux… faux, vrai… vrai. Bornes : `k = 1` (le minimum) et `k = max(piles)` (une heure par pile, qui marche toujours puisque `h ≥ nombre de piles`).

Temps O(n · log(max)), espace O(1). Avec `max = 10⁹`, c'est 30 passes sur les piles. En Rust, `u64::div_ceil` évite le classique `(p + k - 1) / k`.

```rust
fn hours(piles: &[u64], k: u64) -> u64 {
    piles.iter().map(|&p| p.div_ceil(k)).sum()
}

fn min_eating_speed(piles: &[u64], h: u64) -> u64 {
    // réponse dans [1, max] ; hours(k) <= h est monotone en k
    let (mut lo, mut hi) = (1, *piles.iter().max().unwrap());
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if hours(piles, mid) <= h {
            hi = mid; // mid marche : on cherche plus petit
        } else {
            lo = mid + 1;
        }
    }
    lo
}
```
:::

### 5. Split Array Largest Sum

Découpe `nums` (entiers ≥ 0) en `k` sous-tableaux **contigus** non vides, de façon à minimiser la plus grande des `k` sommes. Retourne cette valeur.

- `nums = [7, 2, 5, 10, 8], k = 2` → `18` (`[7, 2, 5]` et `[10, 8]`)
- `nums = [1, 2, 3, 4, 5], k = 2` → `9` (`[1, 2, 3]` et `[4, 5]`)

Problème équivalent sur LeetCode : Split Array Largest Sum.

<Challenge :data="splitArray" />

::: details Explication
« Minimiser le maximum » → binary search sur la réponse `cap`. Test : peut-on découper en au plus `k` morceaux de somme ≤ `cap` ? Glouton : on remplit le morceau courant tant que ça tient, sinon on en ouvre un nouveau. Au plus `k` morceaux → `cap` suffit (avoir moins de morceaux n'est pas gênant : on peut toujours en couper un en deux sans augmenter le max). Monotone : si `cap` marche, `cap + 1` aussi.

Bornes : `max(nums)` (un morceau contient au moins le plus grand élément) et `sum(nums)` (un seul morceau). Temps O(n · log(sum)), espace O(1). La DP alternative est O(k · n²).

```rust
// Peut-on découper en <= k morceaux de somme <= cap ? (glouton)
fn fits(nums: &[i64], k: usize, cap: i64) -> bool {
    let (mut parts, mut cur) = (1, 0);
    for &x in nums {
        if cur + x > cap {
            parts += 1;
            cur = 0;
        }
        cur += x;
    }
    parts <= k
}

fn split_array(nums: &[i64], k: usize) -> i64 {
    let mut lo = *nums.iter().max().unwrap();
    let mut hi: i64 = nums.iter().sum();
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if fits(nums, k, mid) { hi = mid } else { lo = mid + 1 }
    }
    lo
}
```
:::

## À retenir

- Un seul template : « premier indice où un prédicat monotone devient vrai », intervalle `[lo, hi)`, `hi = mid` / `lo = mid + 1`.
- Lower bound / upper bound = deux appels de ce template ; jamais d'« extension » linéaire.
- Tableau tourné : une des deux moitiés est toujours triée.
- « Plus petit X tel que c'est possible » + test monotone → binary search **sur la réponse**, O(n log plage).
- Rust : `binary_search`, `partition_point`, et intervalles semi-ouverts pour éviter l'underflow de `usize`.
