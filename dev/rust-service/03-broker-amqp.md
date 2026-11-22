# Publier sur RabbitMQ

Ce que tu vas apprendre : publier des messages fiables sur RabbitMQ avec `lapin`. Connexion et channel, **publisher confirms** (sans eux, un message refusé passe pour publié), l'enveloppe `{ type, payload, timestamp }`, le contrat avec un consumer écrit dans un autre langage (qui déclare les queues, et pourquoi deux déclarants donnent `PRECONDITION_FAILED 406`), les payloads `serde` miroirs vérifiés par golden files, l'idempotence côté consumer et la backpressure.

## Le modèle AMQP en 5 notions

| Notion | Ce que c'est | Équivalent mental |
|---|---|---|
| connexion | une socket TCP vers le broker | une connexion Postgres |
| channel | une session légère multiplexée sur la connexion | une transaction en cours |
| exchange | le point d'entrée qui route | un routeur |
| queue | la file où dorment les messages | une table d'attente |
| binding | règle exchange → queue | une route |

Pour un producteur simple, tu publies sur **l'exchange par défaut** (`""`) avec comme *routing key* le nom de la queue : le message va directement dans cette queue. Pas besoin de déclarer d'exchange.

Le fil rouge : un job Rust publie, des workers TypeScript consomment.

```text
job Rust ──publish + confirm──▶ [queue upsert_product]
                                   │            │
                                   ▼            ▼
                               worker TS    worker TS
                                   │ échec x5
                                   ▼
                              [dead_letter]
```

## Connexion et channel avec `lapin`

`lapin` est le client AMQP 0-9-1 de référence en Rust, async, compatible Tokio.

```rust
use lapin::options::ConfirmSelectOptions;
use lapin::{Channel, Connection, ConnectionProperties};

async fn connect_once(url: &str)
    -> Result<(Connection, Channel), String>
{
    let conn = Connection::connect(
        url,
        ConnectionProperties::default(),
    )
    .await
    .map_err(|e| format!("connexion AMQP : {e}"))?;
    let ch = conn
        .create_channel()
        .await
        .map_err(|e| format!("ouverture du canal : {e}"))?;
    // sans ça, le broker ne confirme rien
    ch.confirm_select(ConfirmSelectOptions::default())
        .await
        .map_err(|e| format!("confirms : {e}"))?;
    Ok((conn, ch))
}
```

Règles d'usage :

- **Une connexion par processus**, ouverte au démarrage. Une connexion par message, c'est un handshake TCP + AMQP à chaque fois, et des milliers de connexions côté broker.
- **Quelques essais à la connexion** (5 essais espacés de 5 s) : un CronJob peut démarrer pendant que RabbitMQ redémarre.
- **Ferme proprement** en fin de job (`channel.close`, puis `conn.close(200, "fin")`), avec un timeout : un broker bloqué peut ne jamais répondre au `close`.

## Publisher confirms : savoir que le message est arrivé

Par défaut, `basic_publish` est « fire and forget » : la méthode rend la main dès que les octets sont partis. Si le broker refuse le message (queue pleine, disque plein), tu ne le sais jamais.

Avec `confirm_select`, chaque publication renvoie une **promesse de confirmation** que tu attends :

```rust
use lapin::options::BasicPublishOptions;
use lapin::{BasicProperties, Confirmation};

let props = BasicProperties::default()
    .with_content_type("application/json".into())
    .with_delivery_mode(2); // persistant
let opts = BasicPublishOptions {
    mandatory: true,
    ..BasicPublishOptions::default()
};
let confirm = channel
    .basic_publish("".into(), queue.into(), opts, &body, props)
    .await?; // octets partis
match confirm.await? {           // réponse du broker
    Confirmation::Ack(None) => Ok(()),
    Confirmation::Ack(Some(_returned)) => Err(QueueMissing),
    Confirmation::Nack(_) => Err(Nacked),
    Confirmation::NotRequested => Err(ConfirmsOff),
}
```

| Réponse | Sens | Réaction |
|---|---|---|
| `Ack(None)` | stocké dans la queue | succès |
| `Ack(Some(msg))` | accepté mais **rendu** : aucune queue ne l'a reçu | erreur, la queue a disparu |
| `Nack` | refusé (queue pleine, disque) | ralentir et réessayer |
| `NotRequested` | `confirm_select` oublié | bug de config |

Deux options qui changent tout :

- **`delivery_mode = 2`** : le message est écrit sur disque, il survit à un redémarrage du broker (si la queue est durable).
- **`mandatory: true`** : un message qu'aucune queue ne peut recevoir est **rendu** (`basic.return`) au lieu d'être accepté puis jeté en silence. Sans ça, publier vers une queue supprimée en cours de run « réussit ».

Le coût : un aller-retour par message si tu attends chaque confirmation. Pour quelques milliers de messages par run, c'est négligeable. Pour des millions, publie par lots et attends les confirmations ensemble (fenêtre de N messages en vol).

## Borner la publication

Quand RabbitMQ atteint son seuil mémoire ou disque, il déclenche une **alarme** et **bloque** les publieurs : la connexion reste ouverte, les heartbeats passent, mais `basic_publish` n'avance plus. Sans borne, ton job attend indéfiniment.

```rust
async fn bounded(
    deadline: Duration,
    attempt: impl Future<Output = Result<(), Attempt>>,
) -> Result<(), Attempt> {
    tokio::time::timeout(deadline, attempt)
        .await
        .unwrap_or_else(|_| {
            Err(Attempt::ConnectionLost(format!(
                "pas de confirmation en {deadline:?}"
            )))
        })
}
```

Un dépassement est traité comme une coupure : reconnexion, **un** nouvel essai, puis erreur. Un broker qui ne confirme plus ne se distingue pas d'un broker injoignable.

## Reconnexion : au moins une fois

Un scraping de plusieurs heures verra des coupures. Le client garde connexion et channel derrière un `tokio::sync::Mutex` (gardé pendant des `await`), et se reconnecte à la publication suivante :

```rust
pub async fn publish<T: Serialize + ?Sized>(
    &self, queue: &str, kind: &str, payload: &T,
) -> Result<(), BrokerError> {
    let body = serde_json::to_vec(
        &MessageEnvelope::new(kind, payload),
    )?;
    let mut inner = self.inner.lock().await;
    match self.try_once(&inner.channel, queue, &body).await {
        Ok(()) => return Ok(()),
        Err(Attempt::Failed(e)) => return Err(e),
        Err(Attempt::ConnectionLost(_)) => {}
    }
    self.reconnect(&mut inner).await?;
    match self.try_once(&inner.channel, queue, &body).await {
        Ok(()) => Ok(()),
        Err(Attempt::Failed(e)) => Err(e),
        Err(Attempt::ConnectionLost(r)) => {
            Err(BrokerError::Publish { reason: r })
        }
    }
}
```

Remarque : on sérialise **avant** de prendre le verrou (pas de travail CPU sous le verrou), et on ne rejoue qu'après une **coupure**, pas après un `Nack` sur un channel sain.

::: warning Le doublon est inévitable
Si la connexion tombe après que le broker a stocké le message mais avant que tu reçoives l'ack, tu republies : le message arrive **deux fois**. C'est la garantie *at-least-once* d'AMQP. « Exactly once » n'existe pas de bout en bout ; on obtient « effectivement une fois » avec un consumer **idempotent** (plus bas).
:::

## L'enveloppe commune

Tous les messages, quelle que soit la queue, ont la même forme :

```json
{ "type": "supplier-a", "payload": { "...": "..." },
  "timestamp": 1760000000000 }
```

```rust
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct MessageEnvelope<T> {
    /// discriminant de routage côté consumer
    #[serde(rename = "type")]
    pub kind: String,
    pub payload: T,
    /// millisecondes Unix, comme Date.now() en JS
    pub timestamp: i64,
}
```

`type` est un mot réservé en Rust, d'où `kind` + `#[serde(rename)]`. Le `timestamp` est en **millisecondes** parce que le consumer est en JS : un timestamp en secondes donnerait des dates en 1970.

## Le contrat avec un autre langage : qui déclare les queues ?

Une queue a des **arguments** fixés à sa création : `x-message-ttl`, `x-max-length`, `x-overflow`, `x-dead-letter-exchange`... Déclarer une queue qui existe déjà avec **d'autres** arguments est une erreur :

```text
PRECONDITION_FAILED - inequivalent arg 'x-max-length'
for queue 'upsert_product': received none but current is 50000
```

C'est le code AMQP **406**, et il ferme le channel. Si le Rust et le TS déclarent tous les deux la queue, le jour où l'un change un argument sans l'autre, le second à démarrer plante. Et ça arrive : le TS ajoute une limite de taille, le Rust n'est pas redéployé.

La règle : **un seul déclarant**. Ici, le TS (qui possède aussi les queues de retry et de dead letter). Le Rust fait une **déclaration passive** : « dis-moi si cette queue existe », sans la créer ni la modifier.

```rust
use lapin::options::QueueDeclareOptions;
use lapin::types::FieldTable;

pub async fn ensure_queue(&self, name: &str)
    -> Result<(), BrokerError>
{
    let opts = QueueDeclareOptions {
        passive: true, // vérifie seulement
        ..QueueDeclareOptions::default()
    };
    let res = self.channel
        .queue_declare(name.into(), opts, FieldTable::default())
        .await;
    res.map(|_| ()).map_err(|e| BrokerError::QueueMissing {
        queue: name.into(),
        reason: e.to_string(), // 404 NOT_FOUND
    })
}
```

En mode passif, durable et arguments sont ignorés : seul le nom compte. Une queue absente donne un `404 NOT_FOUND` **qui ferme le channel** : rouvre-en un avant de rendre l'erreur, pour que le client reste utilisable.

On l'appelle **au démarrage, avant tout travail** : inutile de scraper pendant 3 h pour découvrir qu'on ne peut rien publier. Conséquence assumée : le job ne peut tourner qu'après qu'un service TS s'est connecté au moins une fois (toujours vrai en production).

| Option | Pour | Contre |
|---|---|---|
| les deux déclarent | marche « tout seul » en dev | 406 au premier écart d'arguments |
| **un déclarant, l'autre passif** | une seule source de vérité | ordre de démarrage à respecter |
| déclaration par l'infra (definitions.json) | découplé des apps | un troisième endroit à maintenir |

## Les payloads : des miroirs testés

Les structs `serde` côté Rust sont des **miroirs manuels** des types (et des schémas zod) côté TS. Le compilateur ne voit pas l'autre langage : c'est aux tests de faire le pont.

```rust
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Product {
    pub provider: String,
    pub reference: String,
    pub stock: String,
    #[serde(rename = "prixPublicHt",
            serialize_with = "finite::serialize")]
    pub public_price: f64,
    pub remise: Option<String>, // None -> null
}
```

Règles de sérialisation qui font partie du contrat :

- **`None` s'écrit `null`**, jamais une clé absente (pas de `skip_serializing_if`) : le schéma zod attend la clé.
- **Les noms de clés sont ceux du contrat** (`prixPublicHt`), même s'ils ne sont pas idiomatiques en Rust : `rename` par champ.
- **Un `f64` NaN ou infini** : `serde_json` l'écrit `null` (pas d'erreur !). Un prix illisible deviendrait un prix absent. Un `serialize_with` qui refuse les non-finis fait échouer la sérialisation à la place.

Le test **golden** : une fixture JSON écrite **à la main** d'après le schéma du consumer, comparée à la sérialisation Rust.

```rust
#[test]
fn product_matches_contract() {
    let p = Product { /* valeurs de test */ ..Default::default() };
    let got: serde_json::Value =
        serde_json::to_value(&p).unwrap();
    let want: serde_json::Value = serde_json::from_str(
        include_str!("../tests/fixtures/payload/product.json"),
    ).unwrap();
    assert_eq!(got, want); // contenu, pas les octets
}
```

Et **la même fixture** est validée côté TS par le schéma zod du worker. Si quelqu'un renomme un champ d'un seul côté, un des deux tests casse.

::: danger Ne génère pas la fixture depuis le code Rust
Si la fixture est copiée de la sortie du code, le test vérifie que le code est égal à lui-même. Elle doit être écrite d'après le schéma du **consumer**. C'est la relecture humaine qui fait le contrat.
:::

Comparer des `serde_json::Value` ignore l'ordre des clés et l'indentation : seul le contenu fait contrat. Alternative plus forte : générer les types des deux côtés depuis un schéma commun (JSON Schema, protobuf). Plus robuste, mais une chaîne de génération à maintenir ; pour une dizaine de payloads, les miroirs + golden suffisent.

## Idempotence côté consumer

Le producteur garantit *at-least-once*. Le consumer doit donc supporter de recevoir deux fois le même message **sans effet double** :

| Message | Traitement idempotent |
|---|---|
| « upsert du produit REF-42 » | `INSERT ... ON CONFLICT (reference) DO UPDATE` |
| « envoie l'email de la commande 7 » | ligne `pending` → `UPDATE ... WHERE status = 'pending'`, n'envoie que si 1 ligne modifiée |
| « publie la vue V » | remplacer les pièces de V, pas les ajouter |

C'est pour ça qu'on publie des **états** (« le produit vaut ceci ») plutôt que des **deltas** (« ajoute 3 au stock ») : un état rejoué deux fois donne le même résultat.

Côté TS, un handler qui lève est rejoué via une queue de retry, puis part en dead letter après N essais. Ce n'est pas le problème du producteur Rust, mais c'est ce qui rend le doublon acceptable.

## Backpressure : `x-overflow: reject-publish`

Un job qui publie 50 000 messages en 5 minutes, des workers qui en traitent 20 par seconde : la queue gonfle. Sans limite, RabbitMQ finit en alarme mémoire et bloque **tous** les publieurs, y compris l'API.

Le déclarant (le TS) pose une limite :

```ts
upsert_product: {
  arguments: {
    "x-max-length": 50_000,
    "x-overflow": "reject-publish",
  },
},
```

| `x-overflow` | Quand la queue est pleine |
|---|---|
| `drop-head` (défaut) | supprime les **plus vieux** messages, en silence |
| `reject-publish` | **nack** au producteur |
| `reject-publish-dlx` | nack + dead letter |

Avec `reject-publish` et des confirms, le producteur **voit** la saturation (`Confirmation::Nack`) et ralentit :

```rust
pub async fn publish_retrying_nacks<P: Publisher>(
    mq: &P, backoff: NackBackoff, queue: &str,
    kind: &str, payload: &(impl Serialize + Sync),
) -> Result<(), BrokerError> {
    let mut waited = Duration::ZERO;
    let mut delay = backoff.first;
    loop {
        match mq.publish(queue, kind, payload).await {
            Err(BrokerError::Nacked { .. })
                if waited < backoff.budget =>
            {
                let wait = delay.min(backoff.budget - waited);
                tokio::time::sleep(wait).await;
                waited += wait;
                delay = (delay * 2).min(backoff.max);
            }
            other => return other,
        }
    }
}
```

Le choix dépend du job : la synchro de stock **ne peut pas sauter** un produit (relancer reprendrait depuis le début), donc elle attend (5 s → 60 s, 30 min au plus). Le scraper, lui, **saute** la vue (elle sera retentée au prochain run, chapitre 4) et échoue après 50 nacks d'affilée. Ne mets pas ce backoff dans `publish` lui-même : chaque appelant choisit.

## Cas réel

Le job de synchro de stock, de bout en bout :

1. Connexion (5 essais), `ensure_queue("upsert_product")` : si la queue manque, sortie immédiate avec un message qui dit « démarre d'abord un worker ».
2. Pour chaque produit : sérialisation (échec si prix NaN : la ligne est sautée et comptée), publication `mandatory` + persistante, attente de l'ack bornée à 60 s.
3. Nack : attente croissante. Coupure : reconnexion et un nouvel essai.
4. Fin : fermeture bornée à 5 s.

L'incident qui a justifié `reject-publish` : un week-end, les workers étaient arrêtés. Avec `drop-head`, la synchro du dimanche a publié 80 000 messages dans une queue limitée à 50 000 ; les 30 000 plus vieux ont disparu sans un log. Avec `reject-publish`, le job attend, puis échoue au bout de 30 min avec une alerte claire.

## Pièges classiques

- **Publier sans confirms** : un nack ou une queue pleine passent pour un succès.
- **Oublier `mandatory`** : un message vers une queue inexistante est accepté puis jeté.
- **`delivery_mode` 1** (transitoire) : les messages en attente disparaissent au redémarrage du broker.
- **Déclarer la queue des deux côtés** : `PRECONDITION_FAILED 406` au premier écart d'arguments.
- **Ne pas rouvrir le channel après une erreur AMQP** : il est fermé, toutes les publications suivantes échouent.
- **Attendre la confirmation sans timeout** : une alarme mémoire bloque le job pour toujours.
- **`skip_serializing_if = "Option::is_none"` par réflexe** : la clé disparaît, le schéma du consumer refuse le message.
- **Fixture golden copiée de la sortie** : le test ne vérifie plus rien.
- **Question d'entretien** : « *Exactly once* avec RabbitMQ ? » → non : *at-least-once* + consumer idempotent (clé naturelle, UPDATE conditionnel).
- **Question d'entretien** : « Que fait une déclaration passive ? » → vérifie l'existence d'une queue sans la créer ni comparer ses arguments ; 404 et channel fermé si elle n'existe pas.

## Défis

### 1. Exercice : la politique de nack

Écris la suite des attentes d'un producteur nacké en continu : première attente `first`, doublée jusqu'à `max`, en ne dépassant jamais `budget` au total (la dernière attente est rognée).

```rust play
use std::time::Duration;

pub fn waits(first: Duration, max: Duration, budget: Duration)
    -> Vec<Duration>
{
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    const S: fn(u64) -> Duration = Duration::from_secs;

    #[test]
    fn doubles_caps_and_trims() {
        assert_eq!(waits(S(5), S(60), S(150)),
                   vec![S(5), S(10), S(20), S(40), S(60), S(15)]);
    }

    #[test]
    fn total_is_the_budget() {
        let total: Duration = waits(S(5), S(60), S(1800))
            .iter().sum();
        assert_eq!(total, S(1800));
    }

    #[test]
    fn zero_budget_never_waits() {
        assert!(waits(S(5), S(60), S(0)).is_empty());
    }
}
```

::: details Solution
```rust play
use std::time::Duration;

pub fn waits(first: Duration, max: Duration, budget: Duration)
    -> Vec<Duration>
{
    let mut out = Vec::new();
    let mut waited = Duration::ZERO;
    let mut delay = first;
    while waited < budget {
        let wait = delay.min(budget - waited);
        out.push(wait);
        waited += wait;
        delay = delay.saturating_mul(2).min(max);
    }
    out
}

fn main() {
    let s = Duration::from_secs;
    println!("{:?}", waits(s(5), s(60), s(150)));
}
```

`budget - waited` ne peut pas sous-déborder grâce à la condition du `while` (une soustraction de `Duration` négative **panique**). C'est la même logique que `publish_retrying_nacks`, sortie de l'async pour être testée seule.
:::

### 2. Exercice : un consumer idempotent

Le producteur peut livrer deux fois le même message. Implémente `handle` : un message `(id, reference, stock)` met à jour le stock de la référence ; un `id` déjà traité ne fait rien et renvoie `false`.

```rust play
use std::collections::{HashMap, HashSet};

#[derive(Default)]
pub struct Consumer {
    seen: HashSet<u64>,
    pub stock: HashMap<String, u32>,
}

impl Consumer {
    pub fn handle(&mut self, id: u64, reference: &str,
                  stock: u32) -> bool {
        todo!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_is_ignored() {
        let mut c = Consumer::default();
        assert!(c.handle(1, "REF-42", 3));
        assert!(!c.handle(1, "REF-42", 3));
        assert_eq!(c.stock["REF-42"], 3);
    }

    #[test]
    fn newer_state_wins() {
        let mut c = Consumer::default();
        c.handle(1, "REF-42", 3);
        c.handle(2, "REF-42", 0);
        assert_eq!(c.stock["REF-42"], 0);
    }
}
```

::: details Solution
```rust play
use std::collections::{HashMap, HashSet};

#[derive(Default)]
pub struct Consumer {
    seen: HashSet<u64>,
    pub stock: HashMap<String, u32>,
}

impl Consumer {
    pub fn handle(&mut self, id: u64, reference: &str,
                  stock: u32) -> bool {
        // insert renvoie false si l'id était déjà là
        if !self.seen.insert(id) {
            return false;
        }
        self.stock.insert(reference.to_string(), stock);
        true
    }
}

fn main() {
    let mut c = Consumer::default();
    println!("{} {}", c.handle(1, "A", 1), c.handle(1, "A", 1));
}
```

Remarque : ici, même **sans** le `HashSet`, rejouer le message 1 donnerait le même stock, car on publie un **état** et pas un delta. Le dédoublonnage par id devient indispensable pour un effet externe (email, SMS). En base, `seen` est une contrainte unique ou un `UPDATE ... WHERE status = 'pending'`. Attention à l'ordre : si le message 1 est rejoué **après** le 2, l'état revient en arrière ; d'où le `timestamp` de l'enveloppe, que le consumer peut comparer.
:::

### 3. Question : pourquoi ce démarrage plante ?

Le worker TS déclare `upsert_product` avec `x-max-length: 50000`. Le job Rust, lui, fait :

```rust
channel.queue_declare(
    "upsert_product".into(),
    QueueDeclareOptions { durable: true, ..Default::default() },
    FieldTable::default(),
).await?;
```

::: details Solution
Déclaration **active** sans arguments d'une queue qui existe avec `x-max-length` : RabbitMQ compare, voit une différence, et répond `PRECONDITION_FAILED` (406), qui ferme le channel. Correctif : `passive: true` (seul le nom est vérifié), et laisser le TS seul déclarant. Copier les arguments côté Rust « pour être cohérent » déplace le problème : au prochain changement côté TS, ça recasse.
:::

### 4. Question : le prix fantôme

Un worker reçoit un produit avec `"prixPublicHt": null` alors que le job Rust a lu un prix. Le champ est un `f64`. Que s'est-il passé, et comment l'empêcher ?

::: details Solution
Le prix lu était `NaN` (parsing d'une chaîne invalide en `f64`, ou division par zéro) ou infini. `serde_json` sérialise un flottant non fini en `null` **sans erreur**. Le consumer voit « pas de prix ».

Deux défenses : refuser la ligne au parsing (un prix illisible est une erreur de ligne, sautée et comptée), et un `#[serde(serialize_with = ...)]` qui renvoie `Err` si `!value.is_finite()`, pour que la sérialisation échoue au lieu de mentir.
:::

## À retenir

- Une connexion par processus, un channel en mode confirms, publication `mandatory` et persistante.
- On attend chaque confirmation, avec un timeout : `Ack(None)` succès, `Ack(Some)` queue absente, `Nack` ralentir.
- Un seul déclarant des queues ; l'autre langage fait une déclaration **passive** au démarrage. Deux déclarants = 406.
- Les payloads sont des miroirs vérifiés par des fixtures écrites à la main, testées des **deux** côtés.
- *At-least-once* : le consumer est idempotent, le producteur publie des états plutôt que des deltas.
- `x-overflow: reject-publish` transforme une queue pleine en nack visible ; chaque job choisit d'attendre ou de sauter.
