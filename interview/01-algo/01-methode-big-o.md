# Méthode & Big-O

Ce que tu vas apprendre : une méthode fiable pour dérouler un problème d'algo en entretien, calculer une complexité sans hésiter, connaître le coût réel des structures JS et Rust, et deviner la complexité visée rien qu'en lisant les contraintes.

## La méthode en 7 étapes

Un entretien algo dure en général 45 min, dont ~30 sur le problème. L'intervieweur note **ta démarche** autant que ton code. Un candidat qui code en silence une solution parfaite marque moins de points qu'un candidat qui raisonne à voix haute et livre une solution correcte.

| Étape | Temps | Ce que tu fais |
|---|---|---|
| 1. Clarifier | 2–3 min | Questions sur l'entrée/sortie |
| 2. Exemples | 2 min | Un normal, un ou deux limites |
| 3. Brute force | 2–3 min | L'énoncer + sa complexité |
| 4. Optimiser | 5–10 min | Trouver le pattern |
| 5. Coder | 10–15 min | Propre, noms clairs |
| 6. Tester | 3–5 min | Dérouler à la main |
| 7. Complexité | 1 min | Temps + espace, justifiés |

### 1. Clarifier

Ne commence jamais à coder sur une hypothèse. Les questions qui reviennent :

- **Taille** de l'entrée ? (ça donne la complexité visée, voir plus bas)
- Valeurs **négatives** ? **zéro** ? **doublons** ?
- Entrée **vide** possible ? Que retourner alors ?
- Le tableau est-il **trié** ? (si oui : binary search ou two pointers)
- Que retourner : indices ou valeurs ? une solution ou toutes ? s'il n'y en a pas ?
- Je peux **modifier** l'entrée ? (trier en place change tout)

### 2. Exemples

Écris 2–3 exemples **à toi**, pas seulement celui de l'énoncé : un cas normal, le cas vide ou à 1 élément, un cas avec doublons. Ils serviront de tests à l'étape 6.

### 3. Brute force

Dis-la, même si elle est mauvaise : « Je peux tester toutes les paires, c'est O(n²). » Ça prouve que tu as compris le problème et ça te donne un filet de sécurité. Code-la seulement si tu ne trouves rien de mieux.

### 4. Optimiser

Questions à te poser, dans l'ordre :

- **Quel est le goulot ?** La boucle interne qui cherche quelque chose ? → une `Map`/`Set` la remplace souvent.
- **Je refais un calcul déjà fait ?** → sommes de préfixes, mémoïsation.
- **L'entrée est triée (ou je peux la trier) ?** → two pointers, binary search.
- **Je cherche un min/max sur une fenêtre ou un « prochain plus grand » ?** → sliding window, monotonic stack.
- **Échanger de la mémoire contre du temps** est presque toujours accepté.

### 5. Coder

- Annonce la structure avant d'écrire : « boucle sur `i`, une map valeur → indice ».
- Noms parlants (`left`, `right`, `seen`), pas `a`, `b`, `tmp2`.
- Extrais un helper dès que c'est plus lisible (`isAlnum(c)`, `fits(cap)`).
- Pas de micro-optimisation : la lisibilité gagne.

### 6. Tester à la main

Déroule ton code ligne par ligne sur un petit exemple, en notant l'état des variables. Puis passe tes cas limites. C'est là que tu trouves les `off-by-one` — avant l'intervieweur.

### 7. Complexité

« O(n) en temps car chaque élément entre et sort une fois de la pile, O(n) en espace pour la pile. » Toujours **temps et espace**, toujours **justifiés**.

::: tip Phrases utiles
« Je vais d'abord faire marcher la version simple, puis optimiser. »
« Je suppose que l'entrée tient en mémoire, c'est OK ? »
« Ici j'échange O(n) de mémoire contre un facteur n en temps. »
:::

## Big-O : l'intuition

Big-O décrit comment le coût **croît** quand `n` grandit. On garde le terme dominant et on jette les constantes : `3n² + 10n + 7` → O(n²).

```ts
// O(1) : ne dépend pas de n
const first = (a: number[]) => a[0];

// O(n) : une passe
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

// O(n²) : toutes les paires
function hasDup(a: number[]): boolean {
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++)
      if (a[i] === a[j]) return true;
  return false;
}

// O(log n) : on divise l'espace de recherche par 2
function countHalvings(n: number): number {
  let k = 0;
  while (n > 1) { n = Math.floor(n / 2); k++; }
  return k;
}
```

| Classe | n = 10⁶ (ordre de grandeur) | Typique |
|---|---|---|
| O(1) | 1 | accès tableau, `Map.get` |
| O(log n) | 20 | binary search |
| O(n) | 10⁶ | une passe |
| O(n log n) | 2·10⁷ | tri |
| O(n²) | 10¹² ❌ | double boucle |
| O(2ⁿ) | ∞ ❌ | sous-ensembles |

Repère utile : un processeur fait de l'ordre de **10⁸ opérations simples par seconde** (un peu moins en JS qu'en Rust). Au-delà de ~10⁹, c'est trop lent.

## Règles de calcul

- **Séquence** : les coûts s'additionnent, on garde le plus gros. O(n) puis O(n log n) → O(n log n).
- **Imbrication** : les coûts se multiplient. Boucle de n dans boucle de n → O(n²).
- **Deux entrées** : garde deux variables. Parcourir `a` puis `b` → O(a + b) ; `a` dans `b` → O(a·b). Ne dis pas O(n²) si les tailles sont indépendantes.
- **Division par une constante** à chaque tour → O(log n).
- **Récursion** : ≈ (nombre d'appels) × (travail par appel). Deux appels récursifs par niveau sur une profondeur n → O(2ⁿ) (Fibonacci naïf).

```ts
// O(n log n) et pas O(n²) : la boucle interne double j
for (let i = 0; i < n; i++)
  for (let j = 1; j < n; j *= 2) work(i, j);

// O(n) au total : left ne recule jamais (sliding window)
let left = 0;
for (let right = 0; right < n; right++)
  while (tooBig(left, right)) left++;
```

Le second cas est **le** piège classique : une boucle `while` imbriquée n'est pas forcément O(n²). Compte combien de fois chaque pointeur peut avancer **au total** (analyse amortie).

## Espace

- On compte la **mémoire auxiliaire** : ce que tu alloues en plus de l'entrée. La sortie est souvent exclue — précise-le.
- La **pile d'appels** compte : un DFS récursif sur un arbre de hauteur h coûte O(h) d'espace, O(n) si l'arbre est un peigne.
- `[...a]`, `a.slice()`, `s.split("")`, `.map()`, `.filter()` allouent O(n).

## Amorti, moyen, pire cas

- **Amorti** : `push` sur un `Array` JS ou un `Vec` Rust est O(1) amorti. Parfois le buffer double (O(n)), mais sur n `push` le total reste O(n).
- **Moyen vs pire** : une hash map est O(1) **en moyenne**, O(n) au pire (collisions). En entretien, on dit « O(1) en moyenne ».
- Le tri rapide est O(n log n) en moyenne, O(n²) au pire ; les tris des bibliothèques standard (TimSort en V8, driftsort/ipnsort en Rust) garantissent O(n log n).

## Coût des structures en JS/TS

| Opération | Coût | Remarque |
|---|---|---|
| `a[i]`, `a.length` | O(1) | |
| `push` / `pop` | O(1) amorti | pile ✅ |
| `shift` / `unshift` | O(n) | file ❌ |
| `includes`, `indexOf` | O(n) | dans une boucle = O(n²) |
| `splice`, `slice` | O(n) / O(k) | copies |
| `sort` | O(n log n) | stable ; comparateur requis pour des nombres |
| `Map`/`Set` get/set/has | O(1) moyen | ordre d'insertion conservé |

::: warning `sort()` sans comparateur
`[10, 9, 1].sort()` donne `[1, 10, 9]` : le tri par défaut compare des **chaînes**. Toujours `sort((a, b) => a - b)`.
:::

Pas de tas ni de deque dans la bibliothèque standard JS : en entretien, on écrit une petite classe (voir [Heap & top-k](/interview/01-algo/09-heap-top-k)) ou on simule une file avec un tableau + un indice de tête.

## Coût des structures en Rust

| Structure | Opérations clés | Coût |
|---|---|---|
| `Vec<T>` | `push`, `pop`, `v[i]` | O(1) (amorti) |
| `Vec<T>` | `insert(0, x)`, `remove(0)`, `contains` | O(n) |
| `VecDeque<T>` | `push_*`, `pop_*` aux 2 bouts | O(1) amorti |
| `HashMap`/`HashSet` | `get`, `insert`, `remove` | O(1) moyen |
| `BTreeMap`/`BTreeSet` | `get`, `insert`, `range` | O(log n), trié |
| `BinaryHeap<T>` | `push`, `pop` / `peek` | O(log n) / O(1) |

Points à connaître :

- `HashMap` utilise SipHash par défaut : résistant aux attaques par collisions, mais plus lent qu'un hash simple. En compétition on change de hasher ; en entretien, on n'y touche pas.
- `BinaryHeap` est un **max-heap**. Pour un min-heap : `BinaryHeap<Reverse<T>>`.
- `BTreeMap` donne l'ordre, le min/max (`first_key_value`) et les requêtes d'intervalle (`range`) en O(log n).
- `s.len()` d'une `String` compte des **octets** ; `s.chars().nth(i)` est O(n). Pour un problème ASCII, travaille sur `s.as_bytes()`.
- `v.swap_remove(i)` est O(1) si l'ordre ne compte pas.

```rust play
use std::cmp::Reverse;
use std::collections::{BTreeMap, BinaryHeap, VecDeque};

fn main() {
    // min-heap grâce à Reverse
    let mut heap = BinaryHeap::new();
    for x in [5, 1, 8, 3] {
        heap.push(Reverse(x));
    }
    let Reverse(min) = heap.pop().unwrap();
    println!("min = {min}"); // 1

    // file FIFO en O(1) aux deux bouts
    let mut q: VecDeque<i32> = VecDeque::from([1, 2, 3]);
    q.push_back(4);
    println!("front = {:?}", q.pop_front()); // Some(1)

    // map triée + requête d'intervalle
    let mut prices = BTreeMap::new();
    for (ts, p) in [(10, 99), (20, 101), (30, 97), (40, 103)] {
        prices.insert(ts, p);
    }
    let window: Vec<_> = prices.range(15..=35).collect();
    println!("{window:?}"); // [(20, 101), (30, 97)]
}
```

## Contrainte → complexité visée

Les contraintes de l'énoncé (ou la réponse à « quelle taille ? ») te disent quelle complexité est attendue. C'est l'indice le plus sous-estimé des juniors.

| n maximum | Complexité visée | Pistes |
|---|---|---|
| ≤ 10 | O(n!) | permutations |
| ≤ 20 | O(2ⁿ · n) | backtracking, bitmask |
| ≤ 500 | O(n³) | DP à 3 indices |
| ≤ 5 000 | O(n²) | double boucle, DP 2D |
| ≤ 10⁵ – 10⁶ | O(n log n) ou O(n) | tri, hash, two pointers, heap |
| ≥ 10⁹ (valeurs) | O(log n) | binary search sur la réponse |

Exemple : « `n ≤ 10⁵` » → O(n²) = 10¹⁰ opérations, trop lent. Il faut du O(n log n) au pire : tri, heap, ou une passe avec une `Map`.

## Reconnaître un pattern

| Signal dans l'énoncé | Pattern | Chapitre |
|---|---|---|
| « paire / complément », « déjà vu », « fréquence » | hash map | [Tableaux & hashing](/interview/01-algo/02-tableaux-hashing) |
| tableau **trié**, paires, « en place » | two pointers | [Two pointers](/interview/01-algo/03-two-pointers-sliding-window) |
| « sous-tableau / sous-chaîne **contigu** » le plus long/court | sliding window | [Sliding window](/interview/01-algo/03-two-pointers-sliding-window) |
| parenthèses, « prochain plus grand », annuler | stack | [Stack & queue](/interview/01-algo/04-stack-queue) |
| trié + O(log n), « minimum tel que… » | binary search | [Binary search](/interview/01-algo/05-binary-search) |
| « k plus grands », « k plus proches », flux | heap | [Heap & top-k](/interview/01-algo/09-heap-top-k) |
| grille, dépendances, plus court chemin | BFS / DFS | [Graphes](/interview/01-algo/08-graphes) |
| « toutes les combinaisons / permutations » | backtracking | [Backtracking](/interview/01-algo/10-backtracking) |
| « nombre de façons », « min/max coût », choix | DP | [Programmation dynamique](/interview/01-algo/11-programmation-dynamique) |
| intervalles, réunions, planning | tri + greedy | [Intervalles](/interview/01-algo/12-intervalles-greedy) |

## Cas réel

Un back-office importe un CSV de 200 000 clients et dédoublonne les emails. Le code d'origine :

```ts
const unique: string[] = [];
for (const row of rows) {
  if (!unique.includes(row.email)) unique.push(row.email);
}
```

`includes` est O(n) dans une boucle de n : O(n²) ≈ 2·10¹⁰ comparaisons de chaînes dans le pire cas (peu de doublons). L'import prend des minutes et bloque l'event loop Node pendant ce temps : toutes les autres requêtes du process attendent.

```ts
const seen = new Set<string>();
const unique: string[] = [];
for (const row of rows) {
  const email = row.email.trim().toLowerCase();
  if (!seen.has(email)) {
    seen.add(email);
    unique.push(email);
  }
}
```

O(n) : quelques dizaines de millisecondes. Même logique côté Rust avec `HashSet::insert`, qui renvoie `false` si la valeur était déjà là :

```rust play
use std::collections::HashSet;

fn dedup_emails(rows: &[&str]) -> Vec<String> {
    let mut seen = HashSet::new();
    rows.iter()
        .map(|e| e.trim().to_lowercase())
        .filter(|e| seen.insert(e.clone()))
        .collect()
}

fn main() {
    let rows = ["a@x.io", "B@x.io ", "A@X.io", "c@x.io"];
    println!("{:?}", dedup_emails(&rows));
}
```

La même erreur se retrouve partout en prod : `array.find` dans une boucle pour joindre deux listes venant de l'API, `filter(x => ids.includes(x.id))`… Le réflexe : **construire une `Map`/`Set` une fois, puis interroger en O(1)**. Côté base de données, c'est exactement le rôle d'un index (voir [Index & EXPLAIN](/bdd/03-index-et-explain)).

## Pièges classiques

- Coder avant d'avoir clarifié : 15 min perdues sur le mauvais problème.
- Oublier de donner l'**espace** (et la pile de récursion).
- Dire O(n²) dès qu'il y a deux boucles imbriquées, sans compter les avancées réelles des pointeurs.
- Confondre O(a + b) et O(n) quand il y a deux entrées de tailles différentes.
- Penser que `shift()` ou `includes()` sont gratuits en JS, ou `remove(0)` / `contains` en Rust.
- `sort()` sans comparateur sur des nombres en JS.
- Indexer une `String` Rust par caractère dans une boucle : O(n²) caché.
- Ne pas tester les cas limites à voix haute : l'intervieweur les teste à ta place.

## Défis

**1. Quelle complexité ?**

```ts
function f(a: number[]): number {
  let count = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 1; j < a.length; j *= 2) count++;
  }
  return count;
}
```

::: details Solution
O(n log n). Pour chaque `i`, `j` double de 1 jusqu'à `n` : log₂(n) tours. Espace O(1).

Variante piège : si `j` partait de `i` (avec `i ≥ 1`, sinon `0 * 2` boucle à l'infini), le total serait Σ log(n/i) ≈ 1,44·n, donc O(n). Compter précisément les tours paie.
:::

**2. Et celle-ci ?**

```ts
function g(a: number[], b: number[]): boolean {
  const s = new Set(a);
  return b.some((x) => s.has(x));
}
```

::: details Solution
O(a + b) en temps : construire le `Set` coûte O(a), puis `some` fait au plus b recherches O(1) en moyenne. Espace O(a). Dire « O(n) » est imprécis : les deux tableaux ont des tailles indépendantes.
:::

**3. Contraintes.** L'énoncé dit `1 ≤ n ≤ 2·10⁵` et `-10⁹ ≤ nums[i] ≤ 10⁹`. Quelles complexités sont acceptables ? Une solution O(n²) passe-t-elle ?

::: details Solution
O(n²) = 4·10¹⁰ opérations : beaucoup trop lent. Vise O(n log n) (tri, heap, binary search) ou O(n) (hash, two pointers, sliding window). Les valeurs jusqu'à 10⁹ indiquent aussi : pas de « tableau de compteurs indexé par la valeur », et attention aux dépassements en Rust (somme de deux `i32` → passer en `i64`).
:::

**4. Pourquoi ce code est-il lent ?** Une file de jobs dans un worker Node :

```ts
const queue: Job[] = loadJobs(); // 100 000 jobs
while (queue.length) {
  const job = queue.shift()!;
  await handle(job);
}
```

::: details Solution
`shift()` décale tous les éléments restants : O(n) par appel, O(n²) au total. Solution : un indice de tête (`let head = 0; const job = queue[head++]`), ou parcourir dans l'ordre inverse avec `pop()` si l'ordre le permet. En Rust, on utiliserait `VecDeque::pop_front` (O(1)).
:::

**5. Espace d'une récursion.** Quelle est la complexité en espace d'un DFS récursif qui calcule la hauteur d'un arbre binaire de n nœuds ? Quand est-ce que ça devient un problème en prod ?

::: details Solution
O(h), h = hauteur : O(log n) pour un arbre équilibré, O(n) pour un arbre dégénéré (un peigne). Sur un arbre très profond (ex. un fil de commentaires imbriqués sur 100 000 niveaux, ou un JSON malveillant), la récursion fait exploser la pile (`RangeError: Maximum call stack size exceeded` en JS, `stack overflow` en Rust). Solution : version itérative avec une pile explicite, et/ou limite de profondeur à la validation.
:::

## À retenir

- Clarifier → exemples → brute force → optimiser → coder → tester → complexité. À voix haute.
- Big-O = croissance : on garde le terme dominant ; temps **et** espace, toujours justifiés.
- Compte les avancées totales des pointeurs : un `while` dans un `for` peut être O(n).
- Connais les pièges de coût : `shift`/`includes` en JS, `remove(0)`/`contains` en Rust ; `Map`/`Set`/`HashMap` sont O(1) en moyenne.
- Les contraintes donnent la complexité visée : 10⁵ → O(n log n), 20 → O(2ⁿ).
- Le pattern se devine dans l'énoncé : trié, contigu, « k plus grands », « nombre de façons »…
