# Two pointers & sliding window

<script setup>
import validPalindrome from "./challenges/valid-palindrome";
import containerWithMostWater from "./challenges/container-with-most-water";
import threeSum from "./challenges/three-sum";
import longestSubstring from "./challenges/longest-substring-no-repeat";
import minWindow from "./challenges/min-window-substring";
</script>

<Progress :ids="['valid-palindrome', 'container-with-most-water', 'three-sum', 'longest-substring-no-repeat', 'min-window-substring']" />

Ce que tu vas apprendre : les deux variantes des two pointers (qui se rapprochent, ou lent/rapide), la sliding window de taille fixe et variable, et l'argument d'amortissement qui prouve que c'est O(n).

## Two pointers qui se rapprochent

Deux indices, `i` au début et `j` à la fin. À chaque tour, on **élimine** au moins une possibilité en déplaçant l'un des deux. Ça marche quand une propriété (souvent le **tri**) dit lequel bouger.

Exemple : dans un tableau trié, trouver deux nombres de somme `target`. Si `a[i] + a[j]` est trop petit, aucun `j' < j` n'aidera avec ce `i` : on avance `i`. Trop grand : on recule `j`.

```ts
// Template : pointeurs aux extrémités (tableau trié)
function pairWithSum(a: number[], target: number): number[] {
  let i = 0;
  let j = a.length - 1;
  while (i < j) {
    const s = a[i] + a[j];
    if (s === target) return [i, j];
    if (s < target) i++; // il faut plus grand
    else j--; // il faut plus petit
  }
  return [];
}
```

Chaque tour rapproche `i` et `j` d'un cran : au plus n tours, O(n) temps, O(1) espace.

## Two pointers lent / rapide

Les deux partent du même côté. `fast` lit, `slow` écrit. Typique des opérations **en place** : dédoublonner un tableau trié, retirer des valeurs, compacter.

```ts
// Retire les doublons d'un tableau trié, en place.
// Retourne la nouvelle longueur.
function dedupSorted(a: number[]): number {
  let slow = 0; // a[0..slow) = partie déjà propre
  for (let fast = 0; fast < a.length; fast++) {
    if (fast === 0 || a[fast] !== a[fast - 1]) a[slow++] = a[fast];
  }
  return slow;
}
```

En Rust, c'est ce que fait `Vec::dedup` (et `retain` pour un filtre en place) :

```rust play
fn dedup_sorted(a: &mut Vec<i32>) -> usize {
    let mut slow = 0;
    for fast in 0..a.len() {
        if fast == 0 || a[fast] != a[fast - 1] {
            a[slow] = a[fast];
            slow += 1;
        }
    }
    a.truncate(slow);
    slow
}

fn main() {
    let mut v = vec![1, 1, 2, 3, 3, 3, 4];
    dedup_sorted(&mut v);
    println!("{v:?}"); // [1, 2, 3, 4]

    let mut w = vec![1, 1, 2, 3, 3];
    w.dedup(); // la version de la std
    w.retain(|&x| x != 2); // filtre en place
    println!("{w:?}"); // [1, 3]
}
```

## Sliding window

Pour les problèmes de **sous-tableau / sous-chaîne contigu(e)**. La fenêtre `[left, right]` glisse : `right` avance à chaque tour, `left` avance quand la fenêtre devient invalide.

**Taille fixe k** : on ajoute l'élément qui entre, on retire celui qui sort.

```ts
function maxSumOfK(a: number[], k: number): number {
  let sum = 0;
  let best = -Infinity;
  for (let i = 0; i < a.length; i++) {
    sum += a[i]; // entre
    if (i >= k) sum -= a[i - k]; // sort
    if (i >= k - 1) best = Math.max(best, sum);
  }
  return best;
}
```

**Taille variable** : le template à connaître par cœur.

```ts
function longestValid(s: string): number {
  const window = new Map<string, number>(); // état de la fenêtre
  let left = 0;
  let best = 0;
  for (let right = 0; right < s.length; right++) {
    // 1. faire entrer s[right]
    const c = s[right];
    window.set(c, (window.get(c) ?? 0) + 1);
    // 2. rétrécir tant que la fenêtre est invalide
    while (window.get(c)! > 1) {
      const l = s[left++];
      window.set(l, window.get(l)! - 1);
    }
    // 3. la fenêtre [left, right] est valide : mettre à jour
    best = Math.max(best, right - left + 1);
  }
  return best;
}
```

Pour « le plus **court** sous-tableau valide », on inverse : on met à jour la réponse **dans** le `while`, pendant que la fenêtre est encore valide, puis on rétrécit (défi 5).

::: tip Pourquoi c'est O(n)
`right` avance n fois. `left` ne recule jamais et ne dépasse jamais `right` : il avance au plus n fois **au total**. Le `while` imbriqué coûte donc O(n) sur toute l'exécution, pas par tour.
:::

La sliding window exige une propriété **monotone** : agrandir la fenêtre ne peut que « l'abîmer » (ou que l'améliorer). Avec des sommes et des nombres négatifs, ce n'est plus vrai → sommes de préfixes ([Tableaux & hashing](/interview/01-algo/02-tableaux-hashing)).

## Comment le reconnaître

- Tableau **trié** + paire/triplet → pointeurs aux extrémités.
- « En place », « O(1) mémoire », « retire / compacte » → lent/rapide.
- « Palindrome », comparer les deux bouts → extrémités.
- « Plus long / plus court sous-tableau (ou sous-chaîne) **contigu** tel que… » → sliding window.
- « Au plus k distincts », « sans répétition », « contient tous les caractères de t » → fenêtre variable + compteurs.
- « Moyenne / somme de chaque fenêtre de taille k » → fenêtre fixe.

## Cas réel

Un rate limiter « 100 requêtes par minute glissante » sur une API publique. Pour chaque client, on garde les timestamps de ses requêtes dans l'ordre. À chaque nouvelle requête, la fenêtre `[now - 60 s, now]` glisse : on retire par la gauche tout ce qui est trop vieux, puis on compte.

```ts
class SlidingLimiter {
  private hits: number[] = [];
  private head = 0; // left : pas de shift() en O(n)
  constructor(private limit: number, private windowMs: number) {}

  allow(now: number): boolean {
    // rétrécir : on sort les requêtes hors fenêtre
    while (this.head < this.hits.length &&
           this.hits[this.head] <= now - this.windowMs) this.head++;
    if (this.hits.length - this.head >= this.limit) return false;
    this.hits.push(now);
    // compacter de temps en temps pour libérer la mémoire
    if (this.head > 1024) {
      this.hits = this.hits.slice(this.head);
      this.head = 0;
    }
    return true;
  }
}
```

Chaque timestamp entre une fois et sort une fois : O(1) amorti par requête. En prod, on stocke ça dans Redis (sorted set + `ZREMRANGEBYSCORE`) pour partager l'état entre instances — voir [Rate limiter](/interview/03-system-design/03-rate-limiter).

## Pièges classiques

- Two pointers sur un tableau **non trié** : l'argument « bouger le plus petit » ne tient plus. Trie d'abord (O(n log n)) si l'énoncé le permet.
- Oublier de sauter les **doublons** dans 3Sum → triplets répétés.
- Faire reculer `left` (`left = last[c] + 1` sans `max`) : sur `"abba"`, la fenêtre se rouvre à tort.
- Mettre à jour la réponse au mauvais endroit : hors du `while` pour « le plus long », dedans pour « le plus court ».
- Fenêtre sur des sommes avec négatifs.
- En Rust : `j = len - 1` sur un `usize` avec `len == 0` → panique (underflow). Garde-fou ou intervalle `[i, j)`.

## Défis

### 1. Valid Palindrome

`s` est-il un palindrome si on ne garde que les lettres et chiffres ASCII, sans tenir compte de la casse ? En O(1) mémoire.

- `"A man, a plan, a canal: Panama"` → `true`
- `"race a car"` → `false`
- `"0P"` → `false`

Problème équivalent sur LeetCode : Valid Palindrome.

<Challenge :data="validPalindrome" />

::: details Explication
Deux pointeurs aux extrémités. On saute les caractères non alphanumériques de chaque côté, puis on compare en minuscules. Dès qu'une paire diffère : `false`.

Temps O(n), espace O(1). La version « nettoyer puis comparer avec l'inverse » est correcte mais O(n) en mémoire : c'est souvent la question de suivi.

```rust
fn is_palindrome(s: &str) -> bool {
    let b = s.as_bytes();
    let (mut i, mut j) = (0, b.len());
    while i < j {
        if !b[i].is_ascii_alphanumeric() {
            i += 1;
        } else if !b[j - 1].is_ascii_alphanumeric() {
            j -= 1;
        } else {
            let (x, y) = (b[i], b[j - 1]);
            if !x.eq_ignore_ascii_case(&y) {
                return false;
            }
            i += 1;
            j -= 1;
        }
    }
    true
}
```
:::

### 2. Container With Most Water

`height[i]` est la hauteur d'une barre verticale en `i`. Choisis deux barres qui, avec l'axe, forment le récipient contenant le plus d'eau : aire = `min(h[i], h[j]) × (j - i)`.

- `[1, 8, 6, 2, 5, 4, 8, 3, 7]` → `49` (barres d'indices 1 et 8)
- `[1, 1]` → `1`

Problème équivalent sur LeetCode : Container With Most Water.

<Challenge :data="containerWithMostWater" />

::: details Explication
On part des deux extrémités (largeur max). L'aire est limitée par la barre la plus **basse**. Si on bougeait la plus haute, la largeur baisserait et la hauteur resterait plafonnée par la basse : l'aire ne peut que baisser. Donc on bouge toujours la plus basse : c'est la seule chance de trouver mieux.

Temps O(n), espace O(1). Brute force : toutes les paires, O(n²) — le test de 3000 barres reste faisable en O(n²), mais pas 10⁵.

```rust
fn max_area(h: &[i32]) -> i32 {
    if h.len() < 2 {
        return 0;
    }
    let (mut i, mut j) = (0, h.len() - 1);
    let mut best = 0;
    while i < j {
        let area = h[i].min(h[j]) * (j - i) as i32;
        best = best.max(area);
        // on déplace le plus petit côté : c'est lui qui limite
        if h[i] < h[j] { i += 1 } else { j -= 1 }
    }
    best
}
```
:::

### 3. 3Sum

Retourne tous les triplets **uniques** `[a, b, c]` de `nums` tels que `a + b + c = 0`. L'ordre n'importe pas.

- `[-1, 0, 1, 2, -1, -4]` → `[[-1, -1, 2], [-1, 0, 1]]`
- `[0, 0, 0, 0]` → `[[0, 0, 0]]`

Problème équivalent sur LeetCode : 3Sum.

<Challenge :data="threeSum" />

::: details Explication
On trie. Pour chaque `i`, on cherche une paire de somme `-nums[i]` dans `[i+1, n)` avec deux pointeurs. Pour l'unicité :

- on saute `i` si `nums[i] === nums[i-1]` ;
- après avoir trouvé un triplet, on avance `lo` tant qu'il répète la valeur précédente.

Optimisation : si `nums[i] > 0`, tout ce qui suit est positif, on s'arrête. Temps O(n²) (n fois une passe O(n)), espace O(1) hors tri et sortie. On ne fait pas mieux que O(n²) dans le cas général.

```rust
fn three_sum(mut nums: Vec<i32>) -> Vec<Vec<i32>> {
    nums.sort_unstable();
    let n = nums.len();
    let mut out = Vec::new();
    for i in 0..n {
        if i > 0 && nums[i] == nums[i - 1] {
            continue; // même premier élément = mêmes triplets
        }
        let (mut lo, mut hi) = (i + 1, n.saturating_sub(1));
        while lo < hi {
            let s = nums[i] + nums[lo] + nums[hi];
            if s < 0 {
                lo += 1;
            } else if s > 0 {
                hi -= 1;
            } else {
                out.push(vec![nums[i], nums[lo], nums[hi]]);
                lo += 1;
                while lo < hi && nums[lo] == nums[lo - 1] {
                    lo += 1; // saute les doublons
                }
                hi -= 1;
            }
        }
    }
    out
}
```
:::

### 4. Longest Substring Without Repeating Characters

Longueur de la plus longue sous-chaîne (contiguë) sans caractère répété.

- `"abcabcbb"` → `3` (`"abc"`)
- `"pwwkew"` → `3` (`"wke"` ; `"pwke"` n'est pas contigu)
- `"abba"` → `2`

Problème équivalent sur LeetCode : Longest Substring Without Repeating Characters.

<Challenge :data="longestSubstring" />

::: details Explication
Fenêtre variable. On mémorise la dernière position de chaque caractère. Quand `s[right]` a déjà été vu **dans la fenêtre** (position ≥ `left`), on saute `left` juste après cette ancienne position — directement, sans boucler. Sur `"abba"`, au dernier `a`, son ancienne position (0) est avant `left` (2) : on ne doit **pas** reculer, d'où le `max` en Rust.

Temps O(n), espace O(k) (alphabet). En Rust on travaille sur les octets (ASCII), avec un tableau de 256 cases au lieu d'une map.

```rust
fn length_of_longest_substring(s: &str) -> usize {
    // last[c] = dernière position + 1 de l'octet c (0 = jamais vu)
    let mut last = [0usize; 256];
    let (mut left, mut best) = (0, 0);
    for (right, b) in s.bytes().enumerate() {
        // si b est déjà dans la fenêtre, on saute après lui
        left = left.max(last[b as usize]);
        last[b as usize] = right + 1;
        best = best.max(right + 1 - left);
    }
    best
}
```
:::

### 5. Minimum Window Substring

Plus petite sous-chaîne de `s` contenant tous les caractères de `t`, doublons compris. `""` s'il n'y en a pas. (La réponse est unique dans les tests.)

- `s = "ADOBECODEBANC", t = "ABC"` → `"BANC"`
- `s = "a", t = "aa"` → `""`

Problème équivalent sur LeetCode : Minimum Window Substring.

<Challenge :data="minWindow" />

::: details Explication
Compteur `need[c]` initialisé avec `t`, et `missing` = nombre de caractères de `t` pas encore couverts. Quand `s[right]` entre : si `need[c] > 0` c'était un caractère utile, `missing--` ; dans tous les cas `need[c]--` (négatif = surplus). Tant que `missing == 0`, la fenêtre est valide : on enregistre sa taille, puis on fait sortir `s[left]` (`need[l]++`, et si ça repasse au-dessus de 0, `missing++`).

Le compteur unique `missing` évite de comparer deux maps à chaque pas. Temps O(|s| + |t|), espace O(k).

```rust
fn min_window(s: &str, t: &str) -> String {
    let (s, t) = (s.as_bytes(), t.as_bytes());
    let mut need = [0i32; 128];
    for &c in t {
        need[c as usize] += 1;
    }
    let mut missing = t.len(); // caractères de t encore absents
    let mut left = 0;
    let mut best: Option<(usize, usize)> = None; // (début, fin)
    for right in 0..s.len() {
        let c = s[right] as usize;
        if need[c] > 0 {
            missing -= 1;
        }
        need[c] -= 1;
        while missing == 0 {
            // fenêtre valide : on l'enregistre puis on rétrécit
            if best.is_none_or(|(a, b)| right + 1 - left < b - a) {
                best = Some((left, right + 1));
            }
            let l = s[left] as usize;
            need[l] += 1;
            if need[l] > 0 {
                missing += 1;
            }
            left += 1;
        }
    }
    best.map_or(String::new(), |(a, b)| {
        String::from_utf8_lossy(&s[a..b]).into_owned()
    })
}
```
:::

## À retenir

- Pointeurs aux extrémités : il faut une raison (tri, monotonie) de savoir **lequel** bouger.
- Lent/rapide : `fast` lit, `slow` écrit — le pattern des opérations en place.
- Sliding window = sous-tableau **contigu** + propriété monotone ; `left` ne recule jamais → O(n) amorti.
- « Plus long » : mise à jour après le `while` ; « plus court » : dans le `while`.
- Négatifs dans une somme → pas de fenêtre, sommes de préfixes.
- Rust : attention aux `usize` qui passent sous zéro ; travaille sur `as_bytes()` pour l'ASCII.
