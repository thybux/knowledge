# CLI avec clap

Ce que tu vas apprendre : construire un vrai outil en ligne de commande, `txreport`, qui ingère un export CSV de transactions et produit un rapport. Au programme : `clap` en mode derive, `serde` + `csv`, lecture depuis un fichier **ou** stdin, écriture efficace sur stdout, codes de sortie, gestion d'erreurs propre, et tests (unitaires et de bout en bout).

## Pourquoi Rust pour les CLI

Rust est devenu le langage de référence des outils CLI (`ripgrep`, `fd`, `bat`, `uv`, `ruff`, `biome`…) :

- un **binaire unique**, sans runtime à installer (pas de `node_modules`, pas de `npx`) ;
- démarrage instantané (pas de JIT à chauffer) ;
- traitement de gros fichiers rapide et à mémoire constante (streaming).

Le cas typique en entreprise : l'équipe finance t'envoie chaque mois un export CSV de 2 Go du PSP, et veut des totaux par marchand. Un script Node charge tout en mémoire et met 3 minutes ; un binaire Rust streame le fichier en quelques secondes.

## L'outil qu'on construit

```text
$ txreport summary -i export.csv --group-by merchant --top 3
clé         nb         total
Acme         2          8.00
Globex       1          5.00

$ cat export.csv | txreport summary --group-by day -f csv
key,count,total_cents
2026-03-01,2,1500
2026-03-02,1,-200

$ txreport validate -i export.csv -v
ligne 4 ignorée : CSV deserialize error: ...
2 valides, 1 invalides          # code de sortie 1
```

Le CSV d'entrée :

```text
date,merchant,category,amount_cents,status
2026-03-01,Acme,saas,1000,settled
2026-03-01,Globex,ads,500,settled
2026-03-02,Acme,saas,200,refunded
```

```toml
[dependencies]
anyhow = "1"
clap = { version = "4", features = ["derive"] }
csv = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[dev-dependencies]
assert_cmd = "2"
predicates = "3"
```

Structure :

```text
src/
├── main.rs     # câblage : args → lecture → rapport → sortie
├── lib.rs      # pub mod cli; model; report; output;
├── cli.rs      # définition clap
├── model.rs    # Transaction (serde)
├── report.rs   # parsing + agrégation (pur, testable)
└── output.rs   # rendu table / json / csv
tests/cli.rs    # tests de bout en bout du binaire
```

Même principe que pour l'API : la logique est dans la **lib**, `main.rs` ne fait que brancher les entrées/sorties.

## 1. Les arguments avec clap derive

En Node, tu utiliserais `commander` ou `yargs`, et tu récupérerais un objet non typé. Avec clap, tu décris une **struct**, et clap génère le parsing, la validation, `--help` et `--version` :

```rust play
use std::path::PathBuf;
use clap::{Parser, Subcommand, ValueEnum};

/// Analyse un export CSV de transactions et produit un rapport.
#[derive(Debug, Parser)]
#[command(name = "txreport", version, about)]
pub struct Cli {
    /// Fichier CSV à lire ("-" ou absent : stdin)
    #[arg(short, long, global = true)]
    pub input: Option<PathBuf>,

    /// Affiche les lignes ignorées sur stderr
    #[arg(short, long, global = true)]
    pub verbose: bool,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Totaux groupés
    Summary {
        /// Critère de regroupement
        #[arg(long, value_enum, default_value_t = GroupBy::Merchant)]
        group_by: GroupBy,
        /// Format de sortie
        #[arg(short, long, value_enum, default_value_t = Format::Table)]
        format: Format,
        /// Nombre maximum de lignes
        #[arg(long, default_value_t = 10,
              value_parser = clap::value_parser!(u16).range(1..=1000))]
        top: u16,
    },
    /// Vérifie le fichier ; code 1 si des lignes sont invalides
    Validate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum GroupBy { Merchant, Category, Day }

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Format { Table, Json, Csv }

fn main() {
    // en vrai : Cli::parse() lit std::env::args()
    let cli = Cli::try_parse_from(
        ["txreport", "summary", "--group-by", "day", "-f", "json"],
    ).unwrap();
    println!("{cli:?}");

    let err = Cli::try_parse_from(["txreport", "summary", "--top", "0"])
        .unwrap_err();
    println!("{err}");
}
```

Ce que tu obtiens gratuitement :

- Les **doc comments** `///` deviennent le texte de `--help`.
- `Option<T>` = argument facultatif, `bool` = flag, `Vec<T>` = répétable (`--tag a --tag b`).
- `ValueEnum` : les valeurs possibles sont listées dans l'aide, et une valeur invalide donne un message clair (`invalid value 'xml' for '--format'`).
- Les sous-commandes sont un **enum** : le `match` du chapitre 2 garantit que tu les traites toutes.
- `try_parse_from` est parfait pour **tester** ton parsing sans lancer le binaire.

::: tip `parse()` gère les erreurs pour toi
`Cli::parse()` affiche l'erreur ou l'aide et quitte avec le bon code (0 pour `--help`, 2 pour une erreur d'usage, la convention Unix). Tu n'as rien à faire.
:::

## 2. Le modèle et la désérialisation

```rust
// src/model.rs
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")] // "settled" ↔ Status::Settled
pub enum Status { Settled, Refunded, Failed }

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Transaction {
    pub date: String,
    pub merchant: String,
    pub category: String,
    pub amount_cents: i64,
    pub status: Status,
}

impl Transaction {
    /// Montant signé : remboursé = négatif, échoué = 0.
    pub fn net_cents(&self) -> i64 {
        match self.status {
            Status::Settled => self.amount_cents,
            Status::Refunded => -self.amount_cents,
            Status::Failed => 0,
        }
    }
}
```

`serde` fait le travail de Zod : un `status` inconnu ou un `amount_cents` non numérique est une erreur de désérialisation, **ligne par ligne**. Les colonnes sont associées par **nom d'en-tête** : l'ordre des colonnes dans le fichier n'a pas d'importance.

## 3. Lire depuis n'importe où : `impl Read`

Le parsing accepte un `R: Read` générique. En prod, c'est un fichier ou stdin ; en test, un simple `&[u8]` :

```rust play
use serde::Deserialize;
use std::io::Read;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Status { Settled, Refunded, Failed }

#[derive(Debug, Deserialize)]
struct Transaction {
    date: String,
    merchant: String,
    amount_cents: i64,
    status: Status,
}

#[derive(Debug, Default)]
struct Parsed {
    txs: Vec<Transaction>,
    errors: Vec<(u64, String)>, // (ligne, message)
}

fn parse<R: Read>(reader: R) -> Parsed {
    let mut rdr = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .from_reader(reader);
    let mut out = Parsed::default();
    // deserialize() : itérateur paresseux, une ligne à la fois
    for (i, rec) in rdr.deserialize::<Transaction>().enumerate() {
        match rec {
            Ok(tx) => out.txs.push(tx),
            // +2 : numérotation 1-based + ligne d'en-tête
            Err(e) => out.errors.push((i as u64 + 2, e.to_string())),
        }
    }
    out
}

fn main() {
    let csv = "date,merchant,category,amount_cents,status
2026-03-01, Acme ,saas,1000,settled
2026-03-02,Acme,saas,abc,refunded
2026-03-02,Globex,ads,300,lost";
    let p = parse(csv.as_bytes());
    println!("{:?}", p.txs);
    for (line, e) in &p.errors {
        println!("ligne {line} : {e}");
    }
}
```

Choix de design : une ligne invalide **ne fait pas échouer** tout l'import, elle est collectée. Un export de 2 millions de lignes avec 3 lignes corrompues doit quand même produire un rapport (et un code de sortie qui signale le problème pour `validate`).

::: info Mémoire constante
Ici on accumule `txs` dans un `Vec` pour simplifier. Pour un fichier de 10 Go, on agrégerait **pendant** la lecture (une `HashMap` de totaux) sans jamais stocker les lignes : la mémoire reste proportionnelle au nombre de marchands, pas au nombre de lignes.
:::

## 4. L'agrégation (pure)

```rust
// src/report.rs
#[derive(Debug, Serialize, PartialEq)]
pub struct Row { pub key: String, pub count: u64, pub total_cents: i64 }

pub fn summarize(txs: &[Transaction], by: GroupBy, top: usize)
    -> Vec<Row> {
    let mut groups: HashMap<&str, (u64, i64)> = HashMap::new();
    for tx in txs {
        let key = match by {
            GroupBy::Merchant => tx.merchant.as_str(),
            GroupBy::Category => tx.category.as_str(),
            GroupBy::Day => tx.date.as_str(),
        };
        let g = groups.entry(key).or_default();
        g.0 += 1;
        g.1 += tx.net_cents();
    }
    let mut rows: Vec<Row> = groups
        .into_iter()
        .map(|(k, (count, total_cents))| Row {
            key: k.to_string(), count, total_cents,
        })
        .collect();
    match by {
        GroupBy::Day => rows.sort_by(|a, b| a.key.cmp(&b.key)),
        _ => rows.sort_by(|a, b| {
            b.total_cents.cmp(&a.total_cents).then(a.key.cmp(&b.key))
        }),
    }
    rows.truncate(top);
    rows
}
```

Aucune I/O, aucun `println!` : une fonction pure, triviale à tester. Les clés de la `HashMap` empruntent les transactions (`&str`) : on n'alloue une `String` que pour les lignes du rapport. C'est le [chapitre 6](/dev/rust/06-collections-iterateurs) appliqué.

## 5. Écrire vers n'importe où : `impl Write`

Symétrique de la lecture : le rendu écrit dans un `W: Write`.

```rust play
use std::io::{self, Write};
use serde::Serialize;

#[derive(Serialize)]
struct Row { key: String, count: u64, total_cents: i64 }

enum Format { Table, Json, Csv }

fn money(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let c = cents.unsigned_abs();
    format!("{sign}{}.{:02}", c / 100, c % 100)
}

fn render<W: Write>(rows: &[Row], fmt: Format, mut w: W)
    -> io::Result<()> {
    match fmt {
        Format::Table => {
            let width = rows.iter().map(|r| r.key.chars().count())
                .max().unwrap_or(3).max(3);
            writeln!(w, "{:<width$}  {:>6}  {:>10}", "clé", "nb", "total")?;
            for r in rows {
                writeln!(w, "{:<width$}  {:>6}  {:>10}",
                         r.key, r.count, money(r.total_cents))?;
            }
        }
        Format::Json => {
            serde_json::to_writer_pretty(&mut w, rows)?;
            writeln!(w)?;
        }
        Format::Csv => {
            let mut wtr = csv::Writer::from_writer(w);
            for r in rows { wtr.serialize(r)?; }
            wtr.flush()?;
        }
    }
    Ok(())
}

fn main() {
    let rows = vec![
        Row { key: "Acme".into(), count: 2, total_cents: 800 },
        Row { key: "Globex".into(), count: 1, total_cents: -150 },
    ];
    for fmt in [Format::Table, Format::Json, Format::Csv] {
        render(&rows, fmt, io::stdout().lock()).unwrap();
    }
    // en test : on écrit dans un Vec<u8> et on compare
    let mut buf = Vec::new();
    render(&rows, Format::Csv, &mut buf).unwrap();
    assert!(String::from_utf8(buf).unwrap().contains("Acme,2,800"));
}
```

`&mut W` implémente aussi `Write` : c'est pour ça qu'on peut passer `&mut buf` et réutiliser `buf` ensuite. `serde` sérialise la même struct `Row` en JSON comme en CSV.

## 6. `main` : câbler, et sortir proprement

```rust
// src/main.rs
use std::fs::File;
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::process::ExitCode;

use anyhow::{Context, Result};
use clap::Parser;
use txreport::cli::{Cli, Command};
use txreport::{output, report};

fn open_input(cli: &Cli) -> Result<Box<dyn Read>> {
    match cli.input.as_deref() {
        None => Ok(Box::new(io::stdin().lock())),
        Some(p) if p.as_os_str() == "-" => {
            Ok(Box::new(io::stdin().lock()))
        }
        Some(p) => {
            let f = File::open(p)
                .with_context(|| format!("ouverture de {}", p.display()))?;
            Ok(Box::new(BufReader::new(f)))
        }
    }
}
```

`Box<dyn Read>` : la source est choisie **à l'exécution** (fichier ou stdin), c'est exactement le cas d'usage du dispatch dynamique ([chapitre 3](/dev/rust/03-traits-generics)). `BufReader` évite un appel système par lecture.

```rust
fn run(cli: Cli) -> Result<ExitCode> {
    let parsed = report::parse(open_input(&cli)?);
    if cli.verbose {
        for (line, err) in &parsed.errors {
            eprintln!("ligne {line} ignorée : {err}"); // → stderr
        }
    }

    let mut out = BufWriter::new(io::stdout().lock());
    match cli.command {
        Command::Summary { group_by, format, top } => {
            let rows = report::summarize(&parsed.txs, group_by,
                                         top as usize);
            output::render(&rows, format, &mut out)?;
        }
        Command::Validate => {
            writeln!(out, "{} valides, {} invalides",
                     parsed.txs.len(), parsed.errors.len())?;
            out.flush()?;
            if !parsed.errors.is_empty() {
                return Ok(ExitCode::from(1));
            }
        }
    }
    out.flush()?;
    Ok(ExitCode::SUCCESS)
}

fn main() -> ExitCode {
    let cli = Cli::parse(); // --help, --version, erreurs d'usage
    match run(cli) {
        Ok(code) => code,
        Err(e) => {
            // `txreport ... | head` : le lecteur a fermé le pipe
            if let Some(io) = e.downcast_ref::<io::Error>()
                && io.kind() == io::ErrorKind::BrokenPipe
            {
                return ExitCode::SUCCESS;
            }
            eprintln!("erreur : {e:#}");
            ExitCode::from(2)
        }
    }
}
```

Les règles d'un bon citoyen Unix :

| Règle | Pourquoi |
|---|---|
| Données sur **stdout**, messages sur **stderr** | `txreport ... > out.csv` ne doit contenir que le CSV |
| Code 0 = succès, ≠ 0 = échec | les scripts et la CI testent `$?` |
| Lire stdin si pas de fichier | composable : `zcat x.gz \| txreport summary` |
| `BufWriter` + `stdout().lock()` | `println!` verrouille et flush à chaque ligne : lent sur 1 M de lignes |
| Gérer `BrokenPipe` | sinon `println!` **panique** quand `head` ferme le pipe |

`{e:#}` affiche toute la chaîne de contexte `anyhow` : `erreur : ouverture de nope.csv: No such file or directory (os error 2)`.

## 7. Les tests

**Unitaires**, dans chaque module, sur les fonctions pures :

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const CSV: &str = "\
date,merchant,category,amount_cents,status
2026-03-01,Acme,saas,1000,settled
2026-03-01,Globex,ads,500,settled
2026-03-02,Acme,saas,200,refunded
2026-03-02,Acme,saas,999,failed
2026-03-02,Oops,ads,abc,settled
";

    #[test]
    fn summary_by_merchant() {
        let p = parse(CSV.as_bytes());
        assert_eq!(p.errors.len(), 1);
        let rows = summarize(&p.txs, GroupBy::Merchant, 10);
        assert_eq!(rows[0], Row { key: "Acme".into(), count: 3,
                                  total_cents: 800 });
    }
}
```

**De bout en bout**, sur le vrai binaire, avec `assert_cmd` (dans `tests/cli.rs`) :

```rust
use assert_cmd::Command;
use predicates::str::contains;

#[test]
fn validate_fails_on_bad_lines() {
    Command::cargo_bin("txreport")
        .unwrap()
        .args(["validate", "-v"])
        .write_stdin("date,merchant,category,amount_cents,status\n\
                      2026-03-01,Acme,saas,1000,settled\n\
                      2026-03-02,Oops,ads,abc,settled\n")
        .assert()
        .code(1)
        .stdout(contains("1 valides, 1 invalides"))
        .stderr(contains("ligne 3 ignorée"));
}

#[test]
fn missing_file_is_a_clean_error() {
    Command::cargo_bin("txreport")
        .unwrap()
        .args(["summary", "-i", "nope.csv"])
        .assert()
        .code(2)
        .stderr(contains("ouverture de nope.csv"));
}
```

Ces tests vérifient ce que voit l'utilisateur : codes de sortie, séparation stdout/stderr, messages. Pour figer de gros rapports, la crate `insta` (snapshot testing) est très pratique ([chapitre 12](/dev/rust/12-tests-et-outillage)).

## Distribuer

```bash
cargo build --release            # target/release/txreport
cargo install --path .           # dans ~/.cargo/bin
```

Pour publier des binaires multi-plateformes (Linux, macOS, Windows) depuis la CI, `cargo-dist` génère le workflow GitHub Actions et les installateurs. Voir [CI/CD](/infra/05-ci-cd-github-actions).

## Pièges classiques

- **`println!` dans une boucle de 1 M de lignes** : un lock + flush par ligne. `BufWriter` sur `stdout().lock()`.
- **Messages de progression sur stdout** : ils polluent la sortie redirigée. `eprintln!`.
- **Panic sur `BrokenPipe`** avec `| head` : utilise `writeln!` et traite l'erreur.
- **`unwrap()` sur l'ouverture de fichier** : l'utilisateur voit un panic et une backtrace au lieu de « fichier introuvable ». `anyhow` + `.context()`.
- **Charger tout le fichier en mémoire** (`read_to_string`) : streame avec `csv::Reader` / `BufRead::lines()`.
- **Toujours renvoyer 0** : la CI ne détecte jamais l'échec.
- **Parser les montants en `f64`** : `0.1 + 0.2`. Centimes entiers, ou `rust_decimal`.

## Défis

### 1. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
use clap::Parser;

#[derive(Debug, Clone)]
enum Format { Table, Json }

#[derive(Parser)]
struct Cli {
    #[arg(long, value_enum)]
    format: Format,
}

fn main() {
    let cli = Cli::parse();
    println!("{:?}", cli.format);
}
```

::: details Solution
Erreur E0599 très verbeuse (« the method `value_parser` exists for reference `&&&&&&_infer_ValueParser_for<Format>`, but its trait bounds were not satisfied »). Traduction : clap ne sait pas transformer une chaîne en `Format`. Il manque `#[derive(ValueEnum)]` sur l'enum (et `Copy`/`PartialEq` sont pratiques). Retiens le réflexe : une erreur de trait bizarre dans une macro derive = un trait manquant sur **ton** type.
:::

### 2. Exercice : parser des montants d'export bancaire

Les exports bancaires français contiennent des montants comme `"1 234,56"`, `"-12,5"` ou `"42"`. Convertis-les en centimes, **sans passer par un flottant**. Plus de 2 décimales ou caractères invalides → `Err`.

```rust play
pub fn parse_amount(raw: &str) -> Result<i64, String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid() {
        assert_eq!(parse_amount("1 234,56"), Ok(123_456));
        assert_eq!(parse_amount("-12,5"), Ok(-1250));
        assert_eq!(parse_amount("42"), Ok(4200));
        assert_eq!(parse_amount(" 0,07 "), Ok(7));
        assert_eq!(parse_amount("3.10"), Ok(310)); // point accepté
    }
    #[test]
    fn invalid() {
        assert!(parse_amount("").is_err());
        assert!(parse_amount("1,234").is_err());
        assert!(parse_amount("12a").is_err());
        assert!(parse_amount("1,2,3").is_err());
        assert!(parse_amount("-").is_err());
    }
}
```

::: details Solution
```rust play
pub fn parse_amount(raw: &str) -> Result<i64, String> {
    let err = || format!("montant invalide : {raw:?}");
    let s: String = raw.trim().chars().filter(|c| *c != ' ').collect();
    let (neg, s) = match s.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, s.as_str()),
    };
    let (int, frac) = match s.split_once([',', '.']) {
        Some((i, f)) => (i, f),
        None => (s, ""),
    };
    let digits = |p: &str| p.chars().all(|c| c.is_ascii_digit());
    if int.is_empty() || !digits(int) || !digits(frac) || frac.len() > 2 {
        return Err(err());
    }
    let units: i64 = int.parse().map_err(|_| err())?;
    let cents: i64 = format!("{frac:0<2}").parse().map_err(|_| err())?;
    let total = units.checked_mul(100)
        .and_then(|u| u.checked_add(cents))
        .ok_or_else(err)?;
    Ok(if neg { -total } else { total })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid() {
        assert_eq!(parse_amount("1 234,56"), Ok(123_456));
        assert_eq!(parse_amount("-12,5"), Ok(-1250));
        assert_eq!(parse_amount("42"), Ok(4200));
        assert_eq!(parse_amount(" 0,07 "), Ok(7));
        assert_eq!(parse_amount("3.10"), Ok(310));
    }
    #[test]
    fn invalid() {
        assert!(parse_amount("").is_err());
        assert!(parse_amount("1,234").is_err());
        assert!(parse_amount("12a").is_err());
        assert!(parse_amount("1,2,3").is_err());
        assert!(parse_amount("-").is_err());
    }
}
```

`split_once([',', '.'])` accepte un tableau de `char` comme pattern. `"1,2,3"` échoue car la partie fractionnaire `"2,3"` contient une virgule. `{frac:0<2}` complète à droite avec des zéros (`"5"` → `"50"`). `checked_mul` évite un débordement silencieux sur un montant absurde. Dans un vrai outil, branche ça sur serde avec `#[serde(deserialize_with = "...")]`.
:::

### 3. Exercice : une CLI testable avec `try_parse_from`

Complète la CLI `export --since 2026-01-01 [--limit N] [--tag T]...` :
- `--since` obligatoire, au format `AAAA-MM-JJ` : écris le `value_parser` custom `parse_date` ;
- `--limit` facultatif, défaut 50 (un attribut à ajouter) ;
- `--tag` répétable (observe comment c'est obtenu).

```rust play
use clap::Parser;

/// TODO : valider le format AAAA-MM-JJ
fn parse_date(s: &str) -> Result<String, String> {
    todo!()
}

#[derive(Debug, Parser)]
pub struct Args {
    #[arg(long, value_parser = parse_date)]
    pub since: String,
    // TODO : défaut 50
    #[arg(long)]
    pub limit: u32,
    #[arg(long)]
    pub tag: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Args, clap::Error> {
        Args::try_parse_from(std::iter::once("export")
            .chain(args.iter().copied()))
    }

    #[test]
    fn defaults() {
        let a = parse(&["--since", "2026-01-01"]).unwrap();
        assert_eq!(a.since, "2026-01-01");
        assert_eq!(a.limit, 50);
        assert!(a.tag.is_empty());
    }
    #[test]
    fn repeated_tags() {
        let a = parse(&["--since", "2026-01-01", "--tag", "vip",
                        "--tag", "eu", "--limit", "5"]).unwrap();
        assert_eq!(a.tag, vec!["vip", "eu"]);
        assert_eq!(a.limit, 5);
    }
    #[test]
    fn errors() {
        assert!(parse(&[]).is_err());
        assert!(parse(&["--since", "01/01/2026"]).is_err());
        assert!(parse(&["--since", "2026-13-01"]).is_err());
    }
}
```

::: details Solution
```rust play
use clap::Parser;

fn parse_date(s: &str) -> Result<String, String> {
    let parts: Vec<&str> = s.split('-').collect();
    let ok = match parts.as_slice() {
        [y, m, d] if y.len() == 4 && m.len() == 2 && d.len() == 2 => {
            let m: u32 = m.parse().map_err(|_| "mois invalide")?;
            let d: u32 = d.parse().map_err(|_| "jour invalide")?;
            y.parse::<u32>().is_ok()
                && (1..=12).contains(&m)
                && (1..=31).contains(&d)
        }
        _ => false,
    };
    if ok { Ok(s.to_string()) }
    else { Err(format!("attendu AAAA-MM-JJ, reçu {s:?}")) }
}

#[derive(Debug, Parser)]
pub struct Args {
    /// Date de début (AAAA-MM-JJ)
    #[arg(long, value_parser = parse_date)]
    pub since: String,
    /// Nombre maximum de lignes
    #[arg(long, default_value_t = 50)]
    pub limit: u32,
    /// Filtre par tag (répétable)
    #[arg(long)]
    pub tag: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Args, clap::Error> {
        Args::try_parse_from(std::iter::once("export")
            .chain(args.iter().copied()))
    }

    #[test]
    fn defaults() {
        let a = parse(&["--since", "2026-01-01"]).unwrap();
        assert_eq!(a.since, "2026-01-01");
        assert_eq!(a.limit, 50);
        assert!(a.tag.is_empty());
    }
    #[test]
    fn repeated_tags() {
        let a = parse(&["--since", "2026-01-01", "--tag", "vip",
                        "--tag", "eu", "--limit", "5"]).unwrap();
        assert_eq!(a.tag, vec!["vip", "eu"]);
        assert_eq!(a.limit, 5);
    }
    #[test]
    fn errors() {
        assert!(parse(&[]).is_err());
        assert!(parse(&["--since", "01/01/2026"]).is_err());
        assert!(parse(&["--since", "2026-13-01"]).is_err());
    }
}
```

Le type du champ dicte le comportement : `u32` + `default_value_t` = facultatif avec défaut, `Vec<String>` = répétable, `String` sans `Option` = obligatoire. Un `value_parser` est une simple fonction `&str -> Result<T, E>`. En vrai, tu parserais vers `chrono::NaiveDate` (qui rejette aussi le 31 février).
:::

### 4. Exercice : « top N + autres »

Pour un graphique, la finance veut les `n` plus gros marchands, et tous les autres regroupés en une ligne `"(autres)"` (seulement s'il y en a). Les lignes en entrée sont déjà triées par total décroissant.

```rust play
#[derive(Debug, PartialEq)]
pub struct Row { pub key: String, pub count: u64, pub total: i64 }

pub fn top_with_others(rows: Vec<Row>, n: usize) -> Vec<Row> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(k: &str, c: u64, t: i64) -> Row {
        Row { key: k.into(), count: c, total: t }
    }

    #[test]
    fn groups_the_rest() {
        let rows = vec![r("A", 1, 900), r("B", 2, 500),
                        r("C", 3, 100), r("D", 4, 50)];
        assert_eq!(top_with_others(rows, 2),
                   vec![r("A", 1, 900), r("B", 2, 500),
                        r("(autres)", 7, 150)]);
    }
    #[test]
    fn nothing_to_group() {
        let rows = vec![r("A", 1, 900)];
        assert_eq!(top_with_others(rows, 3), vec![r("A", 1, 900)]);
    }
}
```

::: details Solution
```rust play
#[derive(Debug, PartialEq)]
pub struct Row { pub key: String, pub count: u64, pub total: i64 }

pub fn top_with_others(mut rows: Vec<Row>, n: usize) -> Vec<Row> {
    if rows.len() <= n {
        return rows;
    }
    let rest = rows.split_off(n); // rows garde les n premiers
    let others = rest.into_iter().fold(
        Row { key: "(autres)".into(), count: 0, total: 0 },
        |mut acc, r| {
            acc.count += r.count;
            acc.total += r.total;
            acc
        },
    );
    rows.push(others);
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(k: &str, c: u64, t: i64) -> Row {
        Row { key: k.into(), count: c, total: t }
    }

    #[test]
    fn groups_the_rest() {
        let rows = vec![r("A", 1, 900), r("B", 2, 500),
                        r("C", 3, 100), r("D", 4, 50)];
        assert_eq!(top_with_others(rows, 2),
                   vec![r("A", 1, 900), r("B", 2, 500),
                        r("(autres)", 7, 150)]);
    }
    #[test]
    fn nothing_to_group() {
        let rows = vec![r("A", 1, 900)];
        assert_eq!(top_with_others(rows, 3), vec![r("A", 1, 900)]);
    }
}
```

`split_off(n)` coupe le `Vec` en deux sans copier les éléments (seulement les déplacer). On prend `rows` par valeur (`mut rows: Vec<Row>`) : la fonction peut le transformer en place et le rendre, zéro clone.
:::

### 5. Question : `println!` vs `BufWriter`

Ton collègue écrit le rapport avec `for row in rows { println!("{row}") }` sur 5 millions de lignes, et `txreport ... | head -3` affiche `failed printing to stdout: Broken pipe` suivi d'un panic. Explique les deux problèmes.

::: details Solution
1. **Performance** : `println!` verrouille stdout à chaque appel, et quand stdout est un terminal il est *line-buffered* (un appel système par ligne). Avec `let mut out = BufWriter::new(io::stdout().lock());` + `writeln!(out, ...)`, on verrouille une fois et on écrit par blocs de 8 Ko : souvent 10× plus rapide.
2. **Broken pipe** : `head` se termine après 3 lignes et ferme le pipe. Rust ignore le signal `SIGPIPE`, donc l'écriture suivante renvoie une erreur `BrokenPipe`, et `println!` **panique** sur toute erreur d'écriture. Avec `writeln!`, l'erreur est un `Result` qu'on propage avec `?` puis qu'on traite comme une fin normale (code 0).
:::

## À retenir

- `clap` derive : une struct/enum = la CLI ; doc comments = `--help` ; `ValueEnum` pour les choix ; `try_parse_from` pour tester.
- `serde` + `csv` : désérialisation typée ligne par ligne, erreurs collectées sans tout arrêter.
- Fonctions génériques sur `impl Read` / `impl Write` : prod sur fichier/stdin/stdout, tests sur `&[u8]`/`Vec<u8>`.
- Données sur stdout, messages sur stderr, codes de sortie significatifs (`ExitCode`).
- `BufWriter` + `stdout().lock()` et gestion de `BrokenPipe` pour une CLI rapide et composable.
- `anyhow` + `.context()` au sommet ; `assert_cmd` pour tester le binaire de bout en bout.
