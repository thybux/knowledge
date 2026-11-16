<script setup>
import meetingRooms from "./challenges/meeting-rooms";
import mergeIntervals from "./challenges/merge-intervals";
import insertInterval from "./challenges/insert-interval";
import nonOverlapping from "./challenges/non-overlapping-intervals";
import jumpGame from "./challenges/jump-game";
import meetingRoomsII from "./challenges/meeting-rooms-ii";
</script>

# Intervalles & greedy

Ce que tu vas apprendre : trier des intervalles et les balayer en une passe, compter des chevauchements avec un « sweep », et surtout savoir quand un choix glouton est correct (et comment le justifier en deux phrases à l'oral).

<Progress :ids="['meeting-rooms', 'merge-intervals', 'insert-interval', 'non-overlapping-intervals', 'jump-game', 'meeting-rooms-ii']" />

## Le pattern intervalles : trier, puis balayer

Un intervalle, c'est `[début, fin]`. Presque tous les problèmes d'intervalles commencent par la même étape : **trier**. Ensuite, tu parcours la liste une fois en comparant l'intervalle courant au dernier que tu as gardé.

Deux intervalles `a` et `b` avec `a.début <= b.début` se chevauchent si et seulement si :

```ts
b[0] < a[1]   // strict : [1,2] et [2,3] se touchent sans chevaucher
b[0] <= a[1]  // large : on fusionne aussi ceux qui se touchent
```

::: warning Bornes ouvertes ou fermées ?
C'est **la** question à poser à l'intervieweur. Une réunion `[9h, 10h)` et une autre `[10h, 11h)` ne sont pas en conflit (bornes semi-ouvertes). Pour « fusionner des plages », LeetCode fusionne `[1,4]` et `[4,5]`. Le `<` contre `<=` est la source n°1 de cas faux.
:::

### Template TS : trier + fusionner

```ts
function sweep(intervals: number[][]): number[][] {
  // 1. tri par début (copie : ne mute pas l'entrée)
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: number[][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) {
      // 2. chevauchement : on étend le dernier
      last[1] = Math.max(last[1], e);
    } else {
      // 3. disjoint : nouvel intervalle
      out.push([s, e]);
    }
  }
  return out;
}
```

Complexité : O(n log n) pour le tri, O(n) pour le balayage. Le tri domine presque toujours.

::: danger `sort()` sans comparateur
`[[10, 1], [9, 2]].sort()` trie en **chaînes** : `"10,1" < "9,2"`. Toujours passer `(a, b) => a[0] - b[0]`.
:::

### Équivalent Rust

```rust play
fn merge(mut v: Vec<[i32; 2]>) -> Vec<[i32; 2]> {
    v.sort_unstable_by_key(|iv| iv[0]);
    let mut out: Vec<[i32; 2]> = Vec::with_capacity(v.len());
    for [s, e] in v {
        match out.last_mut() {
            Some(last) if s <= last[1] => {
                last[1] = last[1].max(e);
            }
            _ => out.push([s, e]),
        }
    }
    out
}

fn main() {
    let v = vec![[8, 10], [1, 3], [2, 6], [15, 18]];
    println!("{:?}", merge(v)); // [[1, 6], [8, 10], [15, 18]]
}
```

`last_mut()` + un `match` avec garde (`if s <= last[1]`) : c'est la forme idiomatique, sans indices ni `unwrap`.

## Le sweep line : compter les chevauchements

Question différente : « combien d'intervalles sont actifs **en même temps**, au maximum ? ». Transforme chaque intervalle en deux événements : `+1` au début, `-1` à la fin. Trie les événements et fais une somme courante.

```ts
function maxOverlap(intervals: number[][]): number {
  const events: [number, number][] = [];
  for (const [s, e] of intervals) {
    events.push([s, +1], [e, -1]);
  }
  // à temps égal, la fin (-1) passe avant le début (+1)
  // => bornes semi-ouvertes [s, e)
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let best = 0;
  for (const [, delta] of events) {
    cur += delta;
    best = Math.max(best, cur);
  }
  return best;
}
```

Variante équivalente (utilisée dans le défi Meeting Rooms II) : trier les débuts et les fins séparément, avancer deux pointeurs. Autre variante : une min-heap des heures de fin (voir [Heap & top-K](/interview/01-algo/09-heap-top-k)), utile quand tu dois savoir **quelle** salle se libère.

## Le greedy : choisir localement, prouver globalement

Un algo glouton fait, à chaque étape, le choix qui paraît le meilleur **maintenant**, sans jamais revenir en arrière. C'est souvent O(n) ou O(n log n), donc bien plus rapide que la DP. Le problème : c'est souvent **faux**.

Contre-exemple classique : rendre la monnaie avec les pièces `[1, 3, 4]` pour 6. Le glouton prend 4, puis 1, puis 1 (3 pièces). L'optimal est 3 + 3 (2 pièces). Là, il faut la [programmation dynamique](/interview/01-algo/11-programmation-dynamique).

En entretien, on attend de toi une justification courte. Deux arguments couvrent 90 % des cas.

### Argument d'échange (exchange argument)

« Prends une solution optimale quelconque. Si elle ne fait pas mon choix glouton, je peux **échanger** son choix contre le mien sans la rendre pire. Donc il existe une solution optimale qui commence par mon choix. »

Exemple : garder le maximum d'intervalles disjoints. Glouton : **trier par fin**, garder l'intervalle qui finit le plus tôt.

- Soit OPT une solution optimale, et `g` l'intervalle qui finit le plus tôt.
- Le premier intervalle `o` de OPT finit au plus tôt… après `g` (ou en même temps).
- Remplace `o` par `g` : `g` finit avant ou avec `o`, donc il ne gêne aucun des suivants de OPT. Même nombre d'intervalles, toujours valide.
- Recommence sur ce qui reste. Le glouton est optimal.

### « Stays ahead » (le glouton reste devant)

« Après chaque étape, ma solution est au moins aussi avancée que n'importe quelle autre. »

Exemple : Jump Game. On maintient `reach` = l'indice le plus loin atteignable avec les cases vues. Aucune stratégie ne peut atteindre plus loin que `reach` en n'utilisant que ces cases, par définition. Si à un moment `i > reach`, personne ne peut atteindre `i`.

### Template greedy

```ts
function greedy(items: Item[]): number {
  // 1. trier selon LE critère (souvent : fin croissante,
  //    ratio, deadline...). C'est là qu'est l'intelligence.
  items.sort(byKey);
  let state = initial;
  let count = 0;
  for (const it of items) {
    // 2. décision locale, jamais remise en cause
    if (compatible(state, it)) {
      state = update(state, it);
      count++;
    }
  }
  return count;
}
```

::: tip Réflexe d'entretien
Propose le glouton, puis cherche toi-même un contre-exemple de 3–4 éléments pendant 30 secondes. Si tu n'en trouves pas, donne l'argument d'échange. Si tu en trouves un, bascule sur la DP : l'intervieweur notera la démarche.
:::

### Autres greedy classiques à connaître

- **Jump Game II** (nombre minimal de sauts) : BFS « par niveaux » sur les indices. On garde `curEnd` (fin du niveau courant) et `farthest` ; quand `i == curEnd`, on fait un saut et `curEnd = farthest`. O(n).
- **Gas Station** : si la somme totale `gas - cost` est négative, impossible. Sinon, la station de départ est juste après le point où le réservoir cumulé est le plus bas : on remet le départ à `i + 1` chaque fois que le réservoir passe sous 0. O(n).
- **Best Time to Buy and Sell Stock II** : additionner toutes les hausses positives.
- **Partition Labels** : dernière occurrence de chaque lettre, couper quand `i` atteint le max des dernières occurrences vues.

## Comment le reconnaître

| Signal dans l'énoncé | Piste |
|---|---|
| « réunions », « créneaux », « plages » | trier par début |
| « fusionner », « union des plages » | merge |
| « combien en même temps », « salles » | sweep / heap des fins |
| « supprimer le moins possible » | greedy tri par fin |
| « peut-on atteindre », « min de sauts » | greedy `reach` |
| « maximiser le nombre de tâches » | tri par fin / deadline |

Et un signal négatif : si l'énoncé dit « nombre de façons » ou si un petit contre-exemple casse ton glouton, c'est de la DP.

## Cas réel

**Agenda d'un SaaS de prise de rendez-vous** (type cabinet médical multi-praticiens). Trois besoins tombent directement sur ces patterns :

1. **Afficher les disponibilités** : les créneaux occupés d'un praticien viennent de plusieurs sources (rendez-vous, congés, sync Google Calendar). On **fusionne** les plages occupées, puis on prend le complément dans la journée.
2. **Réserver un créneau** : avant d'insérer, on vérifie le chevauchement avec `nouveau.début < existant.fin && existant.début < nouveau.fin` (bornes semi-ouvertes).
3. **Dimensionner les salles** : combien de salles de consultation faut-il le mardi ? C'est Meeting Rooms II.

```ts
type Slot = { start: number; end: number }; // epoch ms

function freeSlots(busy: Slot[], day: Slot): Slot[] {
  const merged = mergeSlots(busy); // trié par start
  const free: Slot[] = [];
  let cursor = day.start;
  for (const b of merged) {
    if (b.start > cursor) free.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < day.end) free.push({ start: cursor, end: day.end });
  return free;
}
```

En base, PostgreSQL sait faire la vérification de chevauchement lui-même : un type `tstzrange` et une contrainte `EXCLUDE USING gist (praticien_id WITH =, plage WITH &&)` (extension `btree_gist`) empêche deux réservations qui se chevauchent, même sous concurrence. Le code applicatif seul ne suffit pas : deux requêtes simultanées passeraient toutes les deux le check (voir [Postgres avancé](/bdd/05-postgres-avance)).

## Pièges classiques

- **Oublier de trier**, ou trier par le mauvais critère : par début pour fusionner, par **fin** pour maximiser le nombre d'intervalles gardés.
- **`<` vs `<=`** : clarifie les bornes avant de coder.
- **Fusion avec `last[1] = e`** au lieu de `Math.max(last[1], e)` : casse sur `[[1, 10], [2, 3]]` (intervalle inclus).
- **Muter l'entrée** : `intervals.sort(...)` trie le tableau de l'appelant. Copie si ce n'est pas explicitement autorisé.
- **Glouton non prouvé** : « ça marche sur l'exemple » n'est pas un argument. Cherche un contre-exemple.
- **Sweep à temps égal** : si une fin et un début tombent au même instant, l'ordre de traitement décide si ça compte comme un chevauchement.

## Défis

### 1. Meeting Rooms

Tu reçois une liste de réunions `[début, fin)`. Une personne peut-elle assister à toutes ? Une réunion qui finit à 10 et une autre qui commence à 10 ne sont **pas** en conflit.

- `[[0,30],[5,10],[15,20]]` → `false`
- `[[7,10],[2,4]]` → `true`
- `[[1,2],[2,3]]` → `true`

Problème équivalent sur LeetCode : Meeting Rooms (252, premium).

<Challenge :data="meetingRooms" />

::: details Explication
Trie par début. Après le tri, un conflit ne peut exister qu'entre deux réunions **consécutives** : si `a`, `b`, `c` sont triées et que `a` chevauche `c`, alors `a` chevauche aussi `b` (car `b` commence entre `a.début` et `c.début`). Donc une seule passe qui compare `sorted[i][0] < sorted[i-1][1]`.

Complexité : O(n log n) temps, O(n) espace (copie triée).

```rust play
fn can_attend_meetings(intervals: &[[i32; 2]]) -> bool {
    let mut v = intervals.to_vec();
    v.sort_unstable_by_key(|iv| iv[0]);
    v.windows(2).all(|w| w[1][0] >= w[0][1])
}

fn main() {
    println!("{}", can_attend_meetings(&[[7, 10], [2, 4]]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn overlap() {
        assert!(!can_attend_meetings(&[[0, 30], [5, 10], [15, 20]]));
    }
    #[test]
    fn ok() { assert!(can_attend_meetings(&[[7, 10], [2, 4]])); }
    #[test]
    fn empty() { assert!(can_attend_meetings(&[])); }
    #[test]
    fn touching() { assert!(can_attend_meetings(&[[1, 2], [2, 3]])); }
    #[test]
    fn nested() {
        assert!(!can_attend_meetings(&[[1, 10], [2, 3], [11, 12]]));
    }
}
```

`windows(2)` donne toutes les paires consécutives : parfait pour ce genre de check.
:::

### 2. Merge Intervals

Fusionne tous les intervalles qui se chevauchent **ou se touchent**. Retourne le résultat trié par début.

- `[[1,3],[2,6],[8,10],[15,18]]` → `[[1,6],[8,10],[15,18]]`
- `[[1,4],[4,5]]` → `[[1,5]]`
- `[[1,10],[2,3],[4,5]]` → `[[1,10]]`

Problème équivalent sur LeetCode : Merge Intervals (56).

<Challenge :data="mergeIntervals" />

::: details Explication
C'est exactement le template : tri par début, puis on étend le dernier intervalle gardé tant que `s <= last[1]`. Le `Math.max` est indispensable pour les intervalles inclus dans un autre.

Pourquoi ça marche : après le tri, tout intervalle qui pourrait fusionner avec `last` commence avant `last[1]` ; dès qu'un intervalle commence après, plus aucun suivant (ils commencent encore plus tard) ne peut toucher `last`.

Complexité : O(n log n) temps, O(n) pour la sortie.

```rust play
fn merge(mut intervals: Vec<[i32; 2]>) -> Vec<[i32; 2]> {
    intervals.sort_unstable_by_key(|iv| iv[0]);
    let mut out: Vec<[i32; 2]> = Vec::new();
    for [s, e] in intervals {
        match out.last_mut() {
            Some(last) if s <= last[1] => last[1] = last[1].max(e),
            _ => out.push([s, e]),
        }
    }
    out
}

fn main() {
    println!("{:?}", merge(vec![[1, 3], [2, 6], [8, 10]]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        let got = merge(vec![[1, 3], [2, 6], [8, 10], [15, 18]]);
        assert_eq!(got, vec![[1, 6], [8, 10], [15, 18]]);
    }
    #[test]
    fn touching() { assert_eq!(merge(vec![[1, 4], [4, 5]]), vec![[1, 5]]); }
    #[test]
    fn empty() { assert_eq!(merge(vec![]), Vec::<[i32; 2]>::new()); }
    #[test]
    fn unsorted() {
        let got = merge(vec![[8, 10], [1, 3], [2, 6]]);
        assert_eq!(got, vec![[1, 6], [8, 10]]);
    }
    #[test]
    fn swallow() {
        let got = merge(vec![[2, 3], [4, 5], [1, 10]]);
        assert_eq!(got, vec![[1, 10]]);
    }
}
```
:::

### 3. Insert Interval

`intervals` est **déjà trié** par début et sans chevauchement. Insère `newInterval`, fusionne si nécessaire, et retourne une liste toujours triée et sans chevauchement (ceux qui se touchent fusionnent).

- `[[1,3],[6,9]]`, `[2,5]` → `[[1,5],[6,9]]`
- `[[1,2],[3,5],[6,7],[8,10],[12,16]]`, `[4,8]` → `[[1,2],[3,10],[12,16]]`
- `[[1,2],[5,6]]`, `[3,4]` → `[[1,2],[3,4],[5,6]]`

Problème équivalent sur LeetCode : Insert Interval (57).

<Challenge :data="insertInterval" />

::: details Explication
On pourrait ajouter l'intervalle et rappeler `merge` (O(n log n)), mais l'entrée est déjà triée : on fait mieux en O(n) avec trois phases.

1. Copier tous les intervalles qui finissent **avant** le début du nouveau (`iv[1] < s`).
2. Absorber tous ceux qui commencent **avant ou à** la fin du nouveau (`iv[0] <= e`), en élargissant `[s, e]`.
3. Pousser `[s, e]`, puis copier le reste.

Complexité : O(n) temps, O(n) sortie. L'intervieweur attend précisément que tu exploites le tri existant.

```rust play
fn insert(intervals: Vec<[i32; 2]>, new: [i32; 2]) -> Vec<[i32; 2]> {
    let [mut s, mut e] = new;
    let mut out = Vec::with_capacity(intervals.len() + 1);
    let mut it = intervals.into_iter().peekable();
    while let Some(iv) = it.next_if(|iv| iv[1] < s) {
        out.push(iv);
    }
    while let Some(iv) = it.next_if(|iv| iv[0] <= e) {
        s = s.min(iv[0]);
        e = e.max(iv[1]);
    }
    out.push([s, e]);
    out.extend(it);
    out
}

fn main() {
    println!("{:?}", insert(vec![[1, 3], [6, 9]], [2, 5]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        assert_eq!(insert(vec![[1, 3], [6, 9]], [2, 5]), vec![[1, 5], [6, 9]]);
    }
    #[test]
    fn many() {
        let v = vec![[1, 2], [3, 5], [6, 7], [8, 10], [12, 16]];
        assert_eq!(insert(v, [4, 8]), vec![[1, 2], [3, 10], [12, 16]]);
    }
    #[test]
    fn empty() { assert_eq!(insert(vec![], [5, 7]), vec![[5, 7]]); }
    #[test]
    fn before() {
        assert_eq!(insert(vec![[3, 5]], [1, 2]), vec![[1, 2], [3, 5]]);
    }
    #[test]
    fn bridge() {
        assert_eq!(insert(vec![[1, 2], [5, 6]], [2, 5]), vec![[1, 6]]);
    }
}
```

`Peekable::next_if` consomme l'élément suivant seulement si le prédicat est vrai : idéal pour enchaîner des phases sur un même itérateur.
:::

### 4. Non-overlapping Intervals

Combien d'intervalles faut-il **supprimer**, au minimum, pour qu'il ne reste aucun chevauchement ? `[1,2]` et `[2,3]` ne se chevauchent pas.

- `[[1,2],[2,3],[3,4],[1,3]]` → `1` (on retire `[1,3]`)
- `[[1,2],[1,2],[1,2]]` → `2`
- `[[1,10],[2,3],[4,5],[6,7]]` → `1` (on retire le long)

Problème équivalent sur LeetCode : Non-overlapping Intervals (435).

<Challenge :data="nonOverlapping" />

::: details Explication
Supprimer le minimum = **garder le maximum** d'intervalles disjoints. Glouton : trier par **fin** croissante, garder chaque intervalle qui commence après (ou à) la fin du dernier gardé. Réponse : `n - gardés`.

Preuve par échange (voir plus haut) : l'intervalle qui finit le plus tôt laisse le plus de place pour la suite ; on peut toujours le substituer au premier intervalle d'une solution optimale.

Trier par **début** est faux : `[[1,10],[2,3],[4,5]]` garderait `[1,10]` et jetterait les deux autres.

Complexité : O(n log n) temps, O(n) espace pour la copie triée (O(1) si tu tries en place).

```rust play
fn erase_overlap_intervals(mut intervals: Vec<[i32; 2]>) -> usize {
    intervals.sort_unstable_by_key(|iv| iv[1]);
    let mut kept = 0;
    let mut end = i32::MIN;
    for &[s, e] in &intervals {
        if s >= end {
            kept += 1;
            end = e;
        }
    }
    intervals.len() - kept
}

fn main() {
    let v = vec![[1, 2], [2, 3], [3, 4], [1, 3]];
    println!("{}", erase_overlap_intervals(v));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        let v = vec![[1, 2], [2, 3], [3, 4], [1, 3]];
        assert_eq!(erase_overlap_intervals(v), 1);
    }
    #[test]
    fn same() {
        assert_eq!(erase_overlap_intervals(vec![[1, 2], [1, 2], [1, 2]]), 2);
    }
    #[test]
    fn empty() { assert_eq!(erase_overlap_intervals(vec![]), 0); }
    #[test]
    fn long_one() {
        let v = vec![[1, 10], [2, 3], [4, 5], [6, 7]];
        assert_eq!(erase_overlap_intervals(v), 1);
    }
}
```
:::

### 5. Jump Game

`nums[i]` est la longueur **maximale** du saut possible depuis l'indice `i`. Tu pars de l'indice 0. Peux-tu atteindre le dernier indice ?

- `[2,3,1,1,4]` → `true` (0 → 1 → 4)
- `[3,2,1,0,4]` → `false` (on retombe toujours sur le 0 en indice 3)
- `[0]` → `true` (déjà arrivé)

Problème équivalent sur LeetCode : Jump Game (55).

<Challenge :data="jumpGame" />

::: details Explication
La DP naïve (« `ok[i]` = peut-on atteindre la fin depuis `i` ») est O(n²). Le glouton est O(n) : on balaie de gauche à droite en maintenant `reach`, l'indice le plus loin atteignable. Si on arrive sur un `i > reach`, c'est perdu. Sinon `reach = max(reach, i + nums[i])`.

Argument « stays ahead » : toute case `j <= reach` est atteignable (on peut toujours faire un saut plus court que le max), et aucune case au-delà ne l'est avec les cases déjà vues.

Complexité : O(n) temps, O(1) espace.

```rust play
fn can_jump(nums: &[usize]) -> bool {
    let mut reach = 0;
    for (i, &n) in nums.iter().enumerate() {
        if i > reach {
            return false;
        }
        reach = reach.max(i + n);
    }
    true
}

fn main() {
    println!("{}", can_jump(&[2, 3, 1, 1, 4]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn yes() { assert!(can_jump(&[2, 3, 1, 1, 4])); }
    #[test]
    fn no() { assert!(!can_jump(&[3, 2, 1, 0, 4])); }
    #[test]
    fn single() { assert!(can_jump(&[0])); }
    #[test]
    fn stuck() { assert!(!can_jump(&[0, 1])); }
    #[test]
    fn big_jump() { assert!(can_jump(&[5, 0, 0, 0, 0, 0])); }
}
```

Suite logique : Jump Game II (45), même balayage avec un compteur de « niveaux ».
:::

### 6. Meeting Rooms II

Combien de salles faut-il, au minimum, pour tenir toutes les réunions `[début, fin)` ? Une salle libérée à 10 peut accueillir une réunion qui commence à 10.

- `[[0,30],[5,10],[15,20]]` → `2`
- `[[1,2],[2,3],[3,4]]` → `1`
- `[[1,10],[2,7],[3,19],[8,12],[10,20],[11,30]]` → `4`

Problème équivalent sur LeetCode : Meeting Rooms II (253, premium).

<Challenge :data="meetingRoomsII" />

::: details Explication
Le nombre de salles = le nombre maximal de réunions actives au même instant. Trie séparément les débuts et les fins. Pour chaque début (dans l'ordre), libère d'abord toutes les salles dont la fin est `<=` à ce début (pointeur `j` sur les fins), puis occupe une salle. Le maximum atteint est la réponse.

On n'a pas besoin de savoir **quelle** réunion finit : seul le nombre compte, d'où les deux tableaux indépendants. Si on te demande d'attribuer les salles (quelle réunion dans quelle salle), passe à une min-heap de `(fin, salleId)`.

Complexité : O(n log n) temps (deux tris), O(n) espace.

```rust play
fn min_meeting_rooms(intervals: &[[i32; 2]]) -> usize {
    let mut starts: Vec<i32> = intervals.iter().map(|iv| iv[0]).collect();
    let mut ends: Vec<i32> = intervals.iter().map(|iv| iv[1]).collect();
    starts.sort_unstable();
    ends.sort_unstable();
    let (mut rooms, mut best, mut j) = (0, 0, 0);
    for s in starts {
        while ends[j] <= s {
            rooms -= 1;
            j += 1;
        }
        rooms += 1;
        best = best.max(rooms);
    }
    best
}

fn main() {
    println!("{}", min_meeting_rooms(&[[0, 30], [5, 10], [15, 20]]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        assert_eq!(min_meeting_rooms(&[[0, 30], [5, 10], [15, 20]]), 2);
    }
    #[test]
    fn empty() { assert_eq!(min_meeting_rooms(&[]), 0); }
    #[test]
    fn touching() {
        assert_eq!(min_meeting_rooms(&[[1, 2], [2, 3], [3, 4]]), 1);
    }
    #[test]
    fn same() {
        assert_eq!(min_meeting_rooms(&[[1, 4], [1, 4], [1, 4]]), 3);
    }
    #[test]
    fn mixed() {
        let v = [[1, 10], [2, 7], [3, 19], [8, 12], [10, 20], [11, 30]];
        assert_eq!(min_meeting_rooms(&v), 4);
    }
}
```

`ends[j]` ne déborde jamais : une fin n'est consommée que si elle est `<=` au début courant, donc elle appartient à une réunion déjà comptée, et `j` reste strictement inférieur au nombre de débuts traités.
:::

## À retenir

- Intervalles : **trier d'abord** (par début pour fusionner, par fin pour garder le maximum), puis une passe.
- Clarifie les bornes (`[a, b)` ou `[a, b]`) avant d'écrire un `<` ou un `<=`.
- « Combien en même temps » = sweep line (+1/−1) ou deux tableaux triés ; heap si tu dois attribuer des ressources.
- Un glouton se justifie par **échange** ou par **stays ahead** ; cherche un contre-exemple avant de le défendre.
- Si un contre-exemple casse le glouton (monnaie `[1, 3, 4]`), c'est de la DP.
- En prod, le chevauchement de réservations se garantit en base (contrainte `EXCLUDE` sur un range Postgres), pas seulement dans le code.
