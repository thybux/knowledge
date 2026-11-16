# Stack & queue

<script setup>
import validParentheses from "./challenges/valid-parentheses";
import evalRpn from "./challenges/eval-rpn";
import dailyTemperatures from "./challenges/daily-temperatures";
import slidingWindowMaximum from "./challenges/sliding-window-maximum";
import largestRectangle from "./challenges/largest-rectangle-histogram";
</script>

<Progress :ids="['valid-parentheses', 'eval-rpn', 'daily-temperatures', 'sliding-window-maximum', 'largest-rectangle-histogram']" />

Ce que tu vas apprendre : quand une pile (LIFO) ou une file (FIFO) est la bonne structure, comment les implémenter correctement en TS et en Rust, et la **monotonic stack / deque**, qui transforme des O(n²) en O(n) sur les problèmes de « prochain plus grand » et de max sur fenêtre.

## Pile (stack) : LIFO

Le dernier entré est le premier sorti. On s'en sert dès qu'il faut **revenir** sur l'élément ouvert le plus récent : parenthèses, appels de fonctions, undo, DFS itératif, parsing.

```ts
const stack: number[] = [];
stack.push(1); // O(1) amorti
stack.push(2);
stack[stack.length - 1]; // peek : 2 (ou stack.at(-1))
stack.pop(); // 2, O(1)
stack.length === 0; // vide ?
```

```rust play
fn main() {
    let mut stack: Vec<i32> = Vec::new();
    stack.push(1);
    stack.push(2);
    println!("{:?}", stack.last()); // Some(2) : peek
    println!("{:?}", stack.pop()); // Some(2)
    println!("{:?}", stack.pop()); // Some(1)
    println!("{:?}", stack.pop()); // None : pas de panique
    // while let : le pattern idiomatique pour vider une pile
    let mut todo = vec!["a", "b", "c"];
    while let Some(job) = todo.pop() {
        println!("traite {job}");
    }
}
```

## File (queue) : FIFO

Le premier entré est le premier sorti : BFS, traitement de jobs dans l'ordre, buffers.

En JS, **pas de `shift()`** sur de gros tableaux : c'est O(n). Un indice de tête suffit :

```ts
class Queue<T> {
  private items: T[] = [];
  private head = 0;
  push(x: T) { this.items.push(x); }
  shift(): T | undefined {
    if (this.head === this.items.length) return undefined;
    const x = this.items[this.head++];
    // compacte quand la moitié du tableau est "morte"
    if (this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return x;
  }
  get size() { return this.items.length - this.head; }
}
```

En Rust, `VecDeque` (buffer circulaire) fait push/pop aux deux bouts en O(1) :

```rust play
use std::collections::VecDeque;

fn main() {
    let mut q: VecDeque<&str> = VecDeque::new();
    q.push_back("job-1");
    q.push_back("job-2");
    q.push_front("urgent"); // deque : aussi à l'avant
    while let Some(job) = q.pop_front() {
        println!("{job}");
    }
}
```

## Monotonic stack

Une pile dont les éléments restent **triés** (croissants ou décroissants). Avant d'empiler `x`, on dépile tout ce qui casserait l'ordre — et **chaque élément dépilé vient de trouver sa réponse** : `x` est son « prochain plus grand » (ou plus petit).

```ts
// Template : prochain élément strictement plus grand (à droite)
function nextGreater(a: number[]): number[] {
  const out = new Array<number>(a.length).fill(-1);
  const stack: number[] = []; // INDICES ; valeurs décroissantes
  for (let i = 0; i < a.length; i++) {
    // a[i] est le prochain plus grand de tous ceux qu'il dépile
    while (stack.length && a[stack[stack.length - 1]] < a[i]) {
      out[stack.pop()!] = a[i];
    }
    stack.push(i);
  }
  return out; // ceux restés dans la pile : -1
}
// nextGreater([2, 1, 2, 4, 3]) -> [4, 2, 4, -1, -1]
```

```rust play
fn next_greater(a: &[i32]) -> Vec<Option<i32>> {
    let mut out = vec![None; a.len()];
    let mut stack: Vec<usize> = Vec::new();
    for (i, &x) in a.iter().enumerate() {
        while let Some(&top) = stack.last() {
            if a[top] >= x {
                break;
            }
            out[top] = Some(x);
            stack.pop();
        }
        stack.push(i);
    }
    out
}

fn main() {
    println!("{:?}", next_greater(&[2, 1, 2, 4, 3]));
}
```

Les variantes se déduisent du template :

| On cherche | Ordre de la pile | Condition de dépilement |
|---|---|---|
| prochain plus grand | décroissante | `a[top] < x` |
| prochain plus petit | croissante | `a[top] > x` |
| précédent plus grand | décroissante | après dépilement, le sommet |

**Complexité** : chaque indice est empilé une fois et dépilé au plus une fois → O(n) au total, même avec le `while`.

Stocke des **indices** plutôt que des valeurs : tu peux toujours relire la valeur, et tu obtiens les distances (`i - j`).

## Monotonic deque

Même idée, mais on retire aussi par **l'avant** les éléments sortis d'une fenêtre glissante. Le max de la fenêtre est toujours en tête. C'est le défi 4.

## Comment le reconnaître

- Ouvrant/fermant, imbrication, « valide », « équilibré » → pile.
- Expression à évaluer, notation postfixe, calculatrice → pile.
- « Annuler », « revenir en arrière », chemin de fichiers (`..`) → pile.
- « Prochain / précédent plus grand / plus petit », « combien de jours avant… » → monotonic stack.
- « Max/min de chaque fenêtre de taille k » → monotonic deque.
- « Plus grand rectangle », « eau piégée », « span » → monotonic stack.
- Traitement dans l'ordre d'arrivée, niveau par niveau → file (BFS, voir [Graphes](/interview/01-algo/08-graphes)).

## Cas réel

Un back-office d'e-commerce affiche, pour chaque jour, « nombre de jours avant que le prix repasse au-dessus de celui-ci » sur des historiques de 100 000 points par produit. La double boucle naïve est O(n²) : 10¹⁰ opérations par produit au pire (prix décroissant), le job de nuit ne finit pas. Avec une monotonic stack : une passe, O(n).

Autre usage quotidien : le DFS itératif. Parcourir une arborescence de dossiers (ou de catégories en base) avec une pile explicite évite le stack overflow sur une profondeur anormale :

```ts
type Folder = { name: string; children: Folder[] };

function allPaths(root: Folder): string[] {
  const out: string[] = [];
  const stack: [Folder, string][] = [[root, root.name]];
  while (stack.length) {
    const [f, path] = stack.pop()!;
    out.push(path);
    for (const c of f.children) stack.push([c, `${path}/${c.name}`]);
  }
  return out; // ordre DFS ; une file donnerait un BFS
}
```

Remplacer la pile par une file (`Queue` ci-dessus) transforme ce DFS en BFS : même code, autre structure.

## Pièges classiques

- `shift()` dans une boucle de BFS en JS : O(n²) caché.
- Pile vide : en JS, `pop()` renvoie `undefined` (silencieux) ; en Rust, `pop()` renvoie `None` — gère-le, ne `unwrap()` pas à l'aveugle.
- Parenthèses : oublier de vérifier que la pile est **vide** à la fin (`"(("`).
- Monotonic stack : stocker les valeurs au lieu des indices, puis ne plus pouvoir calculer de distance.
- Strict ou non strict (`<` vs `<=`) : relis l'énoncé, les égalités changent la réponse.
- RPN : inverser les opérandes (`a - b` où `b` est le sommet) et utiliser `Math.floor` au lieu de `Math.trunc` pour la division.

::: info Min Stack
Le classique « pile avec `getMin()` en O(1) » est traité avec les autres problèmes de conception dans [Design de structures](/interview/01-algo/13-design-structures).
:::

## Défis

### 1. Valid Parentheses

`s` ne contient que `()[]{}`. Retourne `true` si chaque ouvrante est fermée par le bon type et dans le bon ordre.

- `"()[]{}"` → `true`
- `"([)]"` → `false`
- `"{[]}"` → `true`

Problème équivalent sur LeetCode : Valid Parentheses.

<Challenge :data="validParentheses" />

::: details Explication
On empile à chaque ouvrante… la **fermante attendue**. À chaque fermante, on dépile et on compare : différent (ou pile vide) → `false`. À la fin, la pile doit être vide.

Empiler la fermante attendue évite une table de correspondance inverse. Temps O(n), espace O(n).

```rust
fn is_valid(s: &str) -> bool {
    let mut stack = Vec::new();
    for c in s.chars() {
        match c {
            // on empile la fermante attendue : comparaison directe
            '(' => stack.push(')'),
            '[' => stack.push(']'),
            '{' => stack.push('}'),
            _ => {
                if stack.pop() != Some(c) {
                    return false;
                }
            }
        }
    }
    stack.is_empty()
}
```
:::

### 2. Evaluate Reverse Polish Notation

Évalue une expression en notation polonaise inverse (postfixe). Opérateurs `+ - * /` ; la division entière **tronque vers zéro**.

- `["2", "1", "+", "3", "*"]` → `9` (`(2 + 1) * 3`)
- `["4", "13", "5", "/", "+"]` → `6` (`4 + 13 / 5`)
- `["7", "-2", "/"]` → `-3`

Problème équivalent sur LeetCode : Evaluate Reverse Polish Notation.

<Challenge :data="evalRpn" />

::: details Explication
Un nombre → on l'empile. Un opérateur → on dépile `b` (sommet) puis `a`, et on empile `a op b`. L'ordre compte pour `-` et `/`. Attention à `"-11"` : c'est un nombre, pas l'opérateur `-` (d'où le test sur la longueur en TS, et `parse` en Rust).

`Math.trunc(-6 / 4)` = `-1`, alors que `Math.floor` donnerait `-2`. En Rust, `/` sur des entiers tronque déjà vers zéro. Temps O(n), espace O(n).

```rust
fn eval_rpn(tokens: &[&str]) -> i64 {
    let mut st: Vec<i64> = Vec::new();
    for &tok in tokens {
        if let Ok(n) = tok.parse::<i64>() {
            st.push(n);
            continue;
        }
        // attention à l'ordre : b est au sommet
        let b = st.pop().expect("expression invalide");
        let a = st.pop().expect("expression invalide");
        st.push(match tok {
            "+" => a + b,
            "-" => a - b,
            "*" => a * b,
            "/" => a / b, // la division entière Rust tronque vers 0
            _ => panic!("opérateur inconnu : {tok}"),
        });
    }
    st.pop().unwrap_or(0)
}
```
:::

### 3. Daily Temperatures

Pour chaque jour, combien de jours attendre une température **strictement** plus chaude ? 0 si jamais.

- `[73, 74, 75, 71, 69, 72, 76, 73]` → `[1, 1, 4, 2, 1, 1, 0, 0]`
- `[30, 60, 90]` → `[1, 1, 0]`

Problème équivalent sur LeetCode : Daily Temperatures.

<Challenge :data="dailyTemperatures" />

::: details Explication
Monotonic stack d'**indices** à températures décroissantes. Quand `t[i]` est plus chaud que le sommet `j`, `i` est le premier jour plus chaud que `j` : `out[j] = i - j`, on dépile et on recommence. Puis on empile `i`. Les indices restés dans la pile n'ont pas de jour plus chaud (0).

Chaque indice est empilé et dépilé au plus une fois : O(n) temps, O(n) espace. La brute force (pour chaque jour, chercher à droite) est O(n²) : le test « 5000 jours décroissants puis un pic » est exactement son pire cas.

```rust
fn daily_temperatures(t: &[i32]) -> Vec<usize> {
    let mut out = vec![0; t.len()];
    // pile d'indices, températures strictement décroissantes
    let mut stack: Vec<usize> = Vec::new();
    for i in 0..t.len() {
        while let Some(&j) = stack.last() {
            if t[j] >= t[i] {
                break;
            }
            stack.pop();
            out[j] = i - j; // i est le premier jour plus chaud que j
        }
        stack.push(i);
    }
    out
}
```
:::

### 4. Sliding Window Maximum

Retourne le maximum de chaque fenêtre de taille `k` qui glisse de gauche à droite.

- `nums = [1, 3, -1, -3, 5, 3, 6, 7], k = 3` → `[3, 3, 5, 5, 6, 7]`
- `nums = [9, 11], k = 2` → `[11]`

Problème équivalent sur LeetCode : Sliding Window Maximum.

<Challenge :data="slidingWindowMaximum" />

::: details Explication
Deque d'**indices** dont les valeurs sont décroissantes de l'avant à l'arrière. Pour chaque `i` :

1. si l'indice en tête est sorti de la fenêtre (`≤ i - k`), on le retire par l'avant ;
2. on retire par l'arrière tous les indices dont la valeur est `≤ nums[i]` : ils sont plus vieux **et** plus petits, ils ne seront plus jamais le max ;
3. on ajoute `i` à l'arrière ;
4. dès que `i ≥ k - 1`, le max de la fenêtre est `nums[tête]`.

Chaque indice entre et sort une fois : O(n) temps, O(k) espace. Un heap donnerait O(n log n) ; la brute force O(n·k), trop lente sur le dernier test (2·10⁷). En JS, on simule la deque avec un tableau + un indice de tête, car `shift()` est O(n).

```rust
fn max_sliding_window(nums: &[i32], k: usize) -> Vec<i32> {
    // indices, valeurs strictement décroissantes de l'avant à l'arrière
    let mut dq: VecDeque<usize> = VecDeque::new();
    let mut out = Vec::new();
    for i in 0..nums.len() {
        // l'indice en tête est sorti de la fenêtre ?
        if dq.front().is_some_and(|&j| j + k <= i) {
            dq.pop_front();
        }
        // les plus petits que nums[i] ne seront plus jamais max
        while dq.back().is_some_and(|&j| nums[j] <= nums[i]) {
            dq.pop_back();
        }
        dq.push_back(i);
        if i + 1 >= k {
            out.push(nums[dq[0]]);
        }
    }
    out
}
```
:::

### 5. Largest Rectangle in Histogram

`heights[i]` est la hauteur d'une barre de largeur 1. Aire du plus grand rectangle contenu dans l'histogramme.

- `[2, 1, 5, 6, 2, 3]` → `10` (barres 5 et 6, hauteur 5, largeur 2)
- `[2, 4]` → `4`

Problème équivalent sur LeetCode : Largest Rectangle in Histogram.

<Challenge :data="largestRectangle" />

::: details Explication
Pour chaque barre `h`, le meilleur rectangle de hauteur exactement `h` s'étend jusqu'à la première barre **plus basse** à gauche et à droite. Une monotonic stack croissante donne les deux d'un coup : quand `heights[i]` est plus basse que le sommet, `i` est la borne droite du sommet, et l'élément juste en dessous dans la pile est sa borne gauche. On dépile et on calcule `h × (i - gauche - 1)`.

Une barre sentinelle de hauteur 0 en fin de parcours vide la pile. Temps O(n), espace O(n). C'est la base d'un autre classique : « plus grand rectangle de 1 dans une matrice » (on applique ce défi ligne par ligne).

```rust
fn largest_rectangle_area(h: &[i32]) -> i32 {
    let mut stack: Vec<usize> = Vec::new(); // hauteurs croissantes
    let mut best = 0;
    // i == h.len() : barre sentinelle de hauteur 0 qui vide la pile
    for i in 0..=h.len() {
        let cur = if i < h.len() { h[i] } else { 0 };
        while let Some(&top) = stack.last() {
            if h[top] < cur {
                break;
            }
            stack.pop();
            // h[top] s'étend de (nouveau sommet + 1) à i - 1
            let left = stack.last().map_or(0, |&l| l + 1);
            best = best.max(h[top] * (i - left) as i32);
        }
        stack.push(i);
    }
    best
}
```
:::

## À retenir

- Pile = revenir sur le plus récent (imbrication, undo, DFS itératif) ; file = ordre d'arrivée (BFS, jobs).
- JS : `push`/`pop` pour la pile ; jamais `shift()` en boucle, utilise un indice de tête. Rust : `Vec` et `VecDeque`.
- Monotonic stack : chaque élément dépilé trouve sa réponse ; O(n) car chaque indice entre et sort une fois.
- Stocke des **indices** dans la pile, pas des valeurs.
- Max/min de fenêtre glissante → monotonic deque, O(n).
