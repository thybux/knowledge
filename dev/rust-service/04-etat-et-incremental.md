# État local et incrémental

Ce que tu vas apprendre : rendre un job long **rejouable sans tout refaire**. Un état local SQLite pour l'incrémental et les checkpoints, la règle d'ordre « le marqueur suit l'effet distant », l'écriture atomique d'un fichier, la reprise après un crash, un verrou d'instance pour empêcher deux runs simultanés, et les options `--limit N` et `--dry-run` pour essayer sans risque.

## Le problème

Le scraper de catalogues parcourt 40 000 vues. À 2 s par requête (politesse, chapitre 2), un parcours complet prend plus de 20 heures. Trois scénarios ordinaires :

1. Le pod est tué à la 15e heure (nœud redémarré, `activeDeadlineSeconds` atteint).
2. Le run suivant, une semaine plus tard, n'a besoin de rafraîchir que les vues qui ont changé.
3. Tu veux tester une modification du parsing sur 20 vues, pas 40 000.

Sans état, les trois finissent pareil : on repart de zéro. Avec un état local, on reprend où on s'était arrêté, on saute ce qui est frais, et on s'arrête après N publications.

## Pourquoi SQLite

| Option | Pour | Contre |
|---|---|---|
| rien, tout refaire | zéro code | 20 h à chaque run |
| un fichier JSON | simple | réécrit en entier à chaque checkpoint, corrompu si crash pendant l'écriture |
| la base de l'app (Postgres) | déjà là | le job dépend d'un autre système, couplage |
| **SQLite local** | transactions, index, un fichier, zéro serveur | un volume persistant à monter (chapitre 6) |

SQLite est une base embarquée : une lib C liée dans ton binaire, un fichier sur disque. Avec `rusqlite` et la feature `bundled`, la lib est compilée dans le binaire : rien à installer dans l'image.

```toml
rusqlite = { version = "0.41", features = ["bundled"] }
```

`rusqlite` est **synchrone**. Dans un job async, ce n'est pas un problème tant que chaque requête prend quelques microsecondes et que le parcours est séquentiel : bloquer le runtime 50 µs n'affame personne. Si une requête devenait lente (gros scan), `tokio::task::spawn_blocking` la sortirait du runtime. `sqlx` offre du SQLite async, mais c'est un pool, des migrations et des macros pour un fichier local : trop pour ce besoin.

## Ouvrir la base

```rust
use rusqlite::Connection;

pub fn open(path: &Path) -> anyhow::Result<Store> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let conn = Connection::open(path)?;
    conn.busy_timeout(Duration::from_secs(5))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA synchronous = NORMAL;",
    )?;
    conn.execute_batch(SCHEMA)?; // CREATE TABLE IF NOT EXISTS
    let store = Store { conn };
    store.upgrade()?;
    Ok(store)
}
```

| Réglage | Effet |
|---|---|
| `journal_mode = WAL` | les écritures vont dans un journal ; un crash ne corrompt pas la base, une lecture ne bloque pas l'écriture |
| `synchronous = NORMAL` | en WAL, sûr contre un crash de l'appli ; une coupure de courant peut perdre les dernières transactions, pas corrompre |
| `foreign_keys = ON` | désactivé par défaut dans SQLite (oui, vraiment) |
| `busy_timeout` | attend un verrou au lieu d'échouer tout de suite en `SQLITE_BUSY` |

`Connection::open(":memory:")` donne une base jetable : idéal pour les tests.

## Faire évoluer le schéma sans casser une base existante

La base vit sur un volume persistant : elle **survit** aux déploiements. Le binaire v2 doit ouvrir la base créée par la v1.

```rust
fn upgrade(&self) -> anyhow::Result<()> {
    let cols = self.columns("view")?; // pragma_table_info
    if !cols.contains("published_at") {
        self.conn.execute_batch(
            "ALTER TABLE view ADD COLUMN published_at INTEGER;
             UPDATE view SET published_at = scraped_at
             WHERE scraped_at IS NOT NULL;",
        )?;
    }
    Ok(())
}
```

Le `UPDATE` de report compte : sans lui, la colonne neuve est `NULL` partout, et le run suivant croit que **rien** n'a été publié. 40 000 vues rescrapées pour une colonne ajoutée.

Pour plus de trois évolutions, `PRAGMA user_version` (un entier stocké dans l'en-tête du fichier) et une liste de migrations numérotées sont plus lisibles que des tests de colonnes.

## Upsert sur une clé naturelle

Relister un catalogue ne doit pas créer de doublons. Chaque table a une **clé naturelle** (le lien de la page, normalisé : chapitre 2) et on fait un upsert :

```rust
const Q: &str = "
INSERT INTO view (category_id, name, reference, link)
VALUES (?1, ?2, ?3, ?4)
ON CONFLICT (link) DO UPDATE SET
  category_id = excluded.category_id,
  name = excluded.name,
  reference = excluded.reference
RETURNING id";

let id: i64 = tx.query_row(
    Q,
    params![cat_id, v.name, v.reference, v.link],
    |row| row.get(0),
)?;
```

Remarque ce que l'upsert **ne touche pas** : `published_at`. Relister les vues met à jour leurs métadonnées sans remettre l'incrémental à zéro.

## La règle d'or : le marqueur suit l'effet distant

Pour chaque vue, deux écritures : publier sur RabbitMQ, et noter « publiée le ... » dans SQLite. Elles ne peuvent pas être atomiques ensemble (deux systèmes, pas de transaction distribuée). Il faut donc choisir l'ordre, et donc choisir quel échec on accepte :

| Ordre | Crash entre les deux | Conséquence |
|---|---|---|
| marquer, puis publier | marquée, jamais publiée | **message perdu**, la vue n'est plus jamais retentée |
| **publier, puis marquer** | publiée, pas marquée | republiée au run suivant : **doublon** |

Un doublon est absorbé par le consumer idempotent (chapitre 3). Un message perdu est invisible. On choisit donc toujours :

```rust
// 1. effet distant, confirmé par le broker
if !publish_view(mq, &mut stats, &msg).await? {
    return Ok(()); // non publiée : pas de marqueur
}
// 2. seulement ensuite, le marqueur local
db.mark_published(view.id)
    .with_context(|| format!("marquage de {}", view.id))?;
```

C'est le même raisonnement que l'*outbox pattern* côté base de données, à l'envers : quand tu ne peux pas rendre deux écritures atomiques, tu ordonnes pour que l'échec possible soit le doublon, et tu rends le récepteur idempotent.

## L'incrémental : sauter ce qui est frais

```rust
if let Some(at) = db.last_published_at(view.id)? {
    // horloge reculée : date future = fraîche
    let age = SystemTime::now()
        .duration_since(at)
        .unwrap_or_default();
    if age < rescrape_after {
        stats.skipped_fresh += 1;
        return Ok(());
    }
}
stats.attempted += 1;
// ... scraper, publier, marquer
```

Deux choix :

- **On saute sur `published_at`, pas sur `scraped_at`.** Une vue scrapée mais dont la publication a échoué (queue pleine) est retentée au run suivant. Le marqueur qui pilote l'incrémental est celui de l'effet qui compte.
- **`rescrape_after` est configurable** (7 jours par défaut). Le mettre à 0 force un parcours complet sans supprimer la base.

`SystemTime::duration_since` renvoie une erreur si `at` est dans le futur (horloge du nœud reculée) : `unwrap_or_default()` donne 0, la vue est fraîche. Mieux vaut rater une mise à jour que planter.

La reprise après crash est un **cas particulier** de l'incrémental : les vues publiées avant le crash ont un `published_at` récent et sont sautées. Pas de code de reprise dédié.

## Remplacer, dans une transaction

Les pièces d'une vue changent d'un scraping à l'autre. On les **remplace** (pas d'ajout), dans une transaction pour qu'un crash au milieu ne laisse pas la moitié des pièces :

```rust
pub fn replace_parts(&mut self, view_id: i64, parts: &[Part])
    -> anyhow::Result<()>
{
    let tx = self.conn.transaction()?; // &mut self requis
    tx.execute(
        "DELETE FROM part WHERE view_id = ?1",
        [view_id],
    )?;
    {
        let mut ins = tx.prepare(
            "INSERT INTO part (view_id, reference, name)
             VALUES (?1, ?2, ?3)",
        )?;
        for p in parts {
            ins.execute(params![view_id, p.reference, p.name])?;
        }
    } // ins emprunte tx : on le libère avant commit
    tx.commit()?;
    Ok(())
}
```

Une `Transaction` de `rusqlite` fait un **rollback dans son `Drop`** si on n'a pas appelé `commit()` : un `?` qui sort au milieu annule tout. C'est le RAII appliqué aux transactions. Et `transaction()` exige `&mut Connection` : le compilateur t'empêche d'ouvrir deux transactions en même temps sur la même connexion.

## Écriture atomique d'un fichier

Tout l'état n'est pas en SQLite. Le job de synchro télécharge un CSV de 50 Mo et le garde pour comparer au suivant. Écrire directement dans `stock.csv` est dangereux : un crash au milieu laisse un fichier **à moitié écrit**, que le run suivant lira comme valide.

La technique : écrire dans un fichier temporaire **du même dossier**, forcer sur disque, puis renommer.

```rust
use std::fs::{self, File};
use std::io::Write;

pub fn write_atomic(path: &Path, data: &[u8])
    -> std::io::Result<()>
{
    let tmp = path.with_extension("tmp");
    let mut f = File::create(&tmp)?;
    f.write_all(data)?;
    f.sync_all()?; // les octets sont sur disque
    fs::rename(&tmp, path)?; // atomique sur un même FS
    Ok(())
}
```

`rename` sur un même système de fichiers POSIX est **atomique** : un lecteur voit soit l'ancien fichier, soit le nouveau, jamais un mélange. D'où « même dossier » : un `rename` entre deux systèmes de fichiers (`/tmp` vers un volume monté) devient une copie, plus atomique du tout, ou échoue (`EXDEV`). Pour une durabilité totale après coupure de courant, il faudrait aussi `fsync` le dossier parent ; pour un fichier de travail qu'on peut retélécharger, c'est superflu.

La crate `tempfile` (`NamedTempFile::persist`) fait la même chose avec un nom aléatoire et le nettoyage en cas d'erreur.

## Un seul run à la fois : le verrou d'instance

Deux runs sur la même base (le CronJob, plus un lancement à la main pour tester) se marchent dessus : double publication, `SQLITE_BUSY`. Kubernetes empêche deux Jobs du même CronJob (`concurrencyPolicy: Forbid`, chapitre 6), mais pas un lancement manuel.

On prend un verrou exclusif sur un fichier `<base>.lock`, avec l'API de verrouillage de fichiers de la std (stable depuis Rust 1.89) :

```rust
use std::fs::{File, TryLockError};

fn lock_instance(lock: PathBuf) -> anyhow::Result<File> {
    let file = File::create(&lock)?;
    match file.try_lock() {
        Ok(()) => Ok(file),
        Err(TryLockError::WouldBlock) => {
            Err(AlreadyRunning { lock }.into())
        }
        Err(TryLockError::Error(e)) => Err(e.into()),
    }
}
```

Le `File` est gardé dans la struct `Store` pendant tout le run. Le verrou est **relâché par le système** quand le fichier est fermé : fin normale, panic ou `kill -9`. Jamais de verrou orphelin à supprimer à la main, contrairement à un fichier « PID » qu'on crée et qu'on oublie d'effacer après un crash.

Un run qui trouve le verrou pris sort en code **2** (« rien à faire »), sans alerte : rien n'a échoué, ce lancement était de trop.

::: warning Verrous et systèmes de fichiers réseau
`flock` est fiable sur un disque local et sur la plupart des volumes bloc (un PVC `ReadWriteOnce`). Sur NFS, le comportement dépend de la version et du montage. Si ton état est sur un partage réseau, vérifie, ou utilise un verrou côté base (advisory lock Postgres).
:::

## `--limit N` et `--dry-run`

Deux options d'essai, au comportement précis :

| Option | Fait | Ne fait pas |
|---|---|---|
| `--limit N` | s'arrête après N **publications confirmées** | ne change rien d'autre : vrai broker, vrai état |
| `--dry-run` | parcourt, parse, valide, **affiche** les messages | ne publie pas, n'écrit pas l'état |

```rust
pub fn limit_reached(&self) -> bool {
    self.limit > 0 && self.published >= self.limit
}
```

`--limit` compte les **publications**, pas les pages vues : avec l'incrémental, 1 000 vues fraîches peuvent être sautées avant la première publication. `--limit 20` sur un environnement de staging est le test de bout en bout le plus utile : vrai portail, vrai broker, vrais workers, 20 messages.

`--dry-run` se branche naturellement sur le trait `Publisher` du chapitre 1 : une implémentation qui affiche le JSON sur stdout au lieu de publier. Le marqueur ne doit **pas** être posé (rien n'a été publié), sinon le vrai run suivant sauterait tout.

::: tip Avec `--limit`, pas de réconciliation
La synchro de stock vérifie en fin de run que le nombre de lignes publiées + sautées égale le total annoncé par le fournisseur (un flux coupé ne doit pas passer pour un succès). Avec `--limit`, ce contrôle est sauté : il échouerait toujours.
:::

## Cas réel

Le scraper de catalogues, après la mise en place de l'état :

| Run | Durée | Vues publiées |
|---|---|---|
| premier (base vide) | ~22 h, en 2 runs (deadline à 12 h) | 40 000 |
| hebdo suivant | ~3 h | 6 000 (plus vieilles de 7 j) |
| après un crash à la 2e heure | reprend, ~1 h | le reste |
| `--limit 20` en staging | 2 min | 20 |

Le premier run atteint `activeDeadlineSeconds` et est tué : la moitié des vues est marquée. Le run du lendemain saute ces 20 000 vues fraîches et finit le travail. Aucune ligne de code de « reprise » : l'incrémental **est** la reprise.

## Pièges classiques

- **Marquer avant de publier** : un crash entre les deux perd le message pour toujours.
- **Sauter sur la date de scraping** au lieu de la date de publication : les échecs de publication ne sont jamais retentés.
- **Écrire un fichier d'état en place** : crash au milieu = fichier corrompu lu comme valide.
- **`rename` entre deux systèmes de fichiers** : plus atomique, ou `EXDEV`.
- **Un fichier PID comme verrou** : orphelin après un crash. Un verrou `flock` est relâché par le noyau.
- **Ajouter une colonne sans report** : la base existante semble vide, tout est refait.
- **`foreign_keys` oublié** : SQLite ne vérifie pas les clés étrangères par défaut.
- **`--dry-run` qui pose les marqueurs** : le vrai run suivant ne publie rien.
- **Question d'entretien** : « Deux écritures sur deux systèmes, comment garantir la cohérence ? » → pas d'atomicité possible : ordonner pour que l'échec soit un doublon, rendre le récepteur idempotent (ou outbox pattern si une base est la source).
- **Question d'entretien** : « Pourquoi `rename` pour une écriture atomique ? » → atomique sur un même FS POSIX : le lecteur voit l'ancien ou le nouveau fichier, jamais un fichier partiel.

## Défis

### 1. Exercice : frais ou à refaire ?

Implémente `should_scrape` : jamais publiée → oui ; publiée il y a moins de `rescrape_after` → non ; date dans le futur → non (fraîche).

```rust play
use std::time::{Duration, SystemTime};

pub fn should_scrape(
    last: Option<SystemTime>,
    now: SystemTime,
    rescrape_after: Duration,
) -> bool {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::UNIX_EPOCH;

    const DAY: Duration = Duration::from_secs(86_400);

    #[test]
    fn cases() {
        let now = UNIX_EPOCH + 100 * DAY;
        let week = 7 * DAY;
        assert!(should_scrape(None, now, week));
        assert!(!should_scrape(Some(now - DAY), now, week));
        assert!(should_scrape(Some(now - 8 * DAY), now, week));
        assert!(!should_scrape(Some(now + DAY), now, week));
        // rescrape_after = 0 : tout est à refaire
        assert!(should_scrape(Some(now - DAY), now,
                              Duration::ZERO));
    }
}
```

::: details Solution
```rust play
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub fn should_scrape(
    last: Option<SystemTime>,
    now: SystemTime,
    rescrape_after: Duration,
) -> bool {
    let Some(at) = last else { return true };
    let age = now.duration_since(at).unwrap_or_default();
    age >= rescrape_after
}

fn main() {
    let now = UNIX_EPOCH + Duration::from_secs(1_000);
    println!("{}", should_scrape(None, now, Duration::ZERO));
}
```

`now` est un paramètre et pas un `SystemTime::now()` interne : c'est ce qui rend la fonction testable (horloge injectée). Le cas « futur » tombe dans `unwrap_or_default()` → âge 0 → frais, sauf si `rescrape_after` vaut 0.
:::

### 2. Exercice : publier puis marquer

Complète `process` : publie chaque vue non marquée ; ne la marque que si la publication a réussi. Un échec de publication passe à la vue suivante. Le test simule un broker qui refuse la vue 2.

```rust play
use std::collections::HashSet;

pub fn process(
    views: &[u32],
    marked: &mut HashSet<u32>,
    mut publish: impl FnMut(u32) -> Result<(), String>,
) -> usize {
    todo!() // renvoie le nombre de vues publiées
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_view_is_retried_next_run() {
        let mut marked = HashSet::new();
        let flaky = |v: u32| {
            if v == 2 { Err("nack".into()) } else { Ok(()) }
        };
        assert_eq!(process(&[1, 2, 3], &mut marked, flaky), 2);
        assert_eq!(marked, HashSet::from([1, 3]));

        let mut sent = vec![];
        let ok = |v: u32| { sent.push(v); Ok(()) };
        assert_eq!(process(&[1, 2, 3], &mut marked, ok), 1);
        assert_eq!(sent, vec![2]);
    }
}
```

::: details Solution
```rust play
use std::collections::HashSet;

pub fn process(
    views: &[u32],
    marked: &mut HashSet<u32>,
    mut publish: impl FnMut(u32) -> Result<(), String>,
) -> usize {
    let mut published = 0;
    for &v in views {
        if marked.contains(&v) {
            continue; // fraîche
        }
        if publish(v).is_err() {
            continue; // pas de marqueur : retentée
        }
        marked.insert(v); // APRÈS l'effet distant
        published += 1;
    }
    published
}

fn main() {
    let mut m = HashSet::new();
    let n = process(&[1, 2], &mut m, |_| Ok(()));
    println!("{n} publiées, marquées : {m:?}");
}
```

Inverse les deux lignes (`insert` avant `publish`) et le second run n'envoie rien : la vue 2 est perdue. C'est le test qui protège l'ordre.
:::

### 3. Exercice : écriture atomique

Implémente `write_atomic` (temporaire dans le même dossier, `sync_all`, `rename`). Le test vérifie qu'aucun `.tmp` ne traîne et que le contenu est remplacé.

```rust play
use std::fs;
use std::io::Write;
use std::path::Path;

pub fn write_atomic(path: &Path, data: &[u8])
    -> std::io::Result<()>
{
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_without_leftover() {
        let dir = std::env::temp_dir()
            .join(format!("atomic-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("state.csv");
        write_atomic(&p, b"v1").unwrap();
        write_atomic(&p, b"v2").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"v2");
        assert!(!dir.join("state.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
```

::: details Solution
```rust play
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

pub fn write_atomic(path: &Path, data: &[u8])
    -> std::io::Result<()>
{
    let tmp = path.with_extension("tmp");
    let mut f = File::create(&tmp)?;
    f.write_all(data)?;
    f.sync_all()?;
    fs::rename(&tmp, path)
}

fn main() {
    let p = std::env::temp_dir().join("demo-atomic.txt");
    write_atomic(&p, b"bonjour").unwrap();
    println!("{}", fs::read_to_string(&p).unwrap());
}
```

Limite de cette version : deux processus qui écrivent en même temps utilisent le même `.tmp`. Le verrou d'instance l'empêche ; sinon, un nom unique (`tempfile`).
:::

### 4. Exercice : le verrou d'instance

Avec `File::try_lock` (std, Rust 1.89+), écris `acquire` : `Ok(File)` si le verrou est libre, `Err(Busy)` s'il est déjà pris. Le test prend le verrou deux fois.

```rust play
use std::fs::{File, TryLockError};
use std::path::Path;

#[derive(Debug, PartialEq)]
pub enum LockError { Busy, Io(String) }

pub fn acquire(path: &Path) -> Result<File, LockError> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_run_is_refused() {
        let p = std::env::temp_dir().join(
            format!("job-{}.lock", std::process::id()));
        let first = acquire(&p).expect("libre");
        assert_eq!(acquire(&p).unwrap_err(), LockError::Busy);
        drop(first); // fin du run : relâché
        assert!(acquire(&p).is_ok());
    }
}
```

::: details Solution
```rust play
use std::fs::{File, TryLockError};
use std::path::Path;

#[derive(Debug, PartialEq)]
pub enum LockError { Busy, Io(String) }

pub fn acquire(path: &Path) -> Result<File, LockError> {
    let file = File::create(path)
        .map_err(|e| LockError::Io(e.to_string()))?;
    match file.try_lock() {
        Ok(()) => Ok(file),
        Err(TryLockError::WouldBlock) => Err(LockError::Busy),
        Err(TryLockError::Error(e)) => {
            Err(LockError::Io(e.to_string()))
        }
    }
}

fn main() {
    let p = std::env::temp_dir().join("demo.lock");
    let _guard = acquire(&p).unwrap();
    println!("verrou pris : {:?}", acquire(&p).err());
}
```

Le verrou appartient à la **description de fichier ouverte** : un second `File::create` du même processus obtient une autre description, et le verrou est refusé. Fermer le premier `File` (son `Drop`) le relâche. `File::create` tronque le fichier, sans gravité ici : il est vide.
:::

## À retenir

- Un état local SQLite (`bundled`, WAL, `busy_timeout`) rend un job long incrémental et reprenable.
- Le marqueur local s'écrit **après** la confirmation de l'effet distant : l'échec possible est un doublon, jamais une perte.
- La reprise après crash n'est qu'un cas de l'incrémental ; on saute sur la date de **publication**.
- Remplacements dans une transaction (rollback au `Drop`), upserts sur une clé naturelle.
- Fichier d'état : temporaire du même dossier, `sync_all`, `rename` atomique.
- Verrou d'instance par `flock` (relâché par le noyau), `--limit` compte les publications, `--dry-run` n'écrit rien.
