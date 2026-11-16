# Rust

Ce que tu vas trouver ici : un parcours Rust pensé pour un dev TypeScript qui veut atteindre un vrai niveau mid → senior en 2026, avec des cas tirés d'apps réelles (API, CLI, workers) et des défis à faire le soir.

## Pourquoi Rust quand on vient de TS

En TypeScript, le compilateur vérifie tes **types**, mais le runtime (V8 + garbage collector) gère la **mémoire** et la **concurrence** pour toi. En Rust, le compilateur vérifie les deux :

| Problème | TS / Node | Rust |
|---|---|---|
| Mémoire | GC, invisible | ownership, vérifié à la compilation |
| `null` / `undefined` | `strictNullChecks` | pas de null : `Option<T>` |
| Erreurs | `throw`, non typé | `Result<T, E>`, typé |
| Data race | 1 thread (event loop) | interdit par `Send`/`Sync` |
| Perf | JIT, pauses GC | natif, prévisible |

Le prix : une courbe d'apprentissage. Le **borrow checker** va te refuser du code qui « marcherait » en JS. Le bon état d'esprit : chaque erreur de compilation est un bug que tu n'auras pas en prod à 3 h du matin.

::: tip Le pont mental principal
En TS, tout objet est une **référence partagée** : `const b = a` → deux noms, un objet, tout le monde peut muter. En Rust, chaque valeur a **un seul propriétaire**, et tu dois dire explicitement si tu la **prêtes** (`&`), la **prêtes en écriture** (`&mut`) ou la **donnes** (move). C'est 80 % de la difficulté, et c'est le chapitre 1.
:::

## Mid vs senior : ce qu'on attend de toi

| Sujet | Mid | Senior |
|---|---|---|
| Ownership | lit et corrige les erreurs du borrow checker | conçoit des API qui évitent les `clone()` inutiles |
| Types | enums + `match`, `Option`/`Result` | rend les états invalides impossibles (typestate, newtype) |
| Traits | implémente `Display`, `From`, utilise des generics | choisit `dyn` vs generics, conçoit des traits extensibles |
| Lifetimes | comprend l'élision, annote une fonction | structs qui empruntent, zero-copy, `'static` bounds |
| Erreurs | `?`, `thiserror`/`anyhow` | hiérarchie d'erreurs par couche, mapping HTTP propre |
| Concurrence | `Arc<Mutex<T>>`, channels | évite les locks, sait ce que `Send`/`Sync` garantissent |
| Async | écrit des handlers Tokio | comprend `Future`, cancellation, ne bloque pas le runtime |
| Outillage | clippy, tests, workspace | features, profils, bench, CI rapide |
| `unsafe` | sait que ça existe | sait justifier un invariant, relit une FFI |

## Ordre de lecture

Les chapitres se lisent dans l'ordre. Les 5 premiers sont le socle : ne saute pas.

1. [Ownership & borrowing](/dev/rust/01-ownership-borrowing) — le cœur du langage.
2. [Structs, enums & match](/dev/rust/02-structs-enums-pattern-matching) — modéliser un domaine.
3. [Traits & generics](/dev/rust/03-traits-generics) — l'équivalent (en mieux) des interfaces.
4. [Lifetimes](/dev/rust/04-lifetimes) — démystifiées.
5. [Gestion d'erreurs](/dev/rust/05-gestion-erreurs) — `Result`, `?`, `thiserror`, `anyhow`.
6. [Collections & itérateurs](/dev/rust/06-collections-iterateurs) — ton quotidien (et LeetCode).
7. [Smart pointers](/dev/rust/07-smart-pointers) — `Box`, `Rc`, `Arc`, `RefCell`…
8. [Concurrence](/dev/rust/08-concurrence) — threads, `Send`/`Sync`, channels.
9. [Async & Tokio](/dev/rust/09-async-tokio) — le Rust backend moderne.
10. [API Axum + SQLx](/dev/rust/10-api-axum-sqlx) — une vraie API de bout en bout.
11. [CLI avec clap](/dev/rust/11-cli-clap) — un outil interne réel.
12. [Tests & outillage](/dev/rust/12-tests-et-outillage) — cargo, clippy, bench, proptest.
13. [Macros & unsafe](/dev/rust/13-macros-et-unsafe) — ce qu'il y a sous le capot.

Ensuite : les [défis Rust d'entretien](/interview/02-pratique/02-defis-rust).

## Setup minimal

### Installer

```bash
# rustup gère les versions de Rust (comme nvm pour Node)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup update            # passer à la dernière stable
rustup component add clippy rustfmt
rustc --version          # 1.9x
```

| Node / TS | Rust |
|---|---|
| `nvm` | `rustup` |
| `npm` / `pnpm` | `cargo` |
| `package.json` | `Cargo.toml` |
| `pnpm-lock.yaml` | `Cargo.lock` |
| npmjs.com | crates.io (+ docs.rs) |
| ESLint | `cargo clippy` |
| Prettier | `cargo fmt` |
| Vitest | `cargo test` (intégré) |

### Les commandes du quotidien

```bash
cargo new mon-app          # binaire (src/main.rs)
cargo new --lib ma-lib     # bibliothèque (src/lib.rs)
cargo add serde --features derive
cargo check                # type-check rapide, sans binaire
cargo run -- --arg 1       # compile + exécute
cargo test                 # tous les tests (unit, intégration, doc)
cargo clippy -- -D warnings
cargo fmt
cargo build --release      # binaire optimisé (target/release)
```

::: tip `cargo check` est ton `tsc --noEmit`
Il est bien plus rapide que `cargo build` car il ne génère pas de code machine. Ton éditeur le lance en continu via rust-analyzer.
:::

### Éditeur

- **rust-analyzer** (VS Code, Zed, Neovim, RustRover a son propre moteur) : types inférés affichés inline, go-to-definition dans les crates, quick-fixes. Indispensable.
- Active « check on save » avec **clippy** au lieu de `check` : `"rust-analyzer.check.command": "clippy"`.
- Le fichier `Cargo.toml` de base, édition 2024 :

```toml
[package]
name = "orders"
version = "0.1.0"
edition = "2024"

[dependencies]
serde = { version = "1", features = ["derive"] }
```

### Sur ton téléphone : Rust Playground

Les blocs marqués d'un bouton **« ▶ Ouvrir dans Rust Playground »** s'ouvrent sur [play.rust-lang.org](https://play.rust-lang.org) (édition 2024, stable).

- **Run** exécute `fn main`.
- **Test** (menu à côté de Run) lance les `#[test]` : c'est comme ça que tu valides les défis.
- Le Playground embarque les ~100 crates les plus populaires (`serde`, `tokio`, `rand`, `regex`, `anyhow`, `thiserror`, `rayon`, `itertools`…). Pas `axum` ni `sqlx` : ces exemples-là sont à lancer en local.
- **Tools → Clippy** et **Tools → Rustfmt** marchent aussi.

```rust play
fn main() {
    let langages = ["TypeScript", "Rust"];
    for l in langages {
        println!("J'apprends {l}");
    }
}
```

## Comment lire les erreurs du compilateur

Rust a les meilleurs messages d'erreur de l'industrie. Prends l'habitude de les lire **en entier** :

```text
error[E0382]: borrow of moved value: `order`
 --> src/main.rs:5:20
  |
3 |     let order = String::from("A-42");
  |         ----- move occurs because `order` has type `String`
4 |     let other = order;
  |                 ----- value moved here
5 |     println!("{}", order);
  |                    ^^^^^ value borrowed here after move
  |
help: consider cloning the value if the performance cost is acceptable
```

- Le **code** (`E0382`) : `rustc --explain E0382` donne une explication complète avec exemples.
- Les **labels** racontent une histoire : « move ici », « utilisé là ».
- Le **help** propose souvent la correction (pas toujours la meilleure : un `clone()` suggéré n'est pas forcément la bonne réponse).

## À retenir

- `cargo` fait tout : build, deps, tests, lint, format, doc.
- `cargo check` + rust-analyzer + clippy = ta boucle de feedback.
- Le Playground (bouton « Test ») suffit pour tous les défis sauf les chapitres Axum/SQLx.
- Lis les erreurs en entier et utilise `rustc --explain`.
- Ownership d'abord : tout le reste en découle.
