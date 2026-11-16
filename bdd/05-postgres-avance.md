# Postgres avancé

Ce que tu vas apprendre : les outils qui font de Postgres bien plus qu'un stockage de lignes. CTE récursives, window functions, JSONB indexé, recherche plein texte, partitionnement, LISTEN/NOTIFY, les extensions incontournables, et ce qu'il faut savoir de VACUUM et du connection pooling pour ne pas se faire surprendre en prod.

## CTE (WITH)

Une CTE nomme une sous-requête pour rendre une requête lisible, étape par étape :

```sql
WITH paid AS (
  SELECT * FROM orders
  WHERE status IN ('paid', 'shipped')
),
per_user AS (
  SELECT user_id, count(*) AS n, sum(total) AS spent
  FROM paid GROUP BY user_id
)
SELECT u.name, p.n, p.spent
FROM per_user p JOIN users u ON u.id = p.user_id
ORDER BY p.spent DESC;
```

Depuis Postgres 12, une CTE référencée une seule fois est **inlinée** : l'optimiseur la traite comme une sous-requête, pas de perte de performance. `WITH x AS MATERIALIZED (…)` force le calcul une fois (utile si elle est coûteuse et référencée plusieurs fois), `NOT MATERIALIZED` force l'inlining.

Les CTE peuvent aussi **écrire** (`INSERT/UPDATE/DELETE … RETURNING`) : on l'a utilisé au [chapitre 4](/bdd/04-transactions-isolation) pour le ledger.

### CTE récursives : parcourir un arbre

`categories.parent_id` forme un arbre. Pour l'afficher avec son chemin :

```sql
WITH RECURSIVE tree AS (
  -- point de départ : les racines
  SELECT id, name, parent_id, 1 AS depth,
         name::text AS path
  FROM categories
  WHERE parent_id IS NULL AND tenant_id = 1
  UNION ALL
  -- étape : les enfants des lignes déjà trouvées
  SELECT c.id, c.name, c.parent_id, t.depth + 1,
         t.path || ' > ' || c.name
  FROM categories c
  JOIN tree t ON c.parent_id = t.id
)
SELECT id, depth, path FROM tree ORDER BY path;
```

```
 id | depth | path
----+-------+-------------------------
  4 |     1 | Bureau
  1 |     1 | Maison
  2 |     2 | Maison > Cuisine
  3 |     3 | Maison > Cuisine > Cafe
```

Mécanique : la partie avant `UNION ALL` s'exécute une fois ; la partie après tourne en boucle sur les lignes de l'itération précédente, jusqu'à ce qu'elle n'en produise plus.

::: warning Les cycles
Si les données contiennent un cycle (A parent de B, B parent de A), la récursion ne s'arrête jamais avec `UNION ALL`. Protège-toi avec `UNION` (dédoublonne), une limite `WHERE t.depth < 20`, ou la clause standard `CYCLE id SET is_cycle USING path` (Postgres 14+).
:::

Usages réels : arbres de catégories, organigrammes, commentaires imbriqués, graphe de dépendances, nomenclatures (BOM).

## Window functions

Un agrégat (`GROUP BY`) écrase les lignes en une par groupe. Une **window function** calcule sur un groupe de lignes mais **garde chaque ligne**.

```sql
fonction() OVER (
  PARTITION BY …   -- les groupes (optionnel)
  ORDER BY …       -- l'ordre dans le groupe
  ROWS BETWEEN …   -- la fenêtre glissante (optionnel)
)
```

```sql
SELECT id, created_at::date AS day, total,
  sum(total) OVER w AS running_total,
  total - lag(total) OVER w AS delta
FROM orders
WHERE tenant_id = 1 AND status IN ('paid', 'shipped')
WINDOW w AS (PARTITION BY tenant_id ORDER BY created_at)
ORDER BY created_at;
```

```
 id | total  | running_total | delta
----+--------+---------------+--------
  1 |  74.30 |         74.30 |
  2 |  59.00 |        133.30 | -15.30
  3 | 118.00 |        251.30 |  59.00
```

Les fonctions à connaître :

| Fonction | Rôle |
|---|---|
| `row_number()` | 1, 2, 3, 4 (unique) |
| `rank()` | 1, 2, 2, 4 (ex-aequo, trous) |
| `dense_rank()` | 1, 2, 2, 3 (ex-aequo, sans trou) |
| `lag(x)` / `lead(x)` | valeur de la ligne précédente / suivante |
| `first_value` / `last_value` | première / dernière de la fenêtre |
| `sum`, `avg`, `count` … `OVER` | agrégats cumulés ou glissants |
| `ntile(4)` | quartiles |

### Top N par groupe

Le grand classique d'entretien : « les 3 produits qui ont fait le plus de CA, par tenant, le mois dernier ».

```sql
WITH sales AS (
  SELECT o.tenant_id, oi.product_id,
         sum(oi.quantity * oi.unit_price) AS revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status IN ('paid', 'shipped')
    AND o.created_at >= date_trunc('month', now())
                        - interval '1 month'
    AND o.created_at <  date_trunc('month', now())
  GROUP BY o.tenant_id, oi.product_id
), ranked AS (
  SELECT s.*, rank() OVER (
    PARTITION BY tenant_id ORDER BY revenue DESC) AS rk
  FROM sales s
)
SELECT t.slug, p.name, r.revenue, r.rk
FROM ranked r
JOIN tenants t ON t.id = r.tenant_id
JOIN products p ON p.id = r.product_id
WHERE r.rk <= 3
ORDER BY t.slug, r.rk;
```

On ne peut pas écrire `WHERE rank() OVER … <= 3` : les window functions sont calculées **après** `WHERE`, `GROUP BY` et `HAVING` (juste avant `ORDER BY`). D'où la CTE intermédiaire.

### Fenêtre glissante

Moyenne mobile du CA sur 7 jours, avec `generate_series` pour ne pas avoir de trous les jours sans vente :

```sql
SELECT day, revenue,
  round(avg(revenue) OVER (
    ORDER BY day
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS avg7
FROM (
  SELECT d::date AS day,
         coalesce(sum(o.total), 0) AS revenue
  FROM generate_series(now() - interval '30 days',
                       now(), interval '1 day') d
  LEFT JOIN orders o
    ON o.created_at >= d::date
   AND o.created_at <  d::date + 1
   AND o.status IN ('paid', 'shipped')
  GROUP BY d
) s
ORDER BY day;
```

`ROWS` compte des lignes, `RANGE` des valeurs (ex. `RANGE BETWEEN interval '6 days' PRECEDING AND CURRENT ROW` sur une colonne date).

## JSONB

`jsonb` stocke du JSON sous forme binaire décomposée : indexable, comparable, sans espaces ni doublons de clés. (`json` garde le texte tel quel, presque jamais ce que tu veux.)

Cas d'usage légitime : `products.attributes`, des attributs **qui varient par type de produit** (couleur pour un mug, wattage pour une lampe). Mauvais usage : y mettre `price` ou `tenant_id`, qui sont dans toutes les lignes et méritent des colonnes typées et contraintes.

```sql
-- lire
SELECT sku,
       attributes->>'color' AS color,  -- ->> : texte
       attributes->'tags'   AS tags    -- ->  : jsonb
FROM products;

-- contient (le plus utile, indexable)
SELECT sku FROM products
WHERE attributes @> '{"tags": ["cafe"]}';

-- la clé existe ?
SELECT sku FROM products WHERE attributes ? 'watts';

-- JSONPath (Postgres 12+)
SELECT sku FROM products
WHERE attributes @? '$.weight_kg ? (@ > 5)';
```

Modifier :

```sql
UPDATE products SET attributes =
  jsonb_set(attributes, '{color}', '"rouge"')
WHERE id = 1;

UPDATE products
SET attributes = attributes || '{"promo": true}'  -- merge
WHERE id = 2;

UPDATE products
SET attributes = attributes - 'promo'             -- retire
WHERE id = 2;
```

Éclater un tableau en lignes :

```sql
SELECT tag, count(*)
FROM products,
     jsonb_array_elements_text(attributes->'tags') AS tag
GROUP BY tag ORDER BY count(*) DESC;
```

### Indexer du JSONB

```sql
-- GIN : sert @>, @?, @@ (jsonb_path_ops, plus compact)
CREATE INDEX products_attrs_gin
  ON products USING gin (attributes jsonb_path_ops);

-- ou opclass par défaut : sert aussi ?, ?|, ?&
CREATE INDEX ON products USING gin (attributes);

-- B-tree sur une clé précise, pour = et tri
CREATE INDEX products_color_idx
  ON products ((attributes->>'color'));
```

::: warning ->> ne profite pas de l'index GIN
`WHERE attributes->>'color' = 'noir'` est une expression : l'index GIN ne la voit pas (seq scan). Écris `WHERE attributes @> '{"color": "noir"}'`, ou crée l'index B-tree sur l'expression exacte.
:::

Si tu filtres toujours sur la même clé JSON, c'est le signal qu'elle mérite une vraie colonne (éventuellement générée : `color text GENERATED ALWAYS AS (attributes->>'color') STORED`).

## Recherche plein texte

Pour une barre de recherche produits, `ILIKE '%…%'` ne gère ni les pluriels, ni les accents, ni le classement. Le full-text de Postgres fait l'essentiel sans Elasticsearch.

Concepts : un `tsvector` (document découpé en *lexèmes* normalisés) et un `tsquery` (la recherche), comparés avec `@@`.

```sql
-- config française qui ignore aussi les accents
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE TEXT SEARCH CONFIGURATION fr (COPY = french);
ALTER TEXT SEARCH CONFIGURATION fr
  ALTER MAPPING FOR hword, hword_part, word
  WITH unaccent, french_stem;

ALTER TABLE products ADD COLUMN search tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('fr', name), 'A') ||
    setweight(to_tsvector('fr',
      coalesce(attributes->>'color', '')), 'B')
  ) STORED;

CREATE INDEX products_search_idx
  ON products USING gin (search);
```

```sql
SELECT sku, name, ts_rank(search, q) AS rank
FROM products,
     websearch_to_tsquery('fr', 'cafetières OR moulin') q
WHERE search @@ q
ORDER BY rank DESC;
```

`'Cafetière'` et `'cafetières'` donnent tous deux le lexème `cafetier` : la recherche trouve « Cafetiere italienne ». `websearch_to_tsquery` comprend la syntaxe des moteurs (`"phrase exacte"`, `OR`, `-exclu`) et ne lève jamais d'erreur de syntaxe : c'est celle à exposer aux utilisateurs.

Limites : pas de tolérance aux fautes de frappe, pas de recherche par préfixe naturelle (sauf `:*`), classement basique. Au-delà (facettes, synonymes, typo-tolérance), un moteur dédié (Meilisearch, OpenSearch) alimenté par l'[outbox](/bdd/09-choisir-et-scaler).

## Extensions utiles

### pg_trgm : ILIKE rapide et recherche floue

Un *trigramme* = 3 caractères consécutifs. Un index GIN de trigrammes accélère `LIKE`/`ILIKE '%…%'` et la similarité :

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX users_email_trgm
  ON users USING gin (email gin_trgm_ops);

-- le support cherche un client par bout d'email
SELECT email FROM users WHERE email ILIKE '%mail.c%';

-- tolérance aux fautes
SELECT name, similarity(name, 'cafetiere italiene')
FROM products
WHERE name % 'cafetiere italiene';   -- similarité > 0.3
```

### pg_stat_statements : où part le temps

À activer sur **toute** base de prod (`shared_preload_libraries = 'pg_stat_statements'`, redémarrage, puis `CREATE EXTENSION`). Elle agrège chaque requête normalisée (`$1` à la place des valeurs) :

```sql
SELECT left(query, 60) AS query, calls,
       round(total_exec_time::numeric) AS total_ms,
       round(mean_exec_time::numeric, 2) AS mean_ms,
       rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

Trie par `total_exec_time`, pas par `mean` : une requête de 2 ms appelée 5 millions de fois par jour pèse plus qu'un rapport de 30 s. C'est aussi là que tu repères les N+1 (`calls` énorme).

Autres extensions courantes : `pgcrypto` (hash, chiffrement), `postgis` (géo), `pgvector` (embeddings, recherche vectorielle), `pg_partman` (gestion des partitions), `pg_cron` (jobs planifiés).

## Partitionnement

Une table partitionnée est découpée en sous-tables selon une clé. Pour `events` ou `audit_log` qui grossissent sans fin, on partitionne par mois :

```sql
CREATE TABLE events_p (
  id         uuid NOT NULL DEFAULT uuidv7(),
  tenant_id  bigint NOT NULL,
  type       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE events_p_2026_11 PARTITION OF events_p
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE events_p_2026_12 PARTITION OF events_p
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE INDEX ON events_p (tenant_id, created_at);
```

Ce que ça apporte :

- **Partition pruning** : `WHERE created_at >= '2026-11-01' AND …` ne lit que la partition concernée (visible dans `EXPLAIN`).
- **Purge instantanée** : `DETACH PARTITION` + `DROP TABLE` au lieu d'un `DELETE` de 50 M lignes (qui génère du WAL, du bloat, des heures de VACUUM).
- Maintenance (VACUUM, index) par morceau.

Ce que ça coûte :

- Toute contrainte `UNIQUE`/PK doit **inclure la clé de partition** (`unique constraint on partitioned table must include all partitioning columns`).
- Une requête **sans** la clé de partition lit toutes les partitions.
- Il faut créer les partitions à l'avance (job ou `pg_partman`). Une partition `DEFAULT` évite les inserts en erreur, mais empêche `DETACH … CONCURRENTLY`.

Ne partitionne pas une table de 5 Go : les index suffisent. Le partitionnement devient intéressant vers des centaines de millions de lignes, ou dès que tu as une politique de rétention.

## LISTEN / NOTIFY

Un pub/sub léger intégré :

```sql
-- session du worker
LISTEN order_paid;

-- n'importe où, souvent dans un trigger
SELECT pg_notify('order_paid',
  json_build_object('order_id', 42)::text);
```

La notification n'est envoyée **qu'au commit** de la transaction (et jamais si elle est annulée). Usages : réveiller un worker de jobs au lieu de poller chaque seconde, invalider un cache, pousser un événement en WebSocket.

Limites : pas de persistance (un listener déconnecté rate les messages), payload ≤ 8 000 octets, pas compatible avec PgBouncer en mode transaction (la connexion `LISTEN` doit être dédiée). Le pattern robuste : NOTIFY comme *signal* (« il y a du nouveau »), et la table de jobs ou d'outbox comme *source de vérité*.

## VACUUM, autovacuum et bloat

Avec MVCC ([chapitre 4](/bdd/04-transactions-isolation)), chaque `UPDATE` ou `DELETE` laisse un tuple mort. `VACUUM` :

1. marque l'espace des tuples morts comme réutilisable (sans rendre l'espace à l'OS),
2. met à jour la *visibility map* (indispensable aux index-only scans),
3. « gèle » les vieux tuples pour éviter le *wraparound* des identifiants de transaction (32 bits).

L'**autovacuum** le fait tout seul quand `n_dead_tup > 50 + 20 % de la table` (réglages par défaut). Sur une table de 100 M lignes, ça fait attendre 20 M de tuples morts : trop tard.

```sql
-- les tables qui souffrent
SELECT relname, n_live_tup, n_dead_tup,
       last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC LIMIT 10;

-- réglage par table pour une table très mise à jour
ALTER TABLE jobs SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 1000
);
```

**Bloat** = table ou index plus gros que les données vivantes, parce que l'espace mort n'est pas réutilisé assez vite. Symptômes : la table grossit alors que le nombre de lignes est stable, les seq scans ralentissent. `VACUUM FULL` récupère l'espace mais **verrouille la table exclusivement** pendant toute la réécriture : en prod, on utilise `pg_repack` ou on recrée l'index avec `REINDEX CONCURRENTLY`.

::: danger Ce qui bloque VACUUM
Une transaction ouverte depuis longtemps (`idle in transaction`, réplica avec `hot_standby_feedback`, slot de réplication abandonné) empêche de nettoyer **tout** tuple mort plus récent qu'elle, sur toute la base. Surveille `pg_stat_activity` (`xact_start` ancien) et `pg_replication_slots`.
:::

## Connection pooling

Chaque connexion Postgres est un **processus** (plusieurs Mo de RAM, coût de fork). Au-delà de quelques centaines de connexions actives, la base passe son temps à arbitrer. Or 20 pods × un pool de 20 = 400 connexions, et le serverless est pire.

Deux niveaux :

- **Pool applicatif** (pg/postgres.js côté Node, `sqlx::PgPool` côté Rust) : réutilise les connexions d'un process. Toujours.
- **Pooler externe** (PgBouncer, ou celui de ton hébergeur, ex. Supavisor, RDS Proxy) : multiplexe des milliers de clients sur quelques dizaines de connexions réelles.

| Mode PgBouncer | Connexion serveur rendue | Contraintes |
|---|---|---|
| session | à la déconnexion du client | aucune, mais peu de gain |
| transaction | à la fin de chaque transaction | pas d'état de session |
| statement | après chaque requête | pas de transaction multi-requêtes |

Le mode **transaction** est le standard. Ce qui casse : `SET` (sans `LOCAL`), `LISTEN`, advisory locks de session, tables temporaires gardées d'une transaction à l'autre. Les prepared statements nommés au niveau protocole sont supportés depuis PgBouncer 1.21 (`max_prepared_statements`) ; sur une version plus ancienne, désactive-les côté driver.

Ordre de grandeur pour `max_connections` côté base : quelques centaines, avec un pooler devant. La bonne taille de pool est souvent petite : de l'ordre de 2 à 4 × le nombre de cœurs CPU de la base pour les connexions *actives*.

## Cas réel

**Contexte** : un SaaS e-commerce, table `events` (tracking : vues, clics, commandes), 40 M de lignes par mois, rétention légale de 13 mois. Un job de purge nocturne fait `DELETE FROM events WHERE created_at < now() - interval '13 months'`.

Symptômes après un an : la purge dure 3 h, génère 30 Go de WAL (les réplicas prennent du retard), la table fait 600 Go pour 500 M de lignes vivantes, et les dashboards ralentissent chaque nuit.

Ce qu'on a fait :

1. **Nouvelle table partitionnée par mois** (`events_p`), PK `(id, created_at)`. Les écritures passent dessus ; les anciennes données sont migrées par lots de mois.
2. **Création des partitions à l'avance** par un job (`pg_partman` ou un cron maison qui crée M+1 et M+2).
3. **Purge = `DETACH PARTITION … CONCURRENTLY` + `DROP TABLE`** : quelques millisecondes, zéro WAL de suppression, zéro bloat.
4. Index **BRIN** sur `created_at` dans chaque partition (append-only) au lieu d'un B-tree de 20 Go, et B-tree `(tenant_id, created_at)` pour les dashboards par tenant.
5. Les dashboards filtrent **toujours** sur `created_at` → pruning, quelques partitions lues au lieu de 13.

## Pièges classiques

- Croire qu'une CTE est une « barrière d'optimisation » (vrai avant Postgres 12, plus maintenant).
- CTE récursive sans protection contre les cycles.
- Filtrer sur une window function dans le `WHERE` du même niveau.
- `rank()` quand on veut exactement N lignes (ex-aequo → plus de N) : `row_number()`.
- Tout mettre en JSONB « pour être flexible », puis écrire des requêtes sur `->>` sans index.
- `ILIKE '%x%'` sur une grosse table sans index trigramme.
- `DELETE` massif pour la rétention au lieu de partitions.
- `VACUUM FULL` en prod en pleine journée.
- Transactions ou slots de réplication oubliés qui bloquent VACUUM.
- 500 connexions directes à Postgres depuis des lambdas, sans pooler.

## Défis

**1. Top 3 par tenant.** Écris « les 3 produits les plus vendus en CA par tenant le mois dernier ». Puis : si deux produits sont ex-aequo en 3e position, combien de lignes obtiens-tu avec `rank()`, `dense_rank()`, `row_number()` ?

::: details Solution
La requête complète est dans la section *Top N par groupe*. Sur le jeu de données :

```
 slug   | name                | revenue | rk
--------+---------------------+---------+----
 acme   | Moulin a cafe       |  177.00 |  1
 acme   | Mug isotherme       |   39.80 |  2
 acme   | Cafetiere italienne |   34.50 |  3
 globex | Halteres 2x5kg      |   98.00 |  1
 globex | Tapis de yoga       |   29.99 |  2
 globex | Gourde 1L           |   12.50 |  3
```

Ex-aequo en 3e : `rank()` et `dense_rank()` → 4 lignes (1, 2, 3, 3), `row_number()` → exactement 3, mais l'élu est arbitraire. La différence entre les deux premiers apparaît avec un ex-aequo plus haut : 1, 2, 2 puis `rank()` saute à 4 (3 lignes gardées) alors que `dense_rank()` continue à 3 (4 lignes). Ajoute un départage déterministe (`ORDER BY revenue DESC, product_id`) si tu utilises `row_number()`. La commande 2 (`shipped`) compte : c'est un CA encaissé.
:::

**2. Les produits d'une catégorie et de ses sous-catégories.** Liste les produits rangés dans « Maison » ou n'importe laquelle de ses descendantes, sans doublon.

::: details Solution
```sql
WITH RECURSIVE sub AS (
  SELECT id FROM categories WHERE id = 1   -- Maison
  UNION
  SELECT c.id FROM categories c
  JOIN sub ON c.parent_id = sub.id
)
SELECT DISTINCT p.name
FROM sub
JOIN product_categories pc ON pc.category_id = sub.id
JOIN products p ON p.id = pc.product_id
ORDER BY p.name;
```

Résultat : Cafetiere italienne, Moulin a cafe, Mug isotherme. Le `DISTINCT` est nécessaire : le mug est à la fois dans « Cuisine » et « Cafe ». `UNION` (et non `UNION ALL`) dans la récursion protège contre un éventuel cycle.
:::

**3. Réachat rapide.** Le marketing veut les clients dont la 2e commande (non annulée) est arrivée moins de 30 jours après la 1re, avec l'écart.

::: details Solution
```sql
WITH numbered AS (
  SELECT user_id, created_at,
         row_number() OVER w AS n,
         lag(created_at) OVER w AS prev_at
  FROM orders
  WHERE status <> 'cancelled'
  WINDOW w AS (PARTITION BY user_id ORDER BY created_at)
)
SELECT u.name, n.created_at - n.prev_at AS gap
FROM numbered n
JOIN users u ON u.id = n.user_id
WHERE n.n = 2
  AND n.created_at - n.prev_at < interval '30 days'
ORDER BY gap;
```

Frank (10 jours), Bob (15 jours) et, selon le jour où tu as chargé les données, Bob G. Le filtre sur `n` est dans la requête externe : les window functions sont calculées après le `WHERE`. Le filtre `status <> 'cancelled'` est, lui, appliqué **avant** la numérotation, c'est voulu.
:::

**4. L'index JSONB ignoré.** Avec `products_attrs_gin (attributes jsonb_path_ops)`, cette requête fait un seq scan. Pourquoi ? Réécris-la.

```sql
SELECT sku FROM products
WHERE attributes->>'color' = 'noir';
```

::: details Solution
`attributes->>'color'` est une expression ; un index GIN `jsonb_path_ops` ne sert que les opérateurs `@>`, `@?`, `@@` sur la colonne entière. Le plan montre `Filter: ((attributes ->> 'color') = 'noir')`.

```sql
SELECT sku FROM products
WHERE attributes @> '{"color": "noir"}';
```

Plan : `Bitmap Index Scan on products_attrs_gin`. Alternative si la couleur est un filtre fréquent : `CREATE INDEX ON products ((attributes->>'color'))`, ou une colonne générée.
:::

**5. Recherche support.** Le support tape « dupont » pour trouver un client par email ou nom. Aujourd'hui : `WHERE email ILIKE '%dupont%' OR name ILIKE '%dupont%'` sur 3 M d'utilisateurs, 1,2 s. Que proposes-tu ?

::: details Solution
`pg_trgm` + index GIN sur chaque colonne :

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY users_email_trgm
  ON users USING gin (email gin_trgm_ops);
CREATE INDEX CONCURRENTLY users_name_trgm
  ON users USING gin (name gin_trgm_ops);
```

Le `OR` se traduit en `BitmapOr` des deux index. Ajoute `tenant_id = $1` (le support d'un tenant ne cherche que chez lui) et un `LIMIT`. Les trigrammes demandent au moins 3 caractères dans le motif pour être efficaces : impose une saisie minimale côté UI. Pour la recherche produits *en langue naturelle*, préfère le full-text.
:::

**6. La table jobs qui gonfle.** La table `jobs` du chapitre 4 contient ~5 000 lignes vivantes mais fait 8 Go. `n_dead_tup` est à 40 M. Explique et propose un plan d'action.

::: details Solution
Chaque job subit plusieurs `UPDATE` (queued → running → done) : autant de tuples morts. Deux causes possibles, à vérifier dans cet ordre :

1. Une **transaction longue** ou un slot de réplication inactif empêche le nettoyage : `SELECT pid, state, xact_start FROM pg_stat_activity ORDER BY xact_start` et `SELECT slot_name, active FROM pg_replication_slots`. Tant qu'elle existe, aucun VACUUM ne peut aider.
2. Autovacuum trop paresseux : `ALTER TABLE jobs SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_vacuum_threshold = 1000)`.

Ensuite, récupérer l'espace : `pg_repack` (sans verrou long), pas `VACUUM FULL` en journée. Et à la source : supprimer (ou archiver) les jobs `done` régulièrement, éventuellement dans une table partitionnée par jour pour purger par `DROP`.
:::

**7. Partition et unicité.** Un dev crée `events_p` avec `id uuid PRIMARY KEY` et `PARTITION BY RANGE (created_at)`. Quelle erreur, pourquoi, et que perd-on avec `PRIMARY KEY (id, created_at)` ?

::: details Solution
```
ERROR: unique constraint on partitioned table must include
       all partitioning columns
```

Chaque partition a ses propres index ; Postgres ne sait garantir l'unicité que **dans** une partition. Si la clé de partition fait partie de la contrainte, deux lignes identiques tombent forcément dans la même partition, donc l'unicité locale suffit.

Avec `(id, created_at)`, on ne garantit plus que `id` seul est unique : en théorie, le même `id` avec deux dates différentes passerait. Avec des UUIDv7 générés par la base, le risque est nul en pratique. Une FK depuis une autre table devra aussi référencer `(id, created_at)`.
:::

## À retenir

- CTE pour la lisibilité (inlinées depuis PG 12), `WITH RECURSIVE` pour les arbres et graphes.
- Window functions = calcul sur un groupe sans écraser les lignes : top N, cumul, `lag`, moyennes mobiles.
- JSONB pour les attributs variables, interrogé avec `@>` et indexé en GIN ; une clé filtrée partout mérite une colonne.
- Full-text pour la recherche en langage naturel, `pg_trgm` pour le « contient » et la tolérance aux fautes.
- Partitionner pour la rétention et les très grosses tables ; la clé de partition doit être dans les contraintes uniques.
- Surveille autovacuum et les transactions longues ; mets un pooler en mode transaction devant Postgres.
