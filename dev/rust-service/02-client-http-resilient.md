# Un client HTTP résilient

Ce que tu vas apprendre : construire avec `reqwest` un client HTTP qui tient des heures face à un site tiers lent ou capricieux. Un client unique réutilisé (et pourquoi), des timeouts partout, un retry avec backoff exponentiel et jitter **seulement** sur les erreurs transitoires, le respect de `Retry-After`, un throttling poli, la session par cookies, et des URLs normalisées pour des sorties déterministes.

## Le contexte : un portail que tu ne contrôles pas

Le scraper du fil rouge parcourt le portail web d'un fournisseur : des dizaines de milliers de pages, pendant des heures. Ce portail :

- répond parfois en 30 s, parfois pas du tout ;
- renvoie des 503 aux heures de pointe, des 429 si tu vas trop vite ;
- te déconnecte sans prévenir (redirection vers `/login`) ;
- n'est **pas à toi** : si tu le martèles, ton compte est bloqué.

Chaque section de ce chapitre répond à un de ces points.

## Un seul client, réutilisé

`reqwest::Client` contient un **pool de connexions** (keep-alive HTTP/1.1, multiplexage HTTP/2) et, si tu l'actives, le **cookie jar**. Il est fait pour être créé une fois :

```rust
// MAUVAIS : un client par requête
async fn fetch(url: &str) -> reqwest::Result<String> {
    reqwest::Client::new().get(url).send().await?.text().await
}
```

Ce code refait à chaque appel la résolution DNS, la connexion TCP et la poignée de main TLS (plusieurs allers-retours réseau). Sur 50 000 pages, c'est des heures perdues, et des milliers de sockets en `TIME_WAIT` côté serveur. Sans compter la session : un nouveau client = un cookie jar vide = déconnecté.

La bonne forme : une struct qui possède le client, créée au démarrage du job.

```rust
#[derive(Debug, Clone)]
pub struct HttpClient {
    inner: reqwest::Client,
    cfg: HttpConfig,
}
```

`reqwest::Client` est déjà un `Arc` en interne : `clone()` est gratuit et **partage** le pool et les cookies. Tu peux le passer à plusieurs tâches sans `Arc<HttpClient>`.

## Des timeouts, toujours

Sans timeout, une requête vers un serveur qui accepte la connexion puis ne répond plus attend **indéfiniment**. Ton job de nuit est encore là le lendemain matin, et le CronJob suivant est bloqué derrière (chapitre 6).

```rust
use std::time::Duration;

let inner = reqwest::Client::builder()
    .user_agent(cfg.user_agent.clone())
    // connexion TCP + TLS : échoue vite sur un hôte mort
    .connect_timeout(Duration::from_secs(10))
    // la requête entière, lecture du corps comprise
    .timeout(cfg.timeout)
    .cookie_store(true) // feature "cookies"
    .build()?;
```

| Réglage | Borne | Valeur typique |
|---|---|---|
| `connect_timeout` | établir la connexion | 5-10 s |
| `timeout` | tout : connexion, en-têtes, corps | 30-120 s selon la taille |

Le `timeout` total est celui qui compte : un serveur qui envoie un octet par minute passe sous un timeout « de lecture » mais pas sous un timeout total.

Et refuse une config dangereuse au lieu de la corriger en silence :

```rust
pub fn new(cfg: HttpConfig) -> Result<Self, HttpError> {
    if cfg.timeout.is_zero() {
        return Err(HttpError::Config(
            "timeout doit être positif".into(),
        ));
    }
    if cfg.max_attempts < 1 {
        return Err(HttpError::Config(
            "max_attempts doit valoir au moins 1".into(),
        ));
    }
    // ... builder
}
```

## Classer les erreurs : transitoire ou définitive

Le cœur du sujet. Réessayer n'a de sens que si **la même requête** peut réussir plus tard :

| Erreur | Transitoire ? | Pourquoi |
|---|---|---|
| connexion refusée, DNS, timeout | oui | réseau, serveur qui redémarre |
| corps coupé en cours de lecture | oui | connexion tombée |
| `429 Too Many Requests` | oui | ralentir suffit |
| `500`, `502`, `503`, `504` | oui | panne côté serveur |
| `400`, `401`, `403`, `404`, `422` | **non** | la requête est fausse, elle le restera |
| boucle de redirections | non | le serveur la renverra à l'identique |

```rust
impl HttpError {
    pub fn is_transient(&self) -> bool {
        match self {
            Self::Status { status, .. } => {
                *status == 429 || *status >= 500
            }
            Self::Network { source, .. } => !source.is_redirect(),
            Self::Body { .. } => true,
            _ => false,
        }
    }
}
```

Réessayer un 404 cinq fois, c'est cinq requêtes inutiles vers un site tiers, et un job qui met cinq fois plus de temps à échouer. Réessayer un 401, c'est parfois un compte verrouillé.

::: danger Jamais de retry sur une requête à effet de bord
Un `POST /login` rejoué après un timeout a peut-être réussi la première fois. Selon le portail, deux logins rapprochés invalident la session, ou verrouillent le compte. Le client expose donc deux familles de méthodes : `get_text`, `get_bytes` (avec retry) et `post_form` (sans retry, l'appelant décide). Un POST n'est rejouable que s'il est une lecture déguisée (pagination d'une table, recherche).
:::

## Backoff exponentiel et jitter

Réessayer tout de suite tape un serveur déjà en difficulté. On attend de plus en plus : `base × 2^(essai-1)`, plafonné.

```rust
const MAX_BACKOFF: Duration = Duration::from_secs(60);

fn backoff(&self, attempt: u32) -> Duration {
    let base = self.cfg.backoff_base;
    // 2^(attempt-1) qui déborde = le plafond
    let mut delay = 2u32
        .checked_pow(attempt.saturating_sub(1))
        .map_or(MAX_BACKOFF, |f| base.saturating_mul(f))
        .min(MAX_BACKOFF);
    // jitter : jusqu'à la moitié de la base, au hasard
    let half = u64::try_from((base / 2).as_nanos())
        .unwrap_or(u64::MAX);
    if half > 0 {
        delay += Duration::from_nanos(
            rand::random_range(0..half),
        );
    }
    delay.max(self.cfg.backoff_floor)
}
```

Avec une base de 1 s : environ 1 s, 2 s, 4 s, 8 s, puis 60 s maximum.

**Le jitter** résout le *thundering herd* : si 20 tâches échouent au même instant (le serveur a redémarré), sans jitter elles réessaient toutes au même instant, et le refont tomber. Un peu de hasard étale les essais.

**Le plancher** (`backoff_floor`) est la politesse du fournisseur : si tu dois espacer tes requêtes de 2 s en temps normal, un retry ne doit pas partir plus vite.

`checked_pow` et `saturating_mul` : pas de panic en debug ni de valeur absurde en release si quelqu'un configure 40 essais. `rand::random_range` est l'API de `rand` 0.9+ (avant : `thread_rng().gen_range`).

## `Retry-After` : le serveur sait mieux que toi

Un 429 ou un 503 peut porter `Retry-After: 30`. C'est le serveur qui te dit combien attendre : on prend le **maximum** de notre backoff et de sa demande.

```rust
fn parse_retry_after(v: &HeaderValue) -> Option<Duration> {
    let secs: u64 = v.to_str().ok()?.trim().parse().ok()?;
    Some(Duration::from_secs(secs).min(MAX_BACKOFF))
}

fn wait_after(&self, attempt: u32, err: &HttpError)
    -> Duration
{
    self.backoff(attempt)
        .max(err.retry_after().unwrap_or_default())
}
```

Deux choix assumés :

- **Plafond à 60 s** : un `Retry-After: 86400` mal configuré ne bloque pas le job une journée. Au-delà, l'erreur remonte et le job décide.
- **La forme date** (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`) est ignorée si aucun de tes serveurs ne l'emploie : le backoff s'applique seul. Si tu la rencontres, `httpdate` sait la parser.

## La boucle de retry

```rust
pub async fn fetch_with_retry(
    &self,
    url: &str,
    make_request: impl Fn() -> RequestBuilder,
) -> Result<Fetched, HttpError> {
    let mut attempt = 1;
    loop {
        let err = match self.fetch(url, make_request()).await {
            Ok(v) => return Ok(v),
            Err(e) if !e.is_transient() => return Err(e),
            Err(e) => e,
        };
        if attempt >= self.cfg.max_attempts {
            return Err(HttpError::Exhausted {
                attempts: attempt,
                last: Box::new(err),
            });
        }
        let wait = self.wait_after(attempt, &err);
        tracing::warn!(attempt, ?wait, error = %err, "retry");
        tokio::time::sleep(wait).await;
        attempt += 1;
    }
}
```

Points de mécanisme :

- **`make_request` reconstruit la requête à chaque essai.** Un `RequestBuilder` est consommé par `send()` (son corps peut être un flux). Alternative : `RequestBuilder::try_clone()`, qui renvoie `None` pour un corps en streaming.
- **`Exhausted` garde la dernière erreur** (`Box` car le type est récursif) : le log final dit « 5 essais, dernier statut 503 » et pas juste « échec ».
- **L'attente est un `await`.** Si le job est annulé (SIGTERM, chapitre 5), la future est abandonnée au milieu du `sleep` : pas besoin de vérifier un drapeau dans la boucle. C'est la cancellation par `drop` du [chapitre 9](/dev/rust/09-async-tokio).

## Lire le corps avant de juger le statut

```rust
async fn fetch(&self, url: &str, req: RequestBuilder)
    -> Result<Fetched, HttpError>
{
    let resp = req.send().await.map_err(|source| {
        HttpError::Network { url: url.into(), source }
    })?;
    let status = resp.status().as_u16();
    let final_url = resp.url().clone();
    let body = resp.bytes().await.map_err(|source| {
        HttpError::Body { url: url.into(), source }
    })?;
    if !(200..300).contains(&status) {
        return Err(HttpError::status(url, status, &body));
    }
    Ok(Fetched { body: body.into(), final_url })
}
```

Lire tout le corps, même d'une erreur, **rend la connexion au pool** (une réponse non lue jusqu'au bout ferme la connexion) et donne un extrait pour le diagnostic. Garde un extrait court (200 caractères) dans l'erreur : assez pour reconnaître une page de maintenance, pas assez pour noyer les logs.

`reqwest` ne transforme pas un 500 en erreur tout seul : `send()` réussit dès qu'il a une réponse. `resp.error_for_status()` existe, mais perd le corps ; d'où le test manuel.

## Le throttling poli

Le retry gère les erreurs. Le throttling, lui, s'applique **tout le temps** : un écart minimal entre deux requêtes, porté par le client et pas dispersé dans les boucles.

```rust
use tokio::sync::Mutex;
use tokio::time::Instant;

#[derive(Default)]
pub struct Pacer {
    last: Mutex<Option<Instant>>,
}

impl Pacer {
    pub async fn wait(&self, gap: Duration) {
        let mut last = self.last.lock().await;
        if let Some(prev) = *last {
            let elapsed = prev.elapsed();
            if elapsed < gap {
                tokio::time::sleep(gap - elapsed).await;
            }
        }
        *last = Some(Instant::now());
    }
}
```

Le verrou est gardé **pendant** le `sleep`, volontairement : deux tâches qui appellent `wait` en même temps se sérialisent, et l'espacement tient. D'où `tokio::sync::Mutex` : le `Mutex` de `std` gardé à travers un `.await` bloque le thread du runtime et rend la future non `Send`. Partout ailleurs, dormir verrou en main est une erreur.

Le temps passé ailleurs compte : si le parsing de la page a pris 3 s et que l'écart est de 2 s, la requête suivante part tout de suite.

| Besoin | Outil |
|---|---|
| N requêtes par seconde, une seule tâche | `Pacer` comme ci-dessus, ou `tokio::time::interval` |
| N requêtes **en parallèle** au plus | `tokio::sync::Semaphore` |
| quota par fenêtre, plusieurs hôtes | crate `governor` (GCRA) |

Pour un site tiers, commence **séquentiel et lent**. Paralléliser le scraping d'un portail qui n'est pas à toi, c'est la meilleure façon de te faire bannir.

## Session, cookies et redirection vers le login

Avec `.cookie_store(true)`, le client garde les cookies entre requêtes : on se connecte une fois, la session suit. Le piège : une session qui expire ne renvoie pas d'erreur, mais un **302 vers `/login`**, que le client suit, et un 200 avec la page de login.

```rust
let fetched = client.get_fetched(&url).await?;
if fetched.final_url.path().starts_with("/login") {
    return Err(PortalError::SessionLost);
}
```

D'où l'intérêt de garder `resp.url()` (l'URL finale après redirections) dans le résultat. Le parcours se reconnecte sur `SessionLost`, avec un **plafond** de reconnexions par run : un portail qui te déconnecte toutes les 10 requêtes, c'est un problème à remonter, pas à masquer.

Limite aussi les redirections (`redirect::Policy::limited(10)` ou une politique custom) : la valeur par défaut de `reqwest` est 10, pose-la explicitement pour qu'elle soit lisible.

## Des URLs normalisées pour des sorties déterministes

Les URLs ne servent pas qu'à faire des requêtes. Dans le scraper, elles sont les **clés** de la base d'état (chapitre 4) : « cette vue a été publiée le 3 mars ». Si la même page s'écrit tantôt `?page=2&brand=x`, tantôt `?brand=x&page=2`, l'incrémental croit voir deux pages.

```rust
use std::collections::BTreeMap;

/// Clés triées, valeurs d'une même clé dans l'ordre.
pub struct Values(BTreeMap<String, Vec<String>>);

impl Values {
    pub fn encode(&self) -> String {
        let mut out = Vec::new();
        for (k, vs) in &self.0 {
            for v in vs {
                out.push(format!("{}={}", esc(k), esc(v)));
            }
        }
        out.join("&")
    }
}
```

`BTreeMap` itère dans l'ordre des clés : la sortie est la même quel que soit l'ordre d'insertion. La crate `url` (standard WHATWG) garde l'ordre d'insertion des paramètres : c'est correct pour un navigateur, pas pour une clé de base.

::: warning Une sortie figée est un contrat
Une fois que des milliers d'URLs sont enregistrées, changer l'encodage (`%20` contre `+`, majuscules des échappements) invalide toute la base d'état. Fige ces règles par des tests, et ne remplace pas ce module par une crate « équivalente » sans comparer les sorties.
:::

## Cas réel

Le scraper de catalogues, configuration finale du client :

| Réglage | Valeur | Raison |
|---|---|---|
| `timeout` | 60 s | des pages lourdes, un portail lent |
| `max_attempts` | 5 | ~1+2+4+8 s de backoff, puis abandon de la page |
| `backoff_floor` | 2 s | la politesse demandée par le fournisseur |
| `Pacer` | 2 s entre requêtes | même chose, hors erreurs |
| cookies | oui | session du portail |
| re-logins par run | 10 au plus | au-delà, le job échoue et alerte |

Un incident réel : le portail renvoie des 500 sur une seule vue, toujours la même (une page cassée de son côté). Sans classement, le job réessaie à l'infini. Avec : 5 essais, `Exhausted`, la vue est **sautée et comptée** dans le bilan du run, le parcours continue. Le bilan de fin dit « 1 vue en échec sur 4 000 » (chapitre 5).

## Pièges classiques

- **Un `Client::new()` par requête** : pas de pool, pas de session, des handshakes TLS à chaque fois.
- **Pas de timeout** : un job bloqué jusqu'au lendemain. `reqwest` n'en met **aucun** par défaut.
- **Retry sur un 4xx** : requêtes inutiles, compte bloqué sur un 401.
- **Retry d'un POST de login** : session invalidée ou compte verrouillé.
- **Backoff sans plafond** : `2^20` secondes, le job dort des jours. Sans jitter : toutes les tâches réessaient ensemble.
- **`std::sync::Mutex` gardé à travers un `await`** : thread du runtime bloqué, future non `Send`.
- **Juger le statut sans lire le corps** : connexion non rendue au pool, aucun diagnostic.
- **Ignorer l'URL finale** : la page de login est parsée comme un catalogue vide.
- **Question d'entretien** : « Quelles erreurs HTTP réessayer ? » → réseau, corps tronqué, 429 et 5xx ; jamais les autres 4xx ; jamais une requête non idempotente.
- **Question d'entretien** : « À quoi sert le jitter ? » → désynchroniser les clients qui ont échoué ensemble, pour ne pas recréer le pic qui a fait tomber le serveur.

## Défis

### 1. Exercice : classer les échecs

Implémente `is_transient` d'après le tableau du chapitre.

```rust play
pub enum Failure {
    Status(u16),
    Network,
    BodyCut,
    RedirectLoop,
}

pub fn is_transient(f: &Failure) -> bool {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use Failure::*;

    #[test]
    fn transient() {
        for f in [Status(429), Status(500), Status(503),
                  Network, BodyCut] {
            assert!(is_transient(&f));
        }
    }

    #[test]
    fn definitive() {
        for f in [Status(400), Status(401), Status(404),
                  Status(422), RedirectLoop] {
            assert!(!is_transient(&f));
        }
    }
}
```

::: details Solution
```rust play
pub enum Failure {
    Status(u16),
    Network,
    BodyCut,
    RedirectLoop,
}

pub fn is_transient(f: &Failure) -> bool {
    match f {
        Failure::Status(s) => *s == 429 || *s >= 500,
        Failure::Network | Failure::BodyCut => true,
        Failure::RedirectLoop => false,
    }
}

fn main() {
    println!("{}", is_transient(&Failure::Status(503)));
}
```

Le `match` sans `_` est volontaire : une nouvelle variante (`Tls`, `Dns`) ne compile pas tant que tu n'as pas décidé si elle est transitoire.
:::

### 2. Exercice : un backoff testable

Le hasard rend le backoff impossible à tester. Injecte le jitter en argument : `delay = min(base × 2^(attempt-1), cap) + jitter`, puis au moins `floor`. Aucun panic même pour `attempt = 100`.

```rust play
use std::time::Duration;

pub fn backoff(attempt: u32, base: Duration, cap: Duration,
               floor: Duration, jitter: Duration) -> Duration {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    const S: fn(u64) -> Duration = Duration::from_secs;

    #[test]
    fn doubles_then_caps() {
        let d = |a| backoff(a, S(1), S(60), S(0), S(0));
        assert_eq!(d(1), S(1));
        assert_eq!(d(2), S(2));
        assert_eq!(d(4), S(8));
        assert_eq!(d(100), S(60));
    }

    #[test]
    fn jitter_and_floor() {
        let j = Duration::from_millis(300);
        assert_eq!(backoff(1, S(1), S(60), S(0), j),
                   Duration::from_millis(1300));
        assert_eq!(backoff(1, S(1), S(60), S(5), j), S(5));
    }
}
```

::: details Solution
```rust play
use std::time::Duration;

pub fn backoff(attempt: u32, base: Duration, cap: Duration,
               floor: Duration, jitter: Duration) -> Duration {
    let exp = 2u32
        .checked_pow(attempt.saturating_sub(1))
        .map_or(cap, |f| base.saturating_mul(f))
        .min(cap);
    (exp + jitter).max(floor)
}

fn main() {
    let s = Duration::from_secs;
    for a in 1..=8 {
        let d = backoff(a, s(1), s(60), s(0), s(0));
        println!("essai {a} : {d:?}");
    }
}
```

En production, l'appelant passe `Duration::from_nanos(rand::random_range(0..half))`. La fonction reste pure : c'est le pattern « injecter la source de hasard » (même idée qu'injecter l'horloge).
:::

### 3. Exercice : lire `Retry-After`

Secondes uniquement, plafond à 60 s ; tout le reste (date, négatif, vide) donne `None`.

```rust play
use std::time::Duration;

pub fn parse_retry_after(raw: &str) -> Option<Duration> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cases() {
        let s = Duration::from_secs;
        assert_eq!(parse_retry_after("3"), Some(s(3)));
        assert_eq!(parse_retry_after(" 7 "), Some(s(7)));
        assert_eq!(parse_retry_after("3600"), Some(s(60)));
        assert_eq!(parse_retry_after("-1"), None);
        assert_eq!(parse_retry_after(""), None);
        assert_eq!(parse_retry_after(
            "Wed, 21 Oct 2026 07:28:00 GMT"), None);
    }
}
```

::: details Solution
```rust play
use std::time::Duration;

pub fn parse_retry_after(raw: &str) -> Option<Duration> {
    let secs: u64 = raw.trim().parse().ok()?;
    Some(Duration::from_secs(secs).min(Duration::from_secs(60)))
}

fn main() {
    println!("{:?}", parse_retry_after("120"));
}
```

`u64::from_str` refuse le signe `-` : pas besoin de cas particulier. Le `?` sur `Option` rend la fonction lisible en deux lignes.
:::

### 4. Exercice : une boucle de retry générique

Écris `retry` : appelle `op` jusqu'à `max` fois tant que l'erreur est transitoire, et appelle `sleep(attempt)` entre deux essais (on n'attend pas vraiment : c'est injecté). Renvoie le résultat et le nombre d'essais.

```rust play
pub fn retry<T, E>(
    max: u32,
    mut op: impl FnMut() -> Result<T, E>,
    is_transient: impl Fn(&E) -> bool,
    mut sleep: impl FnMut(u32),
) -> (Result<T, E>, u32) {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn succeeds_on_third() {
        let mut n = 0;
        let mut slept = vec![];
        let (r, tries) = retry(5,
            || { n += 1; if n < 3 { Err(503) } else { Ok("ok") } },
            |e| *e >= 500, |a| slept.push(a));
        assert_eq!(r, Ok("ok"));
        assert_eq!(tries, 3);
        assert_eq!(slept, vec![1, 2]);
    }

    #[test]
    fn stops_on_definitive() {
        let (r, tries) = retry(5, || Err::<(), _>(404),
            |e| *e >= 500, |_| {});
        assert_eq!((r, tries), (Err(404), 1));
    }

    #[test]
    fn gives_up_after_max() {
        let (r, tries) = retry(3, || Err::<(), _>(500),
            |e| *e >= 500, |_| {});
        assert_eq!((r, tries), (Err(500), 3));
    }
}
```

::: details Solution
```rust play
pub fn retry<T, E>(
    max: u32,
    mut op: impl FnMut() -> Result<T, E>,
    is_transient: impl Fn(&E) -> bool,
    mut sleep: impl FnMut(u32),
) -> (Result<T, E>, u32) {
    let mut attempt = 1;
    loop {
        match op() {
            Ok(v) => return (Ok(v), attempt),
            Err(e) if !is_transient(&e) || attempt >= max => {
                return (Err(e), attempt);
            }
            Err(_) => {
                sleep(attempt);
                attempt += 1;
            }
        }
    }
}

fn main() {
    let (r, n) = retry(3, || Err::<(), _>(503),
        |e| *e >= 500, |a| println!("attente après l'essai {a}"));
    println!("{r:?} en {n} essais");
}
```

La version async a la même forme, avec `op: impl Fn() -> Fut` et `tokio::time::sleep(..).await` à la place du `sleep` injecté. Dans les tests, l'horloge en pause de Tokio remplace l'injection (chapitre 7).
:::

### 5. Question : où est le bug ?

```rust
for url in urls {
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .build()?;
    login(&client).await?;
    let page = client.get(&url).send().await?;
    // ...
}
```

::: details Solution
Trois bugs en un : un client par itération (pas de pool, handshake TLS à chaque page), un **login par page** (le portail voit des milliers de connexions, c'est un bon moyen d'être banni), et aucun timeout (une page qui ne répond pas bloque tout). Correctif : client et login **avant** la boucle, `timeout` configuré, re-login seulement sur `SessionLost`.
:::

## À retenir

- Un `reqwest::Client` par job, cloné si besoin : pool de connexions et cookies partagés.
- `timeout` total obligatoire (`reqwest` n'en met aucun), `connect_timeout` pour échouer vite.
- Retry seulement sur réseau, corps tronqué, 429 et 5xx ; jamais sur les autres 4xx ni sur un POST à effet de bord.
- Backoff exponentiel plafonné, jitter contre le thundering herd, au moins le `Retry-After` du serveur.
- Throttling porté par le client (`tokio::sync::Mutex` gardé pendant le sommeil), séquentiel avec un site tiers.
- Les URLs qui servent de clés sont normalisées (query triée) et leurs règles figées par des tests.
