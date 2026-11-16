<script setup>
import subsets from "./challenges/subsets";
import permutations from "./challenges/permutations";
import combinationSum from "./challenges/combination-sum";
import letterCombinations from "./challenges/letter-combinations";
import wordSearch from "./challenges/word-search";
import nQueens from "./challenges/n-queens";
</script>

# Backtracking

Ce que tu vas apprendre : énumérer proprement « toutes les combinaisons / permutations / placements » avec un seul template (choisir, explorer, annuler), élaguer l'arbre de recherche, et estimer la complexité exponentielle sans paniquer.

<Progress :ids="['subsets', 'permutations', 'combination-sum', 'letter-combinations', 'word-search', 'n-queens']" />

## Le pattern : un DFS sur l'arbre des choix

Le backtracking, c'est un parcours en profondeur d'un **arbre de décisions** qu'on ne construit jamais explicitement. À chaque niveau, tu fais un choix ; quand tu arrives au bout (ou dans une impasse), tu **reviens en arrière** et tu essaies le choix suivant.

Trois questions suffisent à écrire n'importe quel backtracking :

1. **L'état** : qu'est-ce que j'ai construit jusqu'ici ? (`path`, l'index courant, les cases utilisées)
2. **Les choix** : à partir de cet état, quelles options ai-je ?
3. **La condition d'arrêt** : quand `path` est-il une réponse complète (ou une impasse) ?

Pour `[1, 2, 3]` en subsets, l'arbre ressemble à ça :

```
              []
       /       |      \
     [1]      [2]     [3]
    /   \      |
 [1,2] [1,3] [2,3]
   |
[1,2,3]
```

Chaque nœud est un sous-ensemble. Le paramètre `start` empêche de revenir en arrière dans le tableau : c'est ce qui évite `[2, 1]` en plus de `[1, 2]`.

## Le template TS

```ts
function backtrack(nums: number[]): number[][] {
  const res: number[][] = [];
  const path: number[] = []; // l'état courant, partagé

  const dfs = (start: number) => {
    // 1. Réponse ? -> on COPIE path (il va encore changer)
    if (isComplete(path)) {
      res.push([...path]);
      return;
    }
    // 2. On essaie chaque choix possible
    for (let i = start; i < nums.length; i++) {
      if (!isValid(nums[i], path)) continue; // élagage
      path.push(nums[i]); // choisir
      dfs(i + 1); // explorer
      path.pop(); // annuler (le "back" de backtrack)
    }
  };

  dfs(0);
  return res;
}
```

Les trois variantes qui couvrent 90 % des entretiens se distinguent par **un seul détail** dans la boucle :

| Problème | Appel récursif | Pourquoi |
|---|---|---|
| Subsets / combinaisons | `dfs(i + 1)` | chaque élément une fois, ordre ignoré |
| Combination sum | `dfs(i)` | élément réutilisable |
| Permutations | `dfs()` + `used[]` | l'ordre compte, on repart de 0 |

::: warning Copier, pas pousser la référence
`res.push(path)` pousse **la même référence** à chaque fois : à la fin, `res` contient N tableaux vides (puisque tout a été `pop`). Toujours `res.push([...path])`.
:::

## Équivalent Rust

En Rust, l'état mutable passe en `&mut`. Une fonction interne récursive (pas une closure : les closures récursives sont pénibles en Rust) prend tout ce dont elle a besoin en paramètre.

```rust play
fn subsets(nums: &[i32]) -> Vec<Vec<i32>> {
    fn dfs(
        nums: &[i32],
        start: usize,
        path: &mut Vec<i32>,
        res: &mut Vec<Vec<i32>>,
    ) {
        res.push(path.clone()); // chaque noeud est une réponse
        for i in start..nums.len() {
            path.push(nums[i]); // choisir
            dfs(nums, i + 1, path, res); // explorer
            path.pop(); // annuler
        }
    }
    let mut res = Vec::new();
    dfs(nums, 0, &mut Vec::new(), &mut res);
    res
}

fn main() {
    println!("{:?}", subsets(&[1, 2, 3]));
}
```

`path.clone()` est l'équivalent de `[...path]`. Le borrow checker t'empêche d'ailleurs de pousser `path` lui-même : il t'oblige à faire la copie que les juniors oublient en JS.

## Élaguer : la vraie différence entre lent et acceptable

Le backtracking est exponentiel par nature. Ce qui fait passer une solution, c'est de **couper les branches mortes le plus tôt possible** :

- **Trier puis `break`** : dans combination sum, si `nums[i] > rest` et que `nums` est trié, tous les suivants sont aussi trop grands. `break`, pas `continue`.
- **Contraintes en O(1)** : pour N-Queens, garder des `Set` de colonnes et diagonales occupées au lieu de rescanner le plateau.
- **Compteurs** : pour générer des parenthèses, `open < n` et `close < open` suffisent à ne jamais produire de chaîne invalide.

```ts
// Generate Parentheses : l'élagage EST l'algorithme
const dfs = (s: string, open: number, close: number) => {
  if (s.length === 2 * n) return void res.push(s);
  if (open < n) dfs(s + "(", open + 1, close);
  if (close < open) dfs(s + ")", open, close + 1);
};
```

### Gérer les doublons

Si l'entrée contient des doublons (`[1, 2, 2]`) et qu'on veut des sous-ensembles uniques : **trie**, puis saute un élément égal au précédent **au même niveau** de l'arbre.

```ts
nums.sort((a, b) => a - b);
for (let i = start; i < nums.length; i++) {
  if (i > start && nums[i] === nums[i - 1]) continue;
  // ...
}
```

`i > start` (et pas `i > 0`) : on autorise `[2, 2]` (deux niveaux différents) mais on interdit de démarrer deux branches sœurs par `2`.

## Complexité : savoir l'annoncer

En entretien, on attend une estimation, pas une preuve :

| Problème | Nombre de réponses | Coût total |
|---|---|---|
| Subsets | 2ⁿ | O(n · 2ⁿ) (copie de chaque) |
| Permutations | n! | O(n · n!) |
| Combinaisons k parmi n | C(n, k) | O(k · C(n, k)) |
| Grille (word search) | — | O(R · C · 3ᴸ) |

Le facteur `n` vient de la copie de `path`. Pour word search, chaque pas a au plus 3 directions (on ne revient pas sur la case d'où on vient), sur une profondeur `L` = longueur du mot. La mémoire supplémentaire, hors résultat, est la profondeur de récursion : O(n).

::: tip La phrase qui rassure l'interviewer
« La sortie elle-même fait 2ⁿ éléments, donc on ne peut pas faire mieux que O(2ⁿ) : l'objectif est de ne pas explorer de branches inutiles. »
:::

## Comment le reconnaître

Signaux dans l'énoncé :

- « **toutes** les combinaisons / permutations / partitions / façons de… » (on veut la liste, pas le nombre)
- « génère toutes les chaînes valides… »
- placement sous contraintes : reines, sudoku, mots dans une grille
- contraintes petites : `n ≤ 10`, `n ≤ 15`, `nums.length ≤ 20` → l'exponentiel est attendu

Contre-signal : si on demande **le nombre** de façons ou **le minimum** et que `n` va jusqu'à 10⁴, c'est presque toujours de la [programmation dynamique](/interview/01-algo/11-programmation-dynamique). Le backtracking avec mémo *est* la DP top-down.

## Cas réel

**Back-office d'une agence de voyages : composer des forfaits.** Un commercial veut toutes les combinaisons d'options (vol, hôtel, assurance, transfert) dont le prix total tombe sous le budget du client, chaque catégorie prise au plus une fois.

```ts
type Option = { id: string; cat: string; price: number };

function bundles(opts: Option[], budget: number): string[][] {
  const sorted = [...opts].sort((a, b) => a.price - b.price);
  const res: string[][] = [];
  const path: Option[] = [];
  const cats = new Set<string>();
  const dfs = (start: number, spent: number) => {
    if (path.length > 0) res.push(path.map((o) => o.id));
    for (let i = start; i < sorted.length; i++) {
      const o = sorted[i];
      if (spent + o.price > budget) break; // trié : on coupe
      if (cats.has(o.cat)) continue; // 1 par catégorie
      path.push(o); cats.add(o.cat);
      dfs(i + 1, spent + o.price);
      path.pop(); cats.delete(o.cat);
    }
  };
  dfs(0, 0);
  return res;
}
```

C'est exactement subsets + élagage. Autres apparitions en vrai : générer les jeux de tests combinatoires (matrice de feature flags), résoudre des affectations (planning de gardes avec contraintes), l'autocomplétion de commandes CLI à plusieurs arguments. En production, on borne **toujours** la sortie (limite de résultats, timeout) : 2³⁰ combinaisons, c'est un milliard.

## Pièges classiques

- **`res.push(path)` sans copie** : résultat plein de tableaux vides.
- **Oublier l'annulation** (`pop`, `used[i] = false`, restaurer la case) : les branches suivantes héritent d'un état faux.
- **`continue` au lieu de `break`** après un tri : correct, mais tu perds l'élagage.
- **Confondre `dfs(i)` et `dfs(i + 1)`** : réutilisation autorisée ou non.
- **Marquer « visité » globalement** dans une grille (comme en BFS) : en backtracking, une case est interdite seulement **sur le chemin courant**, il faut la libérer en remontant.
- **Récursion en JS** : la pile tient ~10 000 niveaux. Pas un souci ici (profondeur = n petit), mais ça le devient sur une DFS de graphe.

## Défis

### 1. Subsets

Donne tous les sous-ensembles d'un tableau d'entiers **distincts**, y compris l'ensemble vide. L'ordre de sortie (et à l'intérieur de chaque sous-ensemble) est libre.

- `[1, 2, 3]` → `[[], [1], [2], [3], [1,2], [1,3], [2,3], [1,2,3]]`
- `[0]` → `[[], [0]]`

Problème équivalent sur LeetCode : Subsets.

<Challenge :data="subsets" />

::: details Explication
Chaque nœud de l'arbre est une réponse : on pousse `path` **à l'entrée** de `dfs`, sans condition d'arrêt. `start` garantit qu'on ne prend les éléments que dans l'ordre du tableau, donc pas de doublons `[1,2]` / `[2,1]`.

Alternative itérative : partir de `[[]]` et, pour chaque `x`, ajouter une copie de chaque sous-ensemble existant avec `x` en plus. Ou un bitmask de 0 à 2ⁿ - 1.

Complexité : O(n · 2ⁿ) en temps, O(n) de pile.

```rust play
fn subsets(nums: &[i32]) -> Vec<Vec<i32>> {
    fn dfs(nums: &[i32], start: usize, path: &mut Vec<i32>,
           res: &mut Vec<Vec<i32>>) {
        res.push(path.clone());
        for i in start..nums.len() {
            path.push(nums[i]);
            dfs(nums, i + 1, path, res);
            path.pop();
        }
    }
    let mut res = Vec::new();
    dfs(nums, 0, &mut Vec::new(), &mut res);
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    fn norm(mut v: Vec<Vec<i32>>) -> Vec<Vec<i32>> {
        for s in v.iter_mut() { s.sort(); }
        v.sort();
        v
    }
    #[test] fn three() {
        let want = vec![vec![], vec![1], vec![2], vec![3], vec![1, 2],
            vec![1, 3], vec![2, 3], vec![1, 2, 3]];
        assert_eq!(norm(subsets(&[1, 2, 3])), norm(want));
    }
    #[test] fn empty() { assert_eq!(subsets(&[]), vec![vec![]]); }
    #[test] fn count() { assert_eq!(subsets(&[1, 2, 3, 4, 5]).len(), 32); }
}
```
:::

### 2. Permutations

Donne toutes les permutations d'un tableau d'entiers **distincts**. Les tests comparent l'ordre exact : le starter trie déjà le résultat lexicographiquement, garde le `return res.sort(lexCmp)`.

- `[1, 2, 3]` → `[[1,2,3], [1,3,2], [2,1,3], [2,3,1], [3,1,2], [3,2,1]]`
- `[0, 1]` → `[[0,1], [1,0]]`

Problème équivalent sur LeetCode : Permutations.

<Challenge :data="permutations" />

::: details Explication
L'ordre compte : à chaque niveau on peut prendre **n'importe quel** élément pas encore utilisé, donc la boucle repart de 0 et un tableau `used` (ou un `Set`) mémorise ce qui est dans `path`. On s'arrête quand `path.length === n`.

Variante sans `used` : permuter en place par swaps (`swap(start, i)`, récursion sur `start + 1`, re-swap). Moins de mémoire, mais l'ordre de sortie n'est pas lexicographique.

Complexité : O(n · n!) en temps, O(n) en mémoire hors résultat.

```rust play
fn permute(nums: &[i32]) -> Vec<Vec<i32>> {
    fn dfs(nums: &[i32], used: &mut Vec<bool>, path: &mut Vec<i32>,
           res: &mut Vec<Vec<i32>>) {
        if path.len() == nums.len() {
            res.push(path.clone());
            return;
        }
        for i in 0..nums.len() {
            if used[i] { continue; }
            used[i] = true;
            path.push(nums[i]);
            dfs(nums, used, path, res);
            path.pop();
            used[i] = false;
        }
    }
    let mut res = Vec::new();
    let mut used = vec![false; nums.len()];
    dfs(nums, &mut used, &mut Vec::new(), &mut res);
    res.sort(); // Vec<i32> est Ord : ordre lexicographique
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn three() {
        assert_eq!(permute(&[1, 2, 3]), vec![vec![1, 2, 3], vec![1, 3, 2],
            vec![2, 1, 3], vec![2, 3, 1], vec![3, 1, 2], vec![3, 2, 1]]);
    }
    #[test] fn one() { assert_eq!(permute(&[1]), vec![vec![1]]); }
    #[test] fn count() { assert_eq!(permute(&[1, 2, 3, 4, 5]).len(), 120); }
}
```
:::

### 3. Combination Sum

Des candidats **distincts et positifs**, une cible. Trouve toutes les combinaisons uniques dont la somme vaut la cible, chaque candidat pouvant être pris **autant de fois que tu veux**. Deux combinaisons qui ne diffèrent que par l'ordre comptent pour une.

- `candidates = [2, 3, 6, 7], target = 7` → `[[2,2,3], [7]]`
- `candidates = [2, 3, 5], target = 8` → `[[2,2,2,2], [2,3,3], [3,5]]`
- `candidates = [2], target = 1` → `[]`

Problème équivalent sur LeetCode : Combination Sum.

<Challenge :data="combinationSum" />

::: details Explication
Template subsets avec deux changements : l'appel récursif est `dfs(i, rest - x)` (on reste sur `i` pour pouvoir le reprendre) et on s'arrête quand `rest === 0`. Le `start` empêche toujours les doublons d'ordre.

Élagage : trier les candidats, puis `break` dès que `nums[i] > rest`.

Complexité : bornée par O(N^(T/m)) où T est la cible et m le plus petit candidat (profondeur max T/m, N choix par niveau). En pratique l'élagage coupe énormément.

Variante « Combination Sum II » (chaque candidat une seule fois, doublons dans l'entrée) : `dfs(i + 1)` + le saut `i > start && nums[i] === nums[i - 1]`.

```rust play
fn combination_sum(candidates: &[i32], target: i32) -> Vec<Vec<i32>> {
    fn dfs(nums: &[i32], start: usize, rest: i32, path: &mut Vec<i32>,
           res: &mut Vec<Vec<i32>>) {
        if rest == 0 {
            res.push(path.clone());
            return;
        }
        for i in start..nums.len() {
            if nums[i] > rest { break; }
            path.push(nums[i]);
            dfs(nums, i, rest - nums[i], path, res);
            path.pop();
        }
    }
    let mut nums = candidates.to_vec();
    nums.sort();
    let mut res = Vec::new();
    dfs(&nums, 0, target, &mut Vec::new(), &mut res);
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    fn norm(mut v: Vec<Vec<i32>>) -> Vec<Vec<i32>> {
        for s in v.iter_mut() { s.sort(); }
        v.sort();
        v
    }
    #[test] fn basic() {
        assert_eq!(norm(combination_sum(&[2, 3, 6, 7], 7)),
            vec![vec![2, 2, 3], vec![7]]);
    }
    #[test] fn three() {
        assert_eq!(norm(combination_sum(&[2, 3, 5], 8)),
            vec![vec![2, 2, 2, 2], vec![2, 3, 3], vec![3, 5]]);
    }
    #[test] fn none() { assert!(combination_sum(&[2], 1).is_empty()); }
}
```
:::

### 4. Combinaisons de lettres d'un clavier de téléphone

Sur un vieux clavier, `2` = `abc`, `3` = `def`, … `7` = `pqrs`, `9` = `wxyz`. Étant donné une chaîne de chiffres 2–9, renvoie tous les mots qu'elle peut taper. Chaîne vide → `[]`. Ordre libre.

- `"23"` → `["ad","ae","af","bd","be","bf","cd","ce","cf"]`
- `""` → `[]`
- `"2"` → `["a","b","c"]`

Problème équivalent sur LeetCode : Letter Combinations of a Phone Number.

<Challenge :data="letterCombinations" />

::: details Explication
Ici, le niveau `i` de l'arbre correspond au chiffre `i`, et les choix sont les lettres de ce chiffre. Pas de `start` : chaque niveau a sa propre liste de choix. On s'arrête à `i === digits.length`.

Le piège : `""` doit renvoyer `[]` et pas `[""]` (le template pousserait le chemin vide).

Complexité : O(4ⁿ · n) (au plus 4 lettres par chiffre, copie de longueur n).

```rust play
const KEYS: [&str; 10] = [
    "", "", "abc", "def", "ghi", "jkl", "mno", "pqrs", "tuv", "wxyz",
];

fn letter_combinations(digits: &str) -> Vec<String> {
    fn dfs(d: &[u8], i: usize, path: &mut String,
           res: &mut Vec<String>) {
        if i == d.len() {
            res.push(path.clone());
            return;
        }
        for ch in KEYS[(d[i] - b'0') as usize].chars() {
            path.push(ch);
            dfs(d, i + 1, path, res);
            path.pop();
        }
    }
    if digits.is_empty() { return vec![]; }
    let mut res = Vec::new();
    dfs(digits.as_bytes(), 0, &mut String::new(), &mut res);
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn two_digits() {
        let mut v = letter_combinations("23");
        v.sort();
        assert_eq!(v, vec!["ad", "ae", "af", "bd", "be", "bf",
            "cd", "ce", "cf"]);
    }
    #[test] fn empty() { assert!(letter_combinations("").is_empty()); }
    #[test] fn count() { assert_eq!(letter_combinations("79").len(), 16); }
}
```
:::

### 5. Word Search

Une grille de lettres et un mot. Le mot existe-t-il dans la grille en enchaînant des cases **adjacentes** (haut, bas, gauche, droite, pas de diagonale), chaque case au plus une fois ?

```
A B C E
S F C S
A D E E
```

- `"ABCCED"` → `true`
- `"SEE"` → `true`
- `"ABCB"` → `false` (il faudrait réutiliser le `B`)

Problème équivalent sur LeetCode : Word Search.

<Challenge :data="wordSearch" />

::: details Explication
On lance un DFS depuis chaque case. `dfs(r, c, i)` vérifie que la case correspond à `word[i]`, la **marque** (on remplace la lettre par `#`), explore les 4 voisins pour `i + 1`, puis **restaure** la lettre. C'est le marquage temporaire qui distingue ce backtracking d'un BFS de [graphe](/interview/01-algo/08-graphes) où « visité » est définitif.

Le `||` court-circuite : dès qu'un chemin réussit, on arrête.

Optimisations bonus : compter les lettres de la grille et sortir tout de suite si le mot en demande plus ; inverser le mot si sa dernière lettre est plus rare que la première.

Complexité : O(R · C · 3ᴸ) en temps, O(L) de pile.

```rust play
fn exist(board: &mut Vec<Vec<u8>>, word: &str) -> bool {
    fn dfs(b: &mut Vec<Vec<u8>>, w: &[u8], r: i32, c: i32,
           i: usize) -> bool {
        if i == w.len() { return true; }
        if r < 0 || c < 0 { return false; }
        let (ru, cu) = (r as usize, c as usize);
        if ru >= b.len() || cu >= b[0].len() { return false; }
        if b[ru][cu] != w[i] { return false; }
        let saved = b[ru][cu];
        b[ru][cu] = b'#';
        let found = dfs(b, w, r + 1, c, i + 1)
            || dfs(b, w, r - 1, c, i + 1)
            || dfs(b, w, r, c + 1, i + 1)
            || dfs(b, w, r, c - 1, i + 1);
        b[ru][cu] = saved;
        found
    }
    let w = word.as_bytes();
    for r in 0..board.len() {
        for c in 0..board[0].len() {
            if dfs(board, w, r as i32, c as i32, 0) { return true; }
        }
    }
    false
}

fn grid(rows: &[&str]) -> Vec<Vec<u8>> {
    rows.iter().map(|r| r.bytes().collect()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn found() {
        assert!(exist(&mut grid(&["ABCE", "SFCS", "ADEE"]), "ABCCED"));
        assert!(exist(&mut grid(&["ABCE", "SFCS", "ADEE"]), "SEE"));
    }
    #[test] fn reuse() {
        assert!(!exist(&mut grid(&["ABCE", "SFCS", "ADEE"]), "ABCB"));
    }
    #[test] fn diag() { assert!(!exist(&mut grid(&["AB", "CD"]), "AD")); }
}
```
:::

### 6. N-Queens

Place `n` reines sur un échiquier `n × n` sans qu'aucune paire ne s'attaque (même ligne, même colonne ou même diagonale). Renvoie le **nombre** de placements possibles.

- `n = 4` → `2`
- `n = 1` → `1`
- `n = 2` ou `3` → `0`
- `n = 8` → `92`

Problème équivalent sur LeetCode : N-Queens II.

<Challenge :data="nQueens" />

::: details Explication
On place **une reine par ligne** (contrainte de ligne gratuite). Pour la ligne `r`, on essaie chaque colonne `c` libre. Trois ensembles rendent la vérification O(1) :

- `cols` : colonnes occupées ;
- `diag` : `r - c` est constant sur une diagonale `\` ;
- `anti` : `r + c` est constant sur une diagonale `/`.

On ajoute aux trois, on récurse sur `r + 1`, on retire des trois. Quand `r === n`, on a une solution.

Optimisation classique : trois entiers utilisés comme bitmasks au lieu de `Set` (`(cols | diag | anti) & mask` donne les cases libres). Même complexité, constante bien meilleure.

Complexité : O(n!) en temps (borne grossière : n choix en ligne 0, au plus n - 1 en ligne 1…), O(n) en mémoire.

Pour la version « renvoie les plateaux » (LeetCode N-Queens), garde en plus `queens[r] = c` et construis les chaînes au moment de la solution.

```rust play
fn total_n_queens(n: usize) -> u32 {
    fn place(r: usize, n: usize, cols: &mut Vec<bool>,
             diag: &mut Vec<bool>, anti: &mut Vec<bool>) -> u32 {
        if r == n { return 1; }
        let mut count = 0;
        for c in 0..n {
            let (d, a) = (r + n - 1 - c, r + c); // index >= 0
            if cols[c] || diag[d] || anti[a] { continue; }
            cols[c] = true; diag[d] = true; anti[a] = true;
            count += place(r + 1, n, cols, diag, anti);
            cols[c] = false; diag[d] = false; anti[a] = false;
        }
        count
    }
    let m = 2 * n;
    place(0, n, &mut vec![false; n], &mut vec![false; m],
          &mut vec![false; m])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn small() {
        assert_eq!(total_n_queens(1), 1);
        assert_eq!(total_n_queens(2), 0);
        assert_eq!(total_n_queens(4), 2);
    }
    #[test] fn eight() { assert_eq!(total_n_queens(8), 92); }
}
```
:::

## À retenir

- Backtracking = DFS sur l'arbre des choix : **choisir, explorer, annuler**.
- Trois réglages font tout : `dfs(i + 1)` (combinaisons), `dfs(i)` (réutilisation), boucle depuis 0 + `used` (permutations).
- Toujours **copier** `path` en le stockant, toujours **défaire** ce qu'on a fait.
- L'élagage (tri + `break`, ensembles de contraintes en O(1)) fait la différence entre TLE et accepté.
- Doublons dans l'entrée : trier, puis `if (i > start && nums[i] === nums[i - 1]) continue`.
- « Toutes les solutions » + petites contraintes → backtracking ; « combien » ou « le meilleur » avec gros n → DP.
