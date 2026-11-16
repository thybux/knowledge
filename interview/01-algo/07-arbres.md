# Arbres

<script setup>
import maxDepth from "./challenges/max-depth-binary-tree";
import invertTree from "./challenges/invert-binary-tree";
import levelOrder from "./challenges/level-order-traversal";
import validateBst from "./challenges/validate-bst";
import lca from "./challenges/lowest-common-ancestor";
import serialize from "./challenges/serialize-deserialize-tree";
</script>

<Progress :ids="['max-depth-binary-tree', 'invert-binary-tree', 'level-order-traversal', 'validate-bst', 'lowest-common-ancestor', 'serialize-deserialize-tree']" />

Ce que tu vas apprendre : penser un problème d'arbre comme une **récursion** (« que dois-je demander à mes enfants ? »), les parcours DFS (pré/in/post-ordre) et BFS, les propriétés des BST, l'ancêtre commun (LCA), et la sérialisation.

## Vocabulaire et représentation

Un arbre binaire : chaque nœud a au plus deux enfants. La **hauteur** est le nombre de nœuds (ou d'arêtes, selon l'énoncé) du plus long chemin racine → feuille. Un arbre **équilibré** a une hauteur O(log n) ; un arbre dégénéré (un « peigne ») a une hauteur O(n).

```ts
class TreeNode {
  constructor(
    public val: number = 0,
    public left: TreeNode | null = null,
    public right: TreeNode | null = null,
  ) {}
}
```

Dans les défis, un arbre arrive au **format LeetCode** : un tableau en largeur (level order), `null` pour un enfant absent. `[3, 9, 20, null, null, 15, 7]` :

```
    3
   / \
  9  20
    /  \
   15   7
```

Les helpers `buildTree` / `toArray` sont fournis dans le code de départ.

## DFS récursif : la question à se poser

Presque tous les problèmes d'arbre s'écrivent : « si je connais la réponse pour mon sous-arbre gauche et mon sous-arbre droit, comment je calcule la mienne ? » Plus le cas de base (`null`).

```ts
// Template DFS post-ordre : les enfants d'abord, puis le nœud
function solve(node: TreeNode | null): number {
  if (!node) return 0; // cas de base
  const l = solve(node.left); // ce que dit le sous-arbre gauche
  const r = solve(node.right); // ... et le droit
  return combine(node.val, l, r); // ma réponse
}

// Exemples de combine
const size = (n: TreeNode | null): number =>
  n ? 1 + size(n.left) + size(n.right) : 0;
const sum = (n: TreeNode | null): number =>
  n ? n.val + sum(n.left) + sum(n.right) : 0;
```

Quand l'information descend (bornes d'un BST, chemin depuis la racine, profondeur courante), on la passe **en paramètre** : c'est le pré-ordre.

| Ordre | Visite | Usage typique |
|---|---|---|
| pré-ordre | nœud, gauche, droite | copier, sérialiser, passer un contexte |
| in-ordre | gauche, nœud, droite | BST → valeurs **triées** |
| post-ordre | gauche, droite, nœud | hauteur, taille, supprimer, LCA |

Coût : chaque nœud est visité une fois, O(n) temps, O(h) d'espace pour la pile d'appels.

## DFS itératif

Si l'arbre peut être très profond, la récursion explose la pile. Une pile explicite fait la même chose :

```ts
function inorder(root: TreeNode | null): number[] {
  const out: number[] = [];
  const stack: TreeNode[] = [];
  let cur = root;
  while (cur || stack.length) {
    while (cur) { stack.push(cur); cur = cur.left; } // tout à gauche
    cur = stack.pop()!;
    out.push(cur.val); // visite
    cur = cur.right;
  }
  return out;
}
```

## BFS : niveau par niveau

Une file. Pour séparer les niveaux, on traite exactement `queue.length` éléments à chaque tour (ou on construit le tableau du niveau suivant). Utile pour : niveaux, vue de droite, plus court chemin en nombre d'arêtes, « la feuille la plus proche ».

```rust play
use std::collections::VecDeque;

#[derive(Debug)]
struct TreeNode {
    val: i32,
    left: Option<Box<TreeNode>>,
    right: Option<Box<TreeNode>>,
}

fn leaf(val: i32) -> Option<Box<TreeNode>> {
    Some(Box::new(TreeNode { val, left: None, right: None }))
}

// vue de droite : le dernier nœud de chaque niveau
fn right_view(root: &Option<Box<TreeNode>>) -> Vec<i32> {
    let mut out = vec![];
    let mut q: VecDeque<&TreeNode> = root.as_deref().into_iter().collect();
    while !q.is_empty() {
        let n = q.len(); // taille du niveau courant
        for i in 0..n {
            let node = q.pop_front().unwrap();
            if i == n - 1 {
                out.push(node.val);
            }
            q.extend(node.left.as_deref());
            q.extend(node.right.as_deref());
        }
    }
    out
}

fn main() {
    let root = Some(Box::new(TreeNode {
        val: 1,
        left: Some(Box::new(TreeNode { val: 2, left: None, right: leaf(5) })),
        right: leaf(3),
    }));
    println!("{:?}", right_view(&root)); // [1, 3, 5]
}
```

En Rust, on utilise ici `Option<Box<TreeNode>>` (un seul propriétaire, simple). LeetCode impose `Option<Rc<RefCell<TreeNode>>>` : même logique, avec des `.borrow()` en plus.

## BST : arbre binaire de recherche

Pour tout nœud : **toutes** les valeurs à gauche sont plus petites, **toutes** à droite sont plus grandes. Conséquences :

- recherche / insertion en O(h) : on descend à gauche ou à droite comme une binary search ;
- le parcours **in-ordre** donne les valeurs triées (« k-ième plus petit » = k-ième de l'in-ordre) ;
- h = O(log n) seulement si l'arbre est équilibré. Les structures de prod (`BTreeMap` en Rust, les index B-tree des SGBD) restent équilibrées par construction.

```ts
function searchBST(n: TreeNode | null, v: number): TreeNode | null {
  while (n && n.val !== v) n = v < n.val ? n.left : n.right;
  return n;
}
```

## LCA : plus proche ancêtre commun

Le LCA de `p` et `q` est le nœud le plus profond qui a les deux dans son sous-arbre (un nœud est son propre ancêtre).

- **Dans un BST** : on descend depuis la racine ; si `p` et `q` sont tous les deux plus petits, à gauche ; tous les deux plus grands, à droite ; sinon on est sur le LCA. O(h).
- **Arbre quelconque** : post-ordre. Un nœud renvoie « j'ai trouvé p ou q dans mon sous-arbre ». Le premier nœud qui reçoit un résultat des **deux** côtés est le LCA (défi 5). O(n).

## Sérialisation

Transformer un arbre en chaîne et inversement (cache, réseau, base). Le pré-ordre avec un marqueur pour `null` suffit à reconstruire l'arbre sans ambiguïté : `1,2,#,#,3,4,#,#,5,#,#`. Le format LeetCode (BFS) en est un autre. Sans marqueur, il faut **deux** parcours (pré + in-ordre) et des valeurs uniques.

## Comment le reconnaître

- « Arbre », « hiérarchie », « parent / enfant » → DFS récursif d'abord.
- « Profondeur, hauteur, diamètre, équilibré, somme de chemin » → post-ordre (les enfants répondent d'abord).
- « Niveau », « vue de droite/gauche », « plus proche » → BFS.
- « BST », « trié », « k-ième plus petit » → in-ordre ou descente guidée.
- « Ancêtre commun », « distance entre deux nœuds » → LCA.
- « Encoder / décoder », « cloner », « reconstruire à partir de parcours » → sérialisation pré-ordre.

## Cas réel

Un SaaS stocke ses catégories (ou ses commentaires imbriqués, ou un organigramme) en base sous forme **liste d'adjacence** : `id, parent_id`. L'API doit renvoyer l'arbre en JSON et, pour chaque nœud, le nombre total d'éléments du sous-arbre.

```ts
type Row = { id: number; parentId: number | null; items: number };
type Node = Row & { children: Node[]; total: number };

function buildForest(rows: Row[]): Node[] {
  const byId = new Map<number, Node>();
  for (const r of rows) byId.set(r.id, { ...r, children: [], total: 0 });
  const roots: Node[] = [];
  for (const n of byId.values()) {
    const parent = n.parentId === null ? undefined : byId.get(n.parentId);
    (parent ? parent.children : roots).push(n);
  }
  // post-ordre : le total d'un nœud dépend de ses enfants
  const fill = (n: Node): number =>
    (n.total = n.items + n.children.reduce((s, c) => s + fill(c), 0));
  roots.forEach(fill);
  return roots;
}
```

O(n) grâce à la `Map` (sans elle, chercher le parent à chaque ligne serait O(n²)). Points de prod : une ligne dont le parent n'existe plus devient une racine (ou est signalée), une boucle `A → B → A` dans les données ferait tourner `fill` à l'infini — à valider à l'écriture. Côté SQL, la même chose se fait avec une CTE récursive (`WITH RECURSIVE`), voir [Postgres avancé](/bdd/05-postgres-avance).

## Pièges classiques

- Valider un BST en comparant seulement un nœud à ses **enfants directs** : `[5, 4, 6, null, null, 3, 7]` passe à tort (3 est dans le sous-arbre droit de 5).
- Bornes initiales `INT_MIN` / `INT_MAX` en dur : faux si un nœud vaut exactement ces valeurs. Utilise `±Infinity` (TS) ou `Option` (Rust).
- Oublier le cas `null` → `Cannot read properties of null`.
- Confondre hauteur en nœuds et en arêtes : relis l'énoncé.
- BFS en JS avec `shift()` : O(n²) sur un grand arbre. Indice de tête, ou tableau du niveau suivant.
- Récursion sur un arbre dégénéré de 10⁵ nœuds : stack overflow. Version itérative.
- Annoncer O(log n) pour un BST quelconque : c'est O(h), O(n) au pire.

## Défis

### 1. Maximum Depth of Binary Tree

Nombre de nœuds sur le plus long chemin de la racine à une feuille.

- `[3, 9, 20, null, null, 15, 7]` → `3`
- `[1, null, 2]` → `2`
- `[]` → `0`

Problème équivalent sur LeetCode : Maximum Depth of Binary Tree.

<Challenge :data="maxDepth" />

::: details Explication
Le template post-ordre dans sa forme la plus pure : `depth(null) = 0`, `depth(n) = 1 + max(depth(gauche), depth(droite))`. Temps O(n), espace O(h). Une version BFS compte simplement le nombre de niveaux.

```rust
fn max_depth(root: &Tree) -> usize {
    match root {
        None => 0,
        Some(n) => 1 + max_depth(&n.left).max(max_depth(&n.right)),
    }
}
```
:::

### 2. Invert Binary Tree

Retourne le miroir de l'arbre (gauche et droite échangés à tous les niveaux).

- `[4, 2, 7, 1, 3, 6, 9]` → `[4, 7, 2, 9, 6, 3, 1]`
- `[1, 2]` → `[1, null, 2]`

Problème équivalent sur LeetCode : Invert Binary Tree.

<Challenge :data="invertTree" />

::: details Explication
Pour chaque nœud, on échange ses deux enfants, puis on recommence dans chacun (l'ordre pré/post n'a pas d'importance tant que chaque nœud est traité une fois). Attention à sauvegarder `left` avant de l'écraser. Temps O(n), espace O(h).

En Rust, `take()` sort les deux enfants, et `Option::map` réécrit le nœud sans `match`.

```rust
fn invert_tree(root: Tree) -> Tree {
    root.map(|mut n| {
        let (l, r) = (n.left.take(), n.right.take());
        n.left = invert_tree(r);
        n.right = invert_tree(l);
        n
    })
}
```
:::

### 3. Level Order Traversal

Retourne les valeurs niveau par niveau, de gauche à droite.

- `[3, 9, 20, null, null, 15, 7]` → `[[3], [9, 20], [15, 7]]`
- `[]` → `[]`

Problème équivalent sur LeetCode : Binary Tree Level Order Traversal.

<Challenge :data="levelOrder" />

::: details Explication
BFS. La version TS garde le niveau courant dans un tableau et construit le suivant avec les enfants : pas de file, pas de `shift()`. La version Rust utilise une `VecDeque` et traite exactement `q.len()` éléments par niveau (la longueur est lue **avant** la boucle). Temps O(n), espace O(largeur max) ≤ O(n).

```rust
use std::collections::VecDeque;

fn level_order(root: &Tree) -> Vec<Vec<i32>> {
    let mut out = Vec::new();
    // des &TreeNode : on parcourt sans rien déplacer
    let mut q: VecDeque<&TreeNode> = root.as_deref().into_iter().collect();
    while !q.is_empty() {
        let mut level = Vec::with_capacity(q.len());
        for _ in 0..q.len() {
            // q.len() est figé au début : exactement un niveau
            let n = q.pop_front().unwrap();
            level.push(n.val);
            q.extend(n.left.as_deref()); // Option = itérable 0/1
            q.extend(n.right.as_deref());
        }
        out.push(level);
    }
    out
}
```
:::

### 4. Validate Binary Search Tree

L'arbre est-il un BST **strict** ? (tout le sous-arbre gauche < nœud < tout le sous-arbre droit)

- `[2, 1, 3]` → `true`
- `[5, 1, 4, null, null, 3, 6]` → `false` (4 < 5 à droite)
- `[5, 4, 6, null, null, 3, 7]` → `false` (3 < 5 dans le sous-arbre droit)

Problème équivalent sur LeetCode : Validate Binary Search Tree.

<Challenge :data="validateBst" />

::: details Explication
L'information **descend** : chaque nœud doit tenir dans un intervalle ouvert `(lo, hi)` hérité de ses ancêtres. En allant à gauche, `hi` devient la valeur du nœud ; à droite, c'est `lo`. Départ : `(-∞, +∞)`, ou `(None, None)` en Rust — ce qui gère proprement `i32::MIN` et `i32::MAX` dans l'arbre.

Alternative : un parcours in-ordre doit être **strictement croissant** ; on garde la valeur précédente. Temps O(n), espace O(h) dans les deux cas.

```rust
fn is_valid_bst(root: &Tree) -> bool {
    // chaque nœud doit être dans l'intervalle ouvert (lo, hi)
    fn go(t: &Tree, lo: Option<i32>, hi: Option<i32>) -> bool {
        let Some(n) = t else { return true };
        if lo.is_some_and(|lo| n.val <= lo) {
            return false;
        }
        if hi.is_some_and(|hi| n.val >= hi) {
            return false;
        }
        go(&n.left, lo, Some(n.val)) && go(&n.right, Some(n.val), hi)
    }
    go(root, None, None)
}
```
:::

### 5. Lowest Common Ancestor

Dans un arbre binaire **quelconque** (pas un BST) à valeurs uniques, trouve le plus proche ancêtre commun de `p` et `q` (tous deux présents). Un nœud est son propre ancêtre. Les tests passent les valeurs de `p` et `q` et vérifient la valeur du LCA.

Avec `[3, 5, 1, 6, 2, 0, 8, null, null, 7, 4]` :

```
        3
      /   \
     5     1
    / \   / \
   6   2 0   8
      / \
     7   4
```

- `p = 5, q = 1` → `3`
- `p = 5, q = 4` → `5`
- `p = 7, q = 4` → `2`

Problème équivalent sur LeetCode : Lowest Common Ancestor of a Binary Tree.

<Challenge :data="lca" />

::: details Explication
Post-ordre. `lca(n)` renvoie :

- `null` si ni `p` ni `q` n'est dans le sous-arbre ;
- `n` lui-même si `n` est `p` ou `q` (inutile de descendre : si l'autre est dessous, c'est bien `n` le LCA ; sinon, un ancêtre le verra des deux côtés) ;
- sinon, si gauche **et** droite renvoient quelque chose, `p` et `q` sont de part et d'autre : `n` est le LCA ;
- sinon, on remonte ce que renvoie le côté non vide.

Temps O(n), espace O(h). Dans un **BST**, on ferait mieux : descente guidée par les valeurs, O(h), sans pile.

```rust
// p et q existent dans l'arbre, valeurs uniques
fn lca(root: &Tree, p: i32, q: i32) -> Option<i32> {
    let n = root.as_ref()?;
    if n.val == p || n.val == q {
        return Some(n.val); // l'autre est dessous, ou ailleurs
    }
    match (lca(&n.left, p, q), lca(&n.right, p, q)) {
        (Some(_), Some(_)) => Some(n.val), // un de chaque côté
        (l, r) => l.or(r), // tout est du même côté
    }
}
```
:::

### 6. Serialize and Deserialize Binary Tree

Écris `serialize(root) → string` et `deserialize(string) → root` tels que `deserialize(serialize(t))` reconstruise exactement `t`. Format libre — mais n'utilise pas les helpers `toArray`/`buildTree`. Valeurs négatives et à plusieurs chiffres possibles.

- `[1, 2, 3, null, null, 4, 5]` → aller-retour → `[1, 2, 3, null, null, 4, 5]`
- `[]` → `[]`

Problème équivalent sur LeetCode : Serialize and Deserialize Binary Tree.

<Challenge :data="serialize" />

::: details Explication
Pré-ordre avec un marqueur `#` pour chaque enfant absent, jetons séparés par des virgules (les valeurs à plusieurs chiffres et négatives restent lisibles). À la lecture, on consomme les jetons **dans le même ordre** : un jeton → un nœud, puis on reconstruit récursivement son sous-arbre gauche, puis le droit. Le marqueur rend la structure non ambiguë.

Temps O(n) dans les deux sens, espace O(n) pour la chaîne et O(h) de pile. En Rust, `tok.parse().ok()?` traite `#` comme `None` en une ligne, et l'itérateur `split(',')` passé en `&mut` est consommé au fil des appels récursifs.

```rust
// préordre, "#" pour un enfant absent : "1,2,#,#,3,#,#"
fn serialize(root: &Tree) -> String {
    fn go(t: &Tree, out: &mut Vec<String>) {
        match t {
            None => out.push("#".into()),
            Some(n) => {
                out.push(n.val.to_string());
                go(&n.left, out);
                go(&n.right, out);
            }
        }
    }
    let mut out = Vec::new();
    go(root, &mut out);
    out.join(",")
}

fn deserialize(data: &str) -> Tree {
    // on relit dans le même ordre : racine, gauche, droite
    fn go<'a>(it: &mut impl Iterator<Item = &'a str>) -> Tree {
        let tok = it.next()?;
        let val = tok.parse().ok()?; // "#" -> None
        let left = go(it);
        let right = go(it);
        Some(Box::new(TreeNode { val, left, right }))
    }
    go(&mut data.split(','))
}
```
:::

## À retenir

- Problème d'arbre = « que me renvoient mes enfants ? » + cas `null`. O(n) temps, O(h) pile.
- Pré-ordre pour faire descendre un contexte (bornes, chemin) ; post-ordre pour remonter un résultat (hauteur, LCA) ; in-ordre d'un BST = trié.
- BFS = file (ou tableau par niveau) ; traiter `len` éléments par niveau.
- Valider un BST : intervalle hérité des ancêtres, pas juste les enfants directs.
- Sérialiser : pré-ordre + marqueur de `null` ; relire dans le même ordre.
- Rust : `Option<Box<TreeNode>>` pour l'entraînement ; `as_deref()`, `take()`, `Option::map` sont tes amis.
