# Observabilité et arrêt propre

Ce que tu vas apprendre : rendre un job de nuit **lisible** le lendemain matin. Logs structurés avec `tracing` et `tracing-subscriber` (texte en dev, JSON en prod), niveaux et spans, zéro donnée personnelle dans les logs, un bilan de run plutôt que mille alertes, un signal de vie publié pour un tableau de bord, puis l'arrêt propre sur SIGTERM (`tokio::signal`, `CancellationToken`, `select!`) et des codes de sortie qui pilotent l'orchestrateur.

## `tracing` : des événements, pas des lignes

`println!` produit du texte. `tracing` produit des **événements structurés** : un message plus des champs typés, rattachés à un contexte (le *span*). Le formatage (texte, JSON, envoi vers un collecteur) est choisi à un seul endroit, par le *subscriber*.

```rust
tracing::info!(total = 12_345, "début de la synchro");
tracing::warn!(
    attempt,
    retry_in = ?wait,     // ? = via Debug
    error = %err,         // % = via Display
    "erreur transitoire, nouvel essai"
);
```

| Syntaxe | Rendu du champ |
|---|---|
| `total = 12_345` | valeur (`Value` : entiers, bool, `&str`) |
| `error = %err` | `Display` de `err` |
| `retry_in = ?wait` | `Debug` de `wait` |
| `attempt` seul | raccourci de `attempt = attempt` |

L'intérêt en prod : chercher `level=ERROR AND span.provider="supplier-a"` dans ton outil de logs, au lieu d'un `grep` sur du texte libre.

## Les niveaux, avec une règle par niveau

| Niveau | Quand | Exemple |
|---|---|---|
| `error!` | le job échoue, ou une chose qui exige une action humaine | « échec du job », « 50 nacks d'affilée » |
| `warn!` | anormal mais géré | retry, vue sautée, reconnexion |
| `info!` | jalons du run, quelques lignes par run | démarrage, total, bilan, fin |
| `debug!` | détail par élément | « vue publiée, 34 pièces » |
| `trace!` | détail du détail | octets reçus |

En prod, `info`. Un job qui écrit un `info!` par élément sur 40 000 éléments noie les jalons et coûte cher à stocker : c'est du `debug!`.

Le niveau se lit dans la config (une variable `LOG_LEVEL` validée au démarrage, chapitre 1) et devient un `LevelFilter`. La feature `env-filter` de `tracing-subscriber` permet des filtres par module (`RUST_LOG=info,lapin=warn`), au prix d'une dépendance à `regex` ; pour un job, un niveau global suffit souvent.

## Les spans : le contexte qui suit

Un span est une période nommée avec des champs. Tout événement émis **pendant** le span hérite de son contexte :

```rust
use tracing::Instrument;

let span = tracing::info_span!(
    "job",
    provider = %cfg.provider,
);
runtime.block_on(job(&cfg).instrument(span))
```

`.instrument(span)` attache le span à la future : il est « entré » à chaque `poll`, et seulement pendant. Ne fais **pas** `let _g = span.enter();` dans une fonction async : le guard reste actif à travers les `.await`, et pendant que ta tâche est suspendue, une autre tâche du même thread logue avec ton span.

En JSON, chaque ligne porte alors les champs du span :

```json
{"timestamp":"2026-11-22T02:00:03Z","level":"WARN",
 "message":"erreur transitoire, nouvel essai","attempt":2,
 "target":"catalog_jobs::http",
 "span":{"provider":"supplier-a","name":"job"}}
```

## Le subscriber : texte en dev, JSON en prod

```rust
use tracing_subscriber::layer::SubscriberExt;

fn subscriber(json: bool, level: LevelFilter)
    -> impl tracing::Subscriber + Send + Sync
{
    let (json_layer, text_layer) = if json {
        let l = tracing_subscriber::fmt::layer()
            .json()
            .flatten_event(true)
            .with_current_span(true)
            .with_span_list(false);
        (Some(l), None)
    } else {
        (None, Some(tracing_subscriber::fmt::layer()))
    };
    tracing_subscriber::registry()
        .with(level)
        .with(json_layer)
        .with(text_layer)
}
```

Le mécanisme : un `Registry` sur lequel on empile des *layers*. `Option<Layer>` est elle-même un layer, qui ne fait rien quand elle vaut `None` : c'est l'astuce pour choisir le format à l'exécution sans `Box<dyn Layer>`. Il faut `tracing-subscriber` avec les features `fmt`, `json` et `registry`.

| Option | Effet |
|---|---|
| `flatten_event(true)` | les champs de l'événement à la racine du JSON, pas sous `fields` |
| `with_current_span(true)` | le span courant sous `span` |
| `with_span_list(false)` | pas la pile complète des spans (bruyant) |

On l'installe **une fois**, en tout début de `main`, avant le runtime : `tracing::subscriber::set_global_default(subscriber)`. Un second appel échoue.

## Zéro donnée personnelle dans les logs

Les logs partent dans un outil tiers, sont gardés des semaines, lus par plus de monde que la base de données. Règle simple : **aucune** PII (email, téléphone, adresse, IP, nom) dans un message ou un champ de log, ni dans un message d'erreur (qui finit aussi dans les logs).

| Au lieu de | Logue |
|---|---|
| `error!(email = %c.email, "envoi raté")` | `error!(message_id = %id, "envoi raté")` |
| `"numéro {phone} invalide"` | `"numéro invalide pour {sms_id}"` |
| `?customer` (Debug complet) | l'identifiant seul |

Un job de catalogue manipule peu de PII, mais des **secrets** : URL AMQP, mots de passe du portail. Même règle, et c'est la raison des `Debug` masqués du chapitre 1.

Filet de sécurité possible : un hook `before_send` côté Sentry (ou un layer `tracing` maison) qui masque les suites de 9 chiffres ou plus. Un filet, pas une excuse pour loguer la donnée.

## Un bilan plutôt que mille alertes

Sur 40 000 vues, 30 images mortes, c'est normal. Si chaque échec déclenche une alerte, l'équipe apprend à ignorer les alertes. On sépare :

- les échecs **fatals** (session perdue, broker injoignable) : le job s'arrête ;
- les échecs **locaux** (une image, une page) : comptés, logués en `warn`/`error`, sautés ;
- en fin de run, **un bilan** et un verdict.

```rust
#[derive(Debug, Default)]
pub struct RunStats {
    pub attempted: u64,
    pub published: u64,
    pub skipped_fresh: u64,
    pub images_failed: u64,
    pub publish_failed: u64,
}

impl RunStats {
    pub fn verdict(&self) -> anyhow::Result<()> {
        let failed = self.attempted.saturating_sub(self.published);
        if self.attempted >= 10 && failed * 100 > self.attempted * 20 {
            anyhow::bail!("{failed}/{} vues en échec",
                          self.attempted);
        }
        Ok(())
    }
}
```

Plus de 20 % d'échecs, c'est un portail ou un gabarit HTML qui a changé : le run échoue et alerte **une fois**. En dessous, un `info!` de bilan suffit. Et pour l'outil d'erreurs (Sentry), seul le **premier** échec de chaque cause est envoyé ; les suivants sont dans le bilan.

## Le signal de vie

Les logs disent ce qui s'est passé. Ils ne disent pas ce qui **ne** s'est **pas** passé : un CronJob suspendu, une image introuvable, un pod jamais démarré ne logue rien. Il faut un signal positif.

Le job publie des événements de cycle de vie sur une queue dédiée, qu'un backend agrège pour un tableau de bord :

| Étape | Quand | Contenu |
|---|---|---|
| `started` | au démarrage | `runId` (nom du pod), job, version |
| `progress` | toutes les 5 min | durée, compteur publié |
| `finished` / `failed` | en fin de run | durée, message d'erreur tronqué |

```rust
fn spawn_heartbeat(&self) -> Option<JoinHandle<()>> {
    let broker = Arc::clone(self.broker.as_ref()?);
    let run_id = self.run_id.clone();
    Some(tokio::spawn(async move {
        let mut tick = tokio::time::interval(HEARTBEAT);
        tick.tick().await; // le premier tick est immédiat
        loop {
            tick.tick().await;
            publish_progress(&broker, &run_id).await;
        }
    }))
}
```

Le backend en déduit « run perdu » après plusieurs intervalles sans nouvelle (OOM, deadline), et « jamais démarré » d'un `started` absent à l'heure prévue. Sentry Crons ou un *dead man's switch* (Healthchecks) font la même chose sans backend maison.

Deux règles :

- **Best-effort de bout en bout.** Broker absent ou queue manquante : un `warn`, le signal se coupe, **le job continue**. Un job qui échoue parce que son signal de vie ne part pas est pire que pas de signal.
- **Connexion dédiée**, distincte de celle des publications métier : une coupure du signal ne touche pas le travail, et inversement.

`tick.tick().await` : le premier tick d'un `interval` part immédiatement. Sans ce premier appel, tu publies un `progress` juste après le `started`.

## Arrêt propre sur SIGTERM

Kubernetes arrête un pod (déploiement, nœud drainé, deadline) en envoyant **SIGTERM**, attend `terminationGracePeriodSeconds` (30 s par défaut), puis envoie **SIGKILL**. Sans gestion, le processus Rust meurt à SIGTERM : pas de bilan, pas de `failed` sur le signal de vie, connexion broker coupée net.

On transforme le signal en `CancellationToken` (crate `tokio-util`) :

```rust
use tokio_util::sync::CancellationToken;

pub fn cancel_on_signal() -> CancellationToken {
    let token = CancellationToken::new();
    let task_token = token.clone();
    // installé MAINTENANT, pas au premier poll
    let signal = shutdown_signal();
    tokio::spawn(async move {
        signal.await;
        tracing::warn!("signal d'arrêt reçu");
        task_token.cancel();
    });
    token
}
```

```rust
#[cfg(unix)]
fn shutdown_signal() -> impl Future<Output = ()> + Send {
    use tokio::signal::unix::{signal, SignalKind};
    let term = signal(SignalKind::terminate());
    async move {
        let Ok(mut term) = term else {
            let _ = tokio::signal::ctrl_c().await;
            return;
        };
        tokio::select! {
            _ = term.recv() => {}
            _ = tokio::signal::ctrl_c() => {}
        }
    }
}
```

Détail de mécanisme : `signal(SignalKind::terminate())` est appelé **hors** du bloc `async`, donc à l'appel de `shutdown_signal()`. Si on l'appelait dans le bloc, le gestionnaire ne serait installé qu'au premier `poll` de la tâche ; un SIGTERM reçu entre-temps tuerait le processus avec le comportement par défaut.

`token.clone()` + `async move` : `tokio::spawn` exige une future `'static`, la tâche doit posséder sa copie du token. Les clones partagent le même état : annuler l'un annule tous.

## Annuler = abandonner la future

En Rust, annuler une future, c'est la **drop** : elle s'arrête à son prochain `.await`, ses `Drop` s'exécutent (transaction SQLite annulée, fichier fermé). Pas besoin de tester un drapeau dans chaque boucle :

```rust
pub async fn until_cancelled<T>(
    cancel: &CancellationToken,
    work: impl Future<Output = anyhow::Result<T>>,
) -> anyhow::Result<T> {
    cancel
        .run_until_cancelled(work)
        .await
        .unwrap_or_else(|| Err(Cancelled.into()))
}
```

`run_until_cancelled` renvoie `None` si le token est annulé avant la fin de `work`. C'est l'équivalent de :

```rust
tokio::select! {
    res = work => Some(res),
    _ = cancel.cancelled() => None,
}
```

Le token sert à choisir **où** couper. Le nettoyage (logout du portail, fermeture du broker, bilan, signal `failed`) doit rester **hors** de la partie abandonnée, et être borné :

```rust
let result = until_cancelled(&cancel, scrape(&cfg)).await;
cleanup("logout", portal.logout()).await;      // hors annulation
cleanup("broker", async { let _ = mq.close().await; }).await;
report.finish(&result).await;                   // failed: Cancelled
```

```rust
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(5);

pub async fn cleanup(what: &str, work: impl Future<Output = ()>) {
    if tokio::time::timeout(CLEANUP_TIMEOUT, work).await.is_err() {
        tracing::warn!(what, "nettoyage abandonné");
    }
}
```

Chaque nettoyage tient en 5 s : la somme reste sous le délai de grâce du pod (mets-le à 60 s pour un job, chapitre 6).

::: warning Un point d'annulation n'est pas transactionnel
Une future abandonnée entre « publié » et « marqué » (chapitre 4) laisse une vue publiée non marquée : doublon au run suivant, absorbé par le consumer. C'est acceptable parce qu'on a ordonné les écritures pour ça. Si une séquence ne doit **jamais** être coupée, protège-la : vérifie le token seulement entre deux éléments, au lieu d'abandonner la future.
:::

## Les codes de sortie : l'API du job

Un job one-shot ne parle à l'orchestrateur que par son code de sortie. On en définit trois, documentés :

| Code | Sens | Réaction attendue de Kubernetes |
|---|---|---|
| 0 | succès | rien |
| 1 | échec du job (réseau, portail, bilan mauvais, SIGTERM) | réessayer (`backoffLimit`) |
| 2 | usage, config invalide, run déjà en cours | **ne pas** réessayer (`podFailurePolicy`) |

```rust
pub fn exit_code<T>(result: &anyhow::Result<T>) -> ExitCode {
    match result {
        Ok(_) => ExitCode::SUCCESS,
        Err(e) if e.chain().any(|c| c.is::<AlreadyRunning>()) => {
            tracing::warn!("run déjà en cours, rien à faire");
            ExitCode::from(2)
        }
        Err(e) => {
            tracing::error!(error = format!("{e:#}"), "échec du job");
            ExitCode::FAILURE
        }
    }
}
```

`main` **renvoie** cet `ExitCode` : les `Drop` s'exécutent (le guard du logger vide ses buffers), puis le processus sort. Un `std::process::exit(1)` sauterait tout ça. Clap, lui, sort déjà en 2 sur un argument invalide : on aligne notre convention sur la sienne.

## Cas réel

Le matin, le tableau de bord montre pour le scraper : `failed`, durée 11 h 59, « job interrompu (SIGTERM ou Ctrl+C) ». Le log JSON de fin :

```json
{"level":"INFO","message":"bilan","attempted":18210,
 "published":18190,"skipped_fresh":0,"images_failed":20,
 "span":{"provider":"supplier-a","name":"job"}}
{"level":"ERROR","message":"échec du job",
 "error":"job interrompu (SIGTERM ou Ctrl+C)"}
```

Lecture : le job n'a pas planté, il a atteint `activeDeadlineSeconds` (12 h). 18 190 vues sont marquées ; le run suivant reprendra (chapitre 4). 20 images mortes sur 18 000 : sous le seuil, pas d'alerte. Action : rien, ou monter la deadline. Sans le SIGTERM géré, on aurait eu un pod `Error` sans aucune ligne de bilan.

## Pièges classiques

- **`span.enter()` dans une fonction async** : le contexte fuit vers d'autres tâches pendant les `await`. Utilise `.instrument(span)`.
- **Un `info!` par élément** : jalons noyés, facture de logs qui explose.
- **PII ou secret dans un message d'erreur** : il finit dans les logs et l'outil d'erreurs.
- **Une alerte par échec local** : l'équipe ignore les alertes. Un bilan, un verdict.
- **Un signal de vie bloquant** : le job échoue parce que le tableau de bord est en panne.
- **Installer le gestionnaire SIGTERM dans le bloc async** : un signal précoce tue le processus.
- **Nettoyage sans timeout** : SIGKILL au bout du délai de grâce, bilan perdu.
- **`process::exit()`** : `Drop` sautés, logs et événements perdus.
- **Question d'entretien** : « Comment annuler une tâche en Rust async ? » → drop la future (`select!`, `timeout`, `run_until_cancelled`) ; elle s'arrête au prochain point d'`await` et ses `Drop` s'exécutent.
- **Question d'entretien** : « Que se passe-t-il quand Kubernetes arrête un pod ? » → SIGTERM, délai de grâce, puis SIGKILL ; le processus doit finir son nettoyage dans ce délai.

## Défis

### 1. Exercice : la chaîne d'erreurs sur une ligne

Écris `error_chain` : le `Display` de l'erreur, puis de chaque `source()`, séparés par ` : `. C'est ce qu'on met dans un champ de log et dans le message `failed`.

```rust play
use std::error::Error;
use std::fmt;

pub fn error_chain(err: &(dyn Error + 'static)) -> String {
    todo!()
}

#[derive(Debug)]
struct Ctx(&'static str, Option<Box<dyn Error>>);

impl fmt::Display for Ctx {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str(self.0)
    }
}
impl Error for Ctx {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        self.1.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn three_levels() {
        let root = Ctx("connexion refusée", None);
        let mid = Ctx("publication", Some(Box::new(root)));
        let top = Ctx("vue V-12", Some(Box::new(mid)));
        assert_eq!(error_chain(&top),
            "vue V-12 : publication : connexion refusée");
    }
}
```

::: details Solution
```rust play
use std::error::Error;
use std::fmt;

pub fn error_chain(err: &(dyn Error + 'static)) -> String {
    let mut out = err.to_string();
    let mut source = err.source();
    while let Some(s) = source {
        out.push_str(" : ");
        out.push_str(&s.to_string());
        source = s.source();
    }
    out
}

#[derive(Debug)]
struct Ctx(&'static str, Option<Box<dyn Error>>);

impl fmt::Display for Ctx {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str(self.0)
    }
}
impl Error for Ctx {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        self.1.as_deref()
    }
}

fn main() {
    let e = Ctx("haut", Some(Box::new(Ctx("bas", None))));
    println!("{}", error_chain(&e));
}
```

Avec `anyhow`, `format!("{e:#}")` fait la même chose (séparateur `: `). Une fonction maison sert pour un `&dyn Error` qui ne vient pas d'`anyhow`, ou pour imposer un séparateur.
:::

### 2. Exercice : masquer les numéros

Filet de sécurité : remplace toute suite de **9 chiffres ou plus** par `[masqué]`. Les suites plus courtes (une référence, un compteur) restent.

```rust play
pub fn scrub(s: &str) -> String {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_long_digit_runs() {
        assert_eq!(scrub("envoi au 0612345678 raté"),
                   "envoi au [masqué] raté");
        assert_eq!(scrub("+33612345678"), "+[masqué]");
        assert_eq!(scrub("vue 12345 : 3 essais"),
                   "vue 12345 : 3 essais");
        assert_eq!(scrub("123456789"), "[masqué]");
    }
}
```

::: details Solution
```rust play
pub fn scrub(s: &str) -> String {
    let mut out = String::new();
    let mut digits = String::new();
    let flush = |out: &mut String, d: &mut String| {
        if d.len() >= 9 {
            out.push_str("[masqué]");
        } else {
            out.push_str(d);
        }
        d.clear();
    };
    for c in s.chars() {
        if c.is_ascii_digit() {
            digits.push(c);
        } else {
            flush(&mut out, &mut digits);
            out.push(c);
        }
    }
    flush(&mut out, &mut digits);
    out
}

fn main() {
    println!("{}", scrub("appel 0612345678 ok"));
}
```

Un filet, jamais la défense principale : un numéro écrit `06 12 34 56 78` passe à travers. La vraie règle reste de ne pas mettre la donnée dans le message.
:::

### 3. Exercice : le verdict du run

Implémente `verdict` : échec si rien n'est publié alors qu'on a tenté quelque chose, ou si plus de 20 % des tentatives échouent (seulement à partir de 10 tentatives). Les vues fraîches (sautées) ne sont pas des échecs.

```rust play
pub struct Stats { pub attempted: u64, pub published: u64 }

pub fn verdict(s: &Stats) -> Result<(), String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn st(a: u64, p: u64) -> Stats {
        Stats { attempted: a, published: p }
    }

    #[test]
    fn thresholds() {
        assert!(verdict(&st(0, 0)).is_ok(), "tout frais");
        assert!(verdict(&st(100, 80)).is_ok(), "20 % pile");
        assert!(verdict(&st(100, 79)).is_err());
        assert!(verdict(&st(5, 3)).is_ok(), "trop peu");
        assert!(verdict(&st(3, 0)).is_err(), "rien publié");
    }
}
```

::: details Solution
```rust play
pub struct Stats { pub attempted: u64, pub published: u64 }

pub fn verdict(s: &Stats) -> Result<(), String> {
    if s.attempted > 0 && s.published == 0 {
        return Err("rien n'a été publié".into());
    }
    let failed = s.attempted.saturating_sub(s.published);
    if s.attempted >= 10 && failed * 100 > s.attempted * 20 {
        return Err(format!("{failed}/{} en échec", s.attempted));
    }
    Ok(())
}

fn main() {
    let s = Stats { attempted: 100, published: 70 };
    println!("{:?}", verdict(&s));
}
```

`failed * 100 > attempted * 20` plutôt qu'un pourcentage flottant : pas d'arrondi, pas de division par zéro. Les seuils (20 %, 10) sont des constantes nommées dans le vrai code, avec un commentaire qui dit pourquoi.
:::

### 4. Question : pourquoi ce job ne sort jamais proprement ?

```rust
#[tokio::main]
async fn main() {
    tokio::signal::ctrl_c().await.unwrap();
    // ...
}
```

et, ailleurs :

```rust
let _g = tracing::info_span!("job").entered();
scrape().await;
```

::: details Solution
Premier bloc : il n'écoute que `Ctrl+C` (SIGINT). Kubernetes envoie **SIGTERM** : le handler n'est jamais déclenché, le processus meurt avec le comportement par défaut. Il faut `tokio::signal::unix::signal(SignalKind::terminate())`. Et ce `main` attend le signal **au lieu** de faire le travail : il faut un `select!` ou un token.

Second bloc : un guard de span gardé à travers un `.await`. Pendant que `scrape` est suspendue, d'autres tâches du même thread loguent dans le span `job` ; à l'inverse, au retour sur un autre thread, le contexte est faux. Correctif : `scrape().instrument(span).await`.
:::

## À retenir

- `tracing` émet des événements structurés ; le subscriber choisit le format (texte en dev, JSON en prod), installé une fois avant le runtime.
- Les spans s'attachent aux futures avec `.instrument()`, jamais `enter()` à travers un `await`.
- Ni PII ni secret dans un log ou un message d'erreur ; un bilan et un verdict plutôt qu'une alerte par échec.
- Un signal de vie best-effort sur une connexion dédiée voit ce que les logs ne voient pas.
- SIGTERM → `CancellationToken` ; annuler = drop la future ; nettoyage hors de la partie annulée, borné à 5 s.
- Codes de sortie documentés : 0 succès, 1 échec (rejouable), 2 config ou usage (ne pas rejouer).
