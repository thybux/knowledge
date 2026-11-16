# Choisir & scaler

Ce que tu vas apprendre : choisir une base de données avec de vrais critères, puis la faire tenir quand le trafic grimpe. Réplicas de lecture et leur lag, sharding, cache Redis (cache-aside, invalidation, stampede), CQRS léger et outbox pattern pour publier des événements sans en perdre.

## Choisir sa BDD

La première question n'est pas « laquelle est la plus rapide ? », mais « **quelle forme ont mes données et mes accès ?** », suivie de « **qu'est-ce que mon équipe sait opérer ?** ».

| Besoin | Choix par défaut | Pourquoi |
|---|---|---|
| App métier, SaaS, paiements | **PostgreSQL** | relations, contraintes, transactions, SQL riche |
| Écosystème PHP/legacy, Vitess | **MySQL** | maturité, outillage, sharding Vitess |
| Documents hétérogènes, accès par document | **MongoDB** | schéma flexible, sharding natif |
| Cache, sessions, rate limiting, files simples | **Redis** (ou Valkey) | mémoire, structures de données, TTL |
| Analytique sur des milliards de lignes | **ClickHouse**, BigQuery, DuckDB | stockage colonne, agrégats massifs |
| Recherche plein texte avancée | **OpenSearch**, Meilisearch | pertinence, facettes, typo-tolérance |
| Clé-valeur à très grande échelle | **DynamoDB**, Cassandra | partitionnement massif, latence stable |
| Embarqué, outil local, CLI | **SQLite** | un fichier, zéro serveur |

Règles pratiques :

- **Commence par Postgres** si rien ne s'y oppose. JSONB, full-text, `pgvector`, files de jobs `SKIP LOCKED`, `LISTEN/NOTIFY` : il couvre beaucoup de besoins « spécialisés » jusqu'à une échelle respectable.
- Ajoute une base spécialisée **quand un besoin mesuré l'impose**, et alimente-la depuis la source de vérité (outbox, CDC), pas par des écritures doubles dans le code.
- Chaque base en plus = backups, monitoring, montée de version, astreinte. C'est le vrai coût.

## Scaler verticalement d'abord

Avant de distribuer : une machine plus grosse, des index corrects ([chapitre 3](/bdd/03-index-et-explain)), un pooler ([chapitre 5](/bdd/05-postgres-avance)), `pg_stat_statements` pour traquer les 10 requêtes qui coûtent le plus. Un seul Postgres bien réglé sur une grosse instance encaisse des dizaines de milliers de requêtes simples par seconde et plusieurs To de données. La plupart des SaaS n'ont jamais besoin de sharder.

## Réplication et read replicas

Le primaire envoie son WAL aux réplicas (*streaming replication*), qui le rejouent. Les réplicas sont en **lecture seule**.

```
           écritures
App ──────────────────► Primaire ──WAL──► Réplica 1 (lectures)
  └───── lectures ─────────────────────► Réplica 2 (lectures)
```

Usages : décharger les lectures lourdes (rapports, exports, recherche), haute disponibilité (un réplica promu si le primaire tombe), backups sans charger le primaire.

- **Asynchrone** (défaut) : le commit n'attend pas le réplica. Rapide, mais un failover peut perdre les dernières transactions.
- **Synchrone** (`synchronous_standby_names` + `synchronous_commit`) : le commit attend un ou plusieurs réplicas. Aucune perte, mais chaque écriture paie l'aller-retour réseau.

### Le lag et le « read-your-writes »

Un réplica a toujours un peu de retard : quelques ms en temps normal, des secondes ou des minutes sous charge, pendant un gros backfill ou un VACUUM massif.

```sql
-- sur le primaire
SELECT application_name, state, replay_lag
FROM pg_stat_replication;

-- sur le réplica
SELECT now() - pg_last_xact_replay_timestamp() AS lag;
```

Le bug classique : le client modifie son adresse (écrit sur le primaire), est redirigé vers la page profil (lue sur le réplica)… et voit l'ancienne adresse. Parades :

- **Lire sur le primaire juste après une écriture** : pendant N secondes après une écriture, les requêtes de cet utilisateur vont au primaire (cookie ou flag de session).
- **Router par criticité** : tout ce qui est transactionnel (panier, paiement, stock) lit sur le primaire ; les réplicas servent le catalogue, les rapports, la recherche.
- **Attendre une position WAL** : renvoyer au client le LSN de son écriture (`pg_current_wal_lsn()`), et ne lire sur un réplica que s'il a rejoué au moins jusque-là (`pg_last_wal_replay_lsn()`).
- Ne jamais lire sur un réplica pour **décider d'une écriture** (« le stock est-il suffisant ? »).

Sur le réplica, une requête longue peut être annulée quand le rejeu du WAL doit supprimer des lignes qu'elle lit (`canceling statement due to conflict with recovery`). `hot_standby_feedback = on` l'évite, au prix de bloat sur le primaire.

## Sharding

Le sharding découpe les données sur **plusieurs bases indépendantes**, chacune avec ses écritures. C'est la seule façon de scaler les **écritures** au-delà d'une machine, et c'est un changement d'architecture lourd.

Le choix crucial : la **clé de sharding**. Pour un SaaS multi-tenant, `tenant_id` est presque toujours la bonne :

- toutes les données d'un tenant sont sur le même shard → les jointures et transactions restent locales ;
- la plupart des requêtes contiennent déjà `tenant_id` → routage direct.

Les problèmes qui arrivent :

| Problème | Exemple |
|---|---|
| Requêtes cross-shard | « CA total de tous les tenants » → interroger tous les shards et agréger |
| Tenant obèse (hot shard) | un client fait 30 % du trafic → shard dédié |
| Rééquilibrage | déplacer un tenant d'un shard à l'autre sans downtime |
| Unicité globale | un email unique *globalement* → table de routage ou service dédié |
| IDs | auto-incréments en collision → UUIDv7 ou ids préfixés par shard |

Outils : **Citus** (extension Postgres, distribue les tables par une colonne), **Vitess** (MySQL), sharding natif de **MongoDB**, ou sharding applicatif (une table `tenant → shard`, une chaîne de connexion par shard). Le sharding applicatif par tenant est souvent le plus simple à raisonner : chaque shard est un Postgres normal, avec le même schéma.

## Cache avec Redis

Le cache réduit la charge et la latence pour des données **lues souvent, modifiées rarement** : fiche produit, configuration d'un tenant, permissions d'un utilisateur. Il ajoute un problème : la cohérence.

### Cache-aside (lazy loading)

Le pattern par défaut : l'app lit le cache, et en cas d'absence lit la base puis remplit le cache.

```ts
async function getProduct(tenantId: number, id: number) {
  const key = `t:${tenantId}:product:${id}`;
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit) as Product;

  const product = await db.findProduct(tenantId, id);
  if (product) {
    // TTL avec jitter : évite les expirations simultanées
    const ttl = 300 + Math.floor(Math.random() * 60);
    await redis.set(key, JSON.stringify(product), "EX", ttl);
  }
  return product;
}
```

- Clé qui contient **le tenant** : un cache partagé sans `tenantId` dans la clé est une fuite de données en attente.
- **TTL toujours** : c'est le filet de sécurité si une invalidation est ratée.
- Ne mets pas en cache les données qui pilotent une décision transactionnelle (stock exact, solde).

### Invalidation

> Il n'y a que deux choses difficiles en informatique : l'invalidation de cache et nommer les choses. (Phil Karlton)

Après une écriture, **supprime** la clé (plutôt que de la réécrire) :

```ts
await db.updateProductPrice(tenantId, id, price);  // 1. base
await redis.del(`t:${tenantId}:product:${id}`);    // 2. cache
```

Pourquoi supprimer et pas mettre à jour : deux écritures concurrentes peuvent arriver au cache dans le désordre et y laisser la vieille valeur pour tout le TTL. Avec `DEL`, la prochaine lecture recharge la valeur à jour.

Il reste une fenêtre (une lecture lente qui remet une vieille valeur juste après le `DEL`) : le TTL la borne. Pour plus de fiabilité : invalidation pilotée par les événements (outbox, ci-dessous), ou **clé versionnée** (`product:42:v17`, la version étant incrémentée en base).

### Cache stampede

Une clé très demandée (la home d'un gros tenant) expire. 2 000 requêtes simultanées ratent le cache et lancent **toutes** la même requête lourde : la base s'effondre.

Parades :

1. **Verrou de recalcul** : seul celui qui obtient le verrou recharge, les autres attendent un peu ou servent l'ancienne valeur.

```ts
const lock = await redis.set(`lock:${key}`, "1",
  "PX", 5000, "NX");          // NX : seulement si absent
if (lock) {
  const fresh = await loadFromDb();
  await redis.set(key, JSON.stringify(fresh), "EX", 300);
  await redis.del(`lock:${key}`);
} else {
  await sleep(50);            // puis relire le cache
}
```

2. **Stale-while-revalidate** : stocker la valeur avec une date d'expiration « logique » plus courte que le TTL Redis ; une fois périmée, on sert l'ancienne valeur et **un seul** worker la rafraîchit en arrière-plan.
3. **Expiration probabiliste anticipée** : chaque lecteur a une petite probabilité de rafraîchir avant l'expiration, croissante à l'approche du TTL.
4. **TTL avec jitter** (comme plus haut) pour éviter que mille clés expirent à la même seconde.

## CQRS léger

CQRS (*Command Query Responsibility Segregation*) : séparer le modèle d'**écriture** (normalisé, contraint) du modèle de **lecture** (dénormalisé, taillé pour l'affichage). Pas besoin d'event sourcing ni de microservices pour en profiter.

Niveau 1, dans Postgres : une **vue matérialisée** pour le dashboard.

```sql
CREATE MATERIALIZED VIEW tenant_daily_revenue AS
SELECT tenant_id,
       date_trunc('day', created_at) AS day,
       count(*) AS orders,
       sum(total) AS revenue
FROM orders
WHERE status IN ('paid', 'shipped')
GROUP BY tenant_id, date_trunc('day', created_at);

CREATE UNIQUE INDEX ON tenant_daily_revenue (tenant_id, day);

-- toutes les 5 min, sans bloquer les lectures
REFRESH MATERIALIZED VIEW CONCURRENTLY tenant_daily_revenue;
```

`CONCURRENTLY` exige un index unique et recalcule tout : OK pour des milliers de lignes, trop lourd pour des milliards. (Attention : `date_trunc` sur un `timestamptz` coupe les jours selon le fuseau de la session : fixe-le, ou utilise `date_trunc('day', created_at, 'Europe/Paris')`.)

Niveau 2 : une **table de lecture** mise à jour à chaque événement (`INSERT … ON CONFLICT DO UPDATE SET revenue = revenue + …`), dans la même transaction ou via l'outbox.

Niveau 3 : un **autre stockage** pour la lecture (OpenSearch pour la recherche, ClickHouse pour l'analytique), alimenté par l'outbox ou le CDC. Les lectures sont **éventuellement cohérentes** : assume-le dans l'UI (« mis à jour il y a 2 min »).

## Outbox pattern

Problème : quand une commande est payée, il faut (1) mettre à jour la base et (2) publier `order.paid` (Kafka, RabbitMQ, webhook marchand, email). Les deux ne peuvent pas être atomiques ensemble :

```ts
await db.markPaid(orderId);       // ✓ commité
await broker.publish("order.paid"); // ✗ crash ici → événement perdu
```

Inverser l'ordre ne règle rien : événement publié, puis la transaction échoue → événement fantôme.

Solution : écrire l'événement **dans la base**, dans la **même transaction**, puis un *relay* le publie.

```sql
CREATE TABLE outbox (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggregate    text NOT NULL,
  aggregate_id text NOT NULL,
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished_idx ON outbox (id)
  WHERE published_at IS NULL;
```

```sql
BEGIN;
UPDATE orders SET status = 'paid' WHERE id = 5;
INSERT INTO outbox (aggregate, aggregate_id, type, payload)
VALUES ('order', '5', 'order.paid',
        jsonb_build_object('order_id', 5, 'tenant_id', 1,
                           'total', 19.90));
COMMIT;
```

Le relay (un worker) :

```sql
BEGIN;
SELECT id, type, payload FROM outbox
WHERE published_at IS NULL
ORDER BY id
LIMIT 100
FOR UPDATE SKIP LOCKED;
-- publier chaque message au broker, puis :
UPDATE outbox SET published_at = now()
WHERE id = ANY($1);
COMMIT;
```

Propriétés :

- **Aucun événement perdu** : s'il est en base, il sera publié.
- **At-least-once** : si le relay crashe après avoir publié et avant le `UPDATE`, il republiera. Les consommateurs doivent être **idempotents** (dédoublonner sur l'`id` de l'outbox).
- **Ordre** : garanti par `id` avec un seul relay ; avec plusieurs relays en `SKIP LOCKED`, l'ordre global n'est plus garanti (seulement par partition si tu shardes les relays par `aggregate_id`).
- Purge des lignes publiées (ou partition par jour, [chapitre 5](/bdd/05-postgres-avance)).

Variante sans polling : le **CDC** (*Change Data Capture*) lit directement le WAL (Debezium, réplication logique) et publie les inserts dans `outbox`. Plus de latence minimale, plus d'infrastructure.

## Cas réel

**Contexte** : le SaaS fil rouge passe de 300 à 6 000 tenants. Symptômes : CPU du primaire à 85 %, la page d'accueil des boutiques lente aux heures de pointe, et des marchands qui se plaignent de webhooks `order.paid` manquants.

Diagnostic et actions, par ordre de rentabilité :

1. **`pg_stat_statements`** : 40 % du temps total vient de la requête « produits mis en avant » de la vitrine (lue 3 000 fois/s, change quelques fois par jour). → **cache-aside Redis** par tenant, TTL 10 min + jitter, invalidation par `DEL` à la modification d'un produit, verrou anti-stampede. CPU : 85 % → 50 %.
2. **Dashboards marchands** (agrégats sur 90 jours, recalculés à chaque affichage) → **table de lecture** `tenant_daily_revenue` mise à jour par un consommateur de l'outbox.
3. **Exports CSV et back-office interne** → **réplica de lecture**, avec la règle : rien de transactionnel ne lit sur le réplica. Les exports tolèrent quelques secondes de lag.
4. **Webhooks perdus** : le code publiait après le commit, et les crashs/déploiements en perdaient. → **outbox** + relay ; les webhooks portent un `event_id`, documenté comme clé de dédoublonnage pour les marchands.
5. **Sharding ?** Évalué, puis **reporté** : avec cache, réplica et requêtes corrigées, le primaire a 3 à 4 ans de marge. Préparé quand même : `tenant_id` est déjà partout et dans les FK composites, ce qui rendrait un sharding par tenant simple le jour venu.

## Pièges classiques

- Choisir une base pour sa popularité ou ses benchmarks plutôt que pour la forme des données et l'équipe.
- Sharder trop tôt (complexité permanente pour un problème qu'un index aurait réglé).
- Lire sur un réplica juste après une écriture, ou pour décider d'une écriture.
- Considérer un réplica comme un backup.
- Clés de cache sans `tenantId`, cache sans TTL, mise à jour du cache au lieu de `DEL`.
- Pas de protection anti-stampede sur les clés chaudes.
- Publier un événement « après le commit » sans outbox → événements perdus.
- Consommateurs non idempotents derrière une livraison at-least-once.
- `REFRESH MATERIALIZED VIEW` sans `CONCURRENTLY` (bloque les lectures pendant le recalcul).

## Défis

**1. Le profil qui ne se met pas à jour.** Après avoir changé son email, un utilisateur voit l'ancien sur la page de confirmation, puis le bon en rafraîchissant 2 s plus tard. L'app route les `SELECT` vers un réplica. Explique et propose deux corrections.

::: details Solution
**Lag de réplication** : l'`UPDATE` est commité sur le primaire, mais le réplica n'a pas encore rejoué le WAL quand la page de confirmation le lit. Violation du *read-your-writes*.

1. **Sticky primary** : après une écriture, marquer la session (cookie ou clé Redis, quelques secondes) pour que ses lectures aillent au primaire.
2. **LSN** : renvoyer `pg_current_wal_lsn()` après l'écriture, et ne lire sur un réplica que si `pg_last_wal_replay_lsn() >= ce LSN` ; sinon, lire sur le primaire.

Option 3 : la page de confirmation utilise directement la valeur renvoyée par l'`UPDATE … RETURNING`, sans relire.
:::

**2. Où est le bug ?** Ce code de mise à jour du cache produit laisse parfois un prix périmé en cache pendant 10 minutes. Pourquoi ?

```ts
await db.updatePrice(id, price);
await redis.set(`product:${id}`, JSON.stringify(
  await db.findProduct(id)), "EX", 600);
```

::: details Solution
Deux problèmes. (1) **La clé n'a pas de tenant** : à corriger d'abord si les ids ne sont pas globaux. (2) **Course entre écrivains** : A écrit le prix 20, B écrit 25 ; B relit et met 25 en cache ; A, plus lent, relit… selon le timing, A peut avoir lu 20 *avant* l'écriture de B mais faire son `SET` *après* celui de B. Le cache garde 20 pendant 10 minutes alors que la base contient 25.

Correctif : `DEL` après l'écriture, et laisser la prochaine lecture recharger (cache-aside). La fenêtre résiduelle (un lecteur lent qui remet une vieille valeur) est bornée par le TTL ; pour la fermer, une clé versionnée (`product:42:v{version}`) avec la `version` de l'optimistic locking ([chapitre 4](/bdd/04-transactions-isolation)).
:::

**3. Le stampede du lundi matin.** Chaque lundi à 9 h, la clé `t:42:homepage` (gros tenant, 1 500 req/s) expire et la base sature 20 secondes. Propose une solution, avec le pseudo-code.

::: details Solution
Stale-while-revalidate avec un seul rafraîchisseur :

```ts
const raw = await redis.get(key);   // TTL Redis : 1 h
if (raw) {
  const { value, freshUntil } = JSON.parse(raw);
  if (Date.now() > freshUntil) {
    // un seul worker obtient le verrou et rafraîchit
    const ok = await redis.set(`lock:${key}`, "1",
      "PX", 10_000, "NX");
    if (ok) void refresh(key);      // en arrière-plan
  }
  return value;                     // on sert l'ancienne
}
return refresh(key);                // vraiment absent
```

`refresh` écrit `{ value, freshUntil: now + 5 min }` avec `EX 3600`. Les 1 500 req/s continuent à recevoir l'ancienne version pendant les quelques ms de recalcul ; une seule requête touche la base. Ajoute du jitter sur `freshUntil` si plusieurs clés chaudes ont été créées en même temps.
:::

**4. L'événement fantôme.** Un dev « corrige » les webhooks perdus en publiant **avant** le commit. Que peut-il se passer, et pourquoi l'outbox règle les deux cas ?

```ts
await db.tx(async (t) => {
  await t.query("UPDATE orders SET status='paid' …");
  await broker.publish("order.paid", { orderId });
  await t.query("UPDATE stock …");   // peut échouer
});
```

::: details Solution
Si le second `UPDATE` échoue (ou si le commit échoue), la transaction est annulée mais l'événement est **déjà parti** : le marchand reçoit `order.paid` pour une commande qui ne l'est pas, et expédie. Événement fantôme. (Et le publish dans la transaction l'allonge, avec un appel réseau sous verrou.)

Avec l'outbox, l'événement est une **ligne** de la même transaction : commit → il existe et sera publié ; rollback → il n'a jamais existé. La publication est découplée et retentée par le relay.
:::

**5. Le relay.** Écris la requête du relay de l'outbox pour deux instances en parallèle sans doublon de traitement, puis explique pourquoi les consommateurs doivent malgré tout dédoublonner.

::: details Solution
```sql
BEGIN;
SELECT id, type, payload FROM outbox
WHERE published_at IS NULL
ORDER BY id
LIMIT 100
FOR UPDATE SKIP LOCKED;
-- publier…
UPDATE outbox SET published_at = now()
WHERE id = ANY($1);
COMMIT;
```

`SKIP LOCKED` : les deux relays prennent des lots disjoints. Mais si un relay publie puis crashe avant le `COMMIT`, les lignes redeviennent disponibles et seront publiées **une seconde fois** : la livraison est *at-least-once*. Le consommateur garde les `event_id` déjà traités (table avec contrainte unique, ou `SET NX` Redis avec TTL) et ignore les doublons. Note : avec deux relays, l'ordre global n'est plus garanti.
:::

**6. Choisir.** Pour chaque besoin du SaaS fil rouge, choisis une technologie et justifie en une phrase : a) recherche produits avec tolérance aux fautes et facettes pour les gros catalogues ; b) rate limiting de l'API publique ; c) analytics des événements (2 milliards de lignes, requêtes ad hoc) ; d) file de jobs d'envoi d'emails (200/s) ; e) stockage des factures PDF.

::: details Solution
- a) **Meilisearch / OpenSearch** alimenté par l'outbox ; Postgres full-text + `pg_trgm` suffit tant que le catalogue est petit et sans facettes complexes.
- b) **Redis** : compteurs atomiques avec TTL (`INCR` + `EXPIRE`, ou script Lua pour un sliding window), latence sub-ms (voir [Rate limiter](/interview/03-system-design/03-rate-limiter)).
- c) **ClickHouse** (ou BigQuery) : stockage colonne, agrégats sur des milliards de lignes en secondes ; Postgres en ligne n'est pas fait pour ça.
- d) **Postgres** `SKIP LOCKED` : 200/s est confortable, et le job est créé dans la même transaction que la commande (pas de double écriture).
- e) **Stockage objet** (S3 ou équivalent), avec la clé de l'objet en base. Jamais de gros binaires dans les lignes de la base.
:::

## À retenir

- Choisis selon la forme des données, les accès et ce que l'équipe sait opérer ; Postgres par défaut.
- Scale vertical + index + pooler + cache avant de distribuer ; le sharding (par `tenant_id`) est un dernier recours.
- Réplicas : lectures non critiques, lag toujours possible, *read-your-writes* à gérer explicitement.
- Cache-aside avec tenant dans la clé, TTL + jitter, `DEL` à l'écriture, protection anti-stampede.
- CQRS léger : vue matérialisée ou table de lecture avant un second datastore.
- Outbox : l'événement est une ligne de la même transaction ; relay `SKIP LOCKED` ; consommateurs idempotents.
