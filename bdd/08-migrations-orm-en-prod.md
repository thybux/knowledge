# Migrations, ORM & prod

Ce que tu vas apprendre : faire évoluer un schéma en prod sans downtime (expand/contract, colonnes NOT NULL, index `CONCURRENTLY`, renommages), choisir entre ORM et query builder en TypeScript et en Rust, et mettre en place des backups qui permettent vraiment de restaurer, à la seconde près.

## Pourquoi une migration casse la prod

Deux raisons, presque toujours :

1. **Le verrou.** Un `ALTER TABLE` prend un verrou `ACCESS EXCLUSIVE` : plus personne ne lit ni n'écrit la table. S'il réécrit 50 Go, c'est 10 minutes d'indisponibilité.
2. **Le décalage code/schéma.** Pendant un déploiement progressif, l'ancienne et la nouvelle version du code tournent **en même temps** contre le **même** schéma. Une colonne renommée d'un coup = l'ancienne version plante.

### La file d'attente des verrous

Le piège que même les seniors oublient : un `ALTER TABLE` instantané peut quand même bloquer toute l'app.

```
T1 (rapport, 2 min) : SELECT … FROM orders   → AccessShare
T2 (migration)      : ALTER TABLE orders …   → attend T1
T3…T500 (l'API)     : SELECT … FROM orders   → attendent T2 !
```

Les verrous sont servis dans l'ordre : T2 attend T1, et toutes les requêtes suivantes attendent derrière T2. L'API est figée 2 minutes pour une migration « de 5 ms ». Parade : **toujours** un `lock_timeout` dans les migrations, et retenter.

```sql
SET lock_timeout = '2s';
ALTER TABLE orders ADD COLUMN channel text;
-- ERROR: canceling statement due to lock timeout
-- → on retente plus tard, l'API n'a attendu que 2 s
```

## Expand / contract

Le principe de toute migration zero-downtime : ne jamais faire un changement incompatible en une étape. On **élargit** le schéma (compatible avec l'ancien et le nouveau code), on migre le code et les données, puis on **contracte**.

```
1. expand    : ajouter (colonne, table, index) — rétrocompatible
2. migrate   : déployer le code qui écrit les deux / lit le nouveau
3. backfill  : remplir l'existant, par lots
4. switch    : le code ne lit/écrit plus que le nouveau
5. contract  : supprimer l'ancien (déploiement séparé)
```

Chaque étape est un déploiement distinct, et chacune peut être annulée sans perte.

## Les opérations, une par une (Postgres)

| Opération | Bloquante ? | Version sûre |
|---|---|---|
| `ADD COLUMN` nullable | non (métadonnées) | telle quelle + `lock_timeout` |
| `ADD COLUMN … DEFAULT 'x'` (constante) | non depuis PG 11 | telle quelle |
| `ADD COLUMN … DEFAULT gen_random_uuid()` | **réécrit la table** | ajouter sans défaut, backfill |
| `SET NOT NULL` | scan complet sous verrou | via `CHECK … NOT VALID` |
| `CREATE INDEX` | bloque les écritures | `CONCURRENTLY` |
| `ADD FOREIGN KEY` / `CHECK` | scan sous verrou | `NOT VALID` puis `VALIDATE` |
| `ALTER COLUMN TYPE` | réécrit souvent la table | nouvelle colonne + expand/contract |
| `RENAME COLUMN` | instantané, mais casse le code | expand/contract |
| `DROP COLUMN` | instantané | après que plus aucun code ne la lit |

Mesuré sur le labo du [chapitre 3](/bdd/03-index-et-explain) (1 M de commandes) : `ADD COLUMN channel text NOT NULL DEFAULT 'web'` en 24 ms, `ADD COLUMN ref uuid NOT NULL DEFAULT gen_random_uuid()` en 1,7 s, verrou exclusif compris. Sur 100 M de lignes, la seconde prend plusieurs minutes de downtime.

### Créer un index sans bloquer

```sql
CREATE INDEX CONCURRENTLY orders_tenant_status_idx
  ON orders (tenant_id, status, created_at DESC);
```

- Plus lent (deux passes sur la table) mais n'empêche pas les écritures.
- **Impossible dans une transaction** (`CREATE INDEX CONCURRENTLY cannot run inside a transaction block`) : beaucoup d'outils de migration enveloppent chaque fichier dans un `BEGIN`, il faut le désactiver pour ce fichier.
- S'il échoue (doublon pour un index unique, timeout), il laisse un index **`INVALID`** : il ralentit les écritures sans servir les lectures. `DROP INDEX CONCURRENTLY` puis recommencer.
- Même logique pour reconstruire : `REINDEX INDEX CONCURRENTLY`.

### Ajouter une colonne NOT NULL à une grosse table

Objectif : `orders.amount_cents bigint NOT NULL`.

```sql
-- 1. expand : colonne nullable (instantané)
ALTER TABLE orders ADD COLUMN amount_cents bigint;
```

Déploiement : le code écrit `amount_cents` pour toute nouvelle commande ou modification.

```sql
-- 2. backfill par lots (à répéter jusqu'à 0 ligne)
UPDATE orders SET amount_cents = (total * 100)::bigint
WHERE id IN (
  SELECT id FROM orders
  WHERE amount_cents IS NULL
  LIMIT 10000
  FOR UPDATE SKIP LOCKED
);
```

Des lots de quelques milliers de lignes : chaque transaction est courte, les verrous sont brefs, VACUUM et la réplication suivent. Un seul `UPDATE` sur 100 M de lignes, c'est une transaction de 40 minutes, du bloat et des réplicas en retard.

```sql
-- 3. contrainte sans scan, puis validation sans bloquer
ALTER TABLE orders ADD CONSTRAINT amount_cents_nn
  CHECK (amount_cents IS NOT NULL) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT amount_cents_nn;

-- 4. SET NOT NULL réutilise la contrainte : pas de scan
ALTER TABLE orders ALTER COLUMN amount_cents SET NOT NULL;
ALTER TABLE orders DROP CONSTRAINT amount_cents_nn;
```

`NOT VALID` : la contrainte s'applique aux nouvelles écritures sans vérifier l'existant. `VALIDATE` scanne avec un verrou léger (`SHARE UPDATE EXCLUSIVE`) qui laisse passer lectures et écritures. Et Postgres le confirme (`client_min_messages = debug1`) : *existing constraints on column "orders.amount_cents" are sufficient to prove that it does not contain nulls*.

Postgres 18 simplifie : `ALTER TABLE orders ADD CONSTRAINT amount_cents_nn NOT NULL amount_cents NOT VALID;` puis `VALIDATE CONSTRAINT`.

::: warning L'ordre compte
Une contrainte `NOT VALID` s'applique à **toute nouvelle version de ligne**, y compris un `UPDATE` sur une vieille ligne qui ne touche pas la colonne. Si tu ajoutes la contrainte **avant** le backfill, toute modification d'une ancienne commande échoue (`violates not-null constraint`). Backfill d'abord, contrainte ensuite.
:::

### Clés étrangères

```sql
ALTER TABLE orders
  ADD CONSTRAINT orders_user_same_tenant
  FOREIGN KEY (tenant_id, user_id)
  REFERENCES users (tenant_id, id) NOT VALID;

ALTER TABLE orders
  VALIDATE CONSTRAINT orders_user_same_tenant;
```

### Renommer une colonne

`ALTER TABLE users RENAME COLUMN name TO full_name` est instantané… et fait planter tous les pods qui tournent encore avec l'ancien code. En expand/contract :

1. ajouter `full_name` ;
2. déployer : écrire dans les deux colonnes (ou trigger de synchro), lire `name` ;
3. backfill `full_name` depuis `name` ;
4. déployer : lire `full_name` (on écrit toujours les deux) ;
5. déployer : n'écrire que `full_name` ;
6. `DROP COLUMN name`.

Six étapes pour un renommage : souvent, la bonne réponse est « on ne renomme pas ». Si c'est vraiment nécessaire, c'est le prix d'un déploiement sans coupure. Même principe pour **changer un type** (`int` → `bigint`, `text` → `jsonb`) ou **découper une table**.

### Supprimer une colonne

Avant le `DROP`, plus **aucun** code ne doit la référencer, y compris dans un `SELECT *` mis en cache, une requête préparée, ou un ORM qui liste toutes les colonnes du modèle. Prisma et la plupart des ORM génèrent la liste explicite des colonnes : supprime-la du modèle et déploie **avant** de la dropper.

## Outillage des migrations

- Fichiers versionnés, appliqués dans l'ordre, une table de suivi (`_migrations`). Jamais de modification manuelle en prod.
- **Forward-only** en pratique : le `down` d'une migration qui a supprimé des données ne les ressuscite pas. Le vrai rollback, c'est une nouvelle migration (ou l'expand/contract qui garde l'ancien).
- Les migrations tournent **avant** le déploiement du code (étapes expand) ou **après** (contract), dans un job dédié de la CI/CD ([CI/CD](/infra/05-ci-cd-github-actions)), pas au démarrage de chaque pod (20 pods qui migrent en même temps…).
- Teste chaque migration sur une copie de la prod (volume réaliste) : c'est là qu'on découvre le `ALTER` de 12 minutes.
- Linter de migrations (ex. `squawk` pour Postgres) dans la CI : il signale `CREATE INDEX` sans `CONCURRENTLY`, `SET NOT NULL` direct, etc.

## ORM vs query builder

| Approche | TypeScript | Rust |
|---|---|---|
| SQL brut typé | `postgres.js`, `pg` + types | **SQLx** (`query!` vérifié à la compilation) |
| Query builder | **Kysely**, **Drizzle** | SeaQuery, Diesel (DSL) |
| ORM complet | **Prisma**, TypeORM, MikroORM | **SeaORM**, Diesel |

### Côté TypeScript

**Drizzle** : schéma déclaré en TypeScript, requêtes qui ressemblent à du SQL, types inférés, pas de moteur intermédiaire.

```ts
const rows = await db
  .select({ id: orders.id, total: orders.total })
  .from(orders)
  .where(and(eq(orders.tenantId, tenantId),
             eq(orders.status, "paid")))
  .orderBy(desc(orders.createdAt))
  .limit(50);
```

**Prisma** : schéma dans un fichier `schema.prisma`, client généré, API haut niveau (`include` pour les relations), migrations intégrées. Très productif pour du CRUD ; moins naturel pour du SQL avancé (CTE, window functions, `FOR UPDATE SKIP LOCKED`), où l'on retombe sur `$queryRaw` ou TypedSQL.

```ts
const order = await prisma.order.findFirst({
  where: { id, tenantId },
  include: { items: { include: { product: true } } },
});
```

Points de vigilance communs :

- Regarde le SQL généré (logs de requêtes) : un `include` imbriqué peut produire plusieurs requêtes ou d'énormes jointures.
- `numeric` arrive souvent en **string** (ou `Decimal`) côté JS : c'est voulu, ne le convertis pas en `number` pour faire des calculs d'argent.
- Les migrations générées automatiquement par diff de schéma ne connaissent pas le zero-downtime : relis chaque fichier, ajoute `CONCURRENTLY`, `NOT VALID`, découpe les renommages.

### Côté Rust

**SQLx** : pas d'ORM, du SQL écrit à la main, **vérifié à la compilation** contre une vraie base (ou un cache `sqlx prepare` pour la CI hors ligne). Async, Postgres/MySQL/SQLite.

```rust
let rows = sqlx::query_as!(
    OrderRow,
    r#"SELECT id, total, created_at
       FROM orders
       WHERE tenant_id = $1 AND status = 'paid'
       ORDER BY created_at DESC
       LIMIT 50"#,
    tenant_id
)
.fetch_all(&pool)
.await?;
```

Une faute de frappe dans une colonne ou un type incompatible = erreur de compilation. C'est le choix le plus courant pour une API Axum ([API Axum + SQLx](/dev/rust/10-api-axum-sqlx)).

**Diesel** : ORM/DSL mature, requêtes construites en Rust et vérifiées par le système de types, schéma généré (`schema.rs`). Synchrone à la base (`diesel-async` pour l'async). **SeaORM** : ORM async construit au-dessus de SQLx, entités générées depuis la base, API proche des ORM dynamiques.

### Comment choisir

- Beaucoup de CRUD, équipe qui veut aller vite → ORM (Prisma, SeaORM).
- Requêtes non triviales, contrôle des performances, SQL connu de l'équipe → query builder ou SQL typé (Drizzle, Kysely, SQLx).
- Dans tous les cas : sois capable d'écrire le SQL à la main et de lire le SQL généré. L'ORM est un outil de productivité, pas une excuse pour ignorer le [chapitre 3](/bdd/03-index-et-explain).

## Backups & PITR

Un backup qui n'a jamais été restauré n'est pas un backup.

**Logique** (`pg_dump`) : exporte les données en SQL ou en format custom. Portable entre versions, restaurable table par table. Mais lent sur de gros volumes, et c'est une photo à un instant T : tout ce qui s'est passé depuis est perdu.

```sh
pg_dump -Fc -d shop -f shop.dump
pg_restore -d shop_restore --jobs 4 shop.dump
```

**Physique + WAL** : une copie des fichiers de la base (`pg_basebackup`) plus l'**archivage continu du WAL** (le journal de chaque modification). On peut rejouer le WAL jusqu'à **n'importe quel instant** : c'est le *Point-In-Time Recovery*.

```
lundi 02:00   backup de base
  │  WAL archivé en continu (S3…)
mardi 14:32   DELETE FROM orders sans WHERE
  └─► restauration : base de lundi + WAL jusqu'à 14:31:59
```

```ini
# postgresql.conf de l'instance restaurée (PG 12+)
restore_command = 'cp /archive/%f %p'
recovery_target_time = '2026-11-17 14:31:59+01'
recovery_target_action = 'promote'
# + un fichier recovery.signal dans le data directory
```

En pratique, on n'écrit pas ça à la main : **pgBackRest**, **WAL-G** ou **Barman** gèrent backups complets/incrémentaux, archivage, rétention, chiffrement et restauration. Postgres 17 a ajouté les backups incrémentaux natifs (`pg_basebackup --incremental` + `pg_combinebackup`). Les offres managées (RDS, Cloud SQL, Neon, Supabase…) font du PITR clé en main : vérifie la **durée de rétention** et **teste la restauration**.

Les deux chiffres à fixer avec le métier :

- **RPO** (*Recovery Point Objective*) : combien de données peut-on perdre ? Avec archivage WAL : quelques secondes.
- **RTO** (*Recovery Time Objective*) : combien de temps pour revenir ? Restaurer 2 To + rejouer 20 h de WAL peut prendre des heures. Des backups de base plus fréquents réduisent le WAL à rejouer.

Et : un réplica **n'est pas** un backup (le `DELETE` est répliqué en quelques millisecondes), et un backup stocké dans le même compte cloud que la base n'en est qu'un à moitié.

## Cas réel

**Contexte** : passer `orders.id` de `integer` à `bigint`. La séquence est à 1,9 milliard, le plafond `int4` est à 2 147 483 647 : dans ~3 semaines, plus aucune commande ne pourra être créée. 400 M de lignes, `order_items` et `payments` référencent `orders.id`. `ALTER COLUMN id TYPE bigint` réécrirait table et index sous verrou exclusif : des heures.

Le plan, en expand/contract :

1. `ALTER TABLE orders ADD COLUMN id_new bigint;` + trigger `BEFORE INSERT OR UPDATE` qui copie `NEW.id_new := NEW.id`.
2. Backfill par lots de 10 000 (`WHERE id_new IS NULL AND id BETWEEN …`), avec une pause entre les lots pour surveiller le lag des réplicas.
3. `CREATE UNIQUE INDEX CONCURRENTLY orders_id_new_uq ON orders (id_new);`
4. Même chose pour `order_items.order_id` et `payments.order_id` (colonnes `bigint` + backfill + index).
5. Contraintes : `CHECK (id_new IS NOT NULL) NOT VALID` + `VALIDATE`, FK en `NOT VALID` + `VALIDATE` vers `id_new`.
6. **La bascule**, dans une transaction courte avec `lock_timeout = '3s'` : renommer `id` → `id_old`, `id_new` → `id`, attacher la séquence (`ALTER SEQUENCE … OWNED BY`, `ALTER SEQUENCE … AS bigint`), remplacer la PK par `ALTER TABLE … ADD CONSTRAINT orders_pkey PRIMARY KEY USING INDEX orders_id_new_uq`, supprimer le trigger. Quelques centaines de ms.
7. Plus tard : `DROP COLUMN id_old`.

Leçon bonus : une alerte sur `last_value / max` de chaque séquence `int4` aurait laissé un an de marge. Utilise `bigint` dès le départ.

## Pièges classiques

- Pas de `lock_timeout` → la migration fige l'API derrière un long `SELECT`.
- `CREATE INDEX` sans `CONCURRENTLY` sur une table en production.
- Index `INVALID` oublié après un `CONCURRENTLY` qui a échoué.
- `ADD COLUMN … NOT NULL DEFAULT <volatile>` sur une grosse table.
- Ajouter la contrainte `NOT VALID` **avant** le backfill.
- Un seul `UPDATE` géant pour le backfill.
- Renommer ou supprimer une colonne dans la même release que le code qui arrête de l'utiliser.
- Laisser l'ORM générer et appliquer les migrations sans relecture.
- Migrations lancées par chaque pod au démarrage.
- Backups jamais restaurés ; réplica considéré comme un backup ; rétention PITR plus courte que le délai de détection d'un bug.
- Colonnes `serial`/`integer` sur les tables qui grossissent.

## Défis

**1. Que va-t-il se passer ?** Un vendredi, un dev lance sur la prod (orders : 80 M lignes, 2 000 req/s) :

```sql
ALTER TABLE orders
  ADD COLUMN ref uuid NOT NULL DEFAULT gen_random_uuid();
```

::: details Solution
`gen_random_uuid()` est **volatile** : Postgres ne peut pas stocker une valeur unique dans le catalogue (comme pour une constante), il doit **réécrire la table entière** pour calculer une valeur par ligne, sous verrou `ACCESS EXCLUSIVE`. Sur le labo : 1,7 s pour 1 M de lignes ; sur 80 M, plusieurs minutes pendant lesquelles aucune requête ne passe sur `orders`. Le pool de connexions sature, l'API tombe.

Version sûre : `ADD COLUMN ref uuid` (nullable, instantané) → `ALTER COLUMN ref SET DEFAULT gen_random_uuid()` (pour les nouvelles lignes ; instantané) → backfill par lots → `CHECK NOT VALID` + `VALIDATE` → `SET NOT NULL`, avec `lock_timeout` sur chaque `ALTER`.
:::

**2. Le CONCURRENTLY qui échoue.** Ta CI applique les migrations avec un outil qui enveloppe chaque fichier dans une transaction. Le fichier contient `CREATE UNIQUE INDEX CONCURRENTLY …`. Quelles erreurs possibles, et que vérifier après coup ?

::: details Solution
1. `CREATE INDEX CONCURRENTLY cannot run inside a transaction block` : désactiver la transaction pour ce fichier (option de l'outil : `-- migrate:no-transaction`, `disable_ddl_transaction!`, etc. selon l'outil).
2. Si l'index unique tombe sur des doublons ou si la commande est interrompue, il reste un index **INVALID** :

```sql
SELECT indexrelid::regclass FROM pg_index
WHERE NOT indisvalid;
```

Il est maintenu à chaque écriture mais jamais utilisé : `DROP INDEX CONCURRENTLY`, corriger les doublons, recommencer.
:::

**3. Planifie un renommage.** Le produit veut renommer `products.name` en `products.title`. 12 pods, déploiement progressif. Écris la liste des déploiements et migrations.

::: details Solution
1. Migration : `ALTER TABLE products ADD COLUMN title text;` (`lock_timeout`).
2. Déploiement A : le code écrit `name` **et** `title`, lit `name`.
3. Backfill par lots : `UPDATE products SET title = name WHERE title IS NULL AND id BETWEEN …`.
4. Migration : `CHECK (title IS NOT NULL) NOT VALID`, `VALIDATE`, `SET NOT NULL`.
5. Déploiement B : lit `title`, écrit les deux (si on doit revenir à A, `name` est à jour).
6. Déploiement C : n'écrit plus que `title` ; retiré du modèle ORM.
7. Migration : `ALTER TABLE products DROP COLUMN name;`.

Un trigger de synchro peut remplacer l'écriture double dans le code à l'étape 2. Et le recours le plus simple, souvent le meilleur : renommer seulement dans le code (mapping ORM `title` → colonne `name`).
:::

**4. Index pendant les soldes.** Le chapitre 3 a montré l'index `(tenant_id, status, created_at DESC, id DESC)`. Écris la migration à lancer en pleine journée sur une table de 80 M lignes, et ce que tu surveilles pendant qu'elle tourne.

::: details Solution
```sql
-- fichier sans transaction
SET lock_timeout = '5s';
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  orders_tenant_status_created_idx
  ON orders (tenant_id, status, created_at DESC, id DESC);
```

Pendant la création : `SELECT phase, blocks_done, blocks_total FROM pg_stat_progress_create_index;`, la charge disque/CPU, le lag des réplicas (la création génère du WAL). `CONCURRENTLY` attend la fin des transactions en cours à certaines phases : une transaction longue la fait patienter. À la fin, vérifier `indisvalid`, puis vérifier avec `EXPLAIN` que la requête l'utilise, et supprimer l'ancien index devenu inutile (`DROP INDEX CONCURRENTLY`).
:::

**5. Le DELETE de 14 h 32.** Un script de support a lancé `DELETE FROM order_items WHERE order_id = order_id` (au lieu de `= $1`) à 14:32:10. La base est sur un service managé avec PITR 7 jours. Que fais-tu, dans l'ordre ?

::: details Solution
1. **Stopper l'hémorragie** : couper le script, éventuellement passer l'app en lecture seule pour les fonctions touchées.
2. **Ne pas restaurer par-dessus la prod** : créer une **nouvelle instance** restaurée au PITR à 14:32:09.
3. Depuis cette instance, extraire les lignes supprimées (`pg_dump -t order_items` ou `COPY`), et les **réinjecter** dans la prod (`INSERT … ON CONFLICT DO NOTHING`) : ainsi on ne perd pas les commandes créées après 14:32.
4. Vérifier la cohérence (totaux, contrôle du chapitre 1), puis post-mortem : pourquoi un script ad hoc avait les droits `DELETE` en prod, et pourquoi pas de transaction avec vérification du nombre de lignes (`DELETE … RETURNING` dans un `BEGIN` avant `COMMIT`).

`order_id = order_id` est toujours vrai (sauf `NULL`) : toute la table est vidée.
:::

**6. ORM ou pas ?** Pour l'API fil rouge en Rust (Axum), l'équipe hésite entre SeaORM et SQLx. L'app a des requêtes de reporting (window functions), une file de jobs `SKIP LOCKED` et du RLS. Que recommandes-tu ?

::: details Solution
**SQLx** : les requêtes clés (top N, keyset, `FOR UPDATE SKIP LOCKED`, `SET LOCAL app.tenant_id` en début de transaction) s'écrivent naturellement en SQL et sont vérifiées à la compilation. SeaORM serait confortable pour le CRUD, mais la moitié des requêtes importantes passeraient par du SQL brut de toute façon, avec deux styles dans la base de code. Un compromis courant : SQLx partout, avec un petit module de helpers pour le CRUD répétitif. Le même raisonnement mène à Drizzle ou Kysely plutôt que Prisma côté TypeScript.
:::

## À retenir

- `lock_timeout` sur toute migration ; méfie-toi de la file d'attente des verrous.
- Expand → migrate → backfill par lots → switch → contract, chaque étape déployée séparément.
- `CREATE INDEX CONCURRENTLY` (hors transaction, vérifier `INVALID`), contraintes en `NOT VALID` + `VALIDATE`, `SET NOT NULL` via un `CHECK` validé.
- Pas de renommage ou de changement de type en une étape.
- ORM pour la productivité, SQL typé pour le contrôle ; lis toujours le SQL généré et les migrations générées.
- PITR = backup de base + archivage WAL ; fixe RPO/RTO et teste la restauration.
