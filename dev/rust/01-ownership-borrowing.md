# Ownership & borrowing

Ce que tu vas apprendre : pourquoi Rust n'a pas besoin de garbage collector, ce que sont un move, une copie et un emprunt, et comment lire (puis corriger) les erreurs du borrow checker sans sortir `clone()` à chaque ligne.

## Stack vs heap, en 2 minutes

Deux zones mémoire :

- **Stack** : rapide, taille connue à la compilation, libérée automatiquement à la fin du bloc. `i32`, `bool`, `f64`, `char`, tuples/tableaux de ces types.
- **Heap** : taille dynamique, allouée à la demande. `String`, `Vec<T>`, `HashMap`, `Box<T>`.

Une `String`, c'est en fait 3 mots sur la stack (pointeur, longueur, capacité) qui pointent vers des octets sur le heap :

```text
stack                     heap
┌──────────┐
│ ptr ─────┼──────────▶  [ 'A' '-' '4' '2' ]
│ len = 4  │
│ cap = 4  │
└──────────┘
```

En TS, le GC traque qui pointe vers quoi et libère « plus tard ». En Rust, la règle est statique : **quand le propriétaire sort du scope, la valeur est libérée** (`drop`). Pas de GC, pas de `free` manuel.

## Les 3 règles de l'ownership

1. Chaque valeur a **un seul propriétaire** (une variable, un champ, un élément de Vec…).
2. Il ne peut y avoir qu'un propriétaire à la fois.
3. Quand le propriétaire sort du scope, la valeur est `drop`.

```rust play
fn main() {
    {
        let order_id = String::from("A-42"); // allocation
        println!("{order_id}");
    } // ← order_id sort du scope : la mémoire est libérée ici

    // println!("{order_id}"); // erreur : n'existe plus
}
```

## Move : donner la valeur

En TS :

```ts
const a = { id: "A-42" };
const b = a;        // deux références au même objet
b.id = "B-1";
console.log(a.id);  // "B-1" — surprise classique
```

En Rust, `let b = a;` **déplace** la propriété. `a` devient inutilisable :

```rust
let a = String::from("A-42");
let b = a;              // move : b est le nouveau propriétaire
println!("{a}");        // error[E0382]: borrow of moved value: `a`
```

Pourquoi ? Si `a` et `b` pointaient tous les deux vers le même heap, les deux feraient `drop` à la fin → **double free**. Rust interdit simplement d'utiliser `a` après le move.

Le move arrive aussi quand tu passes une valeur à une fonction :

```rust
fn archive(order: String) { /* order est drop à la fin */ }

let id = String::from("A-42");
archive(id);       // id est déplacé dans la fonction
// archive(id);    // E0382 : déjà déplacé
```

## Copy : les types « bon marché »

Les types entièrement sur la stack et triviaux à dupliquer implémentent le trait `Copy` : l'affectation **copie** au lieu de déplacer.

```rust play
fn main() {
    let qty: u32 = 3;
    let other = qty;          // copie, pas move
    println!("{qty} {other}"); // OK

    let point = (1.5, 2.0);   // tuple de f64 : Copy aussi
    let p2 = point;
    println!("{point:?} {p2:?}");
}
```

Sont `Copy` : entiers, flottants, `bool`, `char`, `&T` (une référence partagée), tuples et tableaux de types `Copy`. Ne sont **pas** `Copy` : `String`, `Vec`, `Box`, tout ce qui possède du heap, et `&mut T`.

## Clone : dupliquer explicitement

`clone()` fait une copie profonde (nouvelle allocation). C'est l'équivalent de `structuredClone(obj)` en JS : explicite et potentiellement coûteux.

```rust
let a = String::from("A-42");
let b = a.clone();   // nouvelle allocation
println!("{a} {b}"); // OK : deux String indépendantes
```

::: warning `clone()` n'est pas un péché… mais un signal
Cloner une petite `String` dans un handler HTTP ne coûte rien de mesurable. Cloner un `Vec` de 100 000 lignes dans une boucle, si. Clone quand c'est simple et pas sur un chemin chaud ; sinon, emprunte.
:::

## Borrowing : prêter au lieu de donner

Une **référence** `&T` permet d'accéder à une valeur sans en prendre la propriété :

```rust play
fn total_len(items: &Vec<String>) -> usize {
    items.iter().map(|s| s.len()).sum()
}

fn main() {
    let items = vec!["café".to_string(), "thé".to_string()];
    let n = total_len(&items); // on prête
    println!("{n} octets, et j'ai toujours {items:?}");
}
```

Et `&mut T` permet de modifier sans posséder :

```rust play
fn add_tax(prices: &mut Vec<u32>) {
    for p in prices.iter_mut() {
        *p = *p * 120 / 100; // * = déréférencer
    }
}

fn main() {
    let mut prices = vec![100, 250];
    add_tax(&mut prices);
    println!("{prices:?}"); // [120, 300]
}
```

### La règle d'or du borrow checker

À tout instant, pour une valeur donnée, tu as **soit** :

- **N références partagées** `&T` (lecture seule), **soit**
- **1 seule référence exclusive** `&mut T`.

Jamais les deux en même temps. C'est le modèle **« lecteurs multiples XOR écrivain unique »**, le même qu'un `RwLock`, mais vérifié à la compilation.

Et une référence ne doit **jamais survivre** à la valeur qu'elle désigne (pas de pointeur pendant).

::: info Pourquoi cette règle ?
Elle élimine toute une famille de bugs : itérateur invalidé (modifier un tableau pendant qu'on le parcourt), data races entre threads, pointeurs vers de la mémoire libérée. En JS, `arr.forEach(x => arr.push(x))` est légal et piégeux ; en Rust, il ne compile pas.
:::

### NLL : une référence vit jusqu'à sa dernière utilisation

Le compilateur raisonne sur la **dernière utilisation**, pas sur la fin du bloc (Non-Lexical Lifetimes) :

```rust play
fn main() {
    let mut cart = vec![10, 20];
    let first = &cart[0];       // emprunt partagé
    println!("premier : {first}"); // dernière utilisation de first
    cart.push(30);              // OK : first n'est plus utilisé
    println!("{cart:?}");
}
```

## Slices : emprunter un morceau

Une **slice** est une vue sur une séquence contiguë, sans copie : `&[T]` pour un tableau/Vec, `&str` pour une chaîne. C'est un « fat pointer » : pointeur + longueur.

```rust play
fn sum(values: &[i64]) -> i64 {
    values.iter().sum()
}

fn main() {
    let v = vec![1, 2, 3, 4, 5];
    let arr = [10, 20, 30];
    println!("{}", sum(&v));       // &Vec<i64> → &[i64]
    println!("{}", sum(&v[1..3])); // 2 + 3
    println!("{}", sum(&arr));     // marche aussi sur un tableau
}
```

**Règle pratique** : en paramètre, accepte `&[T]` plutôt que `&Vec<T>`, et `&str` plutôt que `&String`. C'est plus général (grâce à la *deref coercion*, `&Vec<T>` se convertit tout seul en `&[T]`) et clippy te le dira (`ptr_arg`).

## `String` vs `&str`

| | `String` | `&str` |
|---|---|---|
| Propriété | possède ses octets | emprunte |
| Mutable | oui (`push_str`) | non |
| Où | heap | n'importe où (heap, binaire…) |
| Équivalent TS | `string` qu'on construit | `string` qu'on lit |

```rust play
fn greet(name: &str) -> String {
    format!("Bonjour {name}") // nouvelle String possédée
}

fn main() {
    let literal: &str = "Ada";          // dans le binaire, 'static
    let owned: String = String::from("Linus");

    println!("{}", greet(literal));
    println!("{}", greet(&owned));      // &String → &str
    println!("{}", greet(&owned[0..3])); // "Lin"
}
```

::: warning Les chaînes sont en UTF-8
`&s[0..1]` indexe des **octets**, pas des caractères. Sur `"été"`, `&s[0..1]` panique (on coupe au milieu de `é`). Pour les caractères : `s.chars()`. Pas de `s[0]` en Rust, justement pour ça.
:::

Pour convertir : `&str → String` avec `.to_string()`, `String::from(..)` ou `.to_owned()` ; `String → &str` avec `&s` ou `s.as_str()`.

## Lire les erreurs du borrow checker

Les 4 erreurs que tu verras 90 % du temps :

| Code | Message | Cause typique |
|---|---|---|
| E0382 | use of moved value | utilisé après un move |
| E0499 | cannot borrow as mutable more than once | deux `&mut` vivants |
| E0502 | cannot borrow as mutable because also borrowed as immutable | `&` vivant + `&mut` |
| E0597 / E0515 | does not live long enough / returns a reference to local | référence qui survit à la valeur |

### E0382 : la boucle qui consomme

```rust
let orders = vec![String::from("A"), String::from("B")];
for o in orders {          // `for x in vec` consomme le Vec
    println!("{o}");
}
println!("{}", orders.len()); // E0382
```

Correction : `for o in &orders` (itère sur des `&String`). En TS, `for...of` ne consomme rien ; en Rust, `for x in v` appelle `v.into_iter()` qui **prend** `v`.

### E0502 : garder une référence puis muter

```rust
let mut queue = vec![1, 2, 3];
let first = &queue[0];
queue.push(4);           // E0502 : queue est mutée…
println!("{first}");     // …alors que first est encore utilisé
```

Pourquoi c'est un vrai bug : `push` peut **réallouer** le buffer, et `first` pointerait alors vers de la mémoire libérée. Correction : copier la valeur (`let first = queue[0];`, `i32` est `Copy`) ou réordonner.

### E0515 : renvoyer une référence vers une variable locale

```rust
fn make_label() -> &'static str {
    let s = format!("ORD-{}", 42);
    &s // E0515 : s est détruite à la fin de la fonction
}
```

Correction : renvoyer la valeur possédée (`-> String`). Retiens : **une fonction qui crée une donnée renvoie une valeur possédée** ; une fonction qui renvoie une référence la tire forcément d'un de ses paramètres.

### La méthode pour corriger

1. Lis les labels : où est le move/l'emprunt, où est le conflit.
2. Demande-toi : « qui doit **posséder** cette donnée ? ». Souvent, la réponse change la signature (`&str` en entrée, `String` en sortie).
3. Réduis la durée de l'emprunt (bloc `{ }`, ou extraire la valeur `Copy` avant).
4. En dernier recours : `clone()`, ou un smart pointer ([chapitre 7](/dev/rust/07-smart-pointers)).

## Cas réel : enrichir des commandes avant export

Un worker lit des commandes, les normalise et calcule un total. Version naïve d'un junior qui vient de TS :

```rust
fn export(orders: Vec<Order>) {
    let total = compute_total(orders);   // move !
    send_to_s3(orders, total);           // E0382
}
```

La bonne conception : **décider qui possède quoi** dans les signatures.

```rust play
#[derive(Debug)]
struct Order {
    id: String,
    email: String,
    amount_cents: u64,
}

// Lecture seule → &[Order]
fn compute_total(orders: &[Order]) -> u64 {
    orders.iter().map(|o| o.amount_cents).sum()
}

// Modification en place → &mut [Order]
fn normalize(orders: &mut [Order]) {
    for o in orders.iter_mut() {
        o.email = o.email.trim().to_lowercase();
    }
}

// Consomme : la fonction devient propriétaire
fn into_csv(orders: Vec<Order>) -> String {
    orders
        .into_iter()
        .map(|o| format!("{},{},{}", o.id, o.email, o.amount_cents))
        .collect::<Vec<_>>()
        .join("\n")
}

fn main() {
    let mut orders = vec![
        Order { id: "A1".into(), email: " Bob@X.io ".into(),
                amount_cents: 1999 },
        Order { id: "A2".into(), email: "ann@y.io".into(),
                amount_cents: 500 },
    ];
    normalize(&mut orders);
    let total = compute_total(&orders);
    let csv = into_csv(orders); // orders n'existe plus après
    println!("{csv}\ntotal={total}");
}
```

La signature documente l'intention, et le compilateur la fait respecter : impossible d'utiliser `orders` après l'export par erreur.

## Pièges classiques

- **`clone()` partout pour « faire taire » le compilateur.** Ça compile, mais ça masque une mauvaise répartition de l'ownership.
- **Prendre `String` en paramètre quand `&str` suffit.** Force l'appelant à allouer ou à céder sa valeur.
- **`&Vec<T>` / `&String` en paramètre.** Préfère `&[T]` / `&str`.
- **Indexer une `String` par octets** sur du texte non ASCII → panic.
- **Croire que `let b = a` copie toujours.** Seulement pour les types `Copy`.
- **Question d'entretien** : « Pourquoi `&mut` n'est pas `Copy` ? » → parce que deux `&mut` sur la même valeur violeraient l'exclusivité.

## Défis

### 1. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
fn main() {
    let mut tags = vec![String::from("urgent")];
    let first = &tags[0];
    tags.push(String::from("vip"));
    println!("{first}");
}
```

::: details Solution
`first` est un emprunt partagé de `tags`, encore utilisé à la ligne `println!`. Entre-temps, `push` demande un `&mut tags` (E0502). C'est un vrai bug évité : `push` peut réallouer et `first` pointerait dans le vide.

Corrections : afficher avant le `push`, ou posséder une copie (`let first = tags[0].clone();`).
:::

### 2. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
fn shout(s: String) -> String {
    s.to_uppercase()
}

fn main() {
    let name = String::from("ada");
    let loud = shout(name);
    println!("{name} -> {loud}");
}
```

::: details Solution
`shout(name)` **déplace** `name` dans la fonction (E0382 au `println!`). La fonction n'a pas besoin de posséder la chaîne : `fn shout(s: &str) -> String`, puis `shout(&name)`.
:::

### 3. Que affiche ce code ?

```rust play
fn main() {
    let a = [1, 2, 3];
    let mut b = a;
    b[0] = 99;
    let v = vec![1, 2, 3];
    let mut w = v.clone();
    w[0] = 99;
    println!("{a:?} {b:?} {v:?} {w:?}");
}
```

::: details Solution
`[1, 2, 3] [99, 2, 3] [1, 2, 3] [99, 2, 3]`. Un tableau `[i32; 3]` est `Copy` : `b` est une copie indépendante. Le `Vec` n'est pas `Copy`, d'où le `clone()` explicite (sans lui, `v` serait déplacé et inutilisable).
:::

### 4. Exercice : le mot le plus long

Écris une fonction qui renvoie le mot le plus long d'un texte **sans allouer** (renvoie une slice du texte). En cas d'égalité, le premier gagne. Texte vide → `""`.

```rust play
pub fn longest_word(text: &str) -> &str {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic() {
        assert_eq!(longest_word("paiement refusé par la banque"),
                   "paiement");
    }
    #[test]
    fn tie_keeps_first() {
        assert_eq!(longest_word("abc xyz de"), "abc");
    }
    #[test]
    fn empty() {
        assert_eq!(longest_word("   "), "");
    }
}
```

::: details Solution
```rust play
pub fn longest_word(text: &str) -> &str {
    let mut best = "";
    for w in text.split_whitespace() {
        // chars().count() : longueur en caractères, pas en octets
        if w.chars().count() > best.chars().count() {
            best = w;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic() {
        assert_eq!(longest_word("paiement refusé par la banque"),
                   "paiement");
    }
    #[test]
    fn tie_keeps_first() {
        assert_eq!(longest_word("abc xyz de"), "abc");
    }
    #[test]
    fn empty() {
        assert_eq!(longest_word("   "), "");
    }
}
```

Le type de retour `&str` emprunte `text` : le compilateur l'infère grâce aux règles d'élision ([chapitre 4](/dev/rust/04-lifetimes)). `split_whitespace` renvoie des slices de `text`, donc zéro allocation. Note : `max_by_key` renverrait le **dernier** en cas d'égalité, d'où la boucle.
:::

### 5. Exercice : remise en place

Applique une remise de `pct` % à chaque prix (en centimes, arrondi vers le bas) **en place**, et renvoie le nombre de prix modifiés (ceux qui ont changé de valeur).

```rust play
pub fn apply_discount(prices: &mut [u64], pct: u64) -> usize {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discount() {
        let mut p = vec![1000, 0, 999];
        let changed = apply_discount(&mut p, 10);
        assert_eq!(p, vec![900, 0, 899]);
        assert_eq!(changed, 2);
    }
    #[test]
    fn zero_pct() {
        let mut p = [500, 200];
        assert_eq!(apply_discount(&mut p, 0), 0);
        assert_eq!(p, [500, 200]);
    }
}
```

::: details Solution
```rust play
pub fn apply_discount(prices: &mut [u64], pct: u64) -> usize {
    let mut changed = 0;
    for p in prices.iter_mut() {
        let new = *p * (100 - pct) / 100;
        if new != *p {
            *p = new;
            changed += 1;
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discount() {
        let mut p = vec![1000, 0, 999];
        let changed = apply_discount(&mut p, 10);
        assert_eq!(p, vec![900, 0, 899]);
        assert_eq!(changed, 2);
    }
    #[test]
    fn zero_pct() {
        let mut p = [500, 200];
        assert_eq!(apply_discount(&mut p, 0), 0);
        assert_eq!(p, [500, 200]);
    }
}
```

`&mut [u64]` accepte un `Vec` comme un tableau. `iter_mut()` donne des `&mut u64`, qu'on déréférence avec `*p`. En prod, on vérifierait `pct <= 100` (sinon `100 - pct` déborde : panic en debug).
:::

### 6. Mini-scénario : signature d'API

Ton collègue propose `fn find_customer(customers: Vec<Customer>, email: String) -> Option<Customer>`. Qu'est-ce qui ne va pas, et quelle signature proposes-tu ?

::: details Solution
Elle **consomme** toute la liste et l'email : l'appelant perd ses clients après une simple recherche. Une recherche est une lecture :

```rust
fn find_customer<'a>(
    customers: &'a [Customer],
    email: &str,
) -> Option<&'a Customer>
```

On emprunte la liste, on emprunte l'email, on renvoie une référence vers l'élément trouvé. L'annotation `'a` dit « le résultat vient de `customers`, pas de `email` » ([chapitre 4](/dev/rust/04-lifetimes)). Si l'appelant a besoin d'une copie, il fera `.cloned()`.
:::

## À retenir

- Un seul propriétaire ; à la sortie du scope, `drop`. Pas de GC.
- `let b = a` **déplace** (sauf types `Copy`) ; `clone()` duplique explicitement.
- `&T` : plein de lecteurs ; `&mut T` : un seul écrivain. Jamais les deux.
- En paramètre : `&str` / `&[T]` pour lire, `&mut [T]` pour modifier en place, valeur possédée pour consommer.
- Une fonction qui **crée** une donnée renvoie une valeur possédée (`String`, `Vec`).
- Les erreurs E0382 / E0499 / E0502 / E0515 racontent une histoire : lis les labels.
