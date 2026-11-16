# Macros & unsafe

Ce que tu vas apprendre : écrire des macros déclaratives (`macro_rules!`), comprendre ce que font les macros procédurales que tu utilises tous les jours (`#[derive(Serialize)]`, `#[tokio::main]`, `sqlx::query!`), et démystifier `unsafe` : ce que ça permet **réellement**, ce que ça ne permet pas, comment raisonner en **invariants**, et un aperçu de la FFI (appeler du C, ou exposer du Rust à Node).

## Pourquoi des macros ?

Une fonction prend des **valeurs** ; une macro prend du **code** (des tokens) et génère du code, à la compilation. On s'en sert pour ce qu'une fonction ne peut pas faire :

- nombre variable d'arguments : `println!("{} {}", a, b)`, `vec![1, 2, 3]` ;
- générer des déclarations (structs, impls) répétitives ;
- vérifier quelque chose à la compilation : `sqlx::query!` valide le SQL, `format!` vérifie que les `{}` correspondent aux arguments.

Le `!` signale toujours une macro. En TS, l'équivalent le plus proche serait un plugin Babel/SWC ou un générateur de code, en beaucoup plus intégré.

## `macro_rules!` : les macros déclaratives

Une macro déclarative, c'est un `match` sur la **syntaxe** :

```rust play
macro_rules! cents {
    // motif (eur est un mot-clé de la macro) => code généré
    ($euros:literal eur) => { $euros * 100 };
    ($euros:literal eur $c:literal) => { $euros * 100 + $c };
}

// répétition : $( ... ),* = "zéro ou plus, séparés par des virgules"
macro_rules! sum_all {
    ($($x:expr),* $(,)?) => { 0 $(+ $x)* };
}

fn main() {
    let price = cents!(12 eur);
    let total = cents!(12 eur 50);
    println!("{price} {total}");
    println!("{}", sum_all!(1, 2, 3 * 4,)); // virgule finale OK
}
```

Les **fragment specifiers** les plus courants :

| Spécificateur | Capture | Exemple |
|---|---|---|
| `expr` | une expression | `a + 1`, `f(x)` |
| `ident` | un identifiant | `UserId`, `total` |
| `ty` | un type | `Vec<u8>`, `&str` |
| `literal` | un littéral | `42`, `"abc"` |
| `pat` | un pattern | `Some(x)`, `1..=9` |
| `block` | un bloc `{ ... }` | |
| `tt` | un *token tree* (n'importe quoi) | |

Répétitions : `$(...)*` (0+), `$(...)+` (1+), `$(...)?` (0 ou 1), avec un séparateur optionnel (`,` ou `;`) avant l'opérateur.

### Un exemple réel : des IDs typés

Dans un SaaS, tu veux un newtype par type d'identifiant ([chapitre 2](/dev/rust/02-structs-enums-pattern-matching)), chacun avec les mêmes derives et un `Display` préfixé (`usr_42`, `ord_7`, à la Stripe). Écrire ça 15 fois à la main, c'est 15 occasions d'oublier un derive :

```rust play
use std::fmt;

macro_rules! typed_id {
    ($($name:ident => $prefix:literal),+ $(,)?) => {
        $(
            #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
            pub struct $name(pub u64);

            impl fmt::Display for $name {
                fn fmt(&self, f: &mut fmt::Formatter<'_>)
                    -> fmt::Result {
                    write!(f, "{}_{}", $prefix, self.0)
                }
            }
        )+
    };
}

typed_id! {
    UserId => "usr",
    OrderId => "ord",
    InvoiceId => "inv",
}

fn main() {
    let u = UserId(42);
    let o = OrderId(7);
    println!("{u} a passé {o}");
    // let bad: UserId = o; // ne compile pas : types distincts
}
```

### Hygiène et portée

Les macros `macro_rules!` sont **hygiéniques** pour les variables locales : une variable créée dans la macro ne peut pas entrer en collision avec une variable de l'appelant.

```rust
macro_rules! double {
    ($e:expr) => {{ let x = $e; x * 2 }};
}
let x = 10;
let y = double!(x + 1); // 22 : le `x` interne ne masque pas le tien
```

Pour utiliser une macro hors de son module, `#[macro_export]` l'exporte à la racine de la crate. Dans le code généré, référence les items par chemin absolu (`$crate::module::Type`, `::std::fmt::Display`) pour que la macro marche partout.

::: tip Fonction ou generics d'abord
Une macro est plus dure à lire, à déboguer et à faire comprendre à rust-analyzer. Utilise-la seulement si une fonction générique ou un trait ne suffit pas. `cargo expand` (crate `cargo-expand`) affiche le code généré : indispensable pour déboguer.
:::

## Les macros procédurales (aperçu)

Les macros procédurales sont des **programmes Rust** qui reçoivent un flux de tokens et en renvoient un autre. Elles vivent dans une crate dédiée (`proc-macro = true`) et utilisent généralement `syn` (parser) et `quote` (générer).

| Sorte | Syntaxe | Exemples |
|---|---|---|
| derive | `#[derive(Trait)]` | `Serialize`, `Error`, `Parser`, `FromRow` |
| attribut | `#[nom]` sur un item | `#[tokio::main]`, `#[tracing::instrument]`, `#[sqlx::test]` |
| function-like | `nom!(...)` | `sqlx::query!`, `html!` (yew) |

Le squelette d'une derive :

```rust
// crate `my_derive`, Cargo.toml : [lib] proc-macro = true
use proc_macro::TokenStream;
use quote::quote;
use syn::{DeriveInput, parse_macro_input};

#[proc_macro_derive(Describe)]
pub fn derive_describe(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    let name = &ast.ident;
    quote! {
        impl #name {
            pub fn describe() -> &'static str {
                stringify!(#name)
            }
        }
    }
    .into()
}
```

Ce qu'il faut retenir pour ton quotidien :

- `#[derive(Serialize)]` **génère** un `impl Serialize for TaStruct` à la compilation : zéro réflexion à l'exécution (contrairement à `class-transformer` ou aux décorateurs TS).
- `#[tokio::main]` réécrit ton `async fn main` en `fn main` qui construit un runtime.
- Les proc macros alourdissent les temps de compilation (`syn` est gros) : c'est une des raisons pour lesquelles les projets Rust compilent lentement.

## `unsafe` : ce que ça permet vraiment

Rust safe garantit l'absence de comportement indéfini (*undefined behavior*, UB) : pas de use-after-free, pas de data race, pas de lecture hors limites. Mais certaines choses sont impossibles à vérifier par le compilateur : parler au matériel, appeler du C, écrire `Vec` lui-même. `unsafe` déverrouille **cinq** capacités, et seulement celles-là :

1. Déréférencer un **pointeur brut** (`*const T`, `*mut T`).
2. Appeler une **fonction `unsafe`** (dont les FFI).
3. Lire ou écrire une **`static mut`**.
4. Implémenter un **trait `unsafe`** (`Send`, `Sync`…).
5. Lire un champ d'une **`union`**.

::: danger Ce que `unsafe` ne fait PAS
Il ne désactive **pas** le borrow checker, ni le typage, ni les autres vérifications. Deux `&mut` sur la même valeur restent interdits dans un bloc `unsafe`. `unsafe` veut dire : « compilateur, sur ces 5 points, **je** garantis que les règles sont respectées ». Si tu te trompes, c'est de l'UB : le programme peut faire **n'importe quoi**, y compris marcher en dev et corrompre la mémoire en prod.
:::

```rust play
fn main() {
    let mut balance: i64 = 100;

    // créer un pointeur brut est safe…
    let p = &mut balance as *mut i64;

    // …le déréférencer ne l'est pas
    unsafe {
        // SAFETY: p vient d'une &mut vivante, aucune autre référence
        // à balance n'est utilisée pendant ce bloc.
        *p -= 30;
    }
    println!("{balance}");
}
```

### Penser en invariants

Une fonction `unsafe fn` a des **préconditions** que l'appelant doit garantir. Un bloc `unsafe { }` est une **promesse** que ces préconditions sont remplies. La convention (et le lint clippy `undocumented_unsafe_blocks`) : un commentaire `// SAFETY:` qui justifie chaque bloc.

```rust
/// Renvoie l'élément à `i` sans vérification de bornes.
///
/// # Safety
/// `i` doit être strictement inférieur à `v.len()`.
unsafe fn get_fast(v: &[u64], i: usize) -> u64 {
    // SAFETY: garanti par le contrat de la fonction
    unsafe { *v.get_unchecked(i) }
}
```

Depuis l'édition 2024, le corps d'une `unsafe fn` n'est plus implicitement un bloc `unsafe` : il faut un `unsafe { }` explicite à l'intérieur (lint `unsafe_op_in_unsafe_fn`). Chaque opération dangereuse est ainsi visible et justifiée.

### Le bon usage : une abstraction safe autour d'un noyau unsafe

Toute la std est construite ainsi : `Vec`, `String`, `HashMap`, `Arc` contiennent de l'`unsafe`, mais exposent une API **safe** qui maintient les invariants. Exemple classique, `split_at_mut` : deux `&mut` vers des moitiés **disjointes** d'une slice. Le borrow checker ne sait pas prouver la disjonction, alors la std le fait avec un pointeur brut et une vérification :

```rust
pub fn split_at_mut<T>(s: &mut [T], mid: usize)
    -> (&mut [T], &mut [T]) {
    let len = s.len();
    assert!(mid <= len); // l'invariant est vérifié ICI, en safe
    let ptr = s.as_mut_ptr();
    // SAFETY: [0, mid) et [mid, len) sont disjoints et dans les
    // bornes de `s`, qui reste emprunté en &mut pour toute la durée
    // de vie des deux moitiés.
    unsafe {
        (std::slice::from_raw_parts_mut(ptr, mid),
         std::slice::from_raw_parts_mut(ptr.add(mid), len - mid))
    }
}
```

Une fonction **safe** qui peut causer de l'UB pour certaines entrées est dite **unsound** : c'est un bug grave, même si aucun appelant actuel ne le déclenche.

### Outils

- **Miri** (`cargo +nightly miri test`) : un interpréteur qui détecte l'UB (accès hors limites, aliasing invalide, lecture de mémoire non initialisée) dans tes tests.
- `#![forbid(unsafe_code)]` (ou `[lints.rust] unsafe_code = "forbid"`) dans les crates qui n'en ont pas besoin : 99 % du code applicatif.
- `cargo geiger` liste l'`unsafe` dans tes dépendances.

### `unsafe impl Send` / `Sync`

Un type qui contient un pointeur brut n'est ni `Send` ni `Sync` automatiquement. Si tu sais qu'il est thread-safe (par exemple un handle d'une lib C documentée comme thread-safe), tu le promets :

```rust
struct Handle(*mut ffi::Engine);
// SAFETY: la doc de libengine garantit que l'Engine peut être
// utilisé depuis n'importe quel thread, avec synchronisation interne.
unsafe impl Send for Handle {}
unsafe impl Sync for Handle {}
```

C'est précisément le genre de promesse à relire deux fois en code review.

### `static mut` : à oublier

```rust
static mut COUNTER: u32 = 0;
unsafe { COUNTER += 1; }    // data race possible entre threads
let r = unsafe { &COUNTER }; // erreur en édition 2024
```

En édition 2024, créer une référence vers une `static mut` est refusé (lint `static_mut_refs`, *deny* par défaut). Les alternatives safe : `AtomicU32`, `Mutex`, `OnceLock`/`LazyLock` pour une initialisation unique.

## FFI : parler au C (aperçu)

### Appeler du C depuis Rust

```rust play
use std::ffi::{CStr, CString, c_char, c_int};

// Édition 2024 : les blocs extern doivent être `unsafe extern`.
// On promet que ces signatures correspondent à la lib C.
unsafe extern "C" {
    fn abs(x: c_int) -> c_int;
    fn strlen(s: *const c_char) -> usize;
}

fn main() {
    // SAFETY: abs est défini pour toute valeur sauf INT_MIN
    let a = unsafe { abs(-42) };

    // les chaînes C finissent par \0 : CString l'ajoute
    let s = CString::new("facture").expect("pas de \\0 interne");
    // SAFETY: s.as_ptr() pointe vers une chaîne C valide
    // qui vit jusqu'à la fin de l'instruction
    let n = unsafe { strlen(s.as_ptr()) };

    let back: &CStr = s.as_c_str();
    println!("{a} {n} {back:?}");
}
```

Le pattern standard : déclarer les fonctions C (`bindgen` les génère depuis un `.h`), puis écrire **par-dessus** un module Rust safe (types possédés, `Result`, `Drop` pour libérer les ressources C). Le reste du code n'utilise que la couche safe.

### Exposer du Rust au C

```rust
// édition 2024 : #[unsafe(no_mangle)] (l'attribut peut
// provoquer des conflits de symboles, d'où le unsafe)
#[unsafe(no_mangle)]
pub extern "C" fn vat_cents(cents: u64, rate_bp: u32) -> u64 {
    cents * (10_000 + rate_bp as u64) / 10_000
}
```

Avec `crate-type = ["cdylib"]` dans `Cargo.toml`, tu obtiens une `.so`/`.dylib`/`.dll` appelable depuis C, Python, Go… `cbindgen` génère le `.h`.

## Cas réel : accélérer un service Node avec Rust

Un back-office Node calcule des rapports de commissions sur des millions de lignes : 4 secondes par rapport, l'event loop bloquée. Plutôt que de tout réécrire, on extrait le calcul dans un module natif avec **napi-rs**, qui génère les bindings Node-API (et même les types `.d.ts`) :

```rust
// Cargo.toml : crate-type = ["cdylib"], deps napi + napi-derive
use napi_derive::napi;

#[napi(object)]
pub struct Line {
    pub seller_id: u32,
    pub amount_cents: i64,
}

/// Total des commissions par vendeur (taux en points de base).
#[napi]
pub fn commissions(lines: Vec<Line>, rate_bp: i64) -> Vec<i64> {
    let max = lines.iter().map(|l| l.seller_id).max().unwrap_or(0);
    let mut out = vec![0i64; max as usize + 1];
    for l in &lines {
        out[l.seller_id as usize] += l.amount_cents * rate_bp / 10_000;
    }
    out
}
```

```ts
// côté TS : un import normal, typé grâce au .d.ts généré
import { commissions } from "@acme/commissions";

const totals = commissions(lines, 250); // 2,5 %
```

Zéro `unsafe` dans ton code : napi-rs l'encapsule. Les points d'attention : le coût de conversion JS ↔ Rust (passe des lots, pas des appels par ligne), la CI qui doit compiler un binaire par plateforme (napi-rs fournit les templates), et les calculs longs à lancer en `AsyncTask` pour ne pas bloquer l'event loop. Même logique côté Python avec **PyO3** / maturin (c'est ainsi que sont faits `pydantic-core`, `polars`, `ruff`).

## Pièges classiques

- **Une macro là où une fonction générique suffit** : moins lisible, moins bien outillée.
- **Chemins relatifs dans une macro exportée** : utilise `$crate::` et `::std::`.
- **Croire que `unsafe` désactive le borrow checker** : non, il ouvre 5 portes précises.
- **`unsafe` sans commentaire `// SAFETY:`** : personne ne peut vérifier l'invariant en review.
- **Fonction safe qui peut produire de l'UB** (unsound) : vérifie l'invariant avant le bloc `unsafe` (`assert!`), ou rends la fonction `unsafe` avec une section `# Safety`.
- **`static mut`** : remplace par un atomique, un `Mutex` ou `LazyLock`.
- **Oublier le `\0` des chaînes C** ou libérer avec le mauvais allocateur : une mémoire allouée par C se libère avec la fonction C correspondante.
- **Question d'entretien** : « Qu'est-ce qui est autorisé dans un bloc `unsafe` ? » → les 5 superpouvoirs ; tout le reste est vérifié comme d'habitude.

## Défis

### 1. Exercice : une macro `hashmap!`

Écris une macro qui construit une `HashMap` : `hashmap!{ "a" => 1, "b" => 2 }`, virgule finale acceptée, et `hashmap!{}` pour une map vide.

```rust play
use std::collections::HashMap;

macro_rules! hashmap {
    () => { todo!() };
    // TODO : ajoute un bras pour clé => valeur, répété
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty() {
        let m: HashMap<&str, i32> = hashmap!{};
        assert!(m.is_empty());
    }
    // décommente quand ta macro gère clé => valeur :
    // #[test]
    // fn pairs() {
    //     let m = hashmap!{ "EUR" => 100, "USD" => 108, };
    //     assert_eq!(m.len(), 2);
    //     assert_eq!(m["USD"], 108);
    // }
}
```

::: details Solution
```rust play
use std::collections::HashMap;

macro_rules! hashmap {
    () => { ::std::collections::HashMap::new() };
    ($($k:expr => $v:expr),+ $(,)?) => {{
        let mut m = ::std::collections::HashMap::new();
        $( m.insert($k, $v); )+
        m
    }};
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty() {
        let m: HashMap<&str, i32> = hashmap!{};
        assert!(m.is_empty());
    }
    #[test]
    fn pairs() {
        let m = hashmap!{ "EUR" => 100, "USD" => 108, };
        assert_eq!(m.len(), 2);
        assert_eq!(m["USD"], 108);
    }
}
```

Les accolades doublées du second bras : la paire externe délimite le code généré, la paire interne forme un **bloc** expression qui renvoie `m`. Le chemin absolu `::std::collections::HashMap` fait marcher la macro même si l'appelant n'a pas importé `HashMap`. (Pour info, la std propose `HashMap::from([("EUR", 100), ...])`, qui suffit souvent.)
:::

### 2. Exercice : générer des enums de permissions

Dans un back-office, chaque permission doit avoir une variante d'enum, une méthode `as_str()` (pour la base) et une liste `ALL`. Écris la macro `permissions!` pour que les tests passent.

```rust play
macro_rules! permissions {
    ($($variant:ident => $s:literal),+ $(,)?) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum Permission { $($variant),+ }

        impl Permission {
            pub const ALL: &'static [Permission] = &[]; // TODO
            pub fn as_str(&self) -> &'static str { todo!() }
            pub fn parse(s: &str) -> Option<Permission> { todo!() }
        }
    };
}

permissions! {
    ReadOrders => "orders:read",
    RefundOrders => "orders:refund",
    ManageUsers => "users:manage",
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        assert_eq!(Permission::ALL.len(), 3);
        for p in Permission::ALL {
            assert_eq!(Permission::parse(p.as_str()), Some(*p));
        }
        assert_eq!(Permission::RefundOrders.as_str(), "orders:refund");
        assert_eq!(Permission::parse("nope"), None);
    }
}
```

::: details Solution
```rust play
macro_rules! permissions {
    ($($variant:ident => $s:literal),+ $(,)?) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum Permission { $($variant),+ }

        impl Permission {
            pub const ALL: &'static [Permission] =
                &[$(Permission::$variant),+];

            pub fn as_str(&self) -> &'static str {
                match self { $(Permission::$variant => $s),+ }
            }

            pub fn parse(s: &str) -> Option<Permission> {
                match s {
                    $($s => Some(Permission::$variant),)+
                    _ => None,
                }
            }
        }
    };
}

permissions! {
    ReadOrders => "orders:read",
    RefundOrders => "orders:refund",
    ManageUsers => "users:manage",
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        assert_eq!(Permission::ALL.len(), 3);
        for p in Permission::ALL {
            assert_eq!(Permission::parse(p.as_str()), Some(*p));
        }
        assert_eq!(Permission::RefundOrders.as_str(), "orders:refund");
        assert_eq!(Permission::parse("nope"), None);
    }
}
```

Une seule source de vérité : ajouter une permission = une ligne, et `ALL`, `as_str`, `parse` restent synchronisés. Les deux variables `$variant` et `$s` sont répétées **ensemble** dans chaque `$( ... )`. Les crates `strum` ou `serde` (avec `rename`) font la même chose via des derives.
:::

### 3. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
fn main() {
    let total: u64 = 1999;
    let p = &total as *const u64;
    println!("{}", *p);
}
```

::: details Solution
E0133 : « dereference of raw pointer is unsafe and requires unsafe block ». Créer un pointeur brut est safe, le **déréférencer** ne l'est pas (le compilateur ne peut pas savoir s'il pointe vers une mémoire valide). Ici, la vraie correction est de ne pas utiliser de pointeur brut du tout : `let p = &total; println!("{}", *p);`.
:::

### 4. Question : ce code est-il correct ?

```rust
pub fn first<T>(v: &[T]) -> &T {
    // SAFETY: on lit le premier élément
    unsafe { &*v.as_ptr() }
}
```

::: details Solution
Non, c'est **unsound** : `first(&[])` déréférence un pointeur qui ne pointe vers aucun élément valide, c'est de l'UB, depuis une fonction **safe**. Le commentaire `SAFETY` ne justifie rien : il décrit l'opération au lieu de prouver l'invariant (« la slice est non vide »).

Corrections : vérifier avant (`assert!(!v.is_empty())`), ou mieux, ne pas utiliser d'`unsafe` : `v.first()` renvoie un `Option<&T>`, ou `&v[0]` panique proprement. Neuf fois sur dix, la bonne réponse à « j'ai besoin d'`unsafe` » est une API safe que tu ne connaissais pas.
:::

### 5. Exercice : ton propre `split_at_mut`

Implémente `split_two_mut` : renvoie deux `&mut` vers les éléments `i` et `j` (distincts) d'une slice. Le borrow checker refuse `(&mut v[i], &mut v[j])` ; utilise un pointeur brut, **vérifie les invariants** avant le bloc `unsafe` et justifie-le.

```rust play
pub fn split_two_mut<T>(v: &mut [T], i: usize, j: usize)
    -> (&mut T, &mut T) {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_between_accounts() {
        let mut balances = vec![100, 50, 0];
        let (from, to) = split_two_mut(&mut balances, 0, 2);
        *from -= 30;
        *to += 30;
        assert_eq!(balances, vec![70, 50, 30]);
    }

    #[test]
    fn order_does_not_matter() {
        let mut v = [1, 2, 3];
        let (a, b) = split_two_mut(&mut v, 2, 0);
        std::mem::swap(a, b);
        assert_eq!(v, [3, 2, 1]);
    }

    #[test]
    #[should_panic]
    fn same_index_panics() {
        let mut v = [1, 2];
        split_two_mut(&mut v, 1, 1);
    }

    #[test]
    #[should_panic]
    fn out_of_bounds_panics() {
        let mut v = [1, 2];
        split_two_mut(&mut v, 0, 5);
    }
}
```

::: details Solution
```rust play
pub fn split_two_mut<T>(v: &mut [T], i: usize, j: usize)
    -> (&mut T, &mut T) {
    assert!(i != j, "les indices doivent être distincts");
    assert!(i < v.len() && j < v.len(), "indice hors limites");
    let ptr = v.as_mut_ptr();
    // SAFETY: i et j sont dans les bornes (assert ci-dessus) et
    // distincts, donc les deux références ne se chevauchent pas.
    // `v` reste emprunté en &mut tant que les résultats vivent.
    unsafe { (&mut *ptr.add(i), &mut *ptr.add(j)) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_between_accounts() {
        let mut balances = vec![100, 50, 0];
        let (from, to) = split_two_mut(&mut balances, 0, 2);
        *from -= 30;
        *to += 30;
        assert_eq!(balances, vec![70, 50, 30]);
    }

    #[test]
    fn order_does_not_matter() {
        let mut v = [1, 2, 3];
        let (a, b) = split_two_mut(&mut v, 2, 0);
        std::mem::swap(a, b);
        assert_eq!(v, [3, 2, 1]);
    }

    #[test]
    #[should_panic]
    fn same_index_panics() {
        let mut v = [1, 2];
        split_two_mut(&mut v, 1, 1);
    }

    #[test]
    #[should_panic]
    fn out_of_bounds_panics() {
        let mut v = [1, 2];
        split_two_mut(&mut v, 0, 5);
    }
}
```

Sans les deux `assert!`, la fonction serait unsound : `i == j` créerait deux `&mut` sur la même valeur (UB), et un indice hors limites lirait n'importe où. Pour info, la std propose une version safe : `v.get_disjoint_mut([i, j])` (stable depuis Rust 1.86), qui renvoie un `Result`. Encore une fois : cherche l'API safe avant d'écrire de l'`unsafe`.
:::

## À retenir

- `macro_rules!` = un `match` sur la syntaxe, avec fragments (`expr`, `ident`, `ty`…) et répétitions `$(...),*` ; à réserver à ce qu'une fonction ne peut pas faire.
- Les macros procédurales (derive, attribut, function-like) génèrent du code à la compilation : `serde`, `tokio`, `sqlx` en dépendent ; `cargo expand` pour voir le résultat.
- `unsafe` ouvre 5 capacités précises (pointeurs bruts, fonctions unsafe, `static mut`, traits unsafe, unions) et ne désactive rien d'autre.
- Chaque bloc `unsafe` a un commentaire `// SAFETY:` qui prouve l'invariant ; une fonction safe ne doit jamais pouvoir causer d'UB.
- Encapsule l'`unsafe` dans une petite abstraction safe ; vérifie avec Miri ; `forbid(unsafe_code)` partout ailleurs.
- FFI : `unsafe extern "C"` + couche safe ; pour Node, napi-rs ; pour Python, PyO3.
