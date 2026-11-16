# Index & EXPLAIN

Ce que tu vas apprendre : comment un index accélère (ou pas) une requête, choisir le bon type et le bon ordre de colonnes, lire un plan `EXPLAIN (ANALYZE, BUFFERS)`, et corriger les deux causes n°1 de lenteur en prod : le N+1 et la pagination par `OFFSET`.

## Le labo : un million de commandes

Sur 9 commandes, tout est instantané. Charge le [schéma fil rouge](/bdd/), puis ce générateur (≈ 30 s) :

```sql
INSERT INTO tenants (slug, name)
SELECT 'shop-' || g, 'Shop ' || g
FROM generate_series(1, 50) g;

INSERT INTO users (tenant_id, email, name)
SELECT 1 + g % 53, 'u' || g || '@mail.com', 'User ' || g
FROM generate_series(1, 100000) g;

INSERT INTO orders (tenant_id, user_id, status, total,
                    created_at)
SELECT u.tenant_id, u.id,
       (ARRAY['pending', 'paid', 'paid', 'paid',
              'shipped', 'cancelled'])[1 + (random() * 5)::int],
       (random() * 300)::numeric(12, 2),
       now() - random() * interval '730 days'
FROM generate_series(1, 1000000) g
JOIN users u ON u.id = 9 + (g % 100000);
```

```sql
-- 2 M d'événements, insérés dans l'ordre du temps
INSERT INTO events (tenant_id, type, payload, created_at)
SELECT 1 + g % 53, 'page.view', '{}',
       now() - interval '365 days'
             + g * interval '15 seconds'
FROM generate_series(1, 2000000) g;

VACUUM ANALYZE;
```

Les plans de cette page viennent de ce labo (Postgres 18), raccourcis pour le mobile.

## Comment marche un B-tree

Le B-tree est l'index par défaut. Un arbre équilibré, trié, dont les feuilles pointent vers les lignes de la table (le *heap*) :

```
              [ 40 | 80 ]
             /     |     \
   [10|20|30]  [50|60|70]  [90|95]   ← feuilles triées,
       │                               chaînées entre elles
       └─► ligne (page 812, slot 3) dans la table
```

Il sert pour : `=`, `<`, `>`, `BETWEEN`, `IN`, `IS NULL`, `LIKE 'abc%'` (préfixe, avec la collation `C` ou l'opclass `text_pattern_ops`), et `ORDER BY` (lu dans l'ordre, pas besoin de trier).

Il ne sert **pas** pour : `LIKE '%abc'`, une fonction appliquée à la colonne (`lower(email)`, `created_at::date`), sauf index sur expression.

Le coût d'un index : chaque `INSERT`/`UPDATE` doit le maintenir, il prend de la place, et il occupe le cache. Une table de prod avec 15 index est souvent une table qui écrit lentement.

## Index composite : l'ordre des colonnes

`orders_tenant_created_idx (tenant_id, created_at DESC)` est trié par `tenant_id`, puis par date **à l'intérieur** de chaque tenant. Comme un annuaire trié par nom puis prénom.

| Requête | Utilise bien l'index ? |
|---|---|
| `tenant_id = 5` | oui |
| `tenant_id = 5 AND created_at > …` | oui, parfait |
| `tenant_id = 5 ORDER BY created_at DESC` | oui, sans tri |
| `created_at > …` seul | mal (voir skip scan) |
| `tenant_id > 5 AND created_at > …` | seulement `tenant_id` |

Règle : **colonnes en égalité d'abord, puis la colonne de range ou de tri.** Dès qu'une colonne est utilisée en range, les suivantes ne peuvent plus restreindre la recherche, seulement filtrer.

::: info Nouveau en Postgres 18 : skip scan
Avant la v18, `WHERE created_at > …` sans `tenant_id` ne pouvait pas « sauter » dans l'index. Postgres 18 sait faire un **skip scan** : une recherche par valeur distincte de `tenant_id`. Visible dans le plan :

```
Index Only Scan using orders_tenant_created_idx
  Index Cond: (created_at >= (now() - '1 day'))
  Index Searches: 54
```

Efficace quand la première colonne a peu de valeurs distinctes (53 tenants ici), inutile si elle en a des millions. Ça ne remplace pas un index bien ordonné.
:::

## Index couvrant (INCLUDE) et index-only scan

Normalement : index → pointeur → lecture de la ligne dans la table. Si **toutes** les colonnes nécessaires sont dans l'index, Postgres saute la table : *index-only scan*.

```sql
CREATE INDEX orders_user_cover
  ON orders (user_id) INCLUDE (status, total);

SELECT status, sum(total)
FROM orders WHERE user_id = 4242
GROUP BY status;
```

```
Index Only Scan using orders_user_cover on orders
  Index Cond: (user_id = 4242)
  Heap Fetches: 0
```

`INCLUDE` ajoute des colonnes dans les feuilles sans les trier (elles ne servent ni à chercher ni à trier, juste à lire). `Heap Fetches: 0` dépend de la *visibility map* : une table mal vacuumée a des `Heap Fetches` élevés et perd l'avantage ([VACUUM](/bdd/05-postgres-avance)).

## Index partiel et index sur expression

Le worker qui relance les paniers abandonnés cherche les commandes `pending`. Elles sont 10 % de la table, mais c'est la seule requête qui les cible :

```sql
CREATE INDEX orders_pending_idx
  ON orders (created_at)
  WHERE status = 'pending';
```

Taille sur le labo : **2,2 Mo**, contre 39 Mo pour l'index complet `(tenant_id, created_at)`. Pour l'utiliser, la requête doit contenir un prédicat qui **implique** celui de l'index (`status = 'pending'` en dur).

Index sur expression : la requête doit utiliser **exactement** la même expression.

```sql
CREATE INDEX users_email_lower_idx ON users (lower(email));
-- ✓ WHERE lower(email) = lower($1)
-- ✗ WHERE email = $1
-- ✗ WHERE email ILIKE $1
```

## Les autres types d'index

| Type | Pour quoi | Exemple |
|---|---|---|
| B-tree | égalité, range, tri | presque tout |
| GIN | « contient » : JSONB, tableaux, full-text, trigrammes | `attributes @> '{"color":"noir"}'` |
| GiST | géométrie, ranges, exclusion, kNN | `valid && tstzrange(…)` |
| BRIN | grosses tables où l'ordre physique suit la colonne | `events.created_at` |
| Hash | égalité seule | rarement utile vs B-tree |

GIN et GiST sont détaillés dans [Postgres avancé](/bdd/05-postgres-avance).

**BRIN** (*Block Range INdex*) stocke seulement min/max par paquet de pages. Parfait pour des tables append-only triées par le temps (logs, événements, métriques) :

```sql
CREATE INDEX events_created_brin
  ON events USING brin (created_at);
```

Sur les 2 M d'événements du labo : **24 ko** pour le BRIN contre **43 Mo** pour un B-tree équivalent. Contrepartie : il est approximatif (`Heap Blocks: lossy`, puis recheck), et inutile si les lignes ne sont pas physiquement dans l'ordre (UPDATE fréquents, données insérées dans le désordre).

## Lire EXPLAIN

- `EXPLAIN` : le plan estimé, sans exécuter.
- `EXPLAIN (ANALYZE, BUFFERS)` : exécute **vraiment** la requête et ajoute temps et pages lues. Attention sur un `UPDATE`/`DELETE` : enveloppe-le dans `BEGIN; … ROLLBACK;`.

```
Limit  (cost=0.42..70.11 rows=20)
       (actual time=1.164..1.539 rows=20.00 loops=1)
  Buffers: shared hit=3 read=35
  ->  Index Scan using orders_tenant_created_idx on orders
        Index Cond: (tenant_id = 5)
        Filter: (status = 'paid'::text)
        Rows Removed by Filter: 12
```

Comment lire :

- **De l'intérieur vers l'extérieur** : le nœud le plus indenté s'exécute en premier.
- `cost=a..b` : unités arbitraires ; `a` = coût avant la 1re ligne, `b` = coût total. Sert à comparer des plans, pas à prédire des ms.
- `rows` estimé vs `actual rows` : **un écart de ×10 ou plus est le signal n°1**. Le planificateur a de mauvaises statistiques → mauvais plan. Remède : `ANALYZE table`, ou statistiques étendues (`CREATE STATISTICS`) pour des colonnes corrélées.
- `loops=N` : le nœud a tourné N fois ; temps et lignes affichés sont **par boucle**.
- `Index Cond` = utilisé pour chercher dans l'index. `Filter` = ligne lue puis jetée. Beaucoup de `Rows Removed by Filter` = index incomplet.
- `Buffers: shared hit` = pages (8 ko) trouvées en cache, `read` = lues depuis l'OS/disque. **Les buffers sont la métrique la plus fiable** : le temps varie avec le cache, le nombre de pages touchées non.

### Les méthodes d'accès

| Nœud | Quand |
|---|---|
| `Seq Scan` | lit toute la table ; optimal si on garde une grosse fraction des lignes |
| `Index Scan` | descend l'index puis lit chaque ligne ; bon pour peu de lignes ou un tri |
| `Index Only Scan` | tout est dans l'index |
| `Bitmap Index Scan` + `Bitmap Heap Scan` | collecte les pointeurs, les trie par page, puis lit la table page par page ; entre les deux |

::: tip Un Seq Scan n'est pas un bug
`SELECT id FROM orders WHERE status = 'paid'` renvoie 60 % de la table : même avec un index sur `status`, Postgres choisit le `Seq Scan`, et il a raison. Lire séquentiellement toute la table coûte moins que des centaines de milliers d'accès aléatoires.
:::

Méthodes de jointure : `Nested Loop` (pour chaque ligne de gauche, cherche à droite, idéal si gauche est petite et droite indexée), `Hash Join` (construit une table de hachage du petit côté), `Merge Join` (deux entrées triées).

## Le N+1

Le bug de performance le plus courant avec un ORM. La page « mes commandes » :

```ts
const orders = await db.query(
  "SELECT * FROM orders WHERE user_id = $1 LIMIT 50", [userId]);
for (const o of orders) {
  // 1 requête par commande → 51 allers-retours
  o.items = await db.query(
    "SELECT * FROM order_items WHERE order_id = $1", [o.id]);
}
```

Chaque requête est rapide (0,1 ms en base), mais 51 allers-retours réseau à 0,5–1 ms, plus la sérialisation, font 50 ms. À 200 commandes affichées, la page dépasse la seconde. Les deux correctifs :

```sql
-- 1. une requête pour tous les items : = ANY($1)
SELECT * FROM order_items WHERE order_id = ANY($1::bigint[]);

-- 2. ou une seule requête qui agrège
SELECT o.id, o.total,
       jsonb_agg(jsonb_build_object(
         'sku', p.sku, 'qty', oi.quantity)) AS items
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id
WHERE o.user_id = $1
GROUP BY o.id;
```

Côté ORM : `include`/`with` (Prisma, Drizzle), ou un *DataLoader* en GraphQL. Pour le détecter : compter les requêtes par requête HTTP dans tes traces ([Observabilité](/infra/08-observabilite)) ou `pg_stat_statements` (un `calls` énorme sur une requête triviale).

## Pagination : OFFSET vs keyset

```sql
SELECT id, created_at FROM orders
WHERE tenant_id = 5
ORDER BY created_at DESC, id DESC
OFFSET 15000 LIMIT 20;
```

`OFFSET 15000` = « lis 15 020 lignes, jettes-en 15 000 ». Le coût grandit avec le numéro de page. Pire : si une commande est créée entre deux pages, tout se décale et l'utilisateur voit un doublon.

**Keyset (ou *seek*) pagination** : on se souvient de la dernière ligne vue et on repart de là.

```sql
-- index : (tenant_id, created_at, id)
SELECT id, created_at FROM orders
WHERE tenant_id = 5
  AND (created_at, id) < ($1, $2)   -- dernière ligne vue
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

```
Index Only Scan Backward using orders_tenant_created_id_idx
  Index Cond: ((tenant_id = 5) AND
     (ROW(created_at, id) < ROW('2025-04-11 …', 893186)))
  Buffers: shared hit=3 read=1
```

4 pages lues quelle que soit la profondeur, contre ~10 000 pour l'`OFFSET` sans index adapté. Points clés :

- Le tri doit être **unique** et **total** : `created_at` seul ne l'est pas (deux commandes à la même µs), d'où le `id` en départage.
- La comparaison de ligne `(a, b) < (x, y)` est utilisable par un B-tree sur `(…, a, b)`.
- On perd le « aller à la page 37 ». Pour une API ou un scroll infini, ce n'est pas un problème : renvoie un `cursor` opaque (base64 de `created_at|id`).

## Cas réel

**Contexte** : le back-office d'un marchand affiche « commandes payées, les plus récentes d'abord, avec l'email du client, 50 par page ». Le marchand est à la page 100. La page met **4 s** en prod (80 M de commandes, cache froid). Le SQL généré par l'ORM :

```sql
SELECT o.id, o.total, o.created_at, u.email
FROM orders o JOIN users u ON u.id = o.user_id
WHERE o.tenant_id = 5 AND o.status = 'paid'
ORDER BY o.created_at DESC
LIMIT 50 OFFSET 5000;
```

Le plan, reproduit sur le labo :

```
Limit (actual time=77.367..77.374 rows=50)
  Buffers: shared hit=10990
  -> Sort  Sort Key: o.created_at DESC
     -> Hash Join  Hash Cond: (o.user_id = u.id)
        -> Bitmap Heap Scan on orders o
             Recheck Cond: (tenant_id = 5)
             Filter: (status = 'paid'::text)
             Rows Removed by Filter: 7556
        -> Hash
           -> Seq Scan on users u   rows=100008
```

Diagnostic, nœud par nœud :

1. `Filter: status` + `Rows Removed: 7556` → l'index ne contient pas `status`.
2. `Sort` → l'index ne fournit pas l'ordre une fois filtré par `status`.
3. Toutes les commandes payées du tenant (11 314) sont lues, jointes, triées pour en garder 50 : à cause de l'`OFFSET`.
4. `Seq Scan on users` : avec 11 000 lignes à joindre, un hash join sur toute la table users est le choix rationnel. Il disparaîtra quand on ne joindra plus que 50 lignes.

Correctif : un index qui suit **exactement** le `WHERE` + `ORDER BY`, et du keyset.

```sql
CREATE INDEX CONCURRENTLY orders_tenant_status_created_idx
  ON orders (tenant_id, status, created_at DESC, id DESC);
```

```sql
SELECT o.id, o.total, o.created_at, u.email
FROM orders o JOIN users u ON u.id = o.user_id
WHERE o.tenant_id = 5 AND o.status = 'paid'
  AND (o.created_at, o.id) < ($1, $2)
ORDER BY o.created_at DESC, o.id DESC
LIMIT 50;
```

```
Limit (rows=50)  Buffers: shared hit=156 read=48
  -> Nested Loop
     -> Index Scan using orders_tenant_status_created_idx
          Index Cond: ((tenant_id = 5) AND (status = 'paid')
            AND (ROW(created_at, id) < ROW(…)))
     -> Index Scan using users_pkey on users u   loops=50
```

**10 990 → 204 pages** : 50 fois moins. Plus de tri, plus de filtre, et le join devient un `Nested Loop` sur 50 lignes. En prod : de 4 s à 15 ms. Le compteur « 11 314 résultats » a été remplacé par « 10 000+ » (un `count(*)` exact sur un gros ensemble coûte aussi cher que la requête initiale).

`CONCURRENTLY` : crée l'index sans bloquer les écritures (voir [Migrations](/bdd/08-migrations-orm-en-prod)).

## Pièges classiques

- Fonction ou cast sur la colonne indexée : `WHERE created_at::date = …`, `WHERE lower(email) = …` sans index d'expression.
- Ordre des colonnes d'un composite au hasard, ou range avant égalité.
- Un index par colonne au lieu d'un composite adapté à la requête.
- Indexer une colonne peu sélective (`status`, `is_active`) seule.
- Oublier d'indexer les FK.
- `EXPLAIN ANALYZE` sur un `DELETE` en prod sans `ROLLBACK`.
- Juger un plan au temps d'exécution plutôt qu'aux buffers.
- `OFFSET` sur des pages profondes, `count(*)` exact sur chaque page.
- Partiel avec un paramètre : `WHERE status = $1` ne peut pas utiliser un index `WHERE status = 'pending'` dans un plan générique.
- Ne jamais supprimer les index inutilisés (`pg_stat_user_indexes.idx_scan = 0`).

## Défis

**1. Le plan qui ignore l'index.** Les deux requêtes renvoient les mêmes 19 lignes. La première lit 106 pages, la seconde 7. Pourquoi ?

```sql
-- A
SELECT count(*) FROM orders
WHERE tenant_id = 5
  AND created_at::date = current_date - 3;
-- B
SELECT count(*) FROM orders
WHERE tenant_id = 5
  AND created_at >= current_date - 3
  AND created_at <  current_date - 2;
```

::: details Solution
Dans A, `created_at::date` est une expression : l'index `(tenant_id, created_at)` ne peut servir que pour `tenant_id = 5`, puis chaque ligne du tenant est convertie et filtrée :

```
Index Only Scan using orders_tenant_created_idx
  Index Cond: (tenant_id = 5)
  Filter: ((created_at)::date = (CURRENT_DATE - 3))
  Rows Removed by Filter: 18851
```

B garde la colonne « nue » : les deux colonnes sont dans l'`Index Cond`, l'index va directement au bon jour. Règle : transforme la **constante**, jamais la colonne. (Attention aussi : `::date` d'un `timestamptz` dépend du `TimeZone` de la session.)
:::

**2. Ordre des colonnes.** Tu dois servir ces deux requêtes avec **un seul** index. Lequel ?

```sql
-- 1. WHERE tenant_id = $1 AND status = $2
--    ORDER BY created_at DESC LIMIT 50
-- 2. WHERE tenant_id = $1 AND status = $2
--    AND created_at >= $3
```

Et pourquoi `(tenant_id, created_at, status)` est-il moins bon ?

::: details Solution
`(tenant_id, status, created_at DESC)` : deux égalités puis la colonne de range/tri. Les deux requêtes descendent directement au bloc `(tenant, status)` déjà trié par date.

Avec `(tenant_id, created_at, status)`, `created_at` est un range : `status` ne peut plus restreindre la descente, seulement filtrer les lignes rencontrées. Pour la requête 1, il faut parcourir les dates du tenant en jetant les autres statuts (`Rows Removed by Filter`). L'ordre des colonnes en égalité entre elles importe peu ; ce qui compte, c'est égalités d'abord.
:::

**3. Pourquoi pas mon index ?** Un dev crée `CREATE INDEX ON orders (status)` pour accélérer `SELECT id FROM orders WHERE status = 'paid'`. Le plan reste un `Seq Scan`. Bug de Postgres ?

::: details Solution
Non : `paid` représente ~60 % des lignes (597 705 estimées). Lire 600 000 lignes via l'index = des centaines de milliers d'accès aléatoires au heap ; un seq scan lit les pages dans l'ordre et est moins cher. Le planificateur a raison.

Fait intéressant : `SELECT count(*) … WHERE status = 'paid'` utilise l'index (*index-only scan*), car il n'a pas besoin de lire la table. Un index sur une colonne peu sélective est utile en **partiel** pour la valeur rare (`WHERE status = 'pending'`), ou comme colonne d'un composite.
:::

**4. Le partiel invisible.** Avec `orders_pending_idx (created_at) WHERE status = 'pending'`, ta requête préparée `WHERE status = $1 ORDER BY created_at LIMIT 10` fait parfois un seq scan, parfois non. Explique.

::: details Solution
Une requête préparée peut être exécutée avec un **plan générique** (valable pour tout `$1`). Postgres ne peut pas prouver que `status = $1` implique `status = 'pending'`, donc l'index partiel est inutilisable :

```
Parallel Seq Scan on orders
  Filter: (status = $1)
```

Par défaut (`plan_cache_mode = auto`), Postgres fait 5 plans personnalisés puis peut basculer sur le générique s'il ne coûte pas plus cher en moyenne : d'où le comportement intermittent. Correctif : écrire `status = 'pending'` en littéral dans cette requête (c'est la seule qui en a besoin), ou un index non partiel `(status, created_at)`.
:::

**5. Lire un plan.** Que t'apprend ce plan, et quelle est la première chose à faire ?

```
Nested Loop  (rows=3) (actual rows=48210 loops=1)
  -> Index Scan using orders_user_idx on orders
       (rows=1) (actual rows=48210 loops=1)
  -> Index Scan using users_pkey on users
       (actual rows=1 loops=48210)
```

::: details Solution
Le planificateur estimait **1** ligne et en a eu **48 210** : il a choisi un nested loop (bon pour 1 ligne) qui fait 48 210 recherches dans `users`. Un hash join aurait été bien meilleur. Cause typique : statistiques obsolètes après un gros import (autovacuum n'est pas encore passé), ou colonnes corrélées.

Première action : `ANALYZE orders;` puis relancer `EXPLAIN (ANALYZE, BUFFERS)`. Si l'estimation reste fausse sur un `WHERE a = … AND b = …` corrélé, `CREATE STATISTICS … (dependencies) ON a, b FROM orders`. Ne force pas le plan (pas de hints natifs dans Postgres) : corrige les stats.
:::

**6. Keyset.** Réécris cette pagination d'API en keyset, et donne l'index nécessaire. Que renvoies-tu au client ?

```sql
SELECT id, type, created_at FROM events
WHERE tenant_id = $1
ORDER BY created_at, id
LIMIT 100 OFFSET $2;
```

::: details Solution
```sql
-- index : (tenant_id, created_at, id)
SELECT id, type, created_at FROM events
WHERE tenant_id = $1
  AND (created_at, id) > ($2, $3)
ORDER BY created_at, id
LIMIT 100;
```

Première page : sans la condition de ligne. Le client reçoit `next_cursor = base64("<created_at>|<id>")` de la dernière ligne, et le renvoie tel quel. Ici, `id` est un UUIDv7 : il est déjà ordonné par le temps, donc `ORDER BY id` seul et un index `(tenant_id, id)` suffiraient presque (à la milliseconde près, et seulement si `created_at` est toujours l'heure d'insertion). Garde un timestamp explicite si les événements peuvent être importés avec une date passée.
:::

**7. N+1 dans les logs.** Ton APM montre pour `GET /orders` : 1 × `SELECT … FROM orders WHERE user_id = $1 LIMIT 50` puis 50 × `SELECT … FROM payments WHERE order_id = $1`. Écris la requête unique qui renvoie, pour chaque commande, son dernier paiement (ou `NULL`).

::: details Solution
```sql
SELECT o.id, o.status, o.total,
       p.status AS payment_status, p.provider
FROM orders o
LEFT JOIN LATERAL (
  SELECT status, provider FROM payments
  WHERE payments.order_id = o.id
  ORDER BY created_at DESC, id DESC
  LIMIT 1
) p ON true
WHERE o.user_id = $1
ORDER BY o.created_at DESC
LIMIT 50;
```

Un aller-retour au lieu de 51. `LEFT JOIN LATERAL … ON true` garde les commandes sans paiement. Avec `payments_order_idx`, chaque sous-requête est une recherche d'index. Sur le jeu de données, pour Bob (`user_id = 2`) : la commande 3 renvoie le paiement `succeeded` (le plus récent, `id` départage les deux tentatives créées dans la même transaction), la 5 renvoie `NULL`.
:::

## À retenir

- Un index composite se conçoit à partir de la requête : égalités, puis range/tri. Postgres 18 a le skip scan, mais ne compte pas dessus.
- Colonne « nue » dans le `WHERE` ; sinon index sur expression identique.
- `INCLUDE` pour les index-only scans, partiel pour les valeurs rares, BRIN pour les gros logs append-only.
- `EXPLAIN (ANALYZE, BUFFERS)` : regarde estimations vs réel, `Filter` vs `Index Cond`, et les buffers.
- N+1 : `= ANY($1)`, `JOIN`, `LATERAL` ou `include` côté ORM.
- Pagination profonde = keyset sur un tri unique, jamais `OFFSET`.
