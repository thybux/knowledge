# Notifications

Ce que tu vas apprendre : concevoir un service de notifications multi-canal (email, push, in-app) pour un SaaS — files par canal, retries et dead letter queue, préférences utilisateur, déduplication, et ce qui casse en prod.

## Exigences

**Fonctionnelles** :

1. Les autres services déclenchent une notification par **événement métier** (`order.shipped`, `comment.mentioned`, `password.reset`), sans connaître les canaux.
2. Canaux : **email**, **push mobile** (APNs pour iOS, FCM pour Android), **in-app** (cloche avec compteur de non-lus). SMS en option.
3. **Préférences** par utilisateur : par catégorie × canal (« mentions : push oui, email non »), désinscription marketing en un clic, heures calmes.
4. Templates par type et par langue.
5. Historique in-app paginé, « marquer comme lu ».

**Non fonctionnelles** :

- **Au moins une fois** : une notification de réinitialisation de mot de passe ne doit pas se perdre.
- Pas de doublon visible dans la grande majorité des cas (pas 3 fois le même email).
- Priorités : transactionnel urgent (< 10 s) vs marketing (peut attendre des heures).
- Résister aux pannes et aux limites de débit des **fournisseurs** (SES, SendGrid, FCM).
- Respect légal : opt-out marketing, RGPD (suppression des données).

## Estimations

```text
Utilisateurs : 5 M, ~10 notifs/jour/utilisateur
-> 50 M notifs/jour ≈ 600/s en moyenne
Campagne marketing : 5 M emails à envoyer en ~1 h
-> ~1 400/s en plus, en rafale
Fournisseur email : quota typique de quelques centaines
à quelques milliers d'envois/s selon le contrat
-> il FAUT une file pour lisser

In-app : 50 M lignes/jour × 300 o ≈ 15 Go/jour
-> rétention 90 jours (~1,4 To) : partitionner par date
```

## API

API interne (appelée par les autres services) :

```http
POST /internal/v1/notifications
{ "idempotencyKey": "order.shipped:ord_123",
  "userId": "usr_42",
  "type": "order.shipped",
  "priority": "high",
  "data": { "orderId": "ord_123", "carrier": "Colissimo" } }
-> 202 { "id": "ntf_9" }
```

API publique (app mobile et web) :

```http
GET  /v1/me/notifications?cursor=…&limit=20
GET  /v1/me/notifications/unread-count
POST /v1/me/notifications/read   { "ids": ["ntf_9"] }
PUT  /v1/me/preferences
     { "mention": { "email": false, "push": true } }
POST /v1/me/devices { "platform": "ios", "token": "…" }
```

Le producteur envoie un **événement**, pas « envoie un email » : le service décide des canaux selon les préférences. Ça évite de dupliquer la logique de préférences dans 15 services.

## Modèle de données

```sql
CREATE TABLE notifications (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL,
  type       text NOT NULL,
  data       jsonb NOT NULL,
  idem_key   text NOT NULL UNIQUE,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- cloche : derniers non-lus d'un utilisateur
CREATE INDEX ON notifications (user_id, created_at DESC);

CREATE TABLE deliveries (
  id              uuid PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES notifications,
  channel         text NOT NULL, -- email|push|inapp
  status          text NOT NULL DEFAULT 'pending',
  -- pending|sent|failed|skipped|bounced
  attempts        int NOT NULL DEFAULT 0,
  provider_id     text,          -- id chez SES/FCM
  last_error      text,
  UNIQUE (notification_id, channel)
);

CREATE TABLE preferences (
  user_id  uuid NOT NULL,
  category text NOT NULL,   -- 'mention', 'marketing'…
  channel  text NOT NULL,
  enabled  boolean NOT NULL,
  PRIMARY KEY (user_id, category, channel)
);

CREATE TABLE devices (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL,
  platform   text NOT NULL,  -- ios|android
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Deux contraintes font le gros du travail d'idempotence : `idem_key UNIQUE` (un événement → une notification) et `UNIQUE (notification_id, channel)` (une notification → au plus un envoi par canal).

## Architecture

```text
services métier
 (orders, comments, auth)
      | événement
      v
[ Notification API ]
  1. dédup (idem_key)
  2. préférences + heures calmes
  3. INSERT notification + deliveries
     + outbox (même transaction)
      |
      v
[ queues par canal et priorité ]
  email.high  email.low  push  inapp
      |          |         |      |
      v          v         v      v
 [ email worker ] [ push worker ] [ inapp ]
   rendu template   FCM / APNs    WebSocket
   SES / SendGrid                 / SSE
      |               |
      v               v
  webhooks fournisseurs (bounce,
  token invalide) -> UPDATE deliveries
      |
      v
   DLQ (échecs définitifs) -> alerte
```

- **Une file par canal** : une panne de FCM n'empêche pas les emails de partir. Chaque worker scale indépendamment.
- **Une file par priorité** : la campagne marketing de 5 M emails ne retarde pas les réinitialisations de mot de passe.
- **In-app** : la ligne en base **est** la notification ; le worker pousse seulement un signal temps réel aux clients connectés (WebSocket / Server-Sent Events). Un client déconnecté verra la notification au prochain chargement de la cloche.

## Deep dive : retries et DLQ

Le worker email, simplifié (Node) :

```ts
async function handle(job: { deliveryId: string }) {
  const d = await repo.lockDelivery(job.deliveryId);
  if (!d || d.status !== "pending") return; // déjà traité

  try {
    const msg = await render(d.type, d.locale, d.data);
    const { id } = await ses.send(msg, { timeoutMs: 5000 });
    await repo.markSent(d.id, id);
  } catch (err) {
    if (isPermanent(err)) {          // adresse invalide…
      await repo.markFailed(d.id, err);
      return;                        // pas de retry
    }
    await repo.incrementAttempts(d.id, err);
    throw err; // la queue re-livre avec backoff
  }
}
```

- **Erreurs temporaires** (timeout, 429, 5xx fournisseur) : retry avec backoff exponentiel + jitter (voir le défi `retry` de [Défis TypeScript](/interview/02-pratique/01-defis-typescript)).
- **Erreurs permanentes** (adresse invalide, token push révoqué) : pas de retry ; on marque `failed`, et pour un token push invalide on **supprime** le device.
- Après N tentatives : le message part en **DLQ** (dead letter queue), une alerte se déclenche, et on peut rejouer la DLQ après correction.

### Le doublon résiduel

```text
worker : envoie à SES ... OK
worker : crash avant markSent
queue  : re-livre le job
worker : status = pending -> renvoie l'email
```

Entre l'appel externe et l'écriture du statut, il y a toujours une fenêtre. On la réduit (statut `sending` + timestamp, et un job re-livré trop tôt après un `sending` est différé), mais avec un fournisseur sans clé d'idempotence, **exactement une fois est impossible**. Pour un email, un doublon rarissime est acceptable ; c'est un compromis à **dire** explicitement.

## Deep dive : préférences et règles

Appliquées **avant** de créer les livraisons :

1. Catégorie obligatoire ? (`password.reset`, `security.alert` : on ignore les préférences, c'est transactionnel.)
2. Préférence `(user, catégorie, canal)` ; absence de ligne = valeur par défaut de la catégorie.
3. Heures calmes : push non urgent entre 22 h et 8 h (fuseau de l'utilisateur) → différé, pas supprimé.
4. Plafond de fréquence : pas plus de N push marketing par jour.
5. **Regroupement** (digest) : « 12 nouveaux commentaires » au lieu de 12 push, avec une fenêtre de quelques minutes par `(user, type)`.

Les livraisons non envoyées sont gardées avec `status = 'skipped'` et la raison : indispensable pour le support (« pourquoi je n'ai pas reçu l'email ? »).

## Lien avec du code Rust

Les canaux sont un bon cas pour un trait. Chaque canal implémente la même interface, et le worker ne dépend que du trait (testable avec un faux canal) :

```rust
pub enum SendError {
    Temporary(String), // -> retry
    Permanent(String), // -> failed, pas de retry
}

pub trait Channel: Send + Sync {
    fn name(&self) -> &'static str;
    async fn send(&self, to: &Recipient, msg: &Rendered)
        -> Result<ProviderId, SendError>;
}
```

`async fn` dans un trait est stable depuis Rust 1.75 ; pour un `Vec<Box<dyn Channel>>` il faut encore passer par la crate `async-trait` ou renvoyer un `Pin<Box<dyn Future>>`. Voir [Traits & generics](/dev/rust/03-traits-generics) et [Async & Tokio](/dev/rust/09-async-tokio).

## Points de défaillance

| Panne | Effet | Mitigation |
| --- | --- | --- |
| Fournisseur email | Emails en attente | Retry, 2e fournisseur |
| FCM / APNs | Push en retard | File dédiée, TTL push |
| Queue | Plus d'envois | Outbox : rien n'est perdu |
| Worker crash | Job re-livré | Statut en base, idempotent |
| Template cassé | Échecs en masse | Tests de rendu en CI |

Un push a une **durée de vie** : « ton livreur arrive dans 5 min » envoyé avec 2 h de retard est pire que rien. Pose un TTL (APNs `apns-expiration`, FCM `ttl`) et jette les messages expirés côté worker.

## Questions de relance

::: details « Comment envoyer une annonce à 5 M d'utilisateurs ? »
Ne pas créer 5 M jobs d'un coup depuis la requête HTTP. Un job « campagne » fait un **fan-out par lots** : il parcourt les utilisateurs éligibles par curseur (10 000 à la fois), crée les notifications et livraisons en `INSERT` groupés, et publie dans la file **basse priorité**. Les workers consomment au rythme du quota fournisseur (rate limiter sortant). On peut suspendre ou annuler la campagne en cours.
:::

::: details « Comment calculer le compteur de non-lus rapidement ? »
`SELECT count(*) ... WHERE user_id = $1 AND read_at IS NULL` avec un index partiel `ON notifications (user_id) WHERE read_at IS NULL` suffit pour la plupart des cas. Si c'est appelé à chaque page, un compteur dans Redis (`INCR` à la création, `DECRBY` à la lecture), recalculé périodiquement depuis la base pour corriger la dérive.
:::

::: details « Comment savoir si un email est bien arrivé ? »
« Envoyé » ≠ « délivré ». Le fournisseur appelle un **webhook** (bounce, plainte spam, délivré, ouvert). On met à jour `deliveries` à partir du `provider_id`. Les bounces permanents (adresse inexistante) doivent bloquer les envois futurs vers cette adresse, sinon la réputation d'expéditeur se dégrade. Les ouvertures sont peu fiables (blocage des pixels par les clients mail).
:::

::: details « Pourquoi l'outbox plutôt que publier directement dans la queue ? »
Si on fait `INSERT notification` puis `queue.publish()` et que la publication échoue (ou que le process crashe entre les deux), la notification existe en base mais ne partira jamais. Avec l'outbox, l'intention d'envoi est écrite **dans la même transaction**, et un relais la publie ensuite avec retry. Voir [Paiements & idempotence](/interview/03-system-design/05-paiements-idempotence).
:::

::: details « SQL ou NoSQL pour l'historique in-app ? »
Accès simple (par `user_id`, trié par date) et gros volume : un store type Cassandra/DynamoDB y est très adapté. Mais Postgres avec **partitionnement par mois** (`PARTITION BY RANGE (created_at)`) tient très bien quelques To, et supprimer une vieille partition (`DROP`) est instantané comparé à un `DELETE` massif. On commence par Postgres.
:::

::: details « Comment tester tout ça ? »
Le moteur de règles (préférences, heures calmes, plafonds) en tests unitaires purs avec une horloge injectée. Les workers avec un faux canal (implémentation de test du trait / de l'interface) qui simule erreurs temporaires et permanentes. Les templates avec des snapshots de rendu par langue. Un environnement de staging avec un fournisseur en mode sandbox.
:::

## Pièges classiques

- Faire envoyer l'email **dans la requête HTTP** de l'inscription : si le fournisseur est lent, l'inscription est lente ; s'il est en panne, elle échoue.
- Une seule file pour tout : la campagne marketing bloque le mot de passe oublié.
- Réessayer les erreurs permanentes à l'infini (adresse invalide, token révoqué).
- Ignorer les bounces : le fournisseur finit par suspendre le compte.
- Oublier le fuseau horaire pour les heures calmes.
- Promettre « exactement une fois » avec un fournisseur externe.

## Défis

1. Écris la requête qui marque comme lues toutes les notifications d'un utilisateur jusqu'à une date, et renvoie le nombre de lignes modifiées.
2. Le service `orders` émet deux fois `order.shipped` pour la même commande (retry réseau). Que se passe-t-il dans ta conception ?
3. Conçois la règle de digest : « si un utilisateur reçoit plus de 3 mentions en 5 minutes, n'envoyer qu'un push récapitulatif ». Où stockes-tu l'état ?

::: details Solution
1. Une requête :

```sql
UPDATE notifications
SET read_at = now()
WHERE user_id = $1
  AND read_at IS NULL
  AND created_at <= $2;
-- rowCount = nombre marquées
```

2. Les deux appels portent la même `idempotencyKey` (`order.shipped:ord_123`). Le second `INSERT` viole `idem_key UNIQUE` → on renvoie le `202` avec l'id existant (`ON CONFLICT (idem_key) DO NOTHING` puis `SELECT`). Aucun doublon. D'où l'importance que la clé soit dérivée de l'**événement métier**, pas générée aléatoirement par le producteur à chaque tentative.
3. Un compteur Redis par `(user, type)` avec une fenêtre de 5 min (`INCR` + `EXPIRE 300`). Les 3 premières mentions partent normalement ; au-delà, on marque les livraisons push `skipped (digest)` et on programme (une seule fois, via `SET digest:{user} NX EX 300`) un job différé qui enverra « N nouvelles mentions » à la fin de la fenêtre. L'in-app reçoit toujours chaque notification.
:::

## À retenir

- Les producteurs envoient des **événements** ; le service de notifications décide des canaux.
- Files séparées par canal et par priorité ; workers indépendants.
- Idempotence par contraintes `UNIQUE` (événement → notification → livraison par canal).
- Erreurs temporaires → retry avec backoff ; permanentes → échec immédiat ; épuisement → DLQ + alerte.
- Préférences, heures calmes et digest appliqués **avant** l'envoi, avec une trace `skipped`.
- « Au moins une fois » + déduplication : l'exactement-une-fois n'existe pas avec un fournisseur externe.
