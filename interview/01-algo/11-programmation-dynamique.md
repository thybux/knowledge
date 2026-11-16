<script setup>
import climbingStairs from "./challenges/climbing-stairs";
import houseRobber from "./challenges/house-robber";
import coinChange from "./challenges/coin-change";
import partition from "./challenges/partition-equal-subset-sum";
import lis from "./challenges/longest-increasing-subsequence";
import editDistance from "./challenges/edit-distance";
</script>

# Programmation dynamique

Ce que tu vas apprendre : une méthode en 4 questions pour trouver la récurrence, passer d'une récursion naïve à une version mémoïsée (top-down) puis à un tableau (bottom-up), et reconnaître les familles classiques : 1D, grille 2D, knapsack, LIS, edit distance.

<Progress :ids="['climbing-stairs', 'house-robber', 'coin-change', 'partition-equal-subset-sum', 'longest-increasing-subsequence', 'edit-distance']" />

## L'idée en une phrase

La DP, c'est une **récursion dont on mémorise les résultats** parce que les mêmes sous-problèmes reviennent sans cesse. Deux conditions :

- **Sous-problèmes qui se chevauchent** : `f(5)` appelle `f(4)` et `f(3)`, `f(4)` rappelle `f(3)`…
- **Sous-structure optimale** : la meilleure réponse pour `n` se construit à partir des meilleures réponses pour des entrées plus petites.

Sans mémo, Fibonacci naïf est O(2ⁿ). Avec, O(n). C'est tout le gain.

## La méthode : 4 questions

Devant un problème, avant toute ligne de code, réponds à voix haute :

1. **État** : « `dp[i]` = … » en une phrase française précise. *Ex. : `dp[a]` = nombre minimal de pièces pour faire le montant `a`.* Si tu ne sais pas finir la phrase, tu n'as pas l'état.
2. **Transition** : comment `dp[i]` se calcule à partir d'états plus petits ? Pense à **la dernière décision** : la dernière pièce, la dernière maison, le dernier caractère. *`dp[a] = 1 + min(dp[a - c])` pour chaque pièce `c`.*
3. **Cas de base** : les plus petits états, qu'on connaît sans calcul. *`dp[0] = 0`.*
4. **Ordre de calcul et réponse** : dans quel sens remplir pour que les dépendances soient prêtes ? Quelle case contient la réponse ? *`a` croissant, réponse `dp[amount]`.*

::: tip L'astuce « dernière décision »
« Que s'est-il passé au dernier pas ? » Pour monter `n` marches, le dernier pas était de 1 ou de 2 : `ways(n) = ways(n-1) + ways(n-2)`. Pour une maison `i` : soit je la vole (et pas `i-1`), soit non. Cette question débloque 80 % des récurrences.
:::

## Top-down : la récursion + un cache

On écrit la récurrence telle quelle, et on ajoute un cache. C'est la version la plus facile à **trouver** en entretien.

```ts
function coinChangeTopDown(coins: number[], amount: number) {
  const memo = new Map<number, number>();
  // f(a) = min de pièces pour faire a (Infinity si impossible)
  const f = (a: number): number => {
    if (a === 0) return 0; // cas de base
    if (a < 0) return Infinity;
    const hit = memo.get(a);
    if (hit !== undefined) return hit;
    let best = Infinity;
    for (const c of coins) best = Math.min(best, 1 + f(a - c));
    memo.set(a, best);
    return best;
  };
  const r = f(amount);
  return r === Infinity ? -1 : r;
}
```

Avantages : on ne calcule que les états atteignables, le code suit la pensée. Inconvénients : profondeur de récursion (en JS, ~10 000 niveaux avant `RangeError: Maximum call stack size exceeded`), overhead de la `Map`.

## Bottom-up : le tableau

On remplit `dp` dans l'ordre des dépendances, sans récursion.

```ts
function coinChange(coins: number[], amount: number): number {
  const dp = new Array(amount + 1).fill(Infinity); // état
  dp[0] = 0; // cas de base
  for (let a = 1; a <= amount; a++) { // ordre : croissant
    for (const c of coins) {
      if (c <= a) dp[a] = Math.min(dp[a], dp[a - c] + 1);
    }
  }
  return dp[amount] === Infinity ? -1 : dp[amount];
}
```

Démarche recommandée en entretien : énonce la récurrence, code le top-down si tu hésites, puis propose la conversion bottom-up et l'optimisation mémoire. Montrer le chemin compte autant que le résultat.

| | Top-down | Bottom-up |
|---|---|---|
| Écriture | intuitive | demande l'ordre |
| Pile | risque d'overflow | aucun |
| États calculés | seulement utiles | tous |
| Opti mémoire | difficile | facile |

## Équivalent Rust

En Rust, la mémo se passe en `&mut Vec<Option<T>>` (plus rapide qu'une `HashMap` quand l'état est un petit entier).

```rust play
fn climb_memo(n: usize, memo: &mut Vec<Option<u64>>) -> u64 {
    if n <= 1 { return 1; }
    if let Some(v) = memo[n] { return v; }
    let v = climb_memo(n - 1, memo) + climb_memo(n - 2, memo);
    memo[n] = Some(v);
    v
}

fn climb_bottom_up(n: usize) -> u64 {
    let mut dp = vec![1u64; n + 1];
    for i in 2..=n {
        dp[i] = dp[i - 1] + dp[i - 2];
    }
    dp[n]
}

fn main() {
    let n = 50;
    let mut memo = vec![None; n + 1];
    assert_eq!(climb_memo(n, &mut memo), climb_bottom_up(n));
    println!("{}", climb_bottom_up(n)); // 20365011074
}
```

## Optimiser la mémoire

Si `dp[i]` ne dépend que de `dp[i-1]` et `dp[i-2]`, inutile de garder tout le tableau : deux variables suffisent, O(1) au lieu de O(n).

```ts
let prev = 1, cur = 1;
for (let i = 2; i <= n; i++) [prev, cur] = [cur, prev + cur];
```

En 2D, si la ligne `i` ne dépend que de la ligne `i - 1`, on garde **une ou deux lignes** : O(n) au lieu de O(m · n). Annonce toujours d'abord la version complète (plus simple à vérifier), puis l'optimisation.

## DP 2D : grilles et deux chaînes

**Unique Paths** : combien de chemins de `(0,0)` à `(m-1,n-1)` en n'allant qu'à droite ou en bas ?

- État : `dp[r][c]` = nombre de chemins jusqu'à `(r, c)`.
- Transition (dernier pas : venu d'en haut ou de gauche) : `dp[r][c] = dp[r-1][c] + dp[r][c-1]`.
- Base : première ligne et première colonne à 1.

```ts
function uniquePaths(m: number, n: number): number {
  const row = new Array(n).fill(1); // une seule ligne suffit
  for (let r = 1; r < m; r++) {
    for (let c = 1; c < n; c++) row[c] += row[c - 1];
  } // row[c] (avant +=) = haut, row[c - 1] = gauche
  return row[n - 1];
}
```

**Longest Common Subsequence** (deux chaînes → presque toujours `dp[i][j]` sur les **préfixes** `a[0..i)` et `b[0..j)`) :

- Si `a[i-1] === b[j-1]` : `dp[i][j] = dp[i-1][j-1] + 1` (on garde ce caractère).
- Sinon : `dp[i][j] = max(dp[i-1][j], dp[i][j-1])` (on jette l'un des deux).
- Base : `dp[0][*] = dp[*][0] = 0` (préfixe vide).

```ts
function lcs(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 },
    () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}
```

La taille `(m + 1) × (n + 1)` avec une ligne/colonne « préfixe vide » évite tous les `if (i === 0)`. C'est la même structure que l'edit distance (défi 6) et le `diff` de git (qui utilise l'algorithme de Myers, une variante optimisée de cette idée).

## Knapsack : 0/1 contre illimité

Le sac à dos : des objets (poids, valeur), une capacité, maximiser la valeur. En 1D sur la capacité, **le sens de la boucle interne** décide de tout :

```ts
// 0/1 : chaque objet AU PLUS une fois -> capacité DÉCROISSANTE
for (const [w, v] of items)
  for (let cap = W; cap >= w; cap--)
    dp[cap] = Math.max(dp[cap], dp[cap - w] + v);

// Illimité : réutilisable -> capacité CROISSANTE
for (const [w, v] of items)
  for (let cap = w; cap <= W; cap++)
    dp[cap] = Math.max(dp[cap], dp[cap - w] + v);
```

Pourquoi : en décroissant, `dp[cap - w]` n'a pas encore été mis à jour pour l'objet courant, donc il vaut « sans cet objet ». En croissant, il inclut déjà l'objet : on peut le reprendre. Coin change est un knapsack illimité ; partition equal subset sum est un 0/1.

Variantes de la même structure : « nombre de façons » (`+=` au lieu de `max`), « atteignable ? » (`||`), « minimum » (`min`).

## Les familles à reconnaître

| Famille | État typique | Exemple |
|---|---|---|
| 1D linéaire | `dp[i]` : préfixe jusqu'à i | stairs, robber |
| Montant / capacité | `dp[x]` : valeur x | coin change |
| Grille | `dp[r][c]` | unique paths |
| Deux séquences | `dp[i][j]` : préfixes | LCS, edit |
| Fin en i | `dp[i]` : finit en i | LIS |
| Intervalle | `dp[i][j]` : sous-tableau | palindromes |

## Comment le reconnaître

- « **nombre de façons** de… » (et pas la liste : ça c'est du [backtracking](/interview/01-algo/10-backtracking))
- « **minimum / maximum** de … » avec des choix qui interagissent
- « **est-il possible** de… » (atteindre une somme, segmenter un mot)
- deux chaînes à comparer, aligner, transformer
- la version glouton naïve a un contre-exemple (coin change avec `[1, 3, 4]` et 6)
- contraintes moyennes : `n ≤ 1000` ou `n · W ≤ 10⁷` → O(n²) ou O(n · W) attendu

## Cas réel

**Moteur de recherche d'un back-office e-commerce : tolérance aux fautes.** Le support tape « chausure » et doit trouver « chaussure ». La distance d'édition (Levenshtein) entre la requête et chaque terme du catalogue sert à proposer « Vouliez-vous dire… ».

```ts
function suggest(q: string, terms: string[], maxDist = 2) {
  return terms
    .map((t) => ({ t, d: minDistance(q, t) })) // défi 6
    .filter((x) => x.d <= maxDist)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map((x) => x.t);
}
```

En vrai, on ne calcule pas Levenshtein contre 1 million de termes : on filtre d'abord (n-grammes, longueur proche, index trigram `pg_trgm` dans [PostgreSQL](/bdd/05-postgres-avance)) puis on applique la DP sur quelques centaines de candidats. Elasticsearch fait la même chose avec ses requêtes `fuzzy` (automates de Levenshtein).

Autres DP en production : le **diff** de fichiers (LCS), le **découpage de texte** en lignes équilibrées (algorithme de Knuth-Plass), l'**optimisation de paniers** (« quels articles promo tiennent dans le budget » = knapsack), le calcul de **rendu de monnaie** sur une caisse avec un stock limité.

## Pièges classiques

- **Ne pas savoir dire ce que représente `dp[i]`** : tu vas te perdre dans les indices. Écris la phrase en commentaire.
- **Off-by-one sur les préfixes** : `dp` de taille `n + 1`, et `a[i - 1]` pour le i-ème caractère.
- **Sens de boucle en knapsack 1D** : croissant = réutilisable, décroissant = une fois.
- **Initialiser avec 0 un problème de minimum** : utilise `Infinity` (et teste-le à la fin pour renvoyer -1).
- **Glouton qui « marche sur les exemples »** : coin change `[1, 3, 4]`, montant 6 → glouton 3 pièces, optimum 2.
- **Mémo sur un état incomplet** : si la réponse dépend de `(i, reste)`, la clé du cache doit contenir les deux.
- **Récursion profonde en JS** : top-down sur `n = 10⁵` → stack overflow. Passe en bottom-up.

## Défis

### 1. Climbing Stairs

Tu montes un escalier de `n` marches, par pas de 1 ou 2 marches. De combien de façons distinctes peux-tu arriver en haut ? (Par convention, 0 marche = 1 façon.)

- `n = 2` → `2` (1+1, 2)
- `n = 3` → `3` (1+1+1, 1+2, 2+1)
- `n = 45` → `1836311903` (la récursion naïve ne passe pas)

Problème équivalent sur LeetCode : Climbing Stairs.

<Challenge :data="climbingStairs" />

::: details Explication
État : `ways(i)` = façons d'atteindre la marche `i`. Dernier pas de 1 ou de 2 : `ways(i) = ways(i-1) + ways(i-2)`. Bases : `ways(0) = ways(1) = 1`. C'est Fibonacci décalé.

Deux variables suffisent : O(n) en temps, O(1) en mémoire. (Il existe une version O(log n) par exponentiation de matrice, rarement attendue.)

```rust play
fn climb_stairs(n: u32) -> u64 {
    let (mut prev, mut cur) = (1u64, 1u64);
    for _ in 2..=n {
        (prev, cur) = (cur, prev + cur);
    }
    cur
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn small() {
        assert_eq!(climb_stairs(1), 1);
        assert_eq!(climb_stairs(2), 2);
        assert_eq!(climb_stairs(5), 8);
    }
    #[test] fn big() { assert_eq!(climb_stairs(45), 1836311903); }
}
```
:::

### 2. House Robber

Des maisons alignées, chacune contient une somme `nums[i]`. Tu ne peux pas cambrioler deux maisons **adjacentes** (l'alarme se déclenche). Somme maximale ?

- `[1, 2, 3, 1]` → `4` (maisons 0 et 2)
- `[2, 7, 9, 3, 1]` → `12` (2 + 9 + 1)
- `[2, 1, 1, 2]` → `4` (maisons 0 et 3 : sauter deux maisons est permis)

Problème équivalent sur LeetCode : House Robber.

<Challenge :data="houseRobber" />

::: details Explication
État : `best(i)` = gain max sur les maisons `0..i`. Dernière décision sur la maison `i` : la voler (`best(i-2) + nums[i]`) ou non (`best(i-1)`). Donc `best(i) = max(best(i-1), best(i-2) + nums[i])`.

Comme on ne regarde que deux états en arrière, deux variables (`skip`, `take`). O(n) en temps, O(1) en mémoire.

Variante House Robber II (maisons en cercle) : la première et la dernière sont adjacentes → max de deux passes, `[0..n-2]` et `[1..n-1]`.

```rust play
fn rob(nums: &[u32]) -> u32 {
    let (mut skip, mut take) = (0, 0);
    for &x in nums {
        (skip, take) = (take, take.max(skip + x));
    }
    take
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn basic() {
        assert_eq!(rob(&[1, 2, 3, 1]), 4);
        assert_eq!(rob(&[2, 7, 9, 3, 1]), 12);
    }
    #[test] fn edge() {
        assert_eq!(rob(&[]), 0);
        assert_eq!(rob(&[5]), 5);
        assert_eq!(rob(&[2, 1, 1, 2]), 4);
    }
}
```
:::

### 3. Coin Change

Des valeurs de pièces (en quantité illimitée) et un montant. Nombre **minimal** de pièces pour faire exactement ce montant, ou `-1` si c'est impossible.

- `coins = [1, 2, 5], amount = 11` → `3` (5 + 5 + 1)
- `coins = [2], amount = 3` → `-1`
- `coins = [1], amount = 0` → `0`
- `coins = [1, 3, 4], amount = 6` → `2` (3 + 3 ; le glouton dirait 4 + 1 + 1)

Problème équivalent sur LeetCode : Coin Change.

<Challenge :data="coinChange" />

::: details Explication
État : `dp[a]` = min de pièces pour faire `a`. Dernière pièce `c` : `dp[a] = 1 + min(dp[a - c])`. Base : `dp[0] = 0`, le reste à `Infinity`. Ordre : `a` croissant.

C'est un knapsack illimité : on peut aussi itérer pièces à l'extérieur et montants croissants à l'intérieur, même résultat.

Complexité : O(amount · k) en temps (k = nombre de pièces), O(amount) en mémoire.

Variante Coin Change II (« nombre de façons ») : `dp[a] += dp[a - c]`, avec **les pièces en boucle extérieure** pour compter des combinaisons et non des permutations (sinon 1+2 et 2+1 comptent deux fois).

```rust play
fn coin_change(coins: &[usize], amount: usize) -> i32 {
    let inf = usize::MAX;
    let mut dp = vec![inf; amount + 1];
    dp[0] = 0;
    for a in 1..=amount {
        for &c in coins {
            if c <= a && dp[a - c] != inf {
                dp[a] = dp[a].min(dp[a - c] + 1);
            }
        }
    }
    if dp[amount] == inf { -1 } else { dp[amount] as i32 }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn basic() { assert_eq!(coin_change(&[1, 2, 5], 11), 3); }
    #[test] fn impossible() { assert_eq!(coin_change(&[2], 3), -1); }
    #[test] fn zero() { assert_eq!(coin_change(&[1], 0), 0); }
    #[test] fn greedy_fails() { assert_eq!(coin_change(&[1, 3, 4], 6), 2); }
}
```
:::

### 4. Partition en deux sommes égales

Un tableau d'entiers positifs. Peut-on le couper en **deux groupes de même somme** (chaque élément dans exactement un groupe) ?

- `[1, 5, 11, 5]` → `true` (`[1, 5, 5]` et `[11]`)
- `[1, 2, 3, 5]` → `false` (somme 11, impaire)
- `[2, 2, 3, 5]` → `false` (somme 12, mais aucun groupe ne fait 6)

Problème équivalent sur LeetCode : Partition Equal Subset Sum.

<Challenge :data="partition" />

::: details Explication
Reformulation : existe-t-il un sous-ensemble de somme `total / 2` ? (Si `total` est impair, c'est non tout de suite.) C'est un **knapsack 0/1** booléen.

État : `dp[s]` = « une partie des éléments vus jusqu'ici atteint `s` ». Pour chaque `x`, `dp[s] ||= dp[s - x]`, avec `s` **décroissant** pour ne pas utiliser `x` deux fois. Base : `dp[0] = true`.

Complexité : O(n · S) en temps, O(S) en mémoire, avec S = total / 2. Pseudo-polynomial : ça dépend de la valeur des nombres, pas seulement de leur nombre.

Astuce Rust (ou JS avec `BigInt`) : un bitset `bits |= bits << x` fait toute la boucle interne d'un coup.

```rust play
fn can_partition(nums: &[usize]) -> bool {
    let total: usize = nums.iter().sum();
    if total % 2 == 1 { return false; }
    let target = total / 2;
    let mut dp = vec![false; target + 1];
    dp[0] = true;
    for &x in nums {
        for s in (x..=target).rev() { // décroissant : 0/1
            if dp[s - x] { dp[s] = true; }
        }
    }
    dp[target]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn yes() {
        assert!(can_partition(&[1, 5, 11, 5]));
        assert!(can_partition(&[3, 3, 3, 4, 5]));
    }
    #[test] fn no() {
        assert!(!can_partition(&[1, 2, 3, 5]));
        assert!(!can_partition(&[2, 2, 3, 5]));
        assert!(!can_partition(&[1]));
    }
}
```
:::

### 5. Longest Increasing Subsequence

Longueur de la plus longue sous-suite **strictement croissante** (éléments dans l'ordre, pas forcément contigus).

- `[10, 9, 2, 5, 3, 7, 101, 18]` → `4` (`2, 3, 7, 18`)
- `[0, 1, 0, 3, 2, 3]` → `4`
- `[7, 7, 7, 7]` → `1`

Un des tests a 20 000 éléments : l'O(n²) passe encore (~0,3 s), l'O(n log n) est instantané. Avec 10⁵ éléments, seul le second tiendrait.

Problème équivalent sur LeetCode : Longest Increasing Subsequence.

<Challenge :data="lis" />

::: details Explication
**O(n²), la DP classique.** État : `dp[i]` = longueur de la plus longue sous-suite croissante **qui finit en `i`**. Transition : `dp[i] = 1 + max(dp[j])` pour `j < i` et `nums[j] < nums[i]`. Réponse : `max(dp)` (pas `dp[n-1]` !). C'est la famille « fin en i ».

**O(n log n), patience sorting.** On maintient `tails[k]` = plus petite valeur finale possible d'une sous-suite croissante de longueur `k + 1`. `tails` est trié, donc pour chaque `x` on cherche par [binary search](/interview/01-algo/05-binary-search) la première case `>= x` : on la remplace (même longueur, fin plus petite = meilleur potentiel), ou on ajoute `x` à la fin s'il dépasse tout. La réponse est `tails.length`.

Attention : `tails` n'est **pas** une sous-suite valide, seulement sa longueur est juste.

Complexité : O(n log n) en temps, O(n) en mémoire.

```rust play
fn length_of_lis(nums: &[i32]) -> usize {
    let mut tails: Vec<i32> = Vec::new();
    for &x in nums {
        // premier indice où tails[i] >= x
        let i = tails.partition_point(|&t| t < x);
        if i == tails.len() { tails.push(x); } else { tails[i] = x; }
    }
    tails.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn basic() {
        assert_eq!(length_of_lis(&[10, 9, 2, 5, 3, 7, 101, 18]), 4);
        assert_eq!(length_of_lis(&[0, 1, 0, 3, 2, 3]), 4);
    }
    #[test] fn edge() {
        assert_eq!(length_of_lis(&[]), 0);
        assert_eq!(length_of_lis(&[7, 7, 7]), 1);
        assert_eq!(length_of_lis(&[5, 4, 3]), 1);
    }
}
```
:::

### 6. Edit Distance

Nombre minimal d'opérations pour transformer `a` en `b`, chaque opération portant sur un caractère : **insérer**, **supprimer**, **remplacer**.

- `"horse"` → `"ros"` : `3` (horse → rorse → rose → ros)
- `"intention"` → `"execution"` : `5`
- `""` → `"abc"` : `3`
- `"ab"` → `"ba"` : `2` (pas d'opération « échanger »)

Problème équivalent sur LeetCode : Edit Distance.

<Challenge :data="editDistance" />

::: details Explication
État : `dp[i][j]` = distance entre les préfixes `a[0..i)` et `b[0..j)`. Dernière décision sur les derniers caractères :

- égaux → `dp[i-1][j-1]` (rien à faire) ;
- sinon `1 + min(` `dp[i-1][j]` (supprimer `a[i-1]`), `dp[i][j-1]` (insérer `b[j-1]`), `dp[i-1][j-1]` (remplacer) `)`.

Bases : `dp[i][0] = i` (tout supprimer), `dp[0][j] = j` (tout insérer).

La ligne `i` ne dépend que de la ligne `i - 1` et d'elle-même → on garde deux lignes : O(m · n) en temps, O(n) en mémoire. Pour reconstruire les opérations (afficher un diff), il faut garder la matrice complète et remonter depuis `dp[m][n]`.

```rust play
fn min_distance(a: &str, b: &str) -> usize {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let n = b.len();
    let mut prev: Vec<usize> = (0..=n).collect();
    for i in 1..=a.len() {
        let mut cur = vec![i; n + 1];
        for j in 1..=n {
            cur[j] = if a[i - 1] == b[j - 1] {
                prev[j - 1]
            } else {
                1 + prev[j].min(cur[j - 1]).min(prev[j - 1])
            };
        }
        prev = cur;
    }
    prev[n]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn basic() {
        assert_eq!(min_distance("horse", "ros"), 3);
        assert_eq!(min_distance("intention", "execution"), 5);
    }
    #[test] fn empty() {
        assert_eq!(min_distance("", "abc"), 3);
        assert_eq!(min_distance("abc", ""), 3);
        assert_eq!(min_distance("", ""), 0);
    }
}
```

Note : `as_bytes()` compare des octets, pas des caractères. Pour de l'UTF-8 avec accents, collecte d'abord `a.chars()` dans un `Vec<char>`. Même remarque en JS avec les emojis (`[...a]` plutôt que `a[i]`).
:::

## À retenir

- DP = récursion + mémoire, utile quand les sous-problèmes se répètent.
- Méthode : **état** (une phrase), **transition** (la dernière décision), **cas de base**, **ordre** + où lire la réponse.
- Top-down pour trouver, bottom-up pour livrer, puis réduire la mémoire à 1–2 lignes.
- Deux chaînes → `dp[i][j]` sur les préfixes, tableau `(m+1) × (n+1)`.
- Knapsack 1D : capacité décroissante = chaque objet une fois, croissante = réutilisable.
- « Fin en i » (LIS) : la réponse est le max du tableau, pas la dernière case.
