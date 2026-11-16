# Paiements & idempotence

Ce que tu vas apprendre : concevoir le paiement d'une commande avec un PSP (type Stripe/Adyen) sans **jamais** débiter deux fois ni perdre un paiement — clés d'idempotence, timeouts ambigus, webhooks, pattern outbox, réconciliation et ledger.

C'est le sujet où la charge est faible mais où chaque détail compte : idéal pour montrer une maturité de senior.

## Exigences

**Fonctionnelles** :

1. Payer une commande (carte, via le PSP), y compris avec authentification 3-D Secure.
2. Rembourser totalement ou partiellement.
3. Recevoir les notifications du PSP (webhooks) : paiement réussi, échoué, litige (*chargeback*).
4. Informer le reste du système (`order` → expédition, email de confirmation).

**Non fonctionnelles** :

- **Jamais de double débit**, même si le client clique deux fois, que le réseau coupe ou qu'un worker crashe.
- **Jamais de commande marquée payée sans paiement** réel, ni de paiement réel sans trace chez nous.
- Traçabilité complète (audit, comptabilité) : on ne supprime ni ne modifie l'historique.
- Disponibilité élevée sur le checkout, mais la **cohérence** prime : mieux vaut refuser que d'être faux.
- Les données de carte ne transitent **pas** par nos serveurs (tokenisation côté PSP → périmètre PCI DSS réduit).

## Estimations

```text
100 000 commandes/jour ≈ 1,2 paiement/s
Pic (soldes, Black Friday) : ×30 ≈ 40/s
Webhooks : ~3 par paiement ≈ 4/s, pics 120/s
Stockage : 100k × 365 × ~2 Ko (paiement + events)
         ≈ 70 Go/an
```

Conclusion : **un seul Postgres** tient la charge sans effort. Toute la difficulté est la **correction** sous pannes et retries, pas le volume.

## D'où viennent les doubles débits ?

```text
1. Double clic sur "Payer"
2. Le mobile perd le réseau, l'app réessaie
3. Notre API appelle le PSP, timeout, on réessaie
4. Le PSP envoie le même webhook 2 fois
5. Un worker crashe et le job est rejoué
```

Chaque flèche réseau peut échouer **après** que l'opération a réussi de l'autre côté. La réponse à toutes ces situations est la même : rendre chaque étape **idempotente**.

## API

```http
POST /v1/orders/ord_123/payments
Idempotency-Key: 5b9e1f0c-…   (UUID généré par le client,
                               UNE fois par intention)
{ "amountCents": 4990, "currency": "EUR",
  "paymentMethod": "pm_tok_…" }

-> 201 { "id": "pay_77", "status": "succeeded" }
-> 202 { "id": "pay_77", "status": "requires_action",
         "redirectUrl": "https://3ds…" }
-> 409 requête identique déjà en cours
-> 422 même clé, body différent

POST /v1/payments/pay_77/refunds
Idempotency-Key: …
{ "amountCents": 1000 }

POST /webhooks/psp   (appelé par le PSP, signé)
```

La clé est générée **par le client** au moment où l'utilisateur décide de payer, et réutilisée à chaque retry de cette même intention. Un nouvel essai volontaire (autre carte) = nouvelle clé.

## Modèle de données

```sql
CREATE TABLE payments (
  id             uuid PRIMARY KEY,
  order_id       uuid NOT NULL,
  amount_cents   bigint NOT NULL CHECK (amount_cents > 0),
  currency       char(3) NOT NULL,
  status         text NOT NULL,
  -- pending|requires_action|succeeded|failed|unknown
  psp_payment_id text UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- au plus un paiement réussi par commande
CREATE UNIQUE INDEX one_success_per_order
  ON payments (order_id) WHERE status = 'succeeded';

CREATE TABLE idempotency_keys (
  user_id       uuid NOT NULL,
  key           text NOT NULL,
  request_hash  text NOT NULL,
  status        text NOT NULL,  -- in_progress|completed
  response_code int,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE webhook_events (
  psp_event_id text PRIMARY KEY,  -- dédup
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  processed_at timestamptz
);

CREATE TABLE outbox (
  id           bigserial PRIMARY KEY,
  topic        text NOT NULL,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX ON outbox (id) WHERE published_at IS NULL;
```

Les montants sont en **centimes** (`bigint`), jamais en `float`. La clé d'idempotence est scopée par utilisateur (deux clients peuvent générer la même chaîne). L'index unique partiel est un **filet de sécurité** au niveau base : même avec un bug applicatif, deux paiements `succeeded` pour une commande sont impossibles.

## Architecture

```text
 app / navigateur
   | Idempotency-Key
   v
[ API paiements ] ---------> [ PSP ]
   |  1. clé d'idempotence    (Idempotency-Key
   |  2. INSERT payment        transmise aussi)
   |  3. appel PSP                 |
   |  4. UPDATE + outbox           | webhooks
   v     (1 transaction)           v
[ Postgres ] <------- [ webhook receiver ]
   |                    vérif signature,
   | outbox             INSERT event, 200
   v
[ relais outbox ] --> [ queue ] --> orders,
                                    emails…
[ job de réconciliation ] (quotidien)
   compare rapports PSP <-> payments/ledger
```

## Deep dive : la clé d'idempotence

Le déroulé côté serveur :

```text
1. INSERT (user, key, hash, 'in_progress')
   ON CONFLICT DO NOTHING
2. Si la ligne existait déjà :
   - hash différent       -> 422
   - 'in_progress'        -> 409 (réessaie plus tard)
   - 'completed'          -> renvoyer la réponse stockée
3. Sinon : traiter, puis stocker la réponse
   et passer à 'completed'
```

En TypeScript (Node + `pg`), simplifié :

```ts
async function withIdempotency(
  db: Pool, userId: string, key: string, body: unknown,
  run: () => Promise<{ code: number; body: unknown }>,
) {
  const hash = sha256(stableStringify(body));
  const ins = await db.query(
    `INSERT INTO idempotency_keys
       (user_id, key, request_hash, status)
     VALUES ($1, $2, $3, 'in_progress')
     ON CONFLICT DO NOTHING`,
    [userId, key, hash],
  );
  if (ins.rowCount === 0) {
    const { rows: [row] } = await db.query(
      `SELECT * FROM idempotency_keys
       WHERE user_id = $1 AND key = $2`, [userId, key]);
    if (row.request_hash !== hash) {
      return { code: 422, body: KEY_REUSED };
    }
    if (row.status === "in_progress") {
      return { code: 409, body: IN_PROGRESS };
    }
    return { code: row.response_code, body: row.response_body };
  }
  const res = await run();
  await db.query(
    `UPDATE idempotency_keys
     SET status = 'completed', response_code = $3,
         response_body = $4
     WHERE user_id = $1 AND key = $2`,
    [userId, key, res.code, res.body],
  );
  return res;
}
```

Subtilités à mentionner :

- Si le process crashe pendant `run()`, la clé reste `in_progress` pour toujours. Il faut une **reprise** : au-delà d'un délai (ex. 1 min), on considère la clé abandonnée et on reprend en vérifiant l'état réel du paiement (chez nous et chez le PSP).
- On ne stocke la réponse que pour les résultats **définitifs**. Une erreur 500 transitoire ne doit pas être figée : on supprime la clé pour permettre le retry.
- Les clés expirent (24 h à quelques jours) : un job les purge.

## Deep dive : appeler le PSP

On transmet **notre propre** clé d'idempotence au PSP : la plupart des PSP sérieux l'acceptent (Stripe : en-tête `Idempotency-Key`, conservé au moins 24 h). Ainsi, si **nous** réessayons l'appel, le PSP renvoie le même résultat sans débiter à nouveau.

```text
API -> PSP : create charge (key = pay_77)
     ... timeout après 10 s ...
Le débit a-t-il eu lieu ?  ON NE SAIT PAS.
```

Le **timeout ambigu** est le cœur du sujet :

- ❌ Marquer `failed` : le client a peut-être été débité → il réessaie → double débit (si la clé change) ou commande jamais expédiée.
- ✅ Marquer `unknown`, puis **réessayer avec la même clé** (sans risque grâce à l'idempotence côté PSP), ou **interroger** le PSP (`GET payment by our reference`), et attendre le webhook. L'utilisateur voit « paiement en cours de vérification ».

En Rust, ce modèle se traduit bien par un enum qui force à traiter le cas ambigu :

```rust
enum PspOutcome {
    Succeeded { psp_id: String },
    Declined { reason: String },     // définitif
    RequiresAction { url: String },  // 3-D Secure
    Unknown,                         // timeout, 5xx
}
```

Un `match` exhaustif interdit d'oublier `Unknown`. Voir l'exercice de machine à états dans [Défis Rust](/interview/02-pratique/02-defis-rust).

## Deep dive : webhooks

Le PSP notifie les changements d'état (`payment.succeeded`, `charge.refunded`, `dispute.created`). Règles :

1. **Vérifier la signature** (HMAC du body brut avec le secret partagé, + timestamp pour éviter le rejeu). Sans ça, n'importe qui peut poster « paiement réussi ».
2. **Dédupliquer** par `psp_event_id` : `INSERT INTO webhook_events ... ON CONFLICT DO NOTHING`. Si 0 ligne insérée → déjà reçu → `200` direct.
3. **Répondre vite** (2xx en < quelques secondes) et traiter de façon asynchrone. Sinon le PSP considère l'envoi échoué et réessaie.
4. **Ordre non garanti** : `succeeded` peut arriver avant `requires_action`. Appliquer une machine à états qui **refuse de régresser** :

```sql
UPDATE payments
SET status = 'succeeded', updated_at = now()
WHERE psp_payment_id = $1
  AND status IN ('pending', 'requires_action', 'unknown');
-- 0 ligne : déjà dans un état final, on ignore
```

En cas de doute sur le contenu, on peut aussi traiter le webhook comme un simple **signal** : on relit l'objet à jour via l'API du PSP plutôt que de faire confiance au payload.

## Deep dive : outbox

Quand le paiement réussit, il faut **à la fois** mettre à jour `payments` **et** prévenir le service `orders`. Faire `UPDATE` puis `queue.publish()` laisse une fenêtre où l'un réussit et pas l'autre.

```sql
BEGIN;
UPDATE payments SET status = 'succeeded' WHERE id = $1;
INSERT INTO outbox (topic, payload)
VALUES ('payment.succeeded',
        jsonb_build_object('paymentId', $1,
                           'orderId', $2));
COMMIT;
```

Un relais lit `outbox` en continu (`SELECT ... WHERE published_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`), publie, puis marque `published_at`. S'il crashe entre la publication et le marquage, il republiera : la livraison est **au moins une fois**, donc les consommateurs (`orders`) doivent eux aussi être idempotents (dédup par `paymentId`). Alternative sans relais maison : CDC (Debezium) qui lit le WAL de Postgres.

## Deep dive : réconciliation et ledger

Même avec tout ça, des écarts arrivent (bug, incident chez le PSP, webhook perdu après 3 jours de retries). Un **job quotidien** compare :

```text
rapport de règlement du PSP (CSV/API)
            <->
nos payments + refunds de la veille
écarts : présent chez le PSP mais pas chez nous,
         montant différent, statut différent
-> file de traitement manuel + alerte
```

Pour la comptabilité, on ajoute souvent un **ledger** en partie double : chaque mouvement est une écriture immuable qui débite un compte et en crédite un autre, et la somme est toujours nulle.

```sql
CREATE TABLE ledger_entries (
  id           bigserial PRIMARY KEY,
  tx_id        uuid NOT NULL,     -- regroupe les lignes
  account      text NOT NULL,     -- 'customer:42', 'psp:stripe'
  amount_cents bigint NOT NULL,   -- + crédit / - débit
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- invariant vérifiable : par tx_id, sum(amount_cents) = 0
```

On ne fait jamais d'`UPDATE` d'un montant : une erreur se corrige par une **écriture inverse**. Le défi « Soldes par compte » de [Défis TypeScript](/interview/02-pratique/01-defis-typescript) est une version jouet de ce calcul.

## Points de défaillance

| Situation | Réponse |
| --- | --- |
| Double clic / retry client | Clé d'idempotence |
| Timeout vers le PSP | `unknown` + retry même clé |
| Crash après débit PSP | Webhook + réconciliation |
| Webhook dupliqué | Dédup `psp_event_id` |
| Webhook désordonné | Transitions non régressives |
| Queue en panne | Outbox, rien n'est perdu |
| PSP en panne | Message clair, 2e PSP (option) |

## Questions de relance

::: details « Pourquoi ne pas simplement désactiver le bouton après le clic ? »
C'est une bonne pratique UX, mais ça ne couvre ni les retries réseau de l'app, ni les retries de notre serveur vers le PSP, ni les webhooks dupliqués. La protection doit être **côté serveur** ; le front n'est qu'une première ligne.
:::

::: details « Une transaction de base de données autour de l'appel au PSP, ça règle le problème ? »
Non. Le PSP n'est pas dans ta transaction : si tu fais `BEGIN; appel PSP; COMMIT` et que le `COMMIT` échoue, le client est débité et tu n'as aucune trace. Et tu gardes une transaction (et des verrous) ouverte pendant un appel réseau de plusieurs secondes. Le bon schéma : écrire l'intention (`pending`) et la valider **avant** l'appel, appeler le PSP **hors** transaction, puis écrire le résultat dans une seconde transaction.
:::

::: details « Exactement une fois, c'est possible ? »
Pas en livraison de messages entre systèmes. On obtient un **effet** exactement une fois en combinant livraison au moins une fois et traitement idempotent (dédup par clé, contraintes d'unicité, transitions conditionnelles). C'est la phrase à placer.
:::

::: details « Comment gérer un remboursement partiel en double ? »
Même mécanisme : clé d'idempotence sur `POST /refunds`, transmise au PSP. Et un invariant en base : la somme des remboursements ≤ montant payé, vérifié dans la transaction avec un verrou sur le paiement (`SELECT ... FOR UPDATE`) ou une contrainte calculée. Sans verrou, deux remboursements concurrents de 30 € sur un paiement de 50 € passent tous les deux.
:::

::: details « Que fait le client quand il reçoit un 409 "en cours" ? »
Il attend un peu et réessaie **avec la même clé**, ou interroge `GET /payments/{id}`. Côté UX : un écran « paiement en cours ». Il ne doit surtout pas générer une nouvelle clé, ce qui créerait une nouvelle intention de paiement.
:::

::: details « Où mettre le code de paiement : monolithe ou service à part ? »
Un module bien isolé (ports/adaptateurs) dans le monolithe suffit au début. Un service séparé se justifie pour isoler le périmètre de conformité (PCI, audit), avoir des déploiements plus prudents, ou une équipe dédiée. Dans les deux cas, le contrat est le même : API idempotente + événements via outbox.
:::

## Pièges classiques

- Générer la clé d'idempotence **côté serveur** à chaque requête (elle ne protège alors de rien).
- Traiter un timeout comme un échec.
- Appeler le PSP à l'intérieur d'une transaction SQL.
- Faire confiance à un webhook non signé, ou le traiter de façon synchrone et lente.
- Laisser un webhook tardif faire régresser un statut (`succeeded` → `pending`).
- Montants en `float` ; `UPDATE` d'un montant au lieu d'une écriture inverse.
- Pas de réconciliation : on découvre les écarts quand la comptabilité appelle.

## Défis

1. Le client envoie `POST /payments` avec la clé K. Le serveur débite chez le PSP, puis crashe avant d'enregistrer la réponse. Le client réessaie avec K. Déroule ce qui se passe dans ta conception.
2. Écris la requête SQL qui crée un remboursement **seulement si** la somme des remboursements existants plus le nouveau ne dépasse pas le montant payé (table `refunds(payment_id, amount_cents)`).
3. Pourquoi la clé d'idempotence est-elle stockée avec un `request_hash` ? Donne un scénario où il évite un bug.

::: details Solution
1. La clé K est `in_progress` (le crash a eu lieu avant `completed`). Le retry reçoit `409`. Après le délai d'abandon, la reprise voit `payments.status = 'pending'` et rappelle le PSP **avec la même clé** (`pay_77`) : le PSP renvoie le résultat du premier débit, sans en refaire un. On enregistre `succeeded`, on complète la clé ; le retry suivant du client reçoit la réponse stockée. Et en filet de sécurité : le webhook `payment.succeeded` et la réconciliation.
2. Avec un verrou sur la ligne du paiement pour sérialiser les remboursements concurrents :

```sql
BEGIN;
SELECT amount_cents FROM payments
WHERE id = $1 AND status = 'succeeded'
FOR UPDATE;

INSERT INTO refunds (payment_id, amount_cents)
SELECT $1, $2
WHERE (SELECT coalesce(sum(amount_cents), 0)
       FROM refunds WHERE payment_id = $1) + $2
   <= (SELECT amount_cents FROM payments
       WHERE id = $1);
-- 0 ligne insérée -> 422 montant trop élevé
COMMIT;
```

3. Un client bogué réutilise la même clé pour deux paiements différents (49,90 € puis 120 €). Sans hash, le second recevrait la réponse du premier (« succeeded 49,90 € ») et croirait avoir payé 120 €. Avec le hash, il reçoit une erreur explicite (422) et le bug est visible.
:::

## À retenir

- Le volume est faible ; la difficulté est la **correction sous pannes**.
- Clé d'idempotence générée par le client, scopée par utilisateur, avec hash de la requête et réponse stockée.
- Transmettre la clé au PSP ; un timeout est un état `unknown`, jamais un échec.
- Webhooks : signature, dédup par id d'événement, réponse rapide, transitions non régressives.
- Outbox pour publier les événements de façon fiable ; consommateurs idempotents.
- Contraintes en base comme filet de sécurité, ledger immuable, réconciliation quotidienne.
