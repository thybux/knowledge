# MySQL

Ce que tu vas apprendre : MySQL 8.4 LTS vu par quelqu'un qui connaît Postgres. Le moteur InnoDB et son index clusterisé (qui change tout pour le choix de la PK), les différences de syntaxe et de comportement qui piègent, l'isolation `REPEATABLE READ` et ses gap locks, la réplication, et quand choisir MySQL.

Tous les exemples ont été testés sur MySQL 8.4 (`docker run -e MYSQL_ROOT_PASSWORD=… mysql:8.4`).

## Le fil rouge en MySQL

```sql
CREATE TABLE products (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  sku        VARCHAR(64) NOT NULL,
  name       VARCHAR(255) NOT NULL,
  price      DECIMAL(12, 2) NOT NULL CHECK (price >= 0),
  stock      INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  attributes JSON NOT NULL DEFAULT (JSON_OBJECT()),
  created_at DATETIME(6) NOT NULL
             DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_tenant_sku (tenant_id, sku),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE = InnoDB;
```

| Postgres | MySQL 8.4 |
|---|---|
| `bigint GENERATED … AS IDENTITY` | `BIGINT AUTO_INCREMENT` |
| `numeric(12, 2)` | `DECIMAL(12, 2)` |
| `text` | `VARCHAR(n)` (indexable) / `TEXT` (préfixe seulement) |
| `timestamptz` | `DATETIME(6)` + tout en UTC côté app |
| `jsonb` | `JSON` (binaire aussi) |
| `uuid` | `BINARY(16)` |
| `boolean` | `TINYINT(1)` (`BOOLEAN` est un alias) |
| `CHECK (status IN …)` | `ENUM(…)` ou `CHECK` |

Les `CHECK` sont appliqués depuis 8.0.16 (avant, ils étaient parsés puis ignorés : méfie-toi des vieux tutos) :

```
INSERT INTO products (…, price) VALUES (…, -1);
ERROR 3819 (HY000): Check constraint 'products_chk_1'
                    is violated.
```

### Les types qui piègent

- **`TIMESTAMP`** est stocké en UTC et converti selon le `time_zone` de la session, mais il **s'arrête en 2038** (`Incorrect datetime value: '2040-01-01'`). `DATETIME` n'a pas de fuseau : stocke de l'UTC et convertis dans l'app.
- **`utf8`** est un alias de `utf8mb3` (3 octets max, pas d'emoji). Utilise **`utf8mb4`**, le défaut depuis 8.0.
- **La collation par défaut** `utf8mb4_0900_ai_ci` est insensible à la casse **et aux accents** : `WHERE name = 'MUG ISOTHÈRME'` trouve « Mug isotherme ». Pratique pour une recherche, surprenant pour un `UNIQUE` (`'élise'` et `'Elise'` sont des doublons). Collation `utf8mb4_0900_as_cs` ou `utf8mb4_bin` pour une comparaison stricte.
- **`ENUM`** : ajouter une valeur à la fin est instantané, mais les valeurs sont triées par position, pas par ordre alphabétique.

## InnoDB et l'index clusterisé

C'est **la** différence d'architecture avec Postgres.

- **Postgres** : la table (*heap*) est un tas de lignes sans ordre ; chaque index (PK comprise) pointe vers une position physique.
- **InnoDB** : la table **est** le B-tree de la clé primaire. Les lignes sont stockées dans les feuilles, triées par PK. Les index secondaires stockent **la valeur de la PK**, pas une position.

```
PK (clustered)            index secondaire (tenant_id, sku)
[id=1 | ligne complète]   [(1,'CAF-01') → id=2]
[id=2 | ligne complète]   [(1,'MUG-01') → id=1]
[id=3 | ligne complète]
```

Une recherche par index secondaire = deux descentes de B-tree : l'index secondaire donne l'`id`, puis la PK donne la ligne.

Conséquences sur le choix de PK :

1. **PK courte** : elle est recopiée dans *chaque* index secondaire. Une PK `VARCHAR(255)` ou composite large gonfle tous les index.
2. **PK croissante** : chaque insertion va à la fin du B-tree. Une PK aléatoire (UUIDv4) insère au milieu des pages → *page splits*, pages à moitié vides, cache inefficace. L'impact est bien plus fort qu'en Postgres, car c'est **la table entière** qui est réorganisée, pas juste un index.
3. **Les requêtes par plage de PK sont très rapides** (lignes contiguës sur disque). Une PK composite `(tenant_id, id)` regroupe physiquement les données d'un tenant : un vrai levier en multi-tenant.
4. **Sans PK explicite**, InnoDB en crée une cachée (`DB_ROW_ID`) : toujours déclarer une PK.

Pour des UUID en MySQL : `BINARY(16)` (pas `CHAR(36)`, 2× plus gros et comparaison de chaînes), et une version ordonnée dans le temps. MySQL n'a pas de générateur v7 natif : génère un UUIDv7 dans l'app, ou utilise `UUID_TO_BIN(UUID(), 1)` qui réordonne les bits d'un UUIDv1 pour mettre le timestamp en tête.

Index **couvrant** : comme chaque index secondaire contient la PK, `SELECT id FROM products WHERE tenant_id = ? AND sku = ?` est servi entièrement par l'index `uq_tenant_sku` (`Using index` dans `EXPLAIN`). Pas de visibility map à maintenir comme en Postgres.

## Différences de syntaxe et de comportement

### Upsert : ON DUPLICATE KEY UPDATE

```sql
INSERT INTO products (tenant_id, sku, name, price, stock)
VALUES (1, 'MUG-01', 'Mug isotherme', 21.90, 30) AS new
ON DUPLICATE KEY UPDATE
  price = new.price,
  stock = products.stock + new.stock;
```

- L'alias de ligne `AS new` (8.0.19+) remplace `VALUES(col)`, déprécié.
- Il réagit à **n'importe quelle** contrainte unique violée, pas à une cible choisie comme `ON CONFLICT (tenant_id, sku)`. Avec plusieurs index uniques, le comportement devient difficile à prévoir.
- `ROW_COUNT()` vaut 1 (insert), 2 (update) ou 0 (rien changé).
- `INSERT IGNORE` ≈ `ON CONFLICT DO NOTHING`, mais il transforme **aussi** d'autres erreurs en warnings (valeurs tronquées…). Préfère `ON DUPLICATE KEY UPDATE id = id`.

### Pas de RETURNING

MySQL n'a pas de `RETURNING`. Après un insert : `LAST_INSERT_ID()` (premier id du lot). Pour un `UPDATE … WHERE stock >= 1`, vérifie le nombre de lignes affectées (`affectedRows` dans le driver), puis relis si besoin.

### Autres différences qui mordent

| Sujet | Postgres | MySQL |
|---|---|---|
| DDL en transaction | oui, `ROLLBACK` possible | **commit implicite** |
| Index partiel | `WHERE …` | non (index fonctionnel ou colonne générée) |
| Index sur expression | oui | oui depuis 8.0.13 (`((lower(email)))`) |
| `NULL`-safe égal | `IS NOT DISTINCT FROM` | `<=>` |
| Concaténation | `\|\|` | `CONCAT()` (`\|\|` = OR logique par défaut) |
| Booléens | vrai type | entiers 0/1 |
| CTE, window functions | oui | oui depuis 8.0 |
| `FOR UPDATE SKIP LOCKED` | oui | oui depuis 8.0 |
| Séquences | oui | non (`AUTO_INCREMENT` seulement) |
| `EXPLAIN ANALYZE` | oui | oui (8.0.18+, format arbre) |

Les migrations sont donc plus risquées : si l'étape 3 sur 5 échoue, les deux premiers `ALTER TABLE` sont déjà appliqués. Garde une migration = un changement.

En contrepartie, beaucoup d'`ALTER TABLE` sont **online** : `ADD COLUMN` en `ALGORITHM=INSTANT` (métadonnées seulement), création d'index sans bloquer les écritures. Pour les cas lourds : `gh-ost` ou `pt-online-schema-change`.

`sql_mode` strict est le défaut en 8.x (`STRICT_TRANS_TABLES`, `ONLY_FULL_GROUP_BY`…) : une valeur trop longue est refusée au lieu d'être tronquée, et `SELECT status, count(*) … GROUP BY tenant_id` est rejeté. Ne le désactive jamais pour « faire passer » une vieille requête.

## Isolation : REPEATABLE READ et gap locks

Le défaut d'InnoDB est **`REPEATABLE READ`** (Postgres : `READ COMMITTED`). Mais il ne veut pas dire la même chose.

### Lecture cohérente vs lecture courante

- Un `SELECT` simple lit le **snapshot** pris au premier `SELECT` de la transaction.
- Un `UPDATE`, `DELETE` ou `SELECT … FOR UPDATE` lit la **dernière version commitée** (*current read*) et la verrouille.

Testé : T1 lit `stock = 40`, T2 retire 10 et commit, T1 relit 40 (snapshot), puis fait `UPDATE … SET stock = stock - 1` :

```
t1_read          40
t1_reread        40     ← snapshot
t1_after_update  29     ← 40 - 10 - 1 : l'UPDATE a lu la vraie valeur
```

Pas d'erreur de sérialisation comme en Postgres `REPEATABLE READ` : l'`UPDATE` relatif est correct, mais un read-modify-write côté app (`SET stock = 39`) écraserait silencieusement la vente de T2. Les règles du [chapitre 4](/bdd/04-transactions-isolation) restent : écriture atomique ou `FOR UPDATE`.

### Gap locks et next-key locks

Pour empêcher les phantoms, InnoDB verrouille en `REPEATABLE READ` non seulement les lignes trouvées, mais aussi **les intervalles entre elles** (*gap locks*, et *next-key lock* = ligne + intervalle précédent).

```sql
-- T1
BEGIN;
SELECT id FROM orders
WHERE tenant_id = 1 AND created_at >= '2020-01-01'
FOR UPDATE;

-- T2 : bloquée jusqu'au COMMIT de T1
INSERT INTO orders (tenant_id, user_id, total, created_at)
VALUES (1, 9, 1, NOW());
```

Le piège classique : le **« check-then-insert »** avec une clé qui n'existe pas encore.

```sql
-- deux requêtes avec la même clé d'idempotence, en parallèle
BEGIN;
SELECT * FROM idem WHERE k = 'p' FOR UPDATE;  -- rien
-- → gap lock sur l'intervalle ('m', 'z')
INSERT INTO idem VALUES ('p', 1);
COMMIT;
```

Les deux transactions obtiennent le gap lock (compatibles entre eux), puis chacune attend l'autre pour insérer :

```
ERROR 1213 (40001): Deadlock found when trying to get lock;
try restarting transaction
```

Correctifs : insérer directement et gérer le doublon (`INSERT … ON DUPLICATE KEY UPDATE`), ou passer en `READ COMMITTED` (gap locks quasi désactivés, ce que font beaucoup d'équipes à grosse charge), et toujours prévoir un retry sur 1213.

Les gap locks dépendent des **index** : un `UPDATE … WHERE colonne_non_indexée = ?` en `REPEATABLE READ` verrouille tous les enregistrements parcourus, donc potentiellement toute la table.

## Réplication

MySQL réplique via le **binlog** (journal des changements, format `ROW` par défaut) :

- **Asynchrone** (défaut) : le primaire n'attend pas les réplicas. Lag possible, perte des dernières transactions si le primaire meurt.
- **Semi-synchrone** : le commit attend qu'au moins un réplica ait *reçu* l'événement.
- **GTID** : chaque transaction a un identifiant global, ce qui simplifie le failover et le repositionnement des réplicas. À activer.
- **Group Replication / InnoDB Cluster** : réplication par consensus avec failover automatique, via MySQL Router.

En 8.4, la terminologie `MASTER/SLAVE` a été retirée : `CHANGE REPLICATION SOURCE TO`, `START REPLICA`, `SHOW REPLICA STATUS` (colonne `Seconds_Behind_Source` pour le lag).

Les problèmes de lag et de « read-your-writes » sont les mêmes qu'en Postgres : voir [Choisir & scaler](/bdd/09-choisir-et-scaler).

## Quand choisir MySQL

Choisis MySQL si :

- l'équipe ou l'hébergeur le maîtrise déjà (c'est un argument valable : l'ops compte plus que les features) ;
- l'écosystème l'impose (WordPress, Magento, beaucoup de PHP/Laravel historique) ;
- tu vises le sharding horizontal avec **Vitess** (PlanetScale, YouTube, Slack l'utilisent) ;
- la charge est très majoritairement des lookups par PK, où l'index clusterisé brille.

Choisis plutôt Postgres pour : un schéma riche en contraintes, du JSONB indexé, du full-text, des extensions (PostGIS, pgvector), des migrations transactionnelles, RLS. Pour un nouveau SaaS sans contrainte particulière, Postgres est le choix par défaut en 2026 ; MySQL n'est pas un mauvais choix pour autant.

## Cas réel

**Contexte** : un SaaS e-commerce historique en MySQL. Les `order_events` ont une PK `CHAR(36)` remplie avec `UUID()` en texte. La table fait 400 Go, les inserts ralentissent au fil des mois, et les index secondaires sont énormes.

Diagnostic :

1. `CHAR(36)` en utf8mb4 : jusqu'à 144 octets réservés par clé, recopiés dans chacun des 4 index secondaires.
2. Les UUID textuels ne sont pas ordonnés dans le temps : chaque insert tombe au hasard dans le B-tree **de la table** → page splits, pages remplies à ~50-60 %, working set qui ne tient plus en RAM (buffer pool).

Migration (avec `gh-ost`, sans downtime) :

- PK `BIGINT UNSIGNED AUTO_INCREMENT` pour l'ordre physique ;
- l'UUID public conservé en `BINARY(16)` avec un `UNIQUE` (pour les APIs qui l'exposent), les nouveaux étant générés en v7 côté app ;
- résultat : table et index divisés par ~2,5, inserts redevenus constants.

Variante multi-tenant : PK `(tenant_id, id)` pour que les données d'un même tenant soient contiguës (les requêtes « toutes les commandes du tenant X » lisent beaucoup moins de pages).

## Pièges classiques

- `utf8` au lieu de `utf8mb4` (emoji refusés ou tronqués).
- `TIMESTAMP` pour des dates après 2038.
- Collation `_ai_ci` sur une colonne `UNIQUE` où la casse ou les accents comptent.
- UUID textuels (`CHAR(36)`) ou aléatoires en PK.
- Croire que `REPEATABLE READ` MySQL = `REPEATABLE READ` Postgres.
- Check-then-insert sous `REPEATABLE READ` → deadlocks.
- Une migration à plusieurs `ALTER` dans une « transaction » (commit implicite).
- `INSERT IGNORE` qui masque des erreurs de données.
- `||` pour concaténer (c'est un OR).
- Oublier les retries sur 1213 (deadlock) et 1205 (lock wait timeout).

## Défis

**1. Traduis cet upsert Postgres** en MySQL 8.4, en gardant la sémantique, et indique ce qui change.

```sql
INSERT INTO products (tenant_id, sku, name, price, stock)
VALUES (1, 'MUG-01', 'Mug isotherme', 21.90, 30)
ON CONFLICT (tenant_id, sku) DO UPDATE
SET price = EXCLUDED.price,
    stock = products.stock + EXCLUDED.stock
RETURNING id, stock;
```

::: details Solution
```sql
INSERT INTO products (tenant_id, sku, name, price, stock)
VALUES (1, 'MUG-01', 'Mug isotherme', 21.90, 30) AS new
ON DUPLICATE KEY UPDATE
  price = new.price,
  stock = products.stock + new.stock;

SELECT id, stock FROM products
WHERE tenant_id = 1 AND sku = 'MUG-01';
```

Différences : pas de cible de conflit (déclenché par **n'importe quel** index unique, y compris la PK), pas de `RETURNING` (relire, ou `LAST_INSERT_ID()` pour l'insert), et `ROW_COUNT()` = 2 pour signaler une mise à jour. Testé : stock 120 → 150.
:::

**2. Pourquoi la PK compte plus qu'en Postgres ?** Un collègue propose `id CHAR(36) PRIMARY KEY DEFAULT (UUID())` sur une table de 200 M lignes avec 5 index secondaires. Donne deux raisons de refuser, chiffrées grossièrement.

::: details Solution
1. **Taille** : la PK est copiée dans chaque index secondaire. `CHAR(36)` en utf8mb4 peut réserver jusqu'à 144 octets (36 caractères × 4), contre 8 pour un `BIGINT` (16 pour un `BINARY(16)`). Sur 200 M lignes × 5 index : des dizaines de Go de plus, juste en copies de clé.
2. **Ordre** : la table **est** le B-tree de la PK. `UUID()` (v1) en texte n'est pas trié chronologiquement (les bits de temps de poids faible viennent en premier), donc les insertions tombent au hasard → page splits, pages à moitié pleines, buffer pool saturé.

Alternative : `BIGINT AUTO_INCREMENT` en PK + UUIDv7 `BINARY(16) UNIQUE` pour l'identifiant public.
:::

**3. Le deadlock de l'idempotence.** Explique pourquoi ce code tombe en `Deadlock found` quand le client envoie deux fois la même requête simultanément, alors que la clé n'existe pas encore. Corrige.

```sql
BEGIN;
SELECT * FROM idem WHERE k = ? FOR UPDATE;
-- si aucune ligne :
INSERT INTO idem (k, v) VALUES (?, ?);
COMMIT;
```

::: details Solution
En `REPEATABLE READ`, le `SELECT … FOR UPDATE` sur une clé absente pose un **gap lock** sur l'intervalle où elle serait. Les gap locks sont compatibles entre eux : les deux transactions l'obtiennent. Chaque `INSERT` demande alors un *insert intention lock* sur cet intervalle, bloqué par le gap lock de l'autre → cycle → `ERROR 1213`.

Correctif : insérer d'abord et laisser la contrainte unique arbitrer.

```sql
INSERT INTO idem (k, v) VALUES (?, ?)
ON DUPLICATE KEY UPDATE k = k;
-- ROW_COUNT() = 1 : on est le premier, on traite
-- ROW_COUNT() = 0 : doublon, on renvoie la réponse stockée
```

Ou passer la session en `READ COMMITTED`, où les gap locks ne sont pas utilisés pour les recherches. Dans tous les cas, retry sur 1213.
:::

**4. Que renvoie T1 ?** `stock = 40`. Les deux transactions sont en `REPEATABLE READ` (défaut MySQL).

```
T1: BEGIN; SELECT stock FROM products WHERE id = 2;
T2: UPDATE products SET stock = stock - 10 WHERE id = 2;
    -- autocommit
T1: SELECT stock FROM products WHERE id = 2;
T1: UPDATE products SET stock = stock - 1 WHERE id = 2;
T1: SELECT stock FROM products WHERE id = 2;
```

Et en Postgres `REPEATABLE READ` ?

::: details Solution
MySQL : 40, 40, puis **29**. Le second `SELECT` lit le snapshot ; l'`UPDATE` est une *current read* qui voit la valeur commitée (30) et écrit 29 ; ensuite la transaction voit sa propre écriture.

Postgres `REPEATABLE READ` : 40, 40, puis l'`UPDATE` échoue avec `could not serialize access due to concurrent update` (la ligne a changé après le snapshot). Il faut retenter la transaction. Postgres préfère l'erreur, MySQL la lecture de la dernière version : deux philosophies, à connaître avant de porter du code de l'un à l'autre.
:::

**5. La migration à moitié appliquée.** Un script de migration MySQL fait `BEGIN; ALTER TABLE orders ADD COLUMN currency CHAR(3); ALTER TABLE orders ADD INDEX …; UPDATE … (échoue); ROLLBACK;`. Dans quel état est la base ?

::: details Solution
La colonne et l'index **existent** : chaque `ALTER TABLE` provoque un commit implicite (avant et après l'instruction), le `ROLLBACK` n'annule que ce qui a suivi le dernier DDL. Testé : `BEGIN; CREATE TABLE t2 …; ROLLBACK;` → `t2` existe.

Conséquences : écrire des migrations **idempotentes** et unitaires (une modification par fichier), séparer DDL et backfill de données, et prévoir la reprise manuelle. En Postgres, le même script serait entièrement annulé (sauf `CREATE INDEX CONCURRENTLY`, qui ne peut pas tourner dans une transaction).
:::

**6. Doublons fantômes.** Le support signale que l'inscription refuse `Élise@mail.com` parce que `elise@mail.com` existe, dans un autre compte. La colonne `email VARCHAR(255) UNIQUE` utilise la collation par défaut. Explique et propose un correctif.

::: details Solution
`utf8mb4_0900_ai_ci` est *accent-insensitive* et *case-insensitive* : `'Élise@mail.com' = 'elise@mail.com'` est vrai, donc l'index unique les considère identiques. Pour les emails, l'insensibilité à la casse est souhaitable, celle aux accents non : deux adresses différentes.

Correctif : `ALTER TABLE users MODIFY email VARCHAR(255) COLLATE utf8mb4_0900_as_ci NOT NULL` (sensible aux accents, insensible à la casse), en vérifiant d'abord les doublons existants. La même question se pose pour les SKU, les slugs, les codes promo.
:::

## À retenir

- InnoDB : la table est le B-tree de la PK, les index secondaires contiennent la PK. PK courte et croissante.
- `utf8mb4`, `DATETIME(6)` en UTC, `DECIMAL` pour l'argent, `BINARY(16)` pour les UUID.
- `ON DUPLICATE KEY UPDATE … AS new`, pas de `RETURNING`, DDL non transactionnel.
- `REPEATABLE READ` par défaut : snapshot pour les `SELECT`, dernière version pour les écritures, gap locks contre les phantoms → deadlocks sur check-then-insert.
- Réplication par binlog, GTID ; 8.4 parle de `SOURCE`/`REPLICA`.
- Postgres par défaut pour un nouveau projet ; MySQL quand l'écosystème, l'équipe ou Vitess le justifient.
