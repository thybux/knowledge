# Concurrence

Ce que tu vas apprendre : lancer des threads, partager des données avec `Arc<Mutex<T>>`, communiquer par channels, emprunter depuis des threads avec `thread::scope`, paralléliser avec `rayon`, comprendre ce que garantissent `Send` et `Sync`, et éviter les deadlocks. Le slogan de Rust : **fearless concurrency**.

## Le contraste avec Node

Node exécute ton JS sur **un seul thread** (l'event loop). Pas de data race possible… et pas de parallélisme CPU non plus : un calcul lourd bloque tout le serveur. Les `worker_threads` existent, mais communiquent par messages copiés (`postMessage`) ou `SharedArrayBuffer`.

Rust donne de vrais threads OS qui partagent la mémoire, **et** le compilateur refuse tout code qui pourrait produire une data race. Une data race en Rust safe est impossible : c'est une erreur de compilation.

::: info Threads vs async
Ce chapitre traite du **parallélisme CPU** (calculs, compression, parsing). Pour l'**I/O** concurrente (milliers de connexions réseau), on utilise l'async : [chapitre 9](/dev/rust/09-async-tokio).
:::

## Threads et closures `move`

```rust play
use std::thread;
use std::time::Duration;

fn main() {
    let invoice_ids = vec![101, 102, 103];

    // move : le thread devient propriétaire de invoice_ids
    let handle = thread::spawn(move || {
        let mut done = 0;
        for id in &invoice_ids {
            thread::sleep(Duration::from_millis(10));
            println!("PDF facture {id} généré");
            done += 1;
        }
        done // valeur de retour du thread
    });

    println!("le thread principal continue…");
    let n = handle.join().unwrap(); // attend + récupère le résultat
    println!("{n} factures");
}
```

- `thread::spawn` exige une closure `'static` : le thread peut survivre à la fonction qui l'a lancé, il ne doit donc rien emprunter à sa pile. D'où le `move`.
- `join()` renvoie un `Result` : `Err` si le thread a paniqué. Un panic dans un thread ne tue pas le programme.
- Un thread OS coûte de la mémoire (~quelques Mo de stack réservés) et un context switch : pas 10 000 threads, mais un pool de la taille du nombre de cœurs.

## `Send` et `Sync`

Deux *marker traits* (sans méthodes) que le compilateur implémente automatiquement :

- **`Send`** : la valeur peut être **déplacée** vers un autre thread.
- **`Sync`** : la valeur peut être **partagée** (`&T`) entre threads. Formellement : `T: Sync` ⇔ `&T: Send`.

| Type | Send | Sync | Pourquoi |
|---|---|---|---|
| `i32`, `String`, `Vec<T>` | oui | oui | données simples |
| `Rc<T>` | non | non | compteur non atomique |
| `Arc<T>` (T: Send + Sync) | oui | oui | compteur atomique |
| `RefCell<T>` | oui | non | vérif d'emprunt non atomique |
| `Mutex<T>` (T: Send) | oui | oui | accès sérialisé |
| `MutexGuard<T>` | non | oui | doit être libéré par son thread |

Une struct est `Send`/`Sync` si tous ses champs le sont. Tu n'implémentes presque jamais ces traits toi-même (c'est `unsafe`, cf. [chapitre 13](/dev/rust/13-macros-et-unsafe)) : tu les **lis** dans les erreurs.

```text
error[E0277]: `Rc<Config>` cannot be sent between threads safely
   = help: the trait `Send` is not implemented for `Rc<Config>`
note: required by a bound in `spawn`
```

Traduction : remplace `Rc` par `Arc`.

## État partagé : `Arc<Mutex<T>>`

- `Arc` : plusieurs threads possèdent la donnée.
- `Mutex` : un seul à la fois peut y accéder.

```rust play
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;

fn main() {
    let stats: Arc<Mutex<HashMap<String, u32>>> = Arc::default();

    let handles: Vec<_> = ["acme", "globex", "acme", "acme"]
        .into_iter()
        .map(|tenant| {
            let stats = Arc::clone(&stats);
            thread::spawn(move || {
                // ... traitement coûteux SANS le verrou ...
                let mut map = stats.lock().unwrap(); // MutexGuard
                *map.entry(tenant.to_string()).or_default() += 1;
            }) // guard drop ici → verrou relâché
        })
        .collect();

    for h in handles {
        h.join().unwrap();
    }
    let map = stats.lock().unwrap();
    println!("acme={} globex={}", map["acme"], map["globex"]);
}
```

Différence clé avec d'autres langages : le `Mutex` **contient** la donnée. Impossible d'y accéder sans prendre le verrou, et le verrou est relâché automatiquement quand le `MutexGuard` est drop. Pas de `unlock()` oublié.

::: warning Empoisonnement
Si un thread panique en tenant le verrou, le `Mutex` est **empoisonné** : les `lock()` suivants renvoient `Err`. D'où le `.unwrap()` idiomatique (propager le panic). Pour récupérer quand même : `lock().unwrap_or_else(|e| e.into_inner())`.
:::

### Atomiques : quand un `Mutex` est trop

Pour un compteur ou un flag, les types atomiques sont plus légers :

```rust play
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;

fn main() {
    let processed = Arc::new(AtomicU64::new(0));
    let hs: Vec<_> = (0..4).map(|_| {
        let p = Arc::clone(&processed);
        thread::spawn(move || {
            for _ in 0..1000 {
                p.fetch_add(1, Ordering::Relaxed);
            }
        })
    }).collect();
    for h in hs { h.join().unwrap(); }
    println!("{}", processed.load(Ordering::Relaxed)); // 4000
}
```

`Ordering::Relaxed` suffit pour un compteur de métriques. Les autres orderings (`Acquire`/`Release`/`SeqCst`) servent quand l'atomique **synchronise** d'autres données : sujet avancé, à n'aborder qu'avec la doc sous les yeux.

## Channels : partager en communiquant

« Ne communique pas en partageant la mémoire, partage la mémoire en communiquant. » Un channel transfère la **propriété** d'une valeur d'un thread à un autre.

```rust play
use std::sync::mpsc;
use std::thread;

fn main() {
    // mpsc = multi-producer, single-consumer
    let (tx, rx) = mpsc::channel::<String>();

    for worker in 0..3 {
        let tx = tx.clone();
        thread::spawn(move || {
            tx.send(format!("worker {worker} : 10 lignes")).unwrap();
        });
    }
    drop(tx); // sinon rx attend éternellement un dernier émetteur

    // l'itération s'arrête quand tous les tx sont drop
    for msg in rx {
        println!("{msg}");
    }
}
```

- `mpsc::channel()` : file **non bornée**. Si les producteurs vont plus vite que le consommateur, la mémoire grossit.
- `mpsc::sync_channel(n)` : file **bornée** à `n` ; `send` bloque quand elle est pleine. C'est la **backpressure** : indispensable en ingestion.
- `send` échoue si le récepteur a été drop ; `recv` échoue quand tous les émetteurs sont drop.

Pour du multi-consumer ou des `select`, la crate `crossbeam-channel` est la référence côté threads ; côté async, `tokio::sync::mpsc`.

## Scoped threads : emprunter sans `'static`

`thread::scope` garantit que tous les threads lancés dans le scope sont terminés **avant** la sortie du scope. Ils peuvent donc **emprunter** des données locales, sans `Arc` ni `move` :

```rust play
use std::thread;

fn main() {
    let lines: Vec<String> = (0..10_000)
        .map(|i| if i % 7 == 0 { "ERROR x".into() } else { "ok".into() })
        .collect();

    let chunk = lines.len().div_ceil(4);
    let total: usize = thread::scope(|s| {
        let handles: Vec<_> = lines
            .chunks(chunk)
            .map(|part| s.spawn(move || {
                part.iter().filter(|l| l.starts_with("ERROR")).count()
            }))
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).sum()
    }); // tous les threads sont joints ici

    println!("{total} erreurs"); // lines est toujours utilisable
    println!("{} lignes", lines.len());
}
```

Le `move` ici déplace seulement la slice `part` (une référence) dans le thread : on emprunte toujours `lines`.

## `rayon` : le parallélisme en une ligne

Pour du parallélisme de données, `rayon` transforme un itérateur séquentiel en itérateur parallèle, avec un pool de threads et du *work stealing* :

```rust play
use rayon::prelude::*;

fn checksum(data: &str) -> u64 {
    let h = data.bytes().fold(0u64, |h, b| {
        h.wrapping_mul(31).wrapping_add(b as u64)
    });
    h % 1_000_000_007 // borne pour que la somme ne déborde pas
}

fn main() {
    let documents: Vec<String> =
        (0..50_000).map(|i| format!("document numéro {i}")).collect();

    let seq: u64 = documents.iter().map(|d| checksum(d)).sum();
    let par: u64 = documents.par_iter().map(|d| checksum(d)).sum();

    println!("{}", seq == par);

    let mut amounts: Vec<i64> = (0..100_000).rev().collect();
    amounts.par_sort_unstable(); // tri parallèle
    println!("{:?}", &amounts[..3]);
}
```

`iter()` → `par_iter()`, et c'est tout : rayon découpe, distribue et réassemble. Le borrow checker vérifie que ta closure ne fait pas de data race (elle doit être `Fn + Send + Sync`).

::: tip Quand paralléliser ?
Quand chaque élément demande un vrai travail CPU (parsing, hash, compression, calcul). Pour additionner 1 000 entiers, le coût de coordination dépasse le gain. Mesure avec un benchmark ([chapitre 12](/dev/rust/12-tests-et-outillage)).
:::

## Deadlocks

Rust empêche les data races, **pas** les deadlocks. Les trois causes classiques :

**1. Ordre de verrouillage incohérent**

```rust
// thread A : lock(comptes[1]) puis lock(comptes[2])
// thread B : lock(comptes[2]) puis lock(comptes[1])
// → chacun attend l'autre, pour toujours
```

Solution : toujours verrouiller dans un **ordre global** (par exemple par id croissant).

**2. Reprendre un verrou qu'on tient déjà**

```rust
let a = m.lock().unwrap();
let b = m.lock().unwrap(); // bloque (ou panique) : non réentrant
```

Le `Mutex` std n'est pas réentrant. Ça arrive souvent via une méthode `&self` qui verrouille, appelée depuis une autre qui tient déjà le verrou.

**3. Garder le verrou pendant une opération lente ou bloquante**

```rust
let mut cache = state.lock().unwrap();
let data = fetch_from_db(); // les autres threads attendent la BDD
cache.insert(key, data);
```

Solution : calcule hors verrou, verrouille juste pour l'écriture. Plus le verrou est court, moins il y a de contention… et de deadlocks.

## Cas réel : un pool de workers avec backpressure

Un outil d'export lit des commandes et génère un fichier par commande (opération CPU). On veut N workers, une file bornée pour ne pas charger toute la base en mémoire, et un canal de résultats :

```rust play
use std::sync::{mpsc, Arc, Mutex};
use std::thread;

struct Job { order_id: u64 }

fn render(job: &Job) -> Result<usize, String> {
    if job.order_id % 13 == 0 {
        return Err(format!("#{} : template invalide", job.order_id));
    }
    Ok((job.order_id as usize) * 10) // taille du fichier
}

fn main() {
    let (job_tx, job_rx) = mpsc::sync_channel::<Job>(8); // bornée
    let job_rx = Arc::new(Mutex::new(job_rx)); // partagé entre workers
    let (res_tx, res_rx) = mpsc::channel();

    let workers: Vec<_> = (0..4).map(|_| {
        let rx = Arc::clone(&job_rx);
        let tx = res_tx.clone();
        thread::spawn(move || loop {
            // verrou tenu juste le temps de recevoir
            let job = match rx.lock().unwrap().recv() {
                Ok(j) => j,
                Err(_) => break, // plus d'émetteur : fin
            };
            tx.send(render(&job)).unwrap();
        })
    }).collect();
    drop(res_tx);

    // producteur : bloque si les workers sont en retard
    for id in 1..=40 {
        job_tx.send(Job { order_id: id }).unwrap();
    }
    drop(job_tx);

    let (mut ok, mut bytes, mut errs) = (0, 0, vec![]);
    for r in res_rx {
        match r {
            Ok(n) => { ok += 1; bytes += n; }
            Err(e) => errs.push(e),
        }
    }
    for w in workers { w.join().unwrap(); }
    errs.sort();
    println!("{ok} fichiers, {bytes} octets, erreurs : {errs:?}");
}
```

Points de design :

- `sync_channel(8)` : au plus 8 jobs en attente, le producteur ralentit au rythme des workers.
- Le `Receiver` n'est pas clonable (single consumer) : on le partage via `Arc<Mutex<_>>`. Le `MutexGuard` est un temporaire de l'instruction `let job = match ...;` : il est relâché à la fin de cette instruction, donc **avant** `render`. Les autres workers peuvent recevoir pendant qu'on travaille. Avec `crossbeam-channel`, le receiver serait directement clonable.
- Les erreurs remontent par le canal de résultats, pas par un panic.

## Pièges classiques

- **Oublier `drop(tx)`** : la boucle `for msg in rx` ne se termine jamais.
- **`Rc` / `RefCell` dans un thread** : `Arc` / `Mutex`.
- **Verrou tenu pendant de l'I/O** : contention, voire deadlock.
- **Channel non borné** dans un pipeline d'ingestion : OOM le jour où le consommateur ralentit.
- **Paralléliser un travail trivial** : plus lent qu'en séquentiel.
- **Croire que Rust empêche les deadlocks** : il empêche les data races, pas les interblocages ni les race conditions logiques (check-then-act).
- **Question d'entretien** : « Différence entre `Send` et `Sync` ? » → déplacer vers un autre thread vs partager une référence entre threads.

## Défis

### 1. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
use std::thread;

fn main() {
    let batch = vec![1, 2, 3];
    let h = thread::spawn(|| {
        println!("{}", batch.len());
    });
    h.join().unwrap();
}
```

::: details Solution
E0373 : la closure **emprunte** `batch`, mais le thread pourrait survivre à `main` (`spawn` exige `'static`). Solutions : `thread::spawn(move || ...)` pour transférer la propriété, ou `thread::scope(|s| { s.spawn(|| ...); })` pour emprunter légitimement.
:::

### 2. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
use std::cell::RefCell;
use std::sync::Arc;
use std::thread;

fn main() {
    let hits = Arc::new(RefCell::new(0));
    let h2 = Arc::clone(&hits);
    thread::spawn(move || *h2.borrow_mut() += 1).join().unwrap();
    println!("{}", hits.borrow());
}
```

::: details Solution
E0277 : `RefCell<i32>` cannot be shared between threads safely. `Arc<T>` n'est `Send` que si `T: Send + Sync`, et `RefCell` n'est pas `Sync` (son compteur d'emprunts n'est pas atomique). Remplace par `Mutex<i32>` (ou `AtomicI32` pour un compteur).
:::

### 3. Que se passe-t-il ?

```rust
use std::sync::Mutex;

struct Account { balance: Mutex<i64> }

impl Account {
    fn balance(&self) -> i64 { *self.balance.lock().unwrap() }

    fn withdraw(&self, amount: i64) -> bool {
        let mut b = self.balance.lock().unwrap();
        if self.balance() >= amount {
            *b -= amount;
            true
        } else {
            false
        }
    }
}
```

::: details Solution
`withdraw` tient le verrou (`b`) puis appelle `self.balance()` qui essaie de le reprendre. Le `Mutex` std n'est pas réentrant : la doc indique que ce cas **bloque ou panique** (en pratique, un deadlock). Correction : utiliser la valeur déjà verrouillée, `if *b >= amount`. Règle : une méthode qui verrouille ne doit pas appeler une autre méthode qui verrouille le même `Mutex`.
:::

### 4. Exercice : somme parallèle avec `thread::scope`

Additionne les montants avec `n` threads (au moins 1), **sans `Arc` ni clone des données**.

```rust play
use std::thread;

pub fn parallel_sum(data: &[u64], n: usize) -> u64 {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_as_sequential() {
        let v: Vec<u64> = (1..=10_001).collect();
        let expected: u64 = v.iter().sum();
        for n in [1, 2, 3, 8, 64] {
            assert_eq!(parallel_sum(&v, n), expected, "n = {n}");
        }
    }
    #[test]
    fn empty() {
        assert_eq!(parallel_sum(&[], 4), 0);
    }
}
```

::: details Solution
```rust play
use std::thread;

pub fn parallel_sum(data: &[u64], n: usize) -> u64 {
    if data.is_empty() {
        return 0;
    }
    let chunk = data.len().div_ceil(n.max(1));
    thread::scope(|s| {
        let handles: Vec<_> = data
            .chunks(chunk)
            .map(|part| s.spawn(move || part.iter().sum::<u64>()))
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).sum()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_as_sequential() {
        let v: Vec<u64> = (1..=10_001).collect();
        let expected: u64 = v.iter().sum();
        for n in [1, 2, 3, 8, 64] {
            assert_eq!(parallel_sum(&v, n), expected, "n = {n}");
        }
    }
    #[test]
    fn empty() {
        assert_eq!(parallel_sum(&[], 4), 0);
    }
}
```

`chunks(0)` panique, d'où le garde sur `data.is_empty()` (et `n.max(1)`). Important : on **collecte** les handles avant de les joindre ; un `.map(spawn).map(join)` en une seule chaîne paresseuse lancerait et attendrait chaque thread l'un après l'autre, donc en séquentiel.
:::

### 5. Exercice : agrégation par channel

Chaque lot de logs est traité par **son propre thread**, qui envoie au thread principal le nombre de lignes contenant `"ERROR"`. Renvoie le total.

```rust play
use std::sync::mpsc;
use std::thread;

pub fn count_errors(batches: Vec<Vec<String>>) -> usize {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b(lines: &[&str]) -> Vec<String> {
        lines.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn counts() {
        let batches = vec![
            b(&["ERROR db", "ok", "ERROR timeout"]),
            b(&["ok"]),
            b(&["ERROR auth"]),
        ];
        assert_eq!(count_errors(batches), 3);
    }
    #[test]
    fn no_batches() {
        assert_eq!(count_errors(vec![]), 0);
    }
}
```

::: details Solution
```rust play
use std::sync::mpsc;
use std::thread;

pub fn count_errors(batches: Vec<Vec<String>>) -> usize {
    let (tx, rx) = mpsc::channel();
    for batch in batches {
        let tx = tx.clone();
        thread::spawn(move || {
            let n = batch.iter().filter(|l| l.contains("ERROR")).count();
            tx.send(n).unwrap();
        });
    }
    drop(tx); // sinon rx.iter() ne se termine jamais
    rx.iter().sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b(lines: &[&str]) -> Vec<String> {
        lines.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn counts() {
        let batches = vec![
            b(&["ERROR db", "ok", "ERROR timeout"]),
            b(&["ok"]),
            b(&["ERROR auth"]),
        ];
        assert_eq!(count_errors(batches), 3);
    }
    #[test]
    fn no_batches() {
        assert_eq!(count_errors(vec![]), 0);
    }
}
```

Chaque lot est **déplacé** dans son thread (`move`) : zéro copie, zéro verrou. Le `drop(tx)` est la ligne que tout le monde oublie.
:::

### 6. Exercice : revenu avec `rayon`

Calcule en parallèle le revenu total des commandes payées et le nombre de commandes au-dessus de `threshold`.

```rust play
use rayon::prelude::*;

pub struct Order { pub cents: u64, pub paid: bool }

/// (revenu des commandes payées, nb de commandes payées > threshold)
pub fn stats(orders: &[Order], threshold: u64) -> (u64, usize) {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stats_ok() {
        let orders: Vec<Order> = (0..10_000u64)
            .map(|i| Order { cents: i, paid: i % 2 == 0 })
            .collect();
        let (rev, big) = stats(&orders, 9_000);
        assert_eq!(rev, (0..10_000u64).filter(|i| i % 2 == 0).sum());
        assert_eq!(big, 499);
    }
}
```

::: details Solution
```rust play
use rayon::prelude::*;

pub struct Order { pub cents: u64, pub paid: bool }

pub fn stats(orders: &[Order], threshold: u64) -> (u64, usize) {
    let paid = || orders.par_iter().filter(|o| o.paid);
    let revenue = paid().map(|o| o.cents).sum();
    let big = paid().filter(|o| o.cents > threshold).count();
    (revenue, big)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stats_ok() {
        let orders: Vec<Order> = (0..10_000u64)
            .map(|i| Order { cents: i, paid: i % 2 == 0 })
            .collect();
        let (rev, big) = stats(&orders, 9_000);
        assert_eq!(rev, (0..10_000u64).filter(|i| i % 2 == 0).sum());
        assert_eq!(big, 499);
    }
}
```

Deux passes parallèles, lisibles. Variante en une seule passe : `par_iter().filter(..).map(|o| (o.cents, (o.cents > threshold) as usize)).reduce(|| (0, 0), |a, b| (a.0 + b.0, a.1 + b.1))`. Le `reduce` de rayon prend une **fonction** d'identité car chaque thread démarre son propre accumulateur.
:::

## À retenir

- Rust safe interdit les data races à la compilation, via `Send` (déplacer) et `Sync` (partager).
- `thread::spawn` exige `'static` → `move` ; `thread::scope` permet d'emprunter.
- État partagé : `Arc<Mutex<T>>` (le mutex contient la donnée), `RwLock` pour beaucoup de lectures, atomiques pour les compteurs.
- Channels : transfert de propriété ; `sync_channel(n)` pour la backpressure ; pense à `drop(tx)`.
- `rayon` : `par_iter()` pour le parallélisme de données CPU.
- Deadlocks : ordre de verrouillage global, pas de verrou réentrant, verrous courts et jamais pendant de l'I/O.
