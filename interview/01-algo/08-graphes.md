<script setup>
import numberOfIslands from "./challenges/number-of-islands";
import rottingOranges from "./challenges/rotting-oranges";
import courseSchedule from "./challenges/course-schedule";
import networkDelayTime from "./challenges/network-delay-time";
import redundantConnection from "./challenges/redundant-connection";
import wordLadder from "./challenges/word-ladder";
</script>

# Graphes

Ce que tu vas apprendre : modéliser un problème en graphe, puis dérouler les 5 outils qui couvrent 90 % des entretiens — BFS, DFS, tri topologique, Dijkstra et union-find.

<Progress :ids="['number-of-islands', 'rotting-oranges', 'course-schedule', 'network-delay-time', 'redundant-connection', 'word-ladder']" />

## Représenter un graphe

Un graphe = des **nœuds** et des **arêtes** (orientées ou non, pondérées ou non). En entretien on te le donne rarement « tout fait » : c'est une liste d'arêtes, une grille, ou des mots qui se ressemblent. Ton premier réflexe : construire une **liste d'adjacence**.

```ts
// edges = [[0, 1], [1, 2]] (non orienté), n nœuds
const adj: number[][] = Array.from({ length: n }, () => []);
for (const [a, b] of edges) {
  adj[a].push(b);
  adj[b].push(a); // retire cette ligne si orienté
}
```

| Représentation | Mémoire | Quand |
|---|---|---|
| Liste d'adjacence | O(V + E) | Par défaut |
| Matrice V×V | O(V²) | Graphe dense, V ≤ ~1000 |
| Grille implicite | O(1) en plus | Voisins = 4 directions |

::: tip Grille = graphe implicite
Dans une grille, chaque case est un nœud et ses voisins sont calculés à la volée avec un tableau `dirs`. Pas besoin de construire `adj`.
:::

```ts
const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
for (const [dr, dc] of dirs) {
  const nr = r + dr, nc = c + dc;
  if (nr < 0 || nc < 0 || nr >= R || nc >= C) continue;
  // ... (nr, nc) est un voisin valide
}
```

## BFS : le plus court chemin en nombre d'étapes

BFS explore **par couches** : d'abord tout ce qui est à distance 1, puis 2… Conséquence clé : la première fois que tu atteins un nœud, c'est par un plus court chemin (si toutes les arêtes valent 1).

```ts
function bfs(adj: number[][], start: number): number[] {
  const dist = new Array(adj.length).fill(-1);
  dist[start] = 0;
  const queue = [start];
  // index de tête au lieu de shift() (shift est O(n))
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    for (const v of adj[u]) {
      if (dist[v] !== -1) continue; // déjà vu
      dist[v] = dist[u] + 1;        // marque À L'ENFILAGE
      queue.push(v);
    }
  }
  return dist;
}
```

Deux détails qui séparent un junior d'un mid :

- **Marquer à l'enfilage**, pas au défilage. Sinon un nœud peut être enfilé plusieurs fois et ta complexité explose sur un graphe dense.
- `queue.shift()` est O(n) en JS. Avec un index de tête, la file reste O(1) amortie.

**BFS multi-source** : tu mets *plusieurs* nœuds de départ dans la file au début (toutes les oranges pourries, tous les entrepôts…). Ça calcule la distance au départ le plus proche, en un seul passage.

En Rust, la file c'est `VecDeque` :

```rust play
use std::collections::VecDeque;

fn bfs(adj: &[Vec<usize>], start: usize) -> Vec<Option<u32>> {
    let mut dist = vec![None; adj.len()];
    dist[start] = Some(0);
    let mut q = VecDeque::from([start]);
    while let Some(u) = q.pop_front() {
        let d = dist[u].unwrap();
        for &v in &adj[u] {
            if dist[v].is_none() {
                dist[v] = Some(d + 1);
                q.push_back(v);
            }
        }
    }
    dist
}

fn main() {
    let adj = vec![vec![1, 2], vec![3], vec![3], vec![]];
    println!("{:?}", bfs(&adj, 0)); // [Some(0), Some(1), Some(1), Some(2)]
}
```

## DFS : explorer tout ce qui est atteignable

DFS va le plus loin possible avant de revenir. Il ne donne **pas** de plus court chemin, mais il est parfait pour : compter des composantes, détecter un cycle, remplir une zone (flood fill), lister des chemins.

```ts
// Version récursive : la plus lisible
function dfs(u: number, adj: number[][], seen: boolean[]) {
  seen[u] = true;
  for (const v of adj[u]) if (!seen[v]) dfs(v, adj, seen);
}

// Composantes connexes = nombre de DFS lancés
let components = 0;
const seen = new Array(n).fill(false);
for (let i = 0; i < n; i++) {
  if (!seen[i]) { components++; dfs(i, adj, seen); }
}
```

::: warning Profondeur de récursion
Une grille 1000×1000 pleine = un million d'appels imbriqués : `RangeError: Maximum call stack size exceeded` en Node, stack overflow en Rust. Dans ce cas, DFS **itératif** avec une pile explicite (même code que BFS, mais `pop()` au lieu de lire en tête). Dis-le en entretien : ça montre que tu as déjà vu le problème en vrai.
:::

```rust play
fn components(n: usize, edges: &[(usize, usize)]) -> usize {
    let mut adj = vec![vec![]; n];
    for &(a, b) in edges {
        adj[a].push(b);
        adj[b].push(a);
    }
    let mut seen = vec![false; n];
    let mut count = 0;
    for s in 0..n {
        if seen[s] { continue; }
        count += 1;
        let mut stack = vec![s]; // DFS itératif
        seen[s] = true;
        while let Some(u) = stack.pop() {
            for &v in &adj[u] {
                if !seen[v] { seen[v] = true; stack.push(v); }
            }
        }
    }
    count
}

fn main() {
    println!("{}", components(5, &[(0, 1), (1, 2), (3, 4)])); // 2
}
```

## Tri topologique : ordonner des dépendances

Sur un graphe **orienté sans cycle** (DAG), un ordre topologique liste les nœuds de façon que chaque arête `u → v` ait `u` avant `v`. C'est exactement « dans quel ordre exécuter ces tâches ». S'il y a un cycle, aucun ordre n'existe — et c'est souvent *ça* qu'on te demande de détecter.

**Algorithme de Kahn** (BFS sur les degrés entrants) :

```ts
function topoSort(n: number, edges: number[][]): number[] | null {
  const adj: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);
  for (const [u, v] of edges) { adj[u].push(v); indeg[v]++; }

  const order: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) order.push(i);
  // order sert aussi de file
  for (let h = 0; h < order.length; h++) {
    for (const v of adj[order[h]]) {
      if (--indeg[v] === 0) order.push(v); // plus de dépendance
    }
  }
  return order.length === n ? order : null; // null = cycle
}
```

L'alternative DFS « 3 couleurs » (blanc = pas vu, gris = sur la pile d'appel, noir = terminé) détecte un cycle quand tu croises un nœud **gris**. Kahn est plus simple à écrire sans bug et ne dépend pas de la profondeur de récursion : c'est celui que je te conseille en entretien.

::: info L'ordre n'est pas unique
Plusieurs ordres topologiques sont souvent valides. Si l'énoncé exige « le plus petit lexicographiquement », remplace la file de Kahn par une min-heap (voir [Heap & top-K](/interview/01-algo/09-heap-top-k)).
:::

## Dijkstra : plus court chemin pondéré

Quand les arêtes ont des **poids positifs** (latence, coût, distance), BFS ne suffit plus. Dijkstra = BFS où la file devient une **file de priorité** triée par distance.

```ts
// adj[u] = [[v, w], ...] ; MinHeap : voir le défi plus bas
function dijkstra(adj: [number, number][][], src: number) {
  const dist = new Array(adj.length).fill(Infinity);
  dist[src] = 0;
  const pq = new MinHeap<[number, number]>((a, b) => a[0] < b[0]);
  pq.push([0, src]);
  while (pq.size) {
    const [d, u] = pq.pop()!;
    if (d > dist[u]) continue;   // entrée périmée : on l'ignore
    for (const [v, w] of adj[u]) {
      if (d + w < dist[v]) {     // relaxation
        dist[v] = d + w;
        pq.push([dist[v], v]);
      }
    }
  }
  return dist;
}
```

Complexité : **O((V + E) log V)**. On ne fait pas de « decrease-key » : on pousse un doublon et on jette les entrées périmées au `pop`. C'est la version standard en entretien comme en prod.

En Rust, `BinaryHeap` est un **max**-heap : on enveloppe dans `Reverse` pour avoir le min.

```rust play
use std::cmp::Reverse;
use std::collections::BinaryHeap;

fn dijkstra(adj: &[Vec<(usize, u64)>], src: usize) -> Vec<u64> {
    let mut dist = vec![u64::MAX; adj.len()];
    dist[src] = 0;
    let mut pq = BinaryHeap::from([Reverse((0u64, src))]);
    while let Some(Reverse((d, u))) = pq.pop() {
        if d > dist[u] { continue; }
        for &(v, w) in &adj[u] {
            let nd = d + w;
            if nd < dist[v] {
                dist[v] = nd;
                pq.push(Reverse((nd, v)));
            }
        }
    }
    dist
}

fn main() {
    let adj = vec![vec![(1, 4), (2, 1)], vec![], vec![(1, 2)]];
    println!("{:?}", dijkstra(&adj, 0)); // [0, 3, 1]
}
```

::: danger Poids négatifs
Dijkstra est **faux** avec des poids négatifs (un nœud « finalisé » pourrait être amélioré plus tard). Il faut alors Bellman-Ford, O(V·E). En entretien, il suffit de savoir le dire.
:::

| Situation | Outil |
|---|---|
| Poids tous égaux | BFS, O(V + E) |
| Poids 0 ou 1 | BFS 0-1 (deque) |
| Poids positifs | Dijkstra |
| Poids négatifs | Bellman-Ford |

## Union-find : « sont-ils connectés ? »

Union-find (ou DSU, *disjoint set union*) maintient des groupes qui fusionnent au fil du temps. Deux opérations :

- `find(x)` : le représentant du groupe de `x` ;
- `union(a, b)` : fusionne les groupes de `a` et `b`.

Avec la **compression de chemin** et l'**union par rang**, chaque opération coûte O(α(n)) — quasi constant en pratique.

```ts
class DSU {
  parent: number[];
  rank: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]; // compression
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): boolean {
    let ra = this.find(a), rb = this.find(b);
    if (ra === rb) return false;          // déjà ensemble
    if (this.rank[ra] < this.rank[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;                 // petit sous grand
    if (this.rank[ra] === this.rank[rb]) this.rank[ra]++;
    return true;
  }
}
```

Quand préférer DSU à DFS ? Quand les arêtes **arrivent au fil de l'eau** (« après chaque ajout, combien de groupes ? ») ou quand tu dois détecter l'arête qui crée un cycle dans un graphe non orienté. C'est aussi le cœur de l'algorithme de Kruskal (arbre couvrant minimal).

## Comment le reconnaître

| Signal dans l'énoncé | Outil |
|---|---|
| « grille », « îles », « zones », « régions » | DFS/BFS sur grille |
| « nombre minimum d'étapes / de coups » | BFS |
| « se propage », « chaque minute » | BFS multi-source |
| « prérequis », « dépendances », « ordre » | Tri topologique |
| « est-ce possible de tout terminer ? » | Détection de cycle |
| « coût / temps / latence minimal » | Dijkstra |
| « groupes », « connectés », « fusionner » | Union-find |
| Transformer un état en un autre, 1 changement à la fois | BFS sur états |

Le dernier signal est le plus subtil : dans Word Ladder, personne ne te dit « graphe ». Les nœuds sont des mots, les arêtes « diffèrent d'une lettre ». Pareil pour un cadenas à 4 roues ou un puzzle : **un état = un nœud**.

## Cas réel

**Worker de jobs avec dépendances.** Ton back-office lance un export comptable nocturne : `extract_invoices`, `extract_payments`, puis `reconcile` (qui dépend des deux), puis `generate_pdf` et `send_email`. Les jobs sont déclarés en base avec leurs dépendances.

- Au **déploiement** d'une nouvelle définition, tu lances Kahn : si `order.length !== n`, il y a un cycle → tu refuses la config avec la liste des jobs restants (ce sont exactement ceux du cycle ou bloqués derrière).
- Au **runtime**, Kahn *est* l'ordonnanceur : `indeg[v]` = nombre de dépendances non terminées. Quand un job finit, tu décrémentes ses successeurs et tu enfiles ceux qui tombent à 0. Tous les jobs de la file peuvent tourner **en parallèle**.

C'est le modèle de GitHub Actions (`needs:`), de Terraform (graphe de ressources), de `pnpm` (ordre de build d'un monorepo) et des migrations SQL avec dépendances.

Autres usages réels : Dijkstra pour un routage de livreurs (poids = minutes), BFS pour « suggestions d'amis à 2 niveaux », union-find pour regrouper des comptes en doublon partageant un e-mail ou un IBAN (dédoublonnage anti-fraude).

## Pièges classiques

- **Oublier le `seen`** sur un graphe avec cycles → boucle infinie. Sur un arbre, pas besoin ; sur un graphe, toujours.
- **Marquer au défilage** en BFS : correct mais peut enfiler un nœud des dizaines de fois.
- **`queue.shift()`** dans une boucle chaude : O(n²) caché.
- **Composantes oubliées** : un graphe peut être non connexe. La boucle `for (i of 0..n) if (!seen[i])` est obligatoire pour la détection de cycle ou le comptage.
- **Indices 1..n** (LeetCode adore) : alloue `n + 1` cases.
- **Diagonales** : relis l'énoncé, 4 ou 8 directions ?
- **Dijkstra avec poids négatifs**, ou Dijkstra quand un BFS suffisait (poids tous à 1).
- **Muter l'entrée** sans le dire : en entretien, annonce-le (« je marque les cases visitées en place pour économiser la mémoire, OK ? »).

## Défis

### 1. Nombre d'îles

On te donne une grille de `"1"` (terre) et `"0"` (eau), sous forme de tableau de lignes. Une île est un groupe de `"1"` reliés **horizontalement ou verticalement** (pas en diagonale). Compte les îles.

```
["11000",
 "11000",
 "00100",
 "00011"]  → 3
```

Problème équivalent sur LeetCode : Number of Islands.

<Challenge :data="numberOfIslands" />

::: details Explication
Parcours toutes les cases. Chaque fois que tu tombes sur une terre pas encore visitée, c'est une **nouvelle île** : incrémente le compteur et lance un DFS (ou BFS) qui marque toute l'île. Les cases déjà marquées ne relancent rien.

Le dernier test (200×200 plein) fait 40 000 appels imbriqués avec un DFS récursif : ça passe souvent en Node, mais c'est limite. La version itérative avec pile est sûre.

**Complexité** : O(R·C) en temps (chaque case visitée une fois), O(R·C) en mémoire (`seen` + pile). Si tu peux muter la grille, tu peux « couler » l'île (`"1"` → `"0"`) au lieu d'un `seen`.

```rust play
fn num_islands(grid: &[&str]) -> usize {
    let g: Vec<&[u8]> = grid.iter().map(|r| r.as_bytes()).collect();
    let rows = g.len();
    if rows == 0 { return 0; }
    let cols = g[0].len();
    let mut seen = vec![vec![false; cols]; rows];
    let mut count = 0;
    for r in 0..rows {
        for c in 0..cols {
            if g[r][c] != b'1' || seen[r][c] { continue; }
            count += 1;
            seen[r][c] = true;
            let mut stack = vec![(r, c)];
            while let Some((cr, cc)) = stack.pop() {
                let dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)];
                for (dr, dc) in dirs {
                    let nr = cr as isize + dr;
                    let nc = cc as isize + dc;
                    if nr < 0 || nc < 0 { continue; }
                    let (nr, nc) = (nr as usize, nc as usize);
                    if nr >= rows || nc >= cols { continue; }
                    if g[nr][nc] == b'1' && !seen[nr][nc] {
                        seen[nr][nc] = true;
                        stack.push((nr, nc));
                    }
                }
            }
        }
    }
    count
}

fn main() {
    println!("{}", num_islands(&["11000", "11000", "00100", "00011"]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn one() {
        assert_eq!(num_islands(&["11110", "11010", "11000", "00000"]), 1);
    }
    #[test]
    fn three() {
        assert_eq!(num_islands(&["11000", "11000", "00100", "00011"]), 3);
    }
    #[test]
    fn empty() { assert_eq!(num_islands(&[]), 0); }
    #[test]
    fn diag() { assert_eq!(num_islands(&["101", "010", "101"]), 5); }
}
```

Remarque l'astuce Rust : on calcule les voisins en `isize` puis on revient en `usize` après le test de bornes (un `usize` ne peut pas valoir -1).
:::

### 2. Oranges pourries

Grille de `0` (vide), `1` (orange fraîche), `2` (orange pourrie). Chaque minute, toute orange fraîche **adjacente** (4 directions) à une pourrie pourrit. Retourne le nombre de minutes avant qu'il ne reste plus aucune fraîche, ou `-1` si c'est impossible.

```
[[2,1,1],
 [1,1,0],
 [0,1,1]]  → 4

[[0,2]]    → 0   (rien à pourrir)
```

Problème équivalent sur LeetCode : Rotting Oranges.

<Challenge :data="rottingOranges" />

::: details Explication
C'est le BFS **multi-source** type : toutes les oranges pourries au départ sont dans la file à la minute 0. On traite la file **niveau par niveau** (un niveau = une minute) en comptant les fraîches restantes.

Fin : si `fresh === 0`, la réponse est le nombre de niveaux traités ; sinon `-1`. La condition `while (queue.length && fresh > 0)` évite de compter une minute de trop après la dernière contamination.

**Complexité** : O(R·C) temps et mémoire.

```rust play
use std::collections::VecDeque;

fn oranges_rotting(mut grid: Vec<Vec<u8>>) -> i32 {
    let rows = grid.len();
    let cols = if rows > 0 { grid[0].len() } else { 0 };
    let mut q = VecDeque::new();
    let mut fresh = 0;
    for r in 0..rows {
        for c in 0..cols {
            match grid[r][c] {
                2 => q.push_back((r, c)),
                1 => fresh += 1,
                _ => {}
            }
        }
    }
    let mut minutes = 0;
    while !q.is_empty() && fresh > 0 {
        for _ in 0..q.len() { // un niveau = une minute
            let (r, c) = q.pop_front().unwrap();
            let cand = [
                (r.wrapping_sub(1), c), (r + 1, c),
                (r, c.wrapping_sub(1)), (r, c + 1),
            ];
            for (nr, nc) in cand {
                if nr < rows && nc < cols && grid[nr][nc] == 1 {
                    grid[nr][nc] = 2;
                    fresh -= 1;
                    q.push_back((nr, nc));
                }
            }
        }
        minutes += 1;
    }
    if fresh == 0 { minutes } else { -1 }
}

fn main() {
    let g = vec![vec![2, 1, 1], vec![1, 1, 0], vec![0, 1, 1]];
    println!("{}", oranges_rotting(g));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn four() {
        let g = vec![vec![2, 1, 1], vec![1, 1, 0], vec![0, 1, 1]];
        assert_eq!(oranges_rotting(g), 4);
    }
    #[test]
    fn impossible() {
        let g = vec![vec![2, 1, 1], vec![0, 1, 1], vec![1, 0, 1]];
        assert_eq!(oranges_rotting(g), -1);
    }
    #[test]
    fn none_fresh() { assert_eq!(oranges_rotting(vec![vec![0, 2]]), 0); }
    #[test]
    fn two_sources() {
        assert_eq!(oranges_rotting(vec![vec![2, 1, 1, 1, 2]]), 2);
    }
}
```

`wrapping_sub(1)` sur `0usize` donne `usize::MAX`, qui échoue au test `nr < rows` : une façon idiomatique d'éviter les `isize`.
:::

### 3. Planning de cours

Tu dois suivre `n` cours numérotés de `0` à `n - 1`. `prereqs[i] = [a, b]` signifie « il faut avoir suivi `b` avant `a` ». Peux-tu suivre tous les cours ?

```
n = 2, [[1, 0]]          → true  (0 puis 1)
n = 2, [[1, 0], [0, 1]]  → false (cycle)
```

Problème équivalent sur LeetCode : Course Schedule.

<Challenge :data="courseSchedule" />

::: details Explication
« Tout terminer » = « le graphe des dépendances n'a pas de cycle ». Kahn : on calcule les degrés entrants, on démarre avec les cours sans prérequis, et chaque cours terminé libère ses successeurs. Si à la fin on a traité `n` cours, pas de cycle.

Attention au sens : `[a, b]` = arête **b → a** (b débloque a).

**Complexité** : O(V + E) temps et mémoire.

Variante très fréquente : *Course Schedule II*, qui demande de **retourner** l'ordre — c'est la liste `order` de Kahn.

```rust play
use std::collections::VecDeque;

fn can_finish(n: usize, prereqs: &[(usize, usize)]) -> bool {
    let mut adj = vec![vec![]; n];
    let mut indeg = vec![0; n];
    for &(a, b) in prereqs {
        adj[b].push(a);
        indeg[a] += 1;
    }
    let mut q: VecDeque<usize> =
        (0..n).filter(|&i| indeg[i] == 0).collect();
    let mut done = 0;
    while let Some(u) = q.pop_front() {
        done += 1;
        for &v in &adj[u] {
            indeg[v] -= 1;
            if indeg[v] == 0 { q.push_back(v); }
        }
    }
    done == n
}

fn main() {
    println!("{}", can_finish(2, &[(1, 0)]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ok() { assert!(can_finish(2, &[(1, 0)])); }
    #[test]
    fn cycle() { assert!(!can_finish(2, &[(1, 0), (0, 1)])); }
    #[test]
    fn self_loop() { assert!(!can_finish(1, &[(0, 0)])); }
    #[test]
    fn diamond() {
        assert!(can_finish(4, &[(1, 0), (2, 0), (3, 1), (3, 2)]));
    }
}
```
:::

### 4. Délai de propagation réseau

Un réseau de `n` serveurs numérotés de `1` à `n`. `times[i] = [u, v, w]` : un message met `w` ms pour aller de `u` à `v` (lien orienté). On envoie un signal depuis `k`. Combien de temps avant que **tous** les serveurs l'aient reçu ? Retourne `-1` si l'un d'eux est injoignable.

```
times = [[2,1,1],[2,3,1],[3,4,1]], n = 4, k = 2  → 2
times = [[1,2,1]], n = 2, k = 2                  → -1
```

Le starter contient une `MinHeap` prête à l'emploi : `new MinHeap<T>((a, b) => a < b)`, avec `push`, `pop` et `size`.

Problème équivalent sur LeetCode : Network Delay Time.

<Challenge :data="networkDelayTime" />

::: details Explication
Plus court chemin depuis une source, poids positifs → **Dijkstra**. La réponse est le **max** des distances (le dernier serveur atteint), ou `-1` s'il reste un `Infinity`.

Le test « détour plus court » piège ceux qui font un BFS : `1 → 2` coûte 10 en direct mais 2 via `3`.

**Complexité** : O((V + E) log V) temps, O(V + E) mémoire.

```rust play
use std::cmp::Reverse;
use std::collections::BinaryHeap;

fn network_delay_time(
    times: &[(usize, usize, u32)], n: usize, k: usize,
) -> Option<u32> {
    let mut adj = vec![vec![]; n + 1];
    for &(u, v, w) in times { adj[u].push((v, w)); }
    let mut dist = vec![u32::MAX; n + 1];
    dist[k] = 0;
    let mut pq = BinaryHeap::from([Reverse((0u32, k))]);
    while let Some(Reverse((d, u))) = pq.pop() {
        if d > dist[u] { continue; }
        for &(v, w) in &adj[u] {
            if d + w < dist[v] {
                dist[v] = d + w;
                pq.push(Reverse((dist[v], v)));
            }
        }
    }
    let max = *dist[1..].iter().max()?;
    (max != u32::MAX).then_some(max)
}

fn main() {
    let t = [(2, 1, 1), (2, 3, 1), (3, 4, 1)];
    println!("{:?}", network_delay_time(&t, 4, 2));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        let t = [(2, 1, 1), (2, 3, 1), (3, 4, 1)];
        assert_eq!(network_delay_time(&t, 4, 2), Some(2));
    }
    #[test]
    fn unreachable() {
        assert_eq!(network_delay_time(&[(1, 2, 1)], 2, 2), None);
    }
    #[test]
    fn detour() {
        let t = [(1, 2, 10), (1, 3, 1), (3, 2, 1)];
        assert_eq!(network_delay_time(&t, 3, 1), Some(2));
    }
}
```

En Rust, retourner `Option<u32>` est plus honnête que `-1` : le type dit « peut-être injoignable ».
:::

### 5. Connexion redondante

Un réseau de `n` nœuds (`1..n`) était un **arbre**, puis quelqu'un a ajouté **une** arête en trop, ce qui crée un cycle. `edges` contient les `n` arêtes non orientées. Retourne l'arête qu'on peut retirer pour retrouver un arbre ; si plusieurs conviennent, celle qui apparaît **en dernier** dans `edges`.

```
[[1,2],[1,3],[2,3]]              → [2,3]
[[1,2],[2,3],[3,4],[1,4],[1,5]]  → [1,4]
```

Problème équivalent sur LeetCode : Redundant Connection.

<Challenge :data="redundantConnection" />

::: details Explication
Ajoute les arêtes une par une dans un union-find. La **première** arête dont les deux extrémités sont déjà dans le même groupe ferme un cycle : c'est la réponse. Pourquoi est-ce aussi « la dernière du cycle dans l'ordre » ? Parce que toutes les autres arêtes du cycle ont été ajoutées avant elle sans conflit.

**Complexité** : O(n · α(n)) ≈ O(n) temps, O(n) mémoire. Un DFS par arête marcherait aussi, mais en O(n²).

```rust play
struct Dsu {
    parent: Vec<usize>,
    rank: Vec<u8>,
}

impl Dsu {
    fn new(n: usize) -> Self {
        Dsu { parent: (0..n).collect(), rank: vec![0; n] }
    }
    fn find(&mut self, mut x: usize) -> usize {
        while self.parent[x] != x {
            self.parent[x] = self.parent[self.parent[x]];
            x = self.parent[x];
        }
        x
    }
    /// Retourne false si a et b étaient déjà connectés.
    fn union(&mut self, a: usize, b: usize) -> bool {
        let (mut ra, mut rb) = (self.find(a), self.find(b));
        if ra == rb { return false; }
        if self.rank[ra] < self.rank[rb] {
            std::mem::swap(&mut ra, &mut rb);
        }
        self.parent[rb] = ra;
        if self.rank[ra] == self.rank[rb] { self.rank[ra] += 1; }
        true
    }
}

fn find_redundant_connection(edges: &[(usize, usize)]) -> (usize, usize) {
    let mut dsu = Dsu::new(edges.len() + 1);
    for &(a, b) in edges {
        if !dsu.union(a, b) { return (a, b); }
    }
    unreachable!("l'énoncé garantit une arête en trop")
}

fn main() {
    println!("{:?}", find_redundant_connection(&[(1, 2), (1, 3), (2, 3)]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn triangle() {
        let e = [(1, 2), (1, 3), (2, 3)];
        assert_eq!(find_redundant_connection(&e), (2, 3));
    }
    #[test]
    fn square() {
        let e = [(1, 2), (2, 3), (3, 4), (1, 4), (1, 5)];
        assert_eq!(find_redundant_connection(&e), (1, 4));
    }
    #[test]
    fn dup() {
        assert_eq!(find_redundant_connection(&[(1, 2), (1, 2)]), (1, 2));
    }
}
```
:::

### 6. Échelle de mots

On part du mot `begin` et on veut atteindre `end`. À chaque étape on change **une seule lettre**, et chaque mot obtenu doit appartenir au dictionnaire `words` (`begin` n'a pas besoin d'y être). Retourne le **nombre de mots** de la plus courte séquence (début et fin inclus), ou `0` si impossible.

```
"hit" → "cog", words = [hot,dot,dog,lot,log,cog]
hit → hot → dot → dog → cog   → 5
```

Problème équivalent sur LeetCode : Word Ladder.

<Challenge :data="wordLadder" />

::: details Explication
« Plus court » + « un changement à la fois » = **BFS sur des états**. Les nœuds sont les mots, une arête relie deux mots à une lettre d'écart.

Le piège est la génération des voisins. Comparer chaque mot à tous les autres coûte O(N²·L). À la place, pour un mot de longueur L, génère les L × 26 variantes et garde celles présentes dans un `Set` : O(N·L·26) appels, chacun construisant une chaîne de taille L, donc **O(N·L²·26)** au total, ce qui est bien meilleur quand N est grand.

Optimisation à mentionner : le **BFS bidirectionnel** (une frontière depuis `begin`, une depuis `end`, on étend toujours la plus petite) réduit fortement le nombre d'états explorés.

```rust play
use std::collections::{HashSet, VecDeque};

fn ladder_length(begin: &str, end: &str, words: &[&str]) -> usize {
    let dict: HashSet<&str> = words.iter().copied().collect();
    if !dict.contains(end) { return 0; }
    let mut seen: HashSet<String> = HashSet::from([begin.to_string()]);
    let mut q = VecDeque::from([(begin.to_string(), 1)]);
    while let Some((w, depth)) = q.pop_front() {
        if w == end { return depth; }
        let mut bytes = w.into_bytes();
        for i in 0..bytes.len() {
            let orig = bytes[i];
            for ch in b'a'..=b'z' {
                bytes[i] = ch;
                let cand = std::str::from_utf8(&bytes).unwrap();
                if dict.contains(cand) && !seen.contains(cand) {
                    seen.insert(cand.to_string());
                    q.push_back((cand.to_string(), depth + 1));
                }
            }
            bytes[i] = orig;
        }
    }
    0
}

fn main() {
    let w = ["hot", "dot", "dog", "lot", "log", "cog"];
    println!("{}", ladder_length("hit", "cog", &w));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        let w = ["hot", "dot", "dog", "lot", "log", "cog"];
        assert_eq!(ladder_length("hit", "cog", &w), 5);
    }
    #[test]
    fn missing_end() {
        let w = ["hot", "dot", "dog", "lot", "log"];
        assert_eq!(ladder_length("hit", "cog", &w), 0);
    }
    #[test]
    fn one_letter() {
        assert_eq!(ladder_length("a", "c", &["a", "b", "c"]), 2);
    }
}
```
:::

## À retenir

- Premier réflexe : **construire la liste d'adjacence** (ou reconnaître une grille / un graphe d'états implicite).
- **BFS** = plus court chemin en nombre d'étapes ; marque à l'enfilage, file avec index de tête. Multi-source pour les propagations.
- **DFS** = composantes, flood fill, cycles ; passe en itératif si la profondeur peut dépasser ~10⁴.
- **Kahn** = ordre de dépendances + détection de cycle (`order.length !== n`).
- **Dijkstra** = poids positifs, heap + entrées périmées ignorées, O((V+E) log V). En Rust : `BinaryHeap<Reverse<_>>`.
- **Union-find** avec compression + rang pour les connexions qui arrivent au fil de l'eau.
