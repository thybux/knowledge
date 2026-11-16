# Listes chaînées

<script setup>
import reverseList from "./challenges/reverse-linked-list";
import mergeTwo from "./challenges/merge-two-sorted-lists";
import cycle from "./challenges/linked-list-cycle";
import removeNth from "./challenges/remove-nth-from-end";
import reorder from "./challenges/reorder-list";
import reverseK from "./challenges/reverse-nodes-k-group";
</script>

<Progress :ids="['reverse-linked-list', 'merge-two-sorted-lists', 'linked-list-cycle', 'remove-nth-from-end', 'reorder-list', 'reverse-nodes-k-group']" />

Ce que tu vas apprendre : les quatre techniques qui résolvent presque tous les exercices de listes chaînées (nœud factice, inversion, slow/fast, deux pointeurs décalés), et comment les écrire en Rust avec `Option<Box<ListNode>>` sans se battre avec le borrow checker.

## La structure

Chaque maillon connaît sa valeur et le suivant. Pas d'accès par indice : lire le k-ième maillon coûte O(k). En échange, insérer ou retirer **un maillon dont on a déjà la référence** est O(1).

```ts
class ListNode {
  constructor(
    public val: number = 0,
    public next: ListNode | null = null,
  ) {}
}
```

| Opération | Tableau | Liste chaînée |
|---|---|---|
| accès au i-ème | O(1) | O(i) |
| insérer en tête | O(n) | O(1) |
| insérer après un nœud connu | O(n) | O(1) |
| mémoire / cache CPU | compact | dispersée |

En pratique, un `Array`/`Vec` gagne presque toujours (localité mémoire). Les listes chaînées servent surtout **dans** d'autres structures : LRU cache (liste doublement chaînée + map), files d'attente intrusives, allocateurs. En entretien, elles testent ta rigueur sur les pointeurs.

Dans les défis de cette page, les listes arrivent sous forme de tableau (`[1, 2, 3]`) ; les helpers `fromArray` / `toArray` sont fournis dans le code de départ, tu n'écris que l'algorithme.

## Technique 1 : le nœud factice (dummy)

Dès que la **tête** peut changer (suppression, fusion, insertion), crée un nœud factice devant. Plus de cas particulier « et si c'est le premier ? ».

```ts
function removeValue(head: ListNode | null, v: number) {
  const dummy = new ListNode(0, head);
  let cur = dummy;
  while (cur.next) {
    if (cur.next.val === v) cur.next = cur.next.next; // saute
    else cur = cur.next;
  }
  return dummy.next; // la vraie tête, peut-être nouvelle
}
```

## Technique 2 : inverser

Trois variables, quatre lignes, à savoir écrire les yeux fermés : c'est une brique de reorder, palindrome, reverse k-group…

```ts
let prev: ListNode | null = null;
let cur = head;
while (cur) {
  const next = cur.next; // 1. sauvegarder
  cur.next = prev; // 2. retourner la flèche
  prev = cur; // 3. avancer
  cur = next;
}
// prev est la nouvelle tête
```

## Technique 3 : slow / fast

`slow` avance d'un maillon, `fast` de deux.

- Quand `fast` atteint la fin, `slow` est **au milieu**.
- S'il y a un **cycle**, `fast` finit par rattraper `slow` (algorithme de Floyd, tortue et lièvre) : dans la boucle, l'écart diminue de 1 à chaque tour.

```ts
function middle(head: ListNode): ListNode {
  let slow = head;
  let fast: ListNode | null = head;
  while (fast && fast.next) {
    slow = slow.next!;
    fast = fast.next.next;
  }
  return slow; // pour [1,2,3,4] : 3 (2e milieu)
}
```

## Technique 4 : deux pointeurs décalés

Pour « le k-ième depuis la fin » en une passe : un pointeur part avec k pas d'avance ; quand il sort de la liste, l'autre est à la bonne place (défi 4).

## En Rust : `Option<Box<ListNode>>`

`Box` = un seul propriétaire par maillon. Donc pas de cycle possible, pas deux pointeurs `&mut` sur la même liste en même temps. Les outils :

- `take()` : sort la valeur d'une `Option` en laissant `None` — c'est ce qui permet de « détacher » un maillon ;
- `as_ref()` / `as_mut()` : parcourir sans prendre la propriété ;
- `while let Some(node) = cur` pour consommer une liste.

```rust play
#[derive(Debug)]
struct ListNode {
    val: i32,
    next: Option<Box<ListNode>>,
}
type List = Option<Box<ListNode>>;

fn from_slice(v: &[i32]) -> List {
    // on construit depuis la fin : chaque nœud possède la suite
    v.iter()
        .rev()
        .fold(None, |next, &val| Some(Box::new(ListNode { val, next })))
}

fn reverse(mut head: List) -> List {
    let mut prev = None;
    while let Some(mut node) = head {
        head = node.next.take(); // détacher la suite
        node.next = prev;
        prev = Some(node);
    }
    prev
}

fn main() {
    let mut cur = &reverse(from_slice(&[1, 2, 3]));
    while let Some(n) = cur {
        print!("{} ", n.val); // 3 2 1
        cur = &n.next;
    }
    println!();
}
```

Pour une liste doublement chaînée ou un graphe avec cycles, Rust propose `Rc<RefCell<..>>` (verbeux) ou, plus simple et plus rapide, une **arène** : un `Vec<Node>` où `next` est un indice `Option<usize>`. C'est ce qu'on fait pour le défi « cycle ». Voir aussi [Smart pointers](/dev/rust/07-smart-pointers).

::: tip LeetCode et Rust
Sur LeetCode, les arbres Rust sont en `Option<Rc<RefCell<TreeNode>>>` mais les listes sont bien en `Option<Box<ListNode>>`, comme ici.
:::

## Comment le reconnaître

L'énoncé dit « liste chaînée », donc la question est plutôt **quelle technique** :

- La tête peut changer → dummy.
- « Inverser », « ordre inverse », « palindrome » → inversion (souvent d'une moitié).
- « Milieu », « cycle », « point d'entrée du cycle » → slow/fast.
- « n-ième depuis la fin » → pointeurs décalés.
- « Fusionner », « trier une liste » → fusion de listes triées (merge sort sur liste).
- « O(1) mémoire » → interdit de copier dans un tableau : il faut re-câbler les `next`.

## Cas réel

Le **LRU cache** d'une API (garder en mémoire les 10 000 réponses les plus récemment lues) : une `Map` clé → nœud donne l'accès O(1), et une liste **doublement** chaînée garde l'ordre d'usage. À chaque lecture, on détache le nœud (O(1) grâce à `prev`/`next`) et on le remet en tête ; quand c'est plein, on retire la queue. C'est le défi `lru-cache` de [Design de structures](/interview/01-algo/13-design-structures).

En JS, une `Map` conserve l'ordre d'insertion : `delete` puis `set` remet une clé « en dernier », ce qui donne un LRU simple sans liste explicite :

```ts
class Lru<K, V> {
  private m = new Map<K, V>();
  constructor(private cap: number) {}
  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v === undefined) return undefined;
    this.m.delete(k); // remet k en "plus récent"
    this.m.set(k, v);
    return v;
  }
  set(k: K, v: V) {
    this.m.delete(k);
    this.m.set(k, v);
    if (this.m.size > this.cap) {
      // la 1re clé de l'itération est la moins récente
      this.m.delete(this.m.keys().next().value!);
    }
  }
}
```

En entretien, on te demandera souvent la version « à la main » (map + liste doublement chaînée) : c'est elle qui montre que tu comprends les pointeurs.

## Pièges classiques

- Perdre la suite : écrire `cur.next = prev` **avant** d'avoir sauvegardé `cur.next`.
- Oublier le dummy et multiplier les `if (head === target)`.
- Boucle `while (fast.next)` sans tester `fast` d'abord → `null.next`.
- Ne pas couper la liste (`slow.next = null`) avant de fusionner deux moitiés → cycle.
- Comparer des nœuds par valeur au lieu de par référence (`===`) pour un cycle : deux nœuds peuvent valoir pareil.
- En Rust : vouloir deux `&mut` dans la même liste (slow/fast mutables). Contourne : compter la longueur, ou découper avec `take()`.
- Récursion sur une liste de 10⁵ maillons : stack overflow. Préfère l'itératif.

## Défis

### 1. Reverse Linked List

Inverse la liste et retourne la nouvelle tête.

- `[1, 2, 3, 4, 5]` → `[5, 4, 3, 2, 1]`
- `[]` → `[]`

Problème équivalent sur LeetCode : Reverse Linked List.

<Challenge :data="reverseList" />

::: details Explication
Technique 2 telle quelle. Temps O(n), espace O(1). La version récursive (`reverse(head.next)` puis `head.next.next = head`) est élégante mais O(n) en pile : le test de 5000 maillons passe en JS, pas forcément 10⁶. En Rust, `take()` détache la suite et le borrow checker est content.

```rust
fn reverse_list(mut head: List) -> List {
    let mut prev: List = None;
    while let Some(mut node) = head {
        head = node.next.take(); // on détache la suite
        node.next = prev; // on retourne le maillon
        prev = Some(node);
    }
    prev
}
```
:::

### 2. Merge Two Sorted Lists

Fusionne deux listes triées en une liste triée, en réutilisant les maillons.

- `[1, 2, 4]` et `[1, 3, 4]` → `[1, 1, 2, 3, 4, 4]`
- `[]` et `[0]` → `[0]`

Problème équivalent sur LeetCode : Merge Two Sorted Lists.

<Challenge :data="mergeTwo" />

::: details Explication
Dummy + pointeur `tail`. Tant que les deux listes ont un maillon, on accroche le plus petit et on avance dans sa liste. À la fin, on accroche le reste de celle qui n'est pas vide (déjà trié). Utiliser `<=` garde la fusion **stable**.

Temps O(n + m), espace O(1). En Rust, `tail.next.insert(node)` accroche et renvoie un `&mut` vers le nouveau maillon : c'est le moyen propre d'avancer un pointeur de queue.

```rust
fn merge_two_lists(mut a: List, mut b: List) -> List {
    let mut dummy = Box::new(ListNode { val: 0, next: None });
    let mut tail = &mut dummy;
    while let (Some(x), Some(y)) = (&a, &b) {
        // on choisit la liste dont la tête est la plus petite
        let src = if x.val <= y.val { &mut a } else { &mut b };
        let mut node = src.take().unwrap();
        *src = node.next.take();
        tail = tail.next.insert(node); // insert renvoie &mut
    }
    tail.next = a.or(b); // le reste, tel quel
    dummy.next
}
```
:::

### 3. Linked List Cycle

La liste contient-elle un cycle ? Dans les tests, `pos` est l'indice du maillon vers lequel pointe la queue (`-1` = pas de cycle). Ta fonction ne reçoit que la tête. Vise O(1) en mémoire.

- `values = [3, 2, 0, -4], pos = 1` → `true`
- `values = [1], pos = -1` → `false`

Problème équivalent sur LeetCode : Linked List Cycle.

<Challenge :data="cycle" />

::: details Explication
Floyd : `slow` avance de 1, `fast` de 2. Sans cycle, `fast` atteint `null`. Avec un cycle, une fois les deux dans la boucle, l'écart se réduit de 1 à chaque tour : ils se rencontrent en au plus « longueur du cycle » tours. Temps O(n), espace O(1). La version `Set` des nœuds visités marche aussi mais coûte O(n) en mémoire.

Suivi classique : trouver **l'entrée** du cycle. Après la rencontre, on repart d'un pointeur depuis la tête et on avance les deux de 1 : ils se croisent à l'entrée.

En Rust, `Box` ne permet pas de cycle : on représente la liste par une arène d'indices, et Floyd s'écrit sur les indices.

```rust
// Liste en "arène" : next[i] = indice du maillon suivant.
// C'est comme ça qu'on fait des graphes/cycles en Rust
// sans Rc<RefCell<..>>.
fn has_cycle(next: &[Option<usize>], head: Option<usize>) -> bool {
    let (mut slow, mut fast) = (head, head);
    loop {
        // fast avance de 2 ; s'il atteint la fin, pas de cycle
        let Some(f1) = fast.and_then(|i| next[i]) else { return false };
        fast = next[f1];
        slow = slow.and_then(|i| next[i]);
        if fast.is_some() && fast == slow {
            return true;
        }
    }
}
```
:::

### 4. Remove Nth Node From End

Supprime le n-ième maillon en comptant depuis la fin (`1 ≤ n ≤ longueur`), et retourne la tête.

- `[1, 2, 3, 4, 5], n = 2` → `[1, 2, 3, 5]`
- `[1], n = 1` → `[]`
- `[1, 2], n = 2` → `[2]`

Problème équivalent sur LeetCode : Remove Nth Node From End of List.

<Challenge :data="removeNth" />

::: details Explication
Dummy (la tête peut disparaître) + deux pointeurs décalés. `fast` prend `n + 1` pas d'avance depuis le dummy ; puis on avance les deux jusqu'à ce que `fast` soit `null`. `slow` est alors juste **avant** le maillon à retirer : `slow.next = slow.next.next`. Une passe, O(n) temps, O(1) espace.

En Rust, avoir `slow` en `&mut` et `fast` en `&` sur la même liste est refusé par le borrow checker. La version idiomatique compte d'abord la longueur (deux passes, toujours O(n)), puis avance de `len - n` depuis le dummy.

```rust
fn remove_nth_from_end(head: List, n: usize) -> List {
    // 1re passe : longueur (deux pointeurs = galère avec Box)
    let mut len = 0;
    let mut p = &head;
    while let Some(node) = p {
        len += 1;
        p = &node.next;
    }
    // le dummy évite le cas particulier "supprimer la tête"
    let mut dummy = Box::new(ListNode { val: 0, next: head });
    let mut cur = &mut dummy;
    for _ in 0..len - n {
        cur = cur.next.as_mut().unwrap();
    }
    let removed = cur.next.take();
    cur.next = removed.and_then(|r| r.next);
    dummy.next
}
```
:::

### 5. Reorder List

Réordonne `L0 → L1 → … → Ln` en `L0 → Ln → L1 → Ln-1 → L2 → …`, en place, sans tableau auxiliaire.

- `[1, 2, 3, 4]` → `[1, 4, 2, 3]`
- `[1, 2, 3, 4, 5]` → `[1, 5, 2, 4, 3]`

Problème équivalent sur LeetCode : Reorder List.

<Challenge :data="reorder" />

::: details Explication
Trois briques de cette page :

1. **milieu** avec slow/fast (ici on s'arrête sur le 1er milieu : la 1re moitié garde le maillon central si n est impair) ;
2. **couper** (`slow.next = null`) et **inverser** la 2e moitié ;
3. **entrelacer** les deux moitiés.

Temps O(n), espace O(1). En Rust, la fonction `interleave(a, b)` récursive prend la tête de `a` et lui accroche `interleave(b, reste de a)` : les rôles s'échangent à chaque appel. Simple, mais récursive (O(n) de pile) ; une boucle avec `take()` ferait la même chose en O(1).

```rust
fn reverse(mut head: List) -> List {
    let mut prev = None;
    while let Some(mut n) = head {
        head = n.next.take();
        n.next = prev;
        prev = Some(n);
    }
    prev
}

// a1 -> b1 -> a2 -> b2 ... (on échange les rôles à chaque pas)
fn interleave(a: List, b: List) -> List {
    match a {
        None => b,
        Some(mut n) => {
            n.next = interleave(b, n.next.take());
            Some(n)
        }
    }
}

fn reorder_list(head: &mut List) {
    let len = to_vec(head).len(); // O(n), juste pour compter
    if len < 3 {
        return;
    }
    // coupe après les ceil(len / 2) premiers maillons
    let mut cur = head.as_mut().unwrap();
    for _ in 0..(len + 1) / 2 - 1 {
        cur = cur.next.as_mut().unwrap();
    }
    let second = reverse(cur.next.take());
    *head = interleave(head.take(), second);
}
```
:::

### 6. Reverse Nodes in k-Group

Inverse les maillons par groupes de `k`. Si le dernier groupe a moins de `k` maillons, il reste dans l'ordre. O(1) mémoire en TS.

- `[1, 2, 3, 4, 5], k = 2` → `[2, 1, 4, 3, 5]`
- `[1, 2, 3, 4, 5], k = 3` → `[3, 2, 1, 4, 5]`

Problème équivalent sur LeetCode : Reverse Nodes in k-Group.

<Challenge :data="reverseK" />

::: details Explication
`groupPrev` pointe sur le maillon juste avant le groupe (au départ, le dummy). Pour chaque groupe :

1. avancer de k depuis `groupPrev` pour trouver `kth` ; s'il n'existe pas, fini ;
2. inverser les maillons du groupe, en initialisant `prev = kth.next` : le premier maillon du groupe se retrouve directement accroché au groupe suivant ;
3. `groupPrev.next = kth` (nouvelle tête du groupe), et `groupPrev` = l'ancien premier, devenu la queue.

Temps O(n), espace O(1). La version Rust est récursive par groupe (O(n/k) de pile) : compter k maillons, inverser ces k avec `take()`, puis accrocher `reverse_k_group(reste)` à la queue du groupe.

```rust
fn reverse_k_group(head: List, k: usize) -> List {
    // reste-t-il au moins k maillons ?
    let mut count = 0;
    let mut p = &head;
    while let Some(n) = p {
        count += 1;
        if count == k {
            break;
        }
        p = &n.next;
    }
    if count < k {
        return head; // groupe incomplet : on laisse tel quel
    }
    // inverse les k premiers
    let (mut rest, mut rev): (List, List) = (head, None);
    for _ in 0..k {
        let mut n = rest.unwrap();
        rest = n.next.take();
        n.next = rev;
        rev = Some(n);
    }
    // l'ancienne tête est maintenant la queue du groupe
    let mut tail = rev.as_mut().unwrap();
    while tail.next.is_some() {
        tail = tail.next.as_mut().unwrap();
    }
    tail.next = reverse_k_group(rest, k);
    rev
}
```
:::

## À retenir

- Quatre techniques : **dummy**, **inversion** (prev/cur/next), **slow/fast** (milieu, cycle), **pointeurs décalés** (n-ième depuis la fin).
- Toujours sauvegarder `next` avant de re-câbler.
- Floyd détecte un cycle en O(1) mémoire ; un `Set` aussi, mais en O(n).
- Rust : `Option<Box<ListNode>>`, `take()` pour détacher, `as_ref()`/`as_mut()` pour parcourir ; arène d'indices pour les cycles.
- En prod, la liste chaînée vit surtout dans un LRU (map + liste doublement chaînée).
