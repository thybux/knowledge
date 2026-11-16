# Tests & outillage

Ce que tu vas apprendre : les trois sortes de tests de Rust (unitaires, intégration, doc-tests), organiser un projet en **workspace**, faire de clippy et rustfmt des alliés, utiliser les **features** et les **profils de build**, mesurer avec **criterion**, accélérer la CI avec **cargo-nextest**, et trouver des bugs avec le **property-based testing** (proptest).

## Le contraste avec l'écosystème JS

En TS, tu assembles : Vitest ou Jest, ESLint + plugins, Prettier, tsc, un bundler, et des heures de config. En Rust, `cargo` livre **tout** en standard, avec des conventions fixes :

| Besoin | JS / TS | Rust |
|---|---|---|
| Lancer les tests | `vitest` | `cargo test` |
| Linter | ESLint | `cargo clippy` |
| Formatter | Prettier | `cargo fmt` |
| Monorepo | pnpm workspaces / Nx | cargo workspace |
| Build optimisé | bundler + minify | `cargo build --release` |
| Benchmarks | tinybench | criterion / divan |

## Tests unitaires

Ils vivent **dans le même fichier** que le code, dans un module compilé seulement pour les tests. Ils ont donc accès aux fonctions **privées**.

```rust play
fn apply_vat(cents: u64, rate_bp: u64) -> u64 {
    // rate en points de base : 2000 = 20 %
    // arrondi au centime le plus proche
    (cents * (10_000 + rate_bp) + 5_000) / 10_000
}

#[derive(Debug, PartialEq)]
enum CouponError { Expired, Unknown }

fn coupon(code: &str) -> Result<u64, CouponError> {
    match code {
        "WELCOME10" => Ok(10),
        "BLACKFRIDAY" => Err(CouponError::Expired),
        _ => Err(CouponError::Unknown),
    }
}

#[cfg(test)]
mod tests {
    use super::*; // accès à tout le module parent, privé inclus

    #[test]
    fn vat_20_percent() {
        assert_eq!(apply_vat(1000, 2000), 1200);
    }

    #[test]
    fn vat_rounding() {
        // 333 * 1.055 = 351.315 → 351
        assert_eq!(apply_vat(333, 550), 351, "TVA réduite 5,5 %");
    }

    #[test]
    fn coupons() {
        assert_eq!(coupon("WELCOME10"), Ok(10));
        assert!(matches!(coupon("X"), Err(CouponError::Unknown)));
    }

    // un test peut renvoyer un Result : `?` fait échouer le test
    #[test]
    fn parse_then_apply() -> Result<(), Box<dyn std::error::Error>> {
        let cents: u64 = "2500".parse()?;
        assert_eq!(apply_vat(cents, 2000), 3000);
        Ok(())
    }

    #[test]
    #[should_panic(expected = "overflow")]
    fn overflow_panics_in_debug() {
        apply_vat(u64::MAX, 2000);
    }

    #[test]
    #[ignore = "lent : lancé avec cargo test -- --ignored"]
    fn slow_test() {}
}
```

Les commandes utiles :

```bash
cargo test                      # tout
cargo test vat                  # filtre : tests dont le nom contient "vat"
cargo test -- --nocapture       # affiche les println! des tests
cargo test -- --ignored         # seulement les #[ignore]
cargo test -p billing           # un seul crate du workspace
```

Les tests d'un même binaire tournent **en parallèle** (un thread par test). Un test qui touche à l'état global (variable d'environnement, fichier fixe) doit en tenir compte.

## Tests d'intégration

Les fichiers de `tests/` sont compilés comme des **crates séparées** : ils ne voient que l'API **publique**, comme un utilisateur de ta bibliothèque.

```text
billing/
├── src/lib.rs
└── tests/
    ├── common/
    │   └── mod.rs        # helpers partagés (pas un test en soi)
    ├── invoices.rs       # un binaire de test
    └── refunds.rs        # un autre
```

```rust
// tests/invoices.rs
mod common;
use billing::Invoice; // seulement ce qui est `pub`

#[test]
fn invoice_total_includes_vat() {
    let inv = common::sample_invoice();
    assert_eq!(inv.total_cents(), 1200);
}
```

Un **binaire** (`src/main.rs` seul) ne peut pas être importé dans `tests/` : c'est pour ça qu'on met la logique dans `lib.rs` ([chapitre 10](/dev/rust/10-api-axum-sqlx), [chapitre 11](/dev/rust/11-cli-clap)).

## Doc-tests : une doc qui ne ment pas

Les blocs de code dans les commentaires `///` sont **compilés et exécutés** par `cargo test` :

````rust
/// Formate un montant en centimes.
///
/// ```
/// use billing::format_cents;
/// assert_eq!(format_cents(1234), "12.34");
/// assert_eq!(format_cents(-5), "-0.05");
/// ```
///
/// ```should_panic
/// // un bloc peut aussi vérifier un panic
/// billing::format_cents_strict(i64::MIN);
/// ```
pub fn format_cents(c: i64) -> String { /* ... */ }
````

| Annotation | Compilé | Exécuté |
|---|---|---|
| (rien) ou `rust` | oui | oui |
| `no_run` | oui | non (ex. appel réseau) |
| `should_panic` | oui | doit paniquer |
| `compile_fail` | doit échouer | — |
| `ignore` | non | non |
| `text` | non (pas du Rust) | non |

Une ligne qui commence par `# ` est compilée mais **masquée** dans la doc générée (pratique pour le `use` ou un `fn main` de setup). `cargo doc --open` génère et ouvre la doc HTML, comme sur docs.rs.

## Cargo workspace : le monorepo

Quand le projet grossit (une API, un worker, une CLI qui partagent le domaine), on découpe en crates dans un **workspace** :

```toml
# Cargo.toml (racine)
[workspace]
resolver = "3"
members = ["crates/*"]

[workspace.package]
edition = "2024"
version = "0.1.0"

[workspace.dependencies]   # versions centralisées
serde = { version = "1", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
thiserror = "2"

[workspace.lints.clippy]
unwrap_used = "warn"
```

```toml
# crates/api/Cargo.toml
[package]
name = "api"
edition.workspace = true
version.workspace = true

[dependencies]
domain = { path = "../domain" }   # crate interne
serde.workspace = true
tokio.workspace = true

[lints]
workspace = true
```

```text
.
├── Cargo.toml          # [workspace]
├── Cargo.lock          # UN lockfile pour tout le monde
├── target/             # UN dossier de build partagé
└── crates/
    ├── domain/         # types métier, règles, zéro I/O
    ├── db/             # repositories SQLx
    ├── api/            # binaire Axum
    └── worker/         # binaire de jobs
```

Bénéfices : versions de dépendances cohérentes, compilation incrémentale partagée, et surtout des **frontières** explicites : `domain` ne peut pas importer `sqlx` par accident si ce n'est pas dans son `Cargo.toml`. Le découpage en crates parallélise aussi la compilation.

## Clippy et rustfmt

Clippy a plus de 700 lints, rangés par catégorie (`correctness`, `suspicious`, `style`, `complexity`, `perf`, activées par défaut ; `pedantic`, `nursery`, `restriction`, à activer).

```bash
cargo clippy --all-targets --all-features -- -D warnings  # en CI
cargo clippy --fix                                        # auto-fix
cargo fmt                     # formate
cargo fmt --check             # en CI : échoue si non formaté
```

Configurer dans `Cargo.toml` (plutôt que des `#![deny]` éparpillés) :

```toml
[lints.clippy]
pedantic = { level = "warn", priority = -1 }
module_name_repetitions = "allow"
unwrap_used = "warn"        # interdit unwrap() hors tests

[lints.rust]
unsafe_code = "forbid"
```

Et localement, `#[expect(lint)]` (stable depuis 1.81) plutôt que `#[allow]` : il **avertit si le lint ne se déclenche plus**, donc les exceptions obsolètes ne s'accumulent pas.

```rust
#[expect(clippy::cast_possible_truncation, reason = "id < 2^32")]
fn shard(id: u64) -> u32 { (id % 1024) as u32 }
```

## Features : la compilation conditionnelle

Les features activent du code et des dépendances optionnelles. Une lib de paiement peut proposer plusieurs backends sans imposer leurs dépendances à tout le monde :

```toml
[features]
default = ["stripe"]
stripe = ["dep:reqwest"]
postgres = ["dep:sqlx"]

[dependencies]
reqwest = { version = "0.13", optional = true }
sqlx = { version = "0.9", optional = true,
         features = ["postgres", "runtime-tokio"] }
```

```rust
#[cfg(feature = "postgres")]
pub mod pg_store;

#[cfg(feature = "stripe")]
pub use providers::stripe::StripeGateway;
```

```bash
cargo build --no-default-features --features postgres
cargo test --all-features
```

::: warning Les features doivent être additives
Cargo **unifie** les features : si deux crates de ton arbre dépendent de `foo`, l'une avec `feature = "a"`, l'autre avec `"b"`, `foo` est compilé une seule fois avec `a` **et** `b`. Une feature ne doit donc jamais *retirer* une fonctionnalité ou être incompatible avec une autre (pas de `feature = "no_std"` ou `"sqlite"` exclusif de `"postgres"`).
:::

## Profils de build

```toml
[profile.dev]
opt-level = 0          # compilation rapide (défaut)

# les dépendances optimisées même en dev :
# ton code compile vite, mais le hash bcrypt ne prend pas 3 s
[profile.dev.package."*"]
opt-level = 2

[profile.release]
opt-level = 3          # défaut
lto = "thin"           # optimisation inter-crates
codegen-units = 1      # meilleur code, compile plus lent
debug = "line-tables-only"  # stack traces lisibles en prod
strip = "symbols"      # binaire plus petit

# un profil custom pour la CI ou le profiling
[profile.profiling]
inherits = "release"
debug = true
```

| Option | Effet |
|---|---|
| `opt-level` | 0 (rapide à compiler) → 3 (rapide à l'exécution), `"s"`/`"z"` (taille) |
| `lto` | optimisations entre crates : +perf, -taille, build plus lent |
| `codegen-units = 1` | meilleure optimisation, moins de parallélisme de compilation |
| `panic = "abort"` | pas de déroulement de pile : binaire plus petit, mais un panic tue tout le process |
| `debug` | infos de debug (profilage, backtraces) |

## Benchmarks avec criterion

Ne devine pas, **mesure**. `criterion` lance ta fonction des milliers de fois, élimine le bruit et compare avec la mesure précédente.

```toml
[dev-dependencies]
criterion = "0.8"

[[bench]]
name = "pricing"
harness = false
```

```rust
// benches/pricing.rs
use criterion::{Criterion, criterion_group, criterion_main};
use std::hint::black_box;

fn bench(c: &mut Criterion) {
    let carts = billing::fixtures::carts(10_000);
    c.bench_function("total 10k paniers", |b| {
        b.iter(|| billing::total(black_box(&carts)))
    });
}

criterion_group!(benches, bench);
criterion_main!(benches);
```

```bash
cargo bench                         # rapport HTML dans target/criterion
```

`black_box` empêche le compilateur d'optimiser le calcul en le jugeant inutile (sans lui, il peut supprimer tout le code mesuré). `divan` est une alternative plus récente, à la syntaxe plus légère. Pour savoir **où** passe le temps, utilise un profiler : `cargo flamegraph`, `samply`.

## cargo-nextest : des tests plus rapides en CI

```bash
cargo install cargo-nextest --locked
cargo nextest run
```

`nextest` lance **chaque test dans son propre process**, en parallèle : un test qui plante ou fuit de l'état n'affecte pas les autres, la sortie est plus lisible, et il sait relancer les tests instables (`--retries 2`) et produire du JUnit pour la CI. Limite : il ne lance pas les doc-tests, garde un `cargo test --doc` à côté.

## Property-based testing avec proptest

Au lieu d'écrire 5 exemples à la main, tu décris une **propriété** vraie pour toutes les entrées, et proptest génère des centaines de cas, puis **réduit** (*shrinking*) le contre-exemple au plus simple.

```rust
use proptest::prelude::*;

proptest! {
    // aller-retour : formater puis parser redonne la valeur
    #[test]
    fn roundtrip(cents in any::<i64>()) {
        let s = format_cents(cents);
        prop_assert_eq!(parse_cents(&s).unwrap(), cents);
    }

    // invariant : une remise ne fait jamais monter le prix
    #[test]
    fn discount_never_increases(
        price in 0u64..10_000_000,
        pct in 0u64..=100,
    ) {
        prop_assert!(apply_discount(price, pct) <= price);
    }
}
```

Les propriétés qui marchent bien :

- **aller-retour** : `decode(encode(x)) == x` (sérialisation, parsing) ;
- **invariant** : le résultat respecte une règle (trié, borné, même longueur) ;
- **oracle** : comparer à une implémentation naïve mais sûre ;
- **idempotence** : `f(f(x)) == f(x)` (normalisation).

proptest n'est pas sur le Playground : à essayer en local.

## Le reste de la boîte à outils

| Outil | Rôle |
|---|---|
| `insta` | snapshot testing (sorties CLI, JSON d'API) |
| `mockall` | mocks générés pour tes traits |
| `cargo-llvm-cov` | couverture de code |
| `cargo-audit` / `cargo-deny` | vulnérabilités, licences, doublons de deps |
| `cargo-machete` | dépendances inutilisées |
| `cargo-watch` / `bacon` | relance check/test à chaque sauvegarde |
| `cargo-expand` | voir le code généré par les macros |

## Cas réel : la CI d'un workspace

Un pipeline GitHub Actions typique, du plus rapide au plus lent pour échouer tôt :

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: dtolnay/rust-toolchain@stable
        with: { components: "clippy, rustfmt" }
      - uses: Swatinem/rust-cache@v2     # cache target/ et ~/.cargo
      - run: cargo fmt --all --check
      - run: cargo clippy --workspace --all-targets -- -D warnings
      - uses: taiki-e/install-action@nextest
      - run: cargo nextest run --workspace
      - run: cargo test --workspace --doc
      - run: cargo deny check
```

Le cache est crucial : sans lui, chaque run recompile toutes les dépendances (plusieurs minutes). Pour un projet SQLx, ajoute `SQLX_OFFLINE: true` ou un service PostgreSQL. Voir [CI/CD avec GitHub Actions](/infra/05-ci-cd-github-actions).

## Pièges classiques

- **Tester l'implémentation privée à outrance** : tes tests cassent à chaque refactoring. Teste surtout le comportement public.
- **Tests qui dépendent de l'ordre** ou d'un état global : ils tournent en parallèle.
- **Bench en mode debug** : `cargo bench` compile en release, mais un `Instant::now()` maison dans `cargo run` mesure du code non optimisé.
- **Oublier `black_box`** : le compilateur supprime le calcul, le bench affiche 0 ns.
- **Features non additives** : erreurs bizarres quand un autre crate active une autre feature.
- **`#[allow(...)]` partout** : préfère `#[expect(..., reason = "...")]`.
- **`cargo test` en CI sans cache** : 10 minutes pour rien.

## Défis

### 1. Exercice : slug de sous-domaine

Un SaaS crée un sous-domaine par client à partir de son nom (`acme-corp.app.io`). Implémente `slugify` pour que les tests passent : minuscules, accents courants retirés, tout caractère non alphanumérique remplacé par `-`, pas de `-` en double ni en bordure, 30 caractères maximum (sans `-` final après la coupe).

```rust play
pub fn slugify(name: &str) -> String {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic() {
        assert_eq!(slugify("Acme Corp"), "acme-corp");
        assert_eq!(slugify("  Café & Crème!! "), "cafe-creme");
        assert_eq!(slugify("Élan--Vital__SAS"), "elan-vital-sas");
    }
    #[test]
    fn truncates() {
        let s = slugify("Une Entreprise Avec Un Nom Vraiment Long");
        assert!(s.len() <= 30);
        assert!(!s.ends_with('-'));
        assert_eq!(s, "une-entreprise-avec-un-nom-vra");
    }
    #[test]
    fn idempotent() {
        for n in ["Acme Corp", "Café & Crème", "x"] {
            assert_eq!(slugify(&slugify(n)), slugify(n));
        }
    }
}
```

::: details Solution
```rust play
pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars().flat_map(char::to_lowercase) {
        let c = match c {
            'à' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            c => c,
        };
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    out.truncate(30); // sûr : out ne contient que de l'ASCII
    out.trim_end_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic() {
        assert_eq!(slugify("Acme Corp"), "acme-corp");
        assert_eq!(slugify("  Café & Crème!! "), "cafe-creme");
        assert_eq!(slugify("Élan--Vital__SAS"), "elan-vital-sas");
    }
    #[test]
    fn truncates() {
        let s = slugify("Une Entreprise Avec Un Nom Vraiment Long");
        assert!(s.len() <= 30);
        assert!(!s.ends_with('-'));
        assert_eq!(s, "une-entreprise-avec-un-nom-vra");
    }
    #[test]
    fn idempotent() {
        for n in ["Acme Corp", "Café & Crème", "x"] {
            assert_eq!(slugify(&slugify(n)), slugify(n));
        }
    }
}
```

`String::truncate` panique si on coupe au milieu d'un caractère UTF-8 : ici c'est sûr parce qu'on n'a gardé que de l'ASCII. Le test `idempotent` est une **propriété** écrite à la main : avec proptest, on la vérifierait sur des milliers de chaînes aléatoires (et il trouverait vite les caractères accentués non gérés, comme `ñ` ou `œ`). En prod, la crate `deunicode` gère tous les cas.
:::

### 2. Question : quels doc-tests tournent ?

Dans un `///`, on trouve cinq blocs annotés : ` ``` `, ` ```no_run `, ` ```ignore `, ` ```compile_fail ` et ` ```text `. Pour chacun : compilé ? exécuté ? Que se passe-t-il si un bloc ` ```compile_fail ` compile ?

::: details Solution
- ` ``` ` : compilé et exécuté (échec si panic ou assert faux).
- ` ```no_run ` : compilé seulement (pour du code qui appelle le réseau, par exemple).
- ` ```ignore ` : ni l'un ni l'autre (affiché « ignored »). À éviter : la doc peut pourrir sans que tu le saches. Préfère `no_run`.
- ` ```compile_fail ` : doit **échouer** à compiler. S'il compile, le doc-test **échoue**. Utile pour documenter ce que ton API interdit (ex. « on ne peut pas construire un `Email` invalide »).
- ` ```text ` : pas du Rust, ignoré par rustdoc.
:::

### 3. Exercice : un test de propriété sans crate

Sans proptest, on peut déjà écrire une propriété avec un générateur pseudo-aléatoire déterministe. Implémente `format_cents` et `parse_cents` ; le test vérifie l'aller-retour sur 10 000 valeurs, extrêmes compris.

```rust play
pub fn format_cents(c: i64) -> String {
    todo!()
}

pub fn parse_cents(s: &str) -> Option<i64> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn examples() {
        assert_eq!(format_cents(1234), "12.34");
        assert_eq!(format_cents(-5), "-0.05");
        assert_eq!(parse_cents("-0.05"), Some(-5));
        assert_eq!(parse_cents("1.5"), None); // 2 décimales exigées
    }

    #[test]
    fn roundtrip_property() {
        let mut seed: u64 = 42;
        let mut next = || {
            // LCG : pseudo-aléatoire, mais reproductible
            seed = seed.wrapping_mul(6364136223846793005)
                       .wrapping_add(1442695040888963407);
            seed as i64
        };
        let edge = [0, 1, -1, 99, -100, i64::MAX, i64::MIN];
        for c in edge.into_iter().chain((0..10_000).map(|_| next())) {
            let s = format_cents(c);
            assert_eq!(parse_cents(&s), Some(c), "valeur {c} → {s}");
        }
    }
}
```

::: details Solution
```rust play
pub fn format_cents(c: i64) -> String {
    let sign = if c < 0 { "-" } else { "" };
    let a = c.unsigned_abs(); // i64::MIN.abs() déborderait
    format!("{sign}{}.{:02}", a / 100, a % 100)
}

pub fn parse_cents(s: &str) -> Option<i64> {
    let (neg, body) = match s.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, s),
    };
    let (units, frac) = body.split_once('.')?;
    if frac.len() != 2 || !frac.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let abs = units.parse::<u64>().ok()?
        .checked_mul(100)?
        .checked_add(frac.parse::<u64>().ok()?)?;
    if neg {
        // -(2^63) est représentable, +(2^63) non
        0i64.checked_sub_unsigned(abs)
    } else {
        i64::try_from(abs).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn examples() {
        assert_eq!(format_cents(1234), "12.34");
        assert_eq!(format_cents(-5), "-0.05");
        assert_eq!(parse_cents("-0.05"), Some(-5));
        assert_eq!(parse_cents("1.5"), None);
    }

    #[test]
    fn roundtrip_property() {
        let mut seed: u64 = 42;
        let mut next = || {
            seed = seed.wrapping_mul(6364136223846793005)
                       .wrapping_add(1442695040888963407);
            seed as i64
        };
        let edge = [0, 1, -1, 99, -100, i64::MAX, i64::MIN];
        for c in edge.into_iter().chain((0..10_000).map(|_| next())) {
            let s = format_cents(c);
            assert_eq!(parse_cents(&s), Some(c), "valeur {c} → {s}");
        }
    }
}
```

Le piège que ce test attrape : `i64::MIN`. `c.abs()` panique (en debug) car `+2^63` n'existe pas en `i64` ; d'où `unsigned_abs()` à l'aller et `checked_sub_unsigned` au retour. C'est exactement le genre de cas limite qu'un test par exemples oublie et qu'un test de propriété trouve.
:::

### 4. Mini-scénario : une feature optionnelle

Ta crate `notifier` envoie des emails via SMTP. Un client veut aussi Slack, mais tu ne veux pas imposer `reqwest` (et ses dizaines de dépendances) à ceux qui n'en ont pas besoin. Écris la section `[features]` / `[dependencies]` et le code conditionnel.

::: details Solution
```toml
[features]
default = ["smtp"]
smtp = ["dep:lettre"]
slack = ["dep:reqwest", "dep:serde_json"]

[dependencies]
lettre = { version = "0.11", optional = true }
reqwest = { version = "0.13", optional = true, features = ["json"] }
serde_json = { version = "1", optional = true }
```

```rust
pub trait Notifier { /* ... */ }

#[cfg(feature = "smtp")]
mod smtp;
#[cfg(feature = "smtp")]
pub use smtp::SmtpNotifier;

#[cfg(feature = "slack")]
mod slack;
#[cfg(feature = "slack")]
pub use slack::SlackNotifier;
```

Le client active avec `notifier = { version = "1", features = ["slack"] }`. Les deux features sont **additives** : activer les deux ensemble fonctionne. En CI, teste `--no-default-features`, `--all-features` et la config par défaut (`cargo hack --feature-powerset` automatise ça).
:::

### 5. Mini-scénario : binaire de CLI trop gros

Ton binaire `txreport` fait 12 Mo en release et tu le distribues à 200 personnes. Propose un profil pour réduire sa taille, et dis ce que tu perds.

::: details Solution
```toml
[profile.release]
opt-level = "z"     # optimiser pour la taille
lto = true          # "fat" LTO : élimine plus de code mort
codegen-units = 1
panic = "abort"     # supprime le code de déroulement de pile
strip = true        # supprime symboles et infos de debug
```

On passe typiquement sous la moitié de la taille. Ce que tu perds : un peu de vitesse (`"z"` vs `3`), des builds plus longs (LTO, 1 codegen unit), des backtraces sans noms de fonctions (`strip`), et `panic = "abort"` rend impossible la récupération d'un panic (`catch_unwind`, ou un thread qui panique sans tuer le process). Pour une CLI, c'est généralement acceptable ; pour un serveur, garde `panic = "unwind"`.
:::

## À retenir

- Tests unitaires dans `#[cfg(test)] mod tests` (accès au privé), tests d'intégration dans `tests/` (API publique), doc-tests dans `///` (doc toujours juste).
- Workspace : un `Cargo.lock`, un `target/`, des `[workspace.dependencies]` et `[workspace.lints]`, des frontières entre crates.
- `cargo clippy -- -D warnings` + `cargo fmt --check` en CI ; lints configurés dans `Cargo.toml`, `#[expect]` plutôt que `#[allow]`.
- Features additives, dépendances optionnelles via `dep:` ; profils pour arbitrer vitesse de build, perf, taille.
- Mesure avec criterion (+ `black_box`), profile avec un flamegraph ; `nextest` pour une CI rapide et isolée.
- Property-based testing (proptest) : aller-retour, invariants, oracles ; il trouve les cas limites que tu n'imagines pas.
