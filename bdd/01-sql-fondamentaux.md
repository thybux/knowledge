# SQL fondamentaux

Ce que tu vas apprendre : écrire sans hésiter les requêtes du quotidien (JOIN, agrégats, sous-requêtes, UPSERT), comprendre l'ordre dans lequel SQL les évalue, et éviter les pièges de `NULL` qui font des bugs silencieux.

Toutes les requêtes tournent sur le [schéma fil rouge](/bdd/). Charge-le dans un Postgres jetable et teste au fur et à mesure.

## L'ordre logique d'exécution

Tu écris `SELECT … FROM … WHERE …`, mais la base l'évalue dans un autre ordre. C'est **la** clé pour comprendre 80 % des erreurs.

```
1. FROM / JOIN      → construit les lignes de départ
2. WHERE            → filtre les lignes
3. GROUP BY         → forme les groupes
4. HAVING           → filtre les groupes
5. SELECT           → calcule les colonnes (et les alias)
6. DISTINCT
7. ORDER BY         → peut utiliser les alias
8. LIMIT / OFFSET
```

Conséquences directes :

- Un alias du `SELECT` n'existe pas encore dans `WHERE` ni `HAVING` (Postgres), mais existe dans `ORDER BY`.
- `WHERE` ne peut pas contenir d'agrégat (`sum`, `count`) : les groupes n'existent pas encore. C'est le rôle de `HAVING`.
- `LIMIT` s'applique en dernier : `ORDER BY` + `LIMIT 10` = « les 10 premiers après tri », pas « trie 10 lignes au hasard ».

::: info Ordre logique ≠ ordre physique
L'optimiseur réorganise librement (il pousse des filtres sous les JOIN, choisit l'ordre des tables…). L'ordre ci-dessus décrit le **sens** de la requête, pas ce que fait le moteur. Pour ça : [EXPLAIN](/bdd/03-index-et-explain).
:::

## SELECT et WHERE

```sql
SELECT id, sku, name, price
FROM products
WHERE tenant_id = 1
  AND price BETWEEN 20 AND 60      -- bornes incluses
  AND name ILIKE '%caf%'           -- ILIKE = insensible à la casse
ORDER BY price DESC
LIMIT 10;
```

Pour les dates, utilise toujours un **intervalle semi-ouvert** `[début, fin)` :

```sql
-- commandes du mois dernier
WHERE created_at >= date_trunc('month', now()) - interval '1 month'
  AND created_at <  date_trunc('month', now())
```

`BETWEEN '2026-10-01' AND '2026-10-31'` rate tout ce qui se passe le 31 après minuit pile, puisque `'2026-10-31'` vaut `2026-10-31 00:00:00`.

## Les JOIN, avec un schéma mental

Un JOIN, c'est : « pour chaque ligne de gauche, trouve les lignes de droite qui satisfont la condition `ON` ».

| JOIN | Garde |
|---|---|
| `INNER JOIN` | seulement les paires qui matchent |
| `LEFT JOIN` | toute la gauche, droite en `NULL` si pas de match |
| `RIGHT JOIN` | l'inverse (on l'écrit rarement : retourne les tables) |
| `FULL JOIN` | tout des deux côtés |
| `CROSS JOIN` | toutes les combinaisons (produit cartésien) |

```
users             orders                 INNER   LEFT
id name           id user_id             Bob-1   Bob-1
2  Bob     ─────► 1  2                   Bob-3   Bob-3
2  Bob     ─────► 3  2                   Carol-2 Carol-2
3  Carol   ─────► 2  3                           Alice-NULL
1  Alice   (rien)
```

### INNER et LEFT

```sql
-- nombre de commandes par client du tenant 1
SELECT u.name, count(o.id) AS nb_orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.tenant_id = 1
GROUP BY u.id, u.name
ORDER BY nb_orders DESC;
```

Résultat : Bob 3, Carol 2, Alice 0, Dan 0. Avec `INNER JOIN`, Alice et Dan disparaissent.

::: warning count(*) vs count(colonne)
Avec un `LEFT JOIN`, `count(*)` compte la ligne « Alice + NULL » → Alice aurait **1** commande. `count(o.id)` ignore les `NULL` → 0. Compte toujours une colonne du côté droit.
:::

### Le piège ON vs WHERE dans un LEFT JOIN

Une condition sur la table de **droite** placée dans `WHERE` transforme ton `LEFT JOIN` en `INNER JOIN` : les lignes sans match ont `o.status = NULL`, et `NULL IN (...)` n'est pas vrai, donc elles sont filtrées.

```sql
-- ✗ initech disparaît
SELECT t.slug, sum(o.total)
FROM tenants t
LEFT JOIN orders o ON o.tenant_id = t.id
WHERE o.status = 'paid'
GROUP BY t.slug;

-- ✓ le filtre de droite va dans le ON
SELECT t.slug, coalesce(sum(o.total), 0)
FROM tenants t
LEFT JOIN orders o
  ON o.tenant_id = t.id AND o.status = 'paid'
GROUP BY t.slug;
```

Règle : filtre sur la table de gauche → `WHERE`. Filtre sur la table de droite → `ON`.

### Self-join, FULL, CROSS, LATERAL

```sql
-- self-join : chaque catégorie avec son parent
SELECT c.name, parent.name AS parent
FROM categories c
LEFT JOIN categories parent ON parent.id = c.parent_id;
```

`CROSS JOIN` sert à générer des combinaisons (ex. toutes les paires tenant × jour pour un rapport sans trous, avec `generate_series`). `FULL JOIN` sert surtout aux réconciliations : « lignes présentes chez Stripe ou chez nous, mais pas des deux côtés ».

`LATERAL` permet à la sous-requête de droite de **référencer la ligne de gauche**. Parfait pour « les N derniers X de chaque Y » :

```sql
-- dernière commande de chaque client
SELECT u.name, last.id, last.created_at
FROM users u
CROSS JOIN LATERAL (
  SELECT o.id, o.created_at
  FROM orders o
  WHERE o.user_id = u.id
  ORDER BY o.created_at DESC
  LIMIT 1
) last;
```

Avec un index sur `orders (user_id, created_at DESC)`, c'est un accès direct par client. `LEFT JOIN LATERAL (...) ON true` garde les clients sans commande.

### Le fan-out : le bug de JOIN le plus courant

Joindre une table « 1 » à une table « N » **duplique** les lignes du côté 1. Si tu sommes une colonne du côté 1 après le JOIN, tu comptes plusieurs fois.

```sql
-- ✗ la commande 1 a 2 items → son total est compté 2 fois
SELECT o.tenant_id, sum(o.total) AS revenue,
       sum(oi.quantity) AS units
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.status IN ('paid', 'shipped')
GROUP BY o.tenant_id;
-- acme: 325.60 au lieu de 251.30
```

Correctif : agréger le côté N **avant** de joindre.

```sql
SELECT o.tenant_id, sum(o.total) AS revenue,
       sum(i.units) AS units
FROM orders o
JOIN (
  SELECT order_id, sum(quantity) AS units
  FROM order_items
  GROUP BY order_id
) i ON i.order_id = o.id
WHERE o.status IN ('paid', 'shipped')
GROUP BY o.tenant_id;
```

## GROUP BY et HAVING

Chaque colonne du `SELECT` doit être soit dans le `GROUP BY`, soit dans un agrégat. Exception Postgres : si tu groupes par la clé primaire, les autres colonnes de la table sont autorisées (dépendance fonctionnelle). D'où `GROUP BY u.id, u.name` → `GROUP BY u.id` suffit.

```sql
-- tentatives de paiement par commande, seulement celles > 1
SELECT order_id,
       count(*) AS attempts,
       count(*) FILTER (WHERE status = 'failed') AS failed
FROM payments
GROUP BY order_id
HAVING count(*) > 1;
```

`FILTER (WHERE …)` est l'outil moderne pour les agrégats conditionnels (standard SQL, supporté par Postgres). L'équivalent portable : `sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`.

Agrégats à connaître : `count`, `sum`, `avg`, `min`, `max`, `string_agg(x, ', ')`, `array_agg(x ORDER BY …)`, `jsonb_agg`, `bool_and`/`bool_or`.

## Sous-requêtes

Trois formes, trois usages :

```sql
-- 1. scalaire : une seule valeur
SELECT name, price,
       price - (SELECT avg(price) FROM products) AS ecart
FROM products;

-- 2. dans FROM (table dérivée)
SELECT avg(nb) FROM (
  SELECT user_id, count(*) AS nb
  FROM orders GROUP BY user_id
) per_user;

-- 3. EXISTS : « existe-t-il au moins une ligne ? »
SELECT u.name FROM users u
WHERE EXISTS (
  SELECT 1 FROM orders o
  WHERE o.user_id = u.id AND o.status = 'paid'
);
```

Une sous-requête **corrélée** référence la requête externe (`o.user_id = u.id`). Conceptuellement elle est réévaluée par ligne ; en pratique Postgres transforme souvent `EXISTS` en semi-join efficace.

`IN (sous-requête)` et `EXISTS` sont en général équivalents en performance sur Postgres moderne. **Mais `NOT IN` et `NOT EXISTS` ne sont pas équivalents** dès qu'un `NULL` traîne (voir plus bas).

## NULL et ses pièges

`NULL` = « valeur inconnue ». SQL utilise une logique à **trois valeurs** : `true`, `false`, `unknown`. `WHERE` ne garde que `true`.

```sql
SELECT NULL = NULL;                 -- NULL (pas true !)
SELECT NULL IS NULL;                -- true
SELECT NULL <> 1;                   -- NULL
SELECT NULL IS DISTINCT FROM 1;     -- true
SELECT 1 + NULL, 'a' || NULL;       -- NULL, NULL
```

Les pièges qui font des bugs en prod :

1. **`WHERE col <> 'x'` exclut les NULL.** `WHERE plan <> 'free'` ne renvoie pas les lignes où `plan` est `NULL`. Utilise `IS DISTINCT FROM` si tu veux les inclure.
2. **`NOT IN` avec un NULL dans la liste renvoie zéro ligne.** `x NOT IN (1, NULL)` = `x <> 1 AND x <> NULL` = `… AND unknown` → jamais `true`.
3. **Les agrégats ignorent les NULL** : `avg(col)` divise par le nombre de valeurs non nulles. `count(*)` compte les lignes, `count(col)` les valeurs non nulles.
4. **`sum` sur zéro ligne renvoie NULL**, pas 0 → `coalesce(sum(x), 0)`.
5. **`UNIQUE` autorise plusieurs NULL** (par défaut). Postgres 15+ : `UNIQUE NULLS NOT DISTINCT` pour l'interdire.
6. **Tri** : en Postgres, `NULL` est considéré plus grand que tout (`ASC` → à la fin). Précise `NULLS FIRST/LAST` si ça compte.

## UPSERT : INSERT … ON CONFLICT

Cas typique : un import catalogue qui envoie des produits déjà connus ou non. On veut « insère, ou mets à jour si le SKU existe ».

```sql
INSERT INTO products (tenant_id, sku, name, price, stock)
VALUES (1, 'MUG-01', 'Mug isotherme', 21.90, 30)
ON CONFLICT (tenant_id, sku) DO UPDATE
SET price = EXCLUDED.price,
    stock = products.stock + EXCLUDED.stock
RETURNING id, price, stock;
```

- La cible du conflit `(tenant_id, sku)` doit correspondre à une contrainte `UNIQUE` ou un index unique.
- `EXCLUDED` = la ligne que tu tentais d'insérer.
- `DO NOTHING` ignore silencieusement (idempotence d'un webhook, par exemple).
- C'est **atomique** même en concurrence, contrairement à `SELECT` puis `INSERT` dans le code, qui a une race condition.

`MERGE` (Postgres 15+, `RETURNING` depuis 17) est plus général : synchroniser une table depuis une source, avec des branches `WHEN MATCHED` / `WHEN NOT MATCHED`. Pour un simple upsert sur une clé unique, `ON CONFLICT` reste le plus sûr : `MERGE` ne gère pas la concurrence de la même façon et peut échouer sur une violation d'unicité si deux transactions insèrent en même temps.

## Cas réel

**Contexte** : le back-office d'un SaaS. Le support demande « la liste des tenants avec leur CA du mois dernier, même ceux à zéro, pour la relance commerciale ». Le premier jet d'un junior :

```sql
SELECT t.slug, sum(o.total) AS revenue
FROM tenants t
JOIN orders o ON o.tenant_id = t.id
JOIN order_items oi ON oi.order_id = o.id
WHERE o.status = 'paid'
GROUP BY t.slug;
```

Trois bugs dans cinq lignes :

1. `JOIN` (inner) → les tenants sans commande disparaissent, alors que ce sont *précisément* ceux à relancer.
2. Le JOIN sur `order_items` est inutile et **duplique** les totaux (fan-out).
3. Pas de filtre de date, et `'shipped'` est oublié (une commande expédiée a été payée).

La version correcte :

```sql
SELECT t.slug, coalesce(sum(o.total), 0) AS revenue
FROM tenants t
LEFT JOIN orders o
  ON o.tenant_id = t.id
 AND o.status IN ('paid', 'shipped')
 AND o.created_at >= date_trunc('month', now())
                     - interval '1 month'
 AND o.created_at <  date_trunc('month', now())
GROUP BY t.id, t.slug
ORDER BY revenue DESC;
```

Résultat sur le jeu de données : acme 251.30, globex 140.49, initech 0.

::: tip Réflexe de review
Devant une requête de reporting, pose-toi trois questions : *qui peut disparaître* (INNER vs LEFT) ? *qui peut être compté deux fois* (fan-out) ? *que se passe-t-il avec NULL* ?
:::

## Pièges classiques

- Utiliser un alias du `SELECT` dans le `WHERE` → `column "x" does not exist`.
- Mettre le filtre de la table de droite dans le `WHERE` d'un `LEFT JOIN`.
- `count(*)` après un `LEFT JOIN` (compte 1 au lieu de 0).
- `NOT IN (SELECT col …)` sur une colonne nullable.
- `sum()` sur un ensemble vide → `NULL`, qui casse ton JSON côté API.
- `SELECT` puis `INSERT` dans le code au lieu d'un `ON CONFLICT` : doublons sous charge.
- `BETWEEN` sur des timestamps.
- `SELECT *` dans du code applicatif : la moindre colonne ajoutée change le résultat et transfère des données inutiles.
- `ORDER BY` absent avant `LIMIT` : l'ordre n'est **jamais** garanti sans `ORDER BY`, même s'il « a l'air stable ».

## Défis

**1. Le NOT IN qui ne renvoie rien.** Un dev veut les utilisateurs qui n'ont aucun événement. Sa requête renvoie 0 ligne alors qu'Alice n'a jamais rien fait. Pourquoi, et comment corriger ?

```sql
SELECT name FROM users
WHERE id NOT IN (SELECT user_id FROM events);
```

::: details Solution
`events.user_id` est nullable, et l'événement `stock.low` a `user_id = NULL`. `id NOT IN (…, NULL)` vaut `unknown` pour toutes les lignes, donc tout est filtré.

```sql
SELECT u.name FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM events e WHERE e.user_id = u.id
);
```

Résultat : Alice, Dan, Eve, Grace. `NOT EXISTS` ne compare jamais à `NULL`. Règle : **n'écris jamais `NOT IN (sous-requête)`**, sauf si la colonne est `NOT NULL` (et même là, `NOT EXISTS` est plus sûr si le schéma évolue).
:::

**2. CA par statut.** Pour chaque tenant (y compris ceux sans commande), affiche le nombre de commandes payées (`paid` ou `shipped`), le nombre annulées ou remboursées, et le CA payé. Une seule requête, sans sous-requête.

::: details Solution
```sql
SELECT t.slug,
  count(o.id) FILTER (
    WHERE o.status IN ('paid', 'shipped')) AS paid,
  count(o.id) FILTER (
    WHERE o.status IN ('cancelled', 'refunded')) AS lost,
  coalesce(sum(o.total) FILTER (
    WHERE o.status IN ('paid', 'shipped')), 0) AS revenue
FROM tenants t
LEFT JOIN orders o ON o.tenant_id = t.id
GROUP BY t.id, t.slug
ORDER BY t.slug;
```

acme : 3 / 1 / 251.30 ; globex : 3 / 1 / 177.99 ; initech : 0 / 0 / 0. Le `LEFT JOIN` garde initech, `count(o.id)` évite de compter la ligne `NULL`, et `FILTER` évite trois sous-requêtes.
:::

**3. Alias interdit.** Pourquoi cette requête échoue ? Donne deux corrections.

```sql
SELECT id, total * 1.2 AS ttc
FROM orders
WHERE ttc > 100;
```

::: details Solution
`WHERE` est évalué (étape 2) **avant** le `SELECT` (étape 5) : l'alias `ttc` n'existe pas encore. Erreur : `column "ttc" does not exist`.

```sql
-- 1. répéter l'expression
SELECT id, total * 1.2 AS ttc
FROM orders WHERE total * 1.2 > 100;

-- 2. table dérivée (ou CTE)
SELECT * FROM (
  SELECT id, total * 1.2 AS ttc FROM orders
) s WHERE ttc > 100;
```

Les deux renvoient les commandes 3 et 7. Bonus : pour l'index, `WHERE total > 100 / 1.2` est meilleur (la colonne est « nue », un index sur `total` est utilisable).
:::

**4. Cohérence des totaux.** `orders.total` est dénormalisé. Écris la requête de contrôle qui trouve les commandes dont le total ne correspond pas à la somme de leurs lignes. (Sur le jeu de données, elle doit renvoyer 0 ligne : fais un `UPDATE orders SET total = 1 WHERE id = 2` dans une transaction pour la tester.)

::: details Solution
```sql
SELECT o.id, o.total,
       sum(oi.quantity * oi.unit_price) AS computed
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id
HAVING o.total <> sum(oi.quantity * oi.unit_price);
```

`GROUP BY o.id` suffit pour pouvoir lire `o.total` (dépendance fonctionnelle sur la PK). C'est typiquement un job de « réconciliation » qui tourne la nuit et alerte si le résultat n'est pas vide. Comme c'est du `numeric`, la comparaison `<>` est exacte. Avec des `float`, elle serait fausse.
:::

**5. Le dashboard qui double.** Le dashboard affiche 325.60 € de CA pour acme alors que la compta dit 251.30 €. Voici la requête. Trouve le bug et corrige-le en gardant le nombre d'unités vendues.

```sql
SELECT o.tenant_id, sum(o.total) AS revenue,
       sum(oi.quantity) AS units
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.status IN ('paid', 'shipped')
GROUP BY o.tenant_id;
```

::: details Solution
Fan-out : la commande 1 a deux lignes d'items, donc `o.total` (74.30) est sommé deux fois. 251.30 + 74.30 = 325.60.

```sql
SELECT o.tenant_id, sum(o.total) AS revenue,
       sum(i.units) AS units
FROM orders o
JOIN (
  SELECT order_id, sum(quantity) AS units
  FROM order_items GROUP BY order_id
) i ON i.order_id = o.id
WHERE o.status IN ('paid', 'shipped')
GROUP BY o.tenant_id;
```

acme : 251.30 / 6 unités, globex : 177.99 / 7. Alternative : calculer le CA depuis les items (`sum(oi.quantity * oi.unit_price)`), qui est au même grain que `units`.
:::

**6. Import catalogue idempotent.** Un fournisseur renvoie chaque nuit son catalogue complet. Écris l'insert qui crée les nouveaux SKU, met à jour le prix des existants, mais **ne touche pas** la ligne si le prix n'a pas changé (pour ne pas générer d'écriture inutile).

::: details Solution
```sql
INSERT INTO products (tenant_id, sku, name, price)
VALUES (1, 'MUG-01', 'Mug isotherme', 19.90),
       (1, 'THE-01', 'Theiere', 27.00)
ON CONFLICT (tenant_id, sku) DO UPDATE
SET price = EXCLUDED.price
WHERE products.price IS DISTINCT FROM EXCLUDED.price
RETURNING sku, price;
```

Le `WHERE` du `DO UPDATE` saute la mise à jour quand rien ne change : seule `THE-01` est renvoyée. En Postgres, un `UPDATE` crée une nouvelle version de ligne même si les valeurs sont identiques (bloat, triggers, réplication) : ce filtre compte sur de gros imports. `IS DISTINCT FROM` gère aussi le cas `NULL`.
:::

**7. Panier moyen au-dessus de la moyenne.** Liste les clients dont le panier moyen (commandes `paid`/`shipped`) dépasse le panier moyen global.

::: details Solution
```sql
SELECT u.name, round(avg(o.total), 2) AS avg_basket
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE o.status IN ('paid', 'shipped')
GROUP BY u.id, u.name
HAVING avg(o.total) > (
  SELECT avg(total) FROM orders
  WHERE status IN ('paid', 'shipped')
);
```

Bob (96.15) et Frank (98.00). La sous-requête scalaire n'est pas corrélée : elle est calculée une seule fois. Le filtre sur l'agrégat va dans `HAVING`, celui sur les lignes dans `WHERE`.
:::

## À retenir

- Ordre logique : `FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT`.
- `LEFT JOIN` : filtres de droite dans le `ON`, et `count(col_droite)`.
- Joindre 1→N duplique le côté 1 : agrège avant de joindre.
- `NULL` n'est égal à rien : `IS NULL`, `IS DISTINCT FROM`, `coalesce`, et jamais `NOT IN (sous-requête)`.
- Dates : intervalles `[début, fin)`, jamais `BETWEEN`.
- `INSERT … ON CONFLICT` pour l'upsert : atomique, contrairement à « SELECT puis INSERT ».
