# Transactions & isolation

Ce que tu vas apprendre : ce que garantit (et ne garantit pas) une transaction, comment Postgres gère la concurrence avec MVCC, quelles anomalies chaque niveau d'isolation laisse passer, et les patterns de prod : `FOR UPDATE`, file de jobs `SKIP LOCKED`, optimistic locking, débit de solde et réservation de stock sans race condition.

## ACID, version courte

| Lettre | Garantie | Concrètement |
|---|---|---|
| **A**tomicité | tout ou rien | la commande et ses items sont créés ensemble, ou rien |
| **C**ohérence | les contraintes sont respectées au commit | `CHECK (stock >= 0)` ne sera jamais violé |
| **I**solation | les transactions concurrentes ne se marchent pas dessus… | …**selon le niveau choisi** |
| **D**urabilité | un `COMMIT` confirmé survit à un crash | grâce au WAL, écrit sur disque avant de répondre |

Le « I » est le seul qui se règle, et c'est là que vivent les bugs.

```sql
BEGIN;
INSERT INTO orders (tenant_id, user_id, total)
VALUES (1, 2, 74.30) RETURNING id;
INSERT INTO order_items VALUES (10, 1, 2, 19.90),
                               (10, 2, 1, 34.50);
COMMIT;   -- ou ROLLBACK : rien n'a existé
```

Sans `BEGIN`, chaque instruction est sa propre transaction (*autocommit*). Une seule instruction `UPDATE` est donc déjà atomique, même si elle touche un million de lignes.

## MVCC : comment Postgres fait cohabiter lecteurs et écrivains

Postgres ne modifie jamais une ligne en place. Un `UPDATE` crée une **nouvelle version** de la ligne (un *tuple*) et marque l'ancienne comme périmée. Chaque tuple porte `xmin` (la transaction qui l'a créé) et `xmax` (celle qui l'a supprimé/remplacé).

```
products id=1
  tuple A  xmin=100  xmax=205  stock=120   ← vu par les snapshots < 205
  tuple B  xmin=205  xmax=0    stock=118   ← version courante
```

Chaque requête (ou transaction, selon le niveau) lit avec un **snapshot** : « les transactions commitées avant moi ». Résultat :

- **Les lecteurs ne bloquent jamais les écrivains, et inversement.**
- Deux écrivains sur la **même ligne** se bloquent : le second attend le commit ou rollback du premier.
- Les anciennes versions s'accumulent : c'est le travail de `VACUUM` de les nettoyer ([Postgres avancé](/bdd/05-postgres-avance)). Une transaction ouverte pendant des heures empêche ce nettoyage.

## Les anomalies

| Anomalie | Ce qui se passe |
|---|---|
| Dirty read | lire une donnée non commitée (qui sera peut-être annulée) |
| Non-repeatable read | relire une ligne et obtenir une autre valeur |
| Phantom read | relancer un `WHERE` et obtenir d'autres lignes |
| Lost update | deux read-modify-write, le second écrase le premier |
| Write skew | deux transactions lisent un état, écrivent des lignes différentes, et l'invariant global casse |

### Lost update, le classique

```ts
// ✗ le code calcule le nouveau stock
const { stock } = await db.one(
  "SELECT stock FROM products WHERE id = $1", [id]);
await db.query(
  "UPDATE products SET stock = $1 WHERE id = $2",
  [stock - qty, id]);
```

```
T1: SELECT stock → 15
T2: SELECT stock → 15
T1: UPDATE stock = 14    (vend 1)
T2: UPDATE stock = 13    (vend 2)  → le stock devrait être 12
```

Trois correctifs, du plus simple au plus général :

```sql
-- 1. laisser la base calculer (atomique)
UPDATE products SET stock = stock - $1
WHERE id = $2 AND stock >= $1
RETURNING stock;            -- 0 ligne = stock insuffisant

-- 2. verrouiller la ligne pendant la transaction
SELECT stock FROM products WHERE id = $1 FOR UPDATE;

-- 3. optimistic locking (voir plus bas)
```

### Write skew : l'anomalie sournoise

Règle métier : « un tenant doit toujours avoir au moins un admin ». Eve et Zoe sont admins de globex. Chacune se rétrograde en même temps :

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT count(*) FROM users
WHERE tenant_id = 2 AND role = 'admin'
  AND deleted_at IS NULL;          -- 2 → ok, je peux partir
UPDATE users SET role = 'staff' WHERE id = :me;
COMMIT;
```

Les deux voient « 2 admins », chacune modifie **sa propre** ligne : aucun conflit d'écriture, les deux commitent. Résultat (vérifié) : plus aucun admin. Seul `SERIALIZABLE` détecte ça :

```
ERROR: could not serialize access due to read/write
       dependencies among transactions
HINT:  The transaction might succeed if retried.
```

## Les niveaux d'isolation dans Postgres

| Niveau | Snapshot | Laisse passer |
|---|---|---|
| `READ COMMITTED` (défaut) | par **instruction** | non-repeatable, phantom, lost update (read-modify-write applicatif), write skew |
| `REPEATABLE READ` | par **transaction** | write skew |
| `SERIALIZABLE` | par transaction + détection | rien (au prix de retries) |

Particularités Postgres à connaître :

- Le dirty read n'existe **jamais** (`READ UNCOMMITTED` se comporte comme `READ COMMITTED`).
- `REPEATABLE READ` est en réalité du *snapshot isolation* : pas de phantom non plus. Si une ligne que tu modifies a été modifiée par une transaction commitée après ton snapshot, tu prends `could not serialize access due to concurrent update` : le lost update est détecté, pas silencieux.
- En `READ COMMITTED`, un `UPDATE` qui attend un verrou **réévalue** son `WHERE` sur la nouvelle version de la ligne. C'est ce qui rend `SET stock = stock - 1 WHERE stock >= 1` sûr.
- `SERIALIZABLE` (SSI) ne bloque pas plus : il laisse tourner et **annule** une transaction au commit s'il détecte un cycle. Ton code **doit** retenter sur `SQLSTATE 40001` (et `40P01`, deadlock).

```ts
// retry générique sur erreurs de sérialisation
async function withRetry<T>(fn: () => Promise<T>, n = 3) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e: any) {
      const retryable = ["40001", "40P01"].includes(e.code);
      if (!retryable || i >= n) throw e;
      await new Promise((r) => setTimeout(r, 2 ** i * 20));
    }
  }
}
```

::: tip Quel niveau choisir ?
`READ COMMITTED` + écritures atomiques et `FOR UPDATE` couvre 90 % des cas. `REPEATABLE READ READ ONLY` pour un rapport qui doit être cohérent sur plusieurs requêtes. `SERIALIZABLE` quand un invariant porte sur **plusieurs lignes** et que tu ne veux pas raisonner verrou par verrou. MySQL a un autre défaut et d'autres règles : voir [MySQL](/bdd/06-mysql).
:::

## Verrous explicites

```sql
SELECT … FOR UPDATE;          -- je vais modifier : exclusif
SELECT … FOR NO KEY UPDATE;   -- idem, mais n'empêche pas
                              -- les FK de référencer la ligne
SELECT … FOR SHARE;           -- personne ne modifie pendant
                              -- que je lis
SELECT … FOR UPDATE NOWAIT;   -- erreur immédiate si verrouillé
SELECT … FOR UPDATE SKIP LOCKED;  -- ignore les lignes verrouillées
```

Les verrous de ligne durent jusqu'à la fin de la transaction. Règle d'or : **une transaction courte**. Jamais d'appel HTTP (Stripe, email) pendant qu'on tient un verrou.

### Deadlocks

```
T1: UPDATE products … WHERE id = 1   (verrouille 1)
T2: UPDATE products … WHERE id = 2   (verrouille 2)
T1: UPDATE products … WHERE id = 2   (attend T2)
T2: UPDATE products … WHERE id = 1   (attend T1) → cycle
```

Postgres détecte le cycle après `deadlock_timeout` (1 s par défaut) et tue l'une des deux :

```
ERROR:  deadlock detected
DETAIL: Process 177 waits for ShareLock on transaction 1043;
        blocked by process 178.
```

Prévention : **toujours verrouiller dans le même ordre** (trier par id). Et retenter sur `40P01`.

## File de jobs avec SKIP LOCKED

Pas besoin de Redis ou RabbitMQ pour une file de jobs fiable à quelques centaines de jobs/s : Postgres suffit, et les jobs sont créés dans **la même transaction** que la donnée métier.

```sql
CREATE TABLE jobs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queue      text NOT NULL DEFAULT 'default',
  payload    jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'queued'
             CHECK (status IN ('queued', 'running',
                               'done', 'failed')),
  attempts   int NOT NULL DEFAULT 0,
  run_at     timestamptz NOT NULL DEFAULT now(),
  locked_at  timestamptz,
  last_error text
);
CREATE INDEX jobs_ready_idx ON jobs (queue, run_at)
  WHERE status = 'queued';
```

Chaque worker réclame un job :

```sql
UPDATE jobs SET status = 'running',
       attempts = attempts + 1,
       locked_at = now()
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'queued' AND queue = 'default'
    AND run_at <= now()
  ORDER BY run_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING id, payload;
```

Testé avec 3 workers en parallèle : chacun reçoit un job différent, aucun n'attend. Sans `SKIP LOCKED`, les trois se battent pour la même première ligne et s'exécutent l'un après l'autre. Sans `FOR UPDATE`, deux workers peuvent prendre le même job.

Deux stratégies :

- **Commit immédiat** (`running`), traitement hors transaction, puis `UPDATE … SET status = 'done'`. Il faut un *reaper* qui remet en `queued` les jobs `running` dont `locked_at` est trop vieux (worker crashé). Garantie : *at-least-once* → le traitement doit être **idempotent**.
- **Transaction ouverte** pendant le traitement : si le worker meurt, le verrou saute et le job redevient disponible. Simple, mais seulement pour des jobs courts (une transaction longue bloque VACUUM et occupe une connexion).

Des libs existantes font ça très bien : pg-boss / Graphile Worker (Node), apalis (Rust), River (Go).

## Optimistic locking

Le back-office : un employé ouvre la fiche produit, part déjeuner, revient, enregistre. Entre-temps, un collègue a changé le prix. Un verrou pendant 1 h est impensable. On ajoute une colonne `version` :

```sql
ALTER TABLE products
  ADD COLUMN version int NOT NULL DEFAULT 0;

-- le formulaire a été chargé avec version = 0
UPDATE products
SET price = 21.00, version = version + 1
WHERE id = 1 AND version = 0
RETURNING version;
```

1 ligne → succès. 0 ligne → quelqu'un a modifié entre-temps : l'API renvoie `409 Conflict` et l'UI recharge. En HTTP, ça se mappe naturellement sur `ETag` / `If-Match`.

Optimiste (version) quand les conflits sont rares et les « transactions » longues côté humain. Pessimiste (`FOR UPDATE`) quand les conflits sont fréquents et l'opération courte.

## Cas réel

**Contexte** : le checkout d'une boutique en pleine vente flash. Il faut (1) réserver le stock de plusieurs produits, (2) créer la commande, (3) débiter le portefeuille du client (avoir/crédit), sans jamais survendre, sans double débit si le client double-clique.

**Réserver le stock sans deadlock** : verrouiller les produits **dans l'ordre des ids**, puis décrémenter.

```sql
BEGIN;
SELECT id, stock FROM products
WHERE id = ANY($1::bigint[])
ORDER BY id
FOR UPDATE;

UPDATE products p
SET stock = p.stock - c.qty
FROM (VALUES (1::bigint, 2), (2, 1)) AS c (product_id, qty)
WHERE p.id = c.product_id
  AND p.stock >= c.qty
RETURNING p.id, p.stock;
-- si moins de lignes que de produits → ROLLBACK
```

Le `CHECK (stock >= 0)` reste le filet de sécurité si le code a un bug.

**Débiter le solde, une seule fois** : un *ledger* (journal d'écritures) avec une clé d'idempotence, plus un solde dénormalisé.

```sql
CREATE TABLE wallets (
  user_id bigint PRIMARY KEY REFERENCES users (id),
  balance numeric(12, 2) NOT NULL DEFAULT 0
          CHECK (balance >= 0)
);
CREATE TABLE wallet_entries (
  id              bigint GENERATED ALWAYS AS IDENTITY
                  PRIMARY KEY,
  user_id         bigint NOT NULL REFERENCES wallets,
  amount          numeric(12, 2) NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

```sql
WITH entry AS (
  INSERT INTO wallet_entries
    (user_id, amount, idempotency_key)
  VALUES (2, -30.00, 'checkout-7f3a')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING user_id, amount
)
UPDATE wallets w
SET balance = w.balance + e.amount
FROM entry e
WHERE w.user_id = e.user_id
RETURNING w.balance;
```

Ce que ça garantit (testé) :

- Rejouée avec la même clé : `ON CONFLICT DO NOTHING` → `entry` vide → aucune mise à jour, 0 ligne renvoyée. Le double-clic ne débite pas deux fois.
- Solde insuffisant : le `CHECK (balance >= 0)` échoue, **toute** l'instruction est annulée, y compris l'insert dans le ledger.
- Deux débits concurrents : le second `UPDATE` attend le verrou de ligne, puis recalcule `balance + amount` sur la nouvelle valeur.
- Le ledger permet de recalculer et d'auditer : `balance = sum(amount)` est un contrôle de réconciliation.

Le tout dans **une** transaction avec la création de la commande, et l'appel à Stripe **après** le commit (avec sa propre clé d'idempotence, voir [Paiements & idempotence](/interview/03-system-design/05-paiements-idempotence)).

## Pièges classiques

- Read-modify-write côté application (`SELECT` puis `UPDATE … SET x = $calculé`).
- Croire que `REPEATABLE READ` protège des invariants multi-lignes (write skew).
- `SERIALIZABLE` sans boucle de retry : erreurs 40001 en prod.
- Appel réseau externe dans une transaction qui tient des verrous.
- Verrouiller des lignes dans un ordre variable → deadlocks sous charge.
- Sessions `idle in transaction` oubliées (une connexion ORM jamais commitée) : verrous tenus, VACUUM bloqué. Garde-fou : `idle_in_transaction_session_timeout`.
- File de jobs sans `SKIP LOCKED`, ou sans reaper, ou avec des handlers non idempotents.
- Oublier que `SELECT … FOR UPDATE` sans transaction explicite relâche le verrou aussitôt (autocommit).

## Défis

**1. Quelle anomalie ?** Deux requêtes HTTP exécutent ce code en même temps pour le même produit (stock = 15), l'une avec `qty = 1`, l'autre avec `qty = 2`. Quel stock final possible ? Corrige en une requête.

```ts
const p = await db.one(
  "SELECT stock FROM products WHERE id = $1", [id]);
if (p.stock < qty) throw new OutOfStock();
await db.query("UPDATE products SET stock = $1 WHERE id = $2",
  [p.stock - qty, id]);
```

::: details Solution
**Lost update** : les deux lisent 15, l'un écrit 14, l'autre 13. Stock final 14 ou 13 au lieu de 12 : on a vendu 3 unités et n'en a décompté que 1 ou 2. Même `REPEATABLE READ` ne suffit pas sans retry (il lèverait une erreur de sérialisation).

```sql
UPDATE products SET stock = stock - $1
WHERE id = $2 AND stock >= $1
RETURNING stock;
```

0 ligne renvoyée → `OutOfStock`. En `READ COMMITTED`, la seconde transaction attend le verrou de ligne, puis réévalue `stock >= $1` sur la valeur à jour.
:::

**2. Le dernier admin.** La règle « au moins un admin par tenant » a été violée (voir le write skew plus haut). Propose deux correctifs **sans** passer toute l'app en `SERIALIZABLE`.

::: details Solution
1. **Verrouiller l'ensemble lu** : `SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' AND deleted_at IS NULL FOR UPDATE`, puis compter. La seconde transaction attend, puis voit 1 admin et refuse. (En `READ COMMITTED`, après l'attente, `FOR UPDATE` relit les lignes à jour et exclut celle qui n'est plus admin.)
2. **Verrouiller un parent commun** : `SELECT … FROM tenants WHERE id = $1 FOR UPDATE` au début de toute opération qui modifie les rôles du tenant. Toutes les modifications de rôles d'un tenant sont sérialisées. Simple et lisible.

Troisième option : passer **cette transaction seulement** en `SERIALIZABLE` avec retry. Toutes les transactions concurrentes qui touchent ces lignes doivent alors aussi être `SERIALIZABLE` pour que la détection fonctionne.
:::

**3. Rapport incohérent.** Un export compta fait deux requêtes successives en `READ COMMITTED` : `SELECT count(*), sum(total) FROM orders WHERE …` puis `SELECT * FROM orders WHERE …`. Le comptable trouve 1 203 commandes dans l'en-tête mais 1 204 lignes dans le détail. Quelle anomalie, quel correctif ?

::: details Solution
En `READ COMMITTED`, chaque **instruction** a son snapshot : une commande commitée entre les deux requêtes apparaît dans la seconde (phantom / non-repeatable read au niveau de la transaction).

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT count(*), sum(total) FROM orders WHERE …;
SELECT * FROM orders WHERE …;
COMMIT;
```

Les deux requêtes voient le même snapshot. `READ ONLY` documente l'intention et évite toute erreur de sérialisation. Pour un très gros export, fais-le sur un réplica ([Choisir & scaler](/bdd/09-choisir-et-scaler)).
:::

**4. Deadlock au checkout.** Le panier A contient les produits [1, 2], le panier B [2, 1]. Le code fait un `UPDATE … SET stock = stock - qty` par item, dans l'ordre du panier. Que se passe-t-il en vente flash, et comment corriger ?

::: details Solution
A verrouille 1, B verrouille 2, A attend 2, B attend 1 → `deadlock detected` après 1 s : une transaction est tuée, et les deux clients ont attendu.

Correctif : verrouiller dans un **ordre global** : `SELECT id FROM products WHERE id = ANY($1) ORDER BY id FOR UPDATE`, puis les `UPDATE`. Ou trier les items par `product_id` avant de boucler. Et ajouter un retry sur `40P01` par sécurité.
:::

**5. Le worker qui crashe.** Ton worker fait : réclamer un job (`status = 'running'`, commit), appeler l'API d'envoi d'email, `status = 'done'`. Le pod est tué pendant l'appel. Que devient le job ? Écris la requête du reaper. Quelle propriété doit avoir le handler ?

::: details Solution
Le job reste `running` à jamais. Reaper périodique :

```sql
UPDATE jobs
SET status = 'queued', locked_at = NULL,
    run_at = now() + interval '30 seconds'
WHERE status = 'running'
  AND locked_at < now() - interval '5 minutes'
RETURNING id;
```

Le job sera retraité, peut-être alors que l'email était parti : la file est **at-least-once**. Le handler doit être **idempotent** (clé d'idempotence côté fournisseur d'email, ou table `sent_emails` avec contrainte unique). Ajoute un plafond : `attempts >= 5` → `failed`.
:::

**6. Double débit.** Le client clique deux fois sur « Payer avec mon avoir ». Écris la transaction qui débite 30 € du portefeuille du user 2 une seule fois, et échoue proprement si le solde est insuffisant.

::: details Solution
```sql
WITH entry AS (
  INSERT INTO wallet_entries
    (user_id, amount, idempotency_key)
  VALUES (2, -30.00, $1)       -- clé générée par le front
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING user_id, amount
)
UPDATE wallets w
SET balance = w.balance + e.amount
FROM entry e
WHERE w.user_id = e.user_id
RETURNING w.balance;
```

Second clic, même clé : 0 ligne, aucun débit ; l'API renvoie la réponse du premier appel. Solde insuffisant : `violates check constraint "wallets_balance_check"`, rien n'est écrit (l'instruction est atomique). La clé d'idempotence doit être générée **une fois** par intention de paiement (au chargement de la page), pas à chaque clic.
:::

**7. Que fait ce code ?** Pourquoi les autres requêtes sur cette commande se mettent à timeout en prod ?

```ts
await db.tx(async (t) => {
  const o = await t.one(
    "SELECT * FROM orders WHERE id = $1 FOR UPDATE", [id]);
  const charge = await stripe.paymentIntents.create({…});
  await t.query("UPDATE orders SET status = 'paid' …");
});
```

::: details Solution
Le verrou sur la commande est tenu **pendant l'appel réseau à Stripe** (100 ms en temps normal, 30 s quand Stripe ralentit). Tout ce qui touche cette ligne attend ; la connexion est monopolisée ; le pool s'épuise ; toute l'API tombe.

Correctif : sortir l'appel externe de la transaction. 1) transaction courte : `status = 'payment_pending'` + clé d'idempotence ; 2) appel Stripe hors transaction ; 3) transaction courte : `status = 'paid'` (ou via le webhook). Les états intermédiaires sont explicites et récupérables.
:::

## À retenir

- Postgres : MVCC, les lecteurs ne bloquent pas les écrivains ; deux écrivains sur la même ligne, si.
- Défaut `READ COMMITTED` : snapshot par instruction. Les read-modify-write côté app perdent des mises à jour.
- Écritures atomiques (`SET x = x - 1 WHERE x >= 1`) et contraintes d'abord ; `FOR UPDATE` ensuite ; `SERIALIZABLE` + retry pour les invariants multi-lignes.
- Verrous dans un ordre fixe, transactions courtes, jamais d'appel réseau dedans.
- `FOR UPDATE SKIP LOCKED` = file de jobs fiable dans Postgres, at-least-once → handlers idempotents.
- Optimistic locking (`version`) pour les éditions humaines longues.
