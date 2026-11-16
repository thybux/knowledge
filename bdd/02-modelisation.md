# Modélisation

Ce que tu vas apprendre : dessiner un schéma qui reste correct quand l'app grossit. Normalisation et dénormalisation assumée, choix des clés, contraintes, multi-tenant, soft delete, audit, et la seule bonne façon de stocker de l'argent.

On s'appuie sur le [schéma fil rouge](/bdd/) : chaque choix qu'il contient est justifié ici.

## Normalisation : 1NF → 3NF

Le but n'est pas académique : **chaque fait stocké à un seul endroit**, pour qu'une mise à jour ne puisse pas laisser deux versions contradictoires.

Point de départ, l'export CSV « tout-en-un » qu'un junior pourrait mettre en table :

```
orders_flat
order_id | customer_email | customer_name | skus          | tenant_name
1        | bob@mail.com   | Bob           | MUG-01,CAF-01 | Acme Store
3        | bob@mail.com   | Bob           | MOU-01        | Acme Store
```

**1NF : valeurs atomiques, pas de groupes répétés.** `skus = 'MUG-01,CAF-01'` viole la 1NF : impossible d'indexer, de joindre, de contraindre. → une ligne par produit commandé (`order_items`).

**2NF : chaque colonne dépend de toute la clé.** Dans `order_items (order_id, product_id, quantity, product_name)`, `product_name` ne dépend que de `product_id` (une partie de la clé). → il va dans `products`.

**3NF : pas de dépendance entre colonnes non-clés.** Dans `orders`, `customer_name` dépend de `customer_email`, qui dépend de la commande. Renommer Bob obligerait à modifier toutes ses commandes. → `users`, et `orders.user_id`.

La phrase à retenir (version Kent) : chaque attribut dépend *de la clé, de toute la clé, et de rien d'autre que la clé*.

## Dénormalisation assumée

Normaliser à fond, puis dénormaliser **en connaissance de cause**, avec un mécanisme qui garde la cohérence. Le schéma fil rouge en a deux :

| Colonne | Pourquoi | Comment rester cohérent |
|---|---|---|
| `order_items.unit_price` | Le prix au moment de l'achat est un **fait historique** | Rien à faire : c'est voulu |
| `orders.total` | Lu sur toutes les listes de commandes | Calculé dans la même transaction que les items + job de réconciliation |

Le premier n'est même pas une vraie dénormalisation : « le prix payé » et « le prix catalogue » sont deux faits différents. Copier le prix du produit dans la ligne de commande est **obligatoire**, sinon changer un prix modifie les factures passées.

Autres dénormalisations courantes en prod : compteurs (`products.review_count`), colonnes de recherche (`search_vector`), tables de reporting pré-agrégées. Règle : documente la source de vérité et le mécanisme de synchro (trigger, même transaction, job, [CQRS](/bdd/09-choisir-et-scaler)).

## Clés primaires : bigint identity vs UUIDv7

```sql
-- entier auto-incrémenté, syntaxe SQL standard
id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY

-- UUID ordonné dans le temps (natif depuis Postgres 18)
id uuid PRIMARY KEY DEFAULT uuidv7()
```

`serial` est l'ancienne syntaxe : préfère `GENERATED ALWAYS AS IDENTITY` (standard, et `ALWAYS` empêche d'insérer un id à la main par erreur).

| Critère | bigint identity | UUIDv7 |
|---|---|---|
| Taille | 8 octets | 16 octets |
| Généré côté client | non | oui (id connu avant l'INSERT) |
| Énumérable dans une URL | oui (`/orders/1042`) | non |
| Fusion de bases / sharding | collisions | aucun conflit |
| Localité B-tree | parfaite | bonne (préfixe = timestamp) |

**Pourquoi v7 et pas v4 ?** Un UUIDv4 est aléatoire : chaque insertion tombe à un endroit aléatoire de l'index B-tree → pages éparpillées, cache inefficace, plus de WAL. UUIDv7 commence par un timestamp en millisecondes : les nouvelles valeurs vont en fin d'index, comme un entier.

::: warning UUIDv7 révèle la date de création
`uuid_extract_timestamp(id)` donne l'instant de création. Souvent sans importance, mais n'expose pas un UUIDv7 si la date d'inscription d'un client est sensible.
:::

En pratique : `bigint` pour les tables internes très jointes (`order_items`, tables de liaison), UUIDv7 pour les ids exposés publiquement ou générés hors de la base (événements, idempotency, systèmes distribués). Le fil rouge fait `bigint` partout sauf `events`, pour montrer les deux.

**Clé naturelle vs clé de substitution.** Un email, un SKU, un numéro de TVA *semblent* uniques et stables. Ils changent (fusion de comptes, reformatage). Garde une clé technique en PK et mets un `UNIQUE` sur la clé naturelle.

## Contraintes : la BDD comme dernière ligne de défense

```sql
price  numeric(12, 2) NOT NULL CHECK (price >= 0),
stock  integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
status text NOT NULL DEFAULT 'pending'
       CHECK (status IN ('pending', 'paid', 'shipped',
                         'cancelled', 'refunded')),
UNIQUE (tenant_id, sku)
```

- `NOT NULL` par défaut, nullable seulement si « absent » a un sens métier.
- `CHECK` peut combiner plusieurs colonnes de la **même ligne** : `CHECK (status NOT IN ('paid','shipped') OR total > 0)`.
- Un `CHECK` ne peut pas regarder d'autres lignes ou tables. Pour ça : FK, `UNIQUE`, contrainte d'exclusion, ou trigger.
- `CHECK (status IN (...))` vs type `ENUM` : le `CHECK` se modifie facilement dans une migration ; retirer une valeur d'un `ENUM` est pénible. Une table de référence (`order_statuses`) + FK est l'option la plus flexible.

### Clés étrangères et ON DELETE

```sql
order_id bigint NOT NULL
         REFERENCES orders (id) ON DELETE CASCADE,
product_id bigint NOT NULL REFERENCES products (id)
```

| Action | Quand |
|---|---|
| `NO ACTION` / `RESTRICT` (défaut) | On refuse de supprimer un produit déjà vendu |
| `CASCADE` | Les lignes enfants n'ont pas de sens seules (items d'une commande) |
| `SET NULL` | Le lien est optionnel (`events.user_id` si on purge un user) |

::: warning Postgres n'indexe pas les FK automatiquement
Il indexe la PK et les `UNIQUE`, pas la colonne qui référence. Sans index sur `order_items.product_id`, supprimer un produit fait un seq scan de `order_items`. D'où `order_items_product_idx` dans le schéma.
:::

### Contrainte d'appartenance au même tenant

Rien n'empêche aujourd'hui une commande du tenant 1 de pointer vers un user du tenant 2. Une FK **composite** le garantit :

```sql
ALTER TABLE users
  ADD CONSTRAINT users_tenant_id_uq UNIQUE (tenant_id, id);

ALTER TABLE orders
  ADD CONSTRAINT orders_user_same_tenant
  FOREIGN KEY (tenant_id, user_id)
  REFERENCES users (tenant_id, id);
```

`INSERT INTO orders (tenant_id, user_id) VALUES (1, 6)` échoue désormais : `Key (tenant_id, user_id)=(1, 6) is not present in table "users"`.

### UNIQUE partiel et contrainte d'exclusion

```sql
-- un email actif par tenant, insensible à la casse
CREATE UNIQUE INDEX users_tenant_email_uq
  ON users (tenant_id, lower(email))
  WHERE deleted_at IS NULL;
```

Contrainte d'exclusion : « pas deux lignes qui se chevauchent ». Idéal pour un historique de prix, des réservations, des créneaux :

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE product_prices (
  product_id bigint NOT NULL REFERENCES products (id),
  price      numeric(12, 2) NOT NULL,
  valid      tstzrange NOT NULL,
  EXCLUDE USING gist (product_id WITH =, valid WITH &&)
);
```

Postgres 18 ajoute la syntaxe temporelle `PRIMARY KEY (product_id, valid WITHOUT OVERLAPS)`, qui fait la même chose.

## Relations N-N

Une table de liaison, avec une PK composite :

```sql
CREATE TABLE product_categories (
  product_id  bigint NOT NULL
              REFERENCES products (id) ON DELETE CASCADE,
  category_id bigint NOT NULL
              REFERENCES categories (id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);
```

La PK `(product_id, category_id)` sert la requête « catégories d'un produit ». Pour « produits d'une catégorie », ajoute un index `(category_id)` (ou `(category_id, product_id)`). Si la relation porte des données (`position`, `added_at`), elles vont dans cette table.

Alternative : `text[]` ou `jsonb` pour des **tags libres** (index GIN, voir [Postgres avancé](/bdd/05-postgres-avance)). Tu perds l'intégrité référentielle : OK pour des tags, pas pour des catégories gérées.

## Soft delete

`deleted_at timestamptz` au lieu d'un `DELETE`. Pratique (corbeille, audit, restauration), mais avec un coût :

- **Chaque requête** doit filtrer `deleted_at IS NULL`. Un oubli = un client supprimé qui reçoit encore des emails.
- Les `UNIQUE` classiques bloquent la réinscription → index unique partiel.
- Les FK ne savent pas qu'une ligne est « supprimée ».
- Le RGPD exige parfois un vrai effacement : soft delete ≠ droit à l'oubli.

Alternatives : une vue `active_users` qui filtre, ou déplacer les lignes supprimées dans une table d'archive (`deleted_users`) via un trigger ou dans la même transaction. Pour les données à forte volumétrie, l'archive est souvent plus saine.

## Multi-tenant

Trois stratégies :

| Stratégie | Isolation | Ops à 10 000 tenants |
|---|---|---|
| Colonne `tenant_id` (+ RLS) | logique | une seule migration, simple |
| Un schéma par tenant | moyenne | 10 000 schémas à migrer |
| Une base par tenant | forte | lourd, mais isolement total |

Le défaut raisonnable pour un SaaS B2B : **colonne `tenant_id` partout + Row-Level Security**. Schéma ou base dédiés pour quelques gros clients avec exigences contractuelles.

### Row-Level Security

Le risque n°1 du multi-tenant : un `WHERE tenant_id = ?` oublié = fuite de données entre clients. RLS met le filtre **dans la base** :

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON orders
  USING (tenant_id =
    nullif(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id =
    nullif(current_setting('app.tenant_id', true), '')::bigint);
```

Côté app, au début de chaque transaction :

```sql
BEGIN;
SET LOCAL app.tenant_id = '2';
SELECT id FROM orders;   -- uniquement les commandes du tenant 2
COMMIT;
```

- `USING` filtre les lignes lues/modifiées, `WITH CHECK` refuse d'écrire une ligne d'un autre tenant.
- Sans variable définie, la policy compare à `NULL` → **zéro ligne** (échec sûr).
- `SET LOCAL` est indispensable avec un pool de connexions : la valeur disparaît au `COMMIT`. Un `SET` simple fuirait vers la requête suivante d'un autre tenant.

::: danger Qui contourne RLS
Les superusers et les rôles `BYPASSRLS` ignorent toujours les policies. Le **propriétaire** de la table aussi, sauf `ALTER TABLE … FORCE ROW LEVEL SECURITY`. L'app doit donc se connecter avec un rôle dédié, pas celui qui lance les migrations.
:::

Pense aussi aux index : en multi-tenant, presque tous les index commencent par `tenant_id`.

## Audit et historique

Deux besoins différents :

- **Audit log** : qui a changé quoi, quand (support, sécurité, conformité).
- **Historique métier** : quel était le prix au 15 mars ? (temporal table, `product_prices` ci-dessus).

Audit générique par trigger :

```sql
CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name text NOT NULL,
  row_id     bigint NOT NULL,
  op         text NOT NULL,
  old_row    jsonb,
  new_row    jsonb,
  actor      text,
  at         timestamptz NOT NULL DEFAULT now()
);
```

```sql
CREATE FUNCTION audit_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log (table_name, row_id, op,
                         old_row, new_row, actor)
  VALUES (
    TG_TABLE_NAME,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
    TG_OP,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
    current_setting('app.user_id', true)
  );
  RETURN NULL;  -- ignoré pour un trigger AFTER
END $$;

CREATE TRIGGER products_audit
AFTER INSERT OR UPDATE OR DELETE ON products
FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

L'app fait `SET LOCAL app.user_id = '42'` en début de transaction, comme pour le tenant. Le trigger est dans la même transaction : pas d'audit perdu, pas d'audit d'une écriture annulée. Coût : une écriture de plus par ligne modifiée, et une table qui grossit vite (partitionne-la par mois, voir chapitre 5).

## L'argent : numeric, jamais float

```sql
SELECT 0.1::float8 + 0.2::float8 = 0.3::float8;  -- false
SELECT 0.1::numeric + 0.2 = 0.3;                 -- true
```

Un `float` est binaire : 0.1 n'y est pas représentable exactement. Sur des millions d'opérations, les centimes dérivent, et `total = sum(items)` devient faux.

Deux options correctes :

- `numeric(12, 2)` : exact, lisible, ce que fait le fil rouge.
- `bigint` en **centimes** (unité mineure) : rapide, et c'est ce qu'utilisent Stripe et la plupart des APIs de paiement. Attention aux devises sans décimale (JPY) ou à 3 décimales (KWD) : stocke la devise à côté.

Toujours : une colonne `currency char(3)` (ISO 4217) à côté du montant, et jamais d'addition entre devises différentes. Côté TypeScript, `number` est un float : passe par des centimes entiers ou une lib décimale, et transmets les montants en chaîne dans le JSON.

## Cas réel

**Contexte** : un SaaS de boutiques en ligne lance un plan « Enterprise ». Un gros client exige que ses données soient « isolées ». Le CTO hésite à passer à une base par tenant.

Ce qu'on a fait :

1. **Garder le modèle partagé** (`tenant_id` + RLS) pour les 3 000 petits tenants : une migration, un pool de connexions, des index communs.
2. **Ajouter les FK composites** `(tenant_id, …)` sur les relations critiques : une commande ne peut plus pointer vers le client d'un autre tenant, même en cas de bug applicatif.
3. **Activer RLS + `FORCE`** sur toutes les tables avec `tenant_id`, l'app se connectant avec un rôle `app_user` sans `BYPASSRLS`. Un test d'intégration vérifie qu'une requête sans `SET LOCAL app.tenant_id` renvoie 0 ligne.
4. Pour le client Enterprise : une **base dédiée** avec le **même schéma** (même code, autre chaîne de connexion choisie par tenant). Le code ne sait pas qu'il est seul.

Le piège évité : passer tout le monde en schéma-par-tenant. À 3 000 schémas, chaque migration devient un script de plusieurs heures, et un échec au 1 800e laisse la flotte dans deux versions.

## Pièges classiques

- Stocker une liste dans une colonne texte (`"1,4,7"`) : viole la 1NF, impossible à indexer ou contraindre.
- Ne pas copier le prix dans la ligne de commande.
- `float` / `double` / `real` pour de l'argent.
- `timestamp` sans fuseau : utilise `timestamptz` (stocké en UTC, converti à l'affichage).
- FK sans index côté enfant.
- UUIDv4 en PK sur une table à forte écriture.
- Soft delete sans index unique partiel.
- RLS activée mais app connectée en tant que propriétaire de la table (ou superuser).
- `SET app.tenant_id` (sans `LOCAL`) derrière un pool : fuite entre requêtes.
- Valider l'unicité dans le code (`SELECT` puis `INSERT`) au lieu d'une contrainte.

## Défis

**1. Diagnostic de normalisation.** Voici une table héritée. Liste les violations de 1NF, 2NF et 3NF, et propose le découpage.

```
order_lines (order_id, product_id, qty, product_name,
             customer_email, customer_city, coupon_codes)
PK (order_id, product_id)
coupon_codes = 'NOEL10,VIP'
```

::: details Solution
- **1NF** : `coupon_codes` contient une liste → table `order_coupons (order_id, coupon_id)`.
- **2NF** : `product_name` dépend seulement de `product_id` → `products`. `customer_email` et `customer_city` dépendent seulement de `order_id` (une partie de la clé) → au niveau de la commande.
- **3NF** : dans `orders`, `customer_city` dépendrait de `customer_email` (le client), pas de la commande → `users` (ou une adresse de livraison *copiée* dans la commande si c'est un fait historique, comme `unit_price`).

Résultat : `orders (id, user_id, shipping_city…)`, `order_items (order_id, product_id, qty, unit_price)`, `products`, `users`, `order_coupons`.
:::

**2. Fuite cross-tenant.** Un bug dans le checkout a créé une commande du tenant 1 rattachée à l'utilisateur 6 (tenant 2). Écris la requête qui détecte ces incohérences, puis la contrainte qui les rend impossibles.

::: details Solution
```sql
SELECT o.id, o.tenant_id, u.tenant_id AS user_tenant
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE u.tenant_id <> o.tenant_id;
```

```sql
ALTER TABLE users
  ADD CONSTRAINT users_tenant_id_uq UNIQUE (tenant_id, id);
ALTER TABLE orders
  ADD CONSTRAINT orders_user_same_tenant
  FOREIGN KEY (tenant_id, user_id)
  REFERENCES users (tenant_id, id);
```

L'`UNIQUE (tenant_id, id)` est redondant logiquement (`id` est déjà unique) mais nécessaire : une FK doit référencer une contrainte unique sur exactement ces colonnes. Sur une vraie table, ajoute la FK en `NOT VALID` puis `VALIDATE CONSTRAINT` (voir [Migrations](/bdd/08-migrations-orm-en-prod)).
:::

**3. Réinscription impossible.** Dan (soft-deleted) veut recréer un compte avec `dan@mail.com` dans acme. Avec `UNIQUE (tenant_id, email)`, ça échoue. Avec l'index du fil rouge, ça passe. Et `BOB@mail.com` ? Explique.

::: details Solution
L'index `users_tenant_email_uq` est **partiel** (`WHERE deleted_at IS NULL`) : la ligne de Dan n'y figure pas, donc un nouveau `dan@mail.com` est accepté. Il porte sur `lower(email)` : `BOB@mail.com` entre en collision avec `bob@mail.com` (Bob est actif) et est refusé :

```
duplicate key value violates unique constraint
"users_tenant_email_uq"
Key (tenant_id, lower(email))=(1, bob@mail.com) already exists.
```

Pour que l'index serve aussi aux lookups de login, la requête doit utiliser la même expression : `WHERE tenant_id = $1 AND lower(email) = lower($2) AND deleted_at IS NULL`.
:::

**4. Quels invariants en CHECK ?** Pour chacun, dis si un `CHECK` suffit, et sinon quel mécanisme utiliser.

a) `quantity > 0` · b) une commande `paid` a un total > 0 · c) la somme des paiements réussis ≤ total de la commande · d) un SKU unique par tenant · e) deux prix d'un même produit ne se chevauchent pas dans le temps.

::: details Solution
- a) `CHECK (quantity > 0)`.
- b) `CHECK` multi-colonnes de la même ligne : `CHECK (status NOT IN ('paid', 'shipped') OR total > 0)`.
- c) Implique **plusieurs lignes d'une autre table** : pas de `CHECK`. Logique applicative dans une transaction avec verrou sur la commande (`SELECT … FOR UPDATE`, [chapitre 4](/bdd/04-transactions-isolation)), ou trigger.
- d) `UNIQUE (tenant_id, sku)`.
- e) Contrainte d'exclusion GiST (`EXCLUDE USING gist (product_id WITH =, valid WITH &&)`) ou `WITHOUT OVERLAPS` en Postgres 18.
:::

**5. Division relationnelle.** Trouve les produits d'acme qui sont **à la fois** dans les catégories « Cuisine » et « Cafe ».

::: details Solution
```sql
SELECT p.name
FROM products p
JOIN product_categories pc ON pc.product_id = p.id
JOIN categories c ON c.id = pc.category_id
WHERE c.name IN ('Cuisine', 'Cafe')
  AND p.tenant_id = 1
GROUP BY p.id, p.name
HAVING count(DISTINCT c.name) = 2;
```

Résultat : « Mug isotherme ». `IN` donne « au moins une des deux » ; le `HAVING count = 2` impose « les deux ». C'est le pattern classique pour « a tous les tags X, Y, Z ».
:::

**6. La facture à 9.99 €.** Un client partage une facture de 10.00 € en 3. Le code calcule `round(10.00 / 3, 2)` pour chaque part. Que se passe-t-il, et comment le corriger ?

::: details Solution
`round(10.00 / 3, 2) = 3.33`, et `3.33 × 3 = 9.99` : un centime disparaît. Ce n'est pas un problème de `float` mais d'arrondi : même en `numeric`, une division doit **répartir le reste**. On calcule les parts en centimes (`1000 / 3 = 333` reste `1`) et on ajoute le reste à la première part : 3.34 + 3.33 + 3.33. Règle compta : la somme des parts doit toujours égaler le total, vérifie-le dans un test.
:::

**7. Le SET sans LOCAL.** En prod, un client voit pendant quelques secondes les commandes d'un autre tenant. L'app utilise un pool de connexions et fait `SET app.tenant_id = '…'` au début de chaque requête HTTP, puis plusieurs requêtes SQL. Explique le bug.

::: details Solution
`SET` (sans `LOCAL`) reste actif sur la **connexion** jusqu'à la fin de la session. Si une requête HTTP prend une connexion du pool sans passer par le `SET` (erreur avant, route qui l'oublie, requête lancée hors transaction…), elle hérite du tenant de la requête précédente. Avec un pooler en mode transaction (PgBouncer), deux requêtes SQL d'une même requête HTTP peuvent même atterrir sur deux connexions différentes.

Correctif : tout le travail d'une requête dans une **transaction**, avec `SET LOCAL app.tenant_id` (ou `SELECT set_config('app.tenant_id', $1, true)`, paramétrable) en première instruction. La valeur meurt au `COMMIT`/`ROLLBACK`. Et la policy avec `nullif(…, '')` garantit 0 ligne si la valeur est absente : en effet, après un `SET LOCAL` terminé, `current_setting('app.tenant_id', true)` renvoie `''` et non `NULL`, et `''::bigint` lève une erreur.
:::

## À retenir

- Normalise jusqu'à la 3NF, puis dénormalise en documentant la source de vérité et le mécanisme de synchro.
- `bigint GENERATED ALWAYS AS IDENTITY` pour l'interne, `uuidv7()` pour ce qui est exposé ou distribué. Jamais UUIDv4 en PK chaude.
- Les invariants vivent en base : `NOT NULL`, `CHECK`, `UNIQUE` (partiel si besoin), FK (indexées !), exclusion.
- Multi-tenant : `tenant_id` partout, FK composites, RLS avec `SET LOCAL`, rôle applicatif sans bypass.
- Soft delete = filtre partout + unique partiel ; sinon table d'archive.
- Argent : `numeric` ou centimes en `bigint`, toujours avec la devise.
