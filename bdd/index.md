# Bases de données

Ce que tu vas trouver ici : SQL solide, modélisation, index, transactions, Postgres avancé, un regard sur MySQL et MongoDB, puis tout ce qui se passe *en prod* (migrations, ORM, scaling). Un seul schéma sert de fil rouge à tous les chapitres.

## Pourquoi cette section

Dans une vraie app, la BDD est presque toujours le goulot : une page lente, un double débit, une migration qui verrouille une table pendant 3 minutes. Le code applicatif se redéploie en 30 s ; une donnée corrompue, elle, reste.

Ce qu'on attend de toi selon le niveau :

| Sujet | Mid | Senior |
|---|---|---|
| SQL | JOIN, GROUP BY, sous-requêtes sans hésiter | CTE, window functions, lit un plan |
| Index | Sait en créer un utile | Sait *pourquoi* il n'est pas utilisé |
| Transactions | Sait en ouvrir une | Choisit l'isolation, connaît les anomalies |
| Schéma | 3NF, FK, contraintes | Multi-tenant, audit, dénormalisation assumée |
| Prod | Écrit une migration | Migration zero-downtime, PITR, pooling |

::: tip La règle d'or
La BDD est ta dernière ligne de défense. Un invariant important (unicité, stock ≥ 0, montant > 0) doit être une **contrainte** en base, pas juste un `if` dans le code. Le code a des bugs et des race conditions ; une contrainte `CHECK` n'en a pas.
:::

## L'app fil rouge

Un SaaS e-commerce **multi-tenant** : chaque boutique (tenant) a ses clients, ses produits, ses commandes. Pense Shopify en (très) petit.

```
tenants ─┬─< users ──────< orders ─┬─< order_items >── products
         │                  │      └─< payments          │
         ├─< products       │                            │
         ├─< categories >───┼──── product_categories ────┘
         └─< events >───────┘
```

`─<` = « un vers plusieurs ». Quelques choix à remarquer (on les justifie au fil des chapitres) :

- `tenant_id` sur toutes les tables « racines » → isolation des données ([Modélisation](/bdd/02-modelisation)).
- Argent en `numeric(12, 2)`, jamais en `float`.
- `order_items.unit_price` copie le prix **au moment de l'achat** : le prix du produit changera, la facture non.
- `orders.total` est une dénormalisation assumée (calculable depuis les items, mais lue partout).
- `users.deleted_at` = soft delete, avec un index `UNIQUE` **partiel**.
- `events` utilise un UUIDv7 (`uuidv7()` est natif depuis Postgres 18).
- `categories.parent_id` = arbre (requêtes récursives au chapitre 5).

## Lancer le labo

Un conteneur jetable suffit :

```sh
docker run --rm -d --name kb-pg \
  -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:18

export PGPASSWORD=pg
psql -h localhost -p 55432 -U postgres \
  -c 'CREATE DATABASE shop'
psql -h localhost -p 55432 -U postgres -d shop \
  -f schema.sql -f seed.sql

# à la fin
docker rm -f kb-pg
```

Copie les deux blocs ci-dessous dans `schema.sql` et `seed.sql`. Toutes les solutions des défis ont été exécutées sur ce jeu de données.

## Le schéma (DDL Postgres)

```sql
CREATE TABLE tenants (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  name       text NOT NULL,
  plan       text NOT NULL DEFAULT 'free'
             CHECK (plan IN ('free', 'pro', 'enterprise')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  bigint NOT NULL REFERENCES tenants (id),
  email      text NOT NULL,
  name       text NOT NULL,
  role       text NOT NULL DEFAULT 'customer'
             CHECK (role IN ('admin', 'staff', 'customer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
-- un email unique par tenant, parmi les comptes non supprimés
CREATE UNIQUE INDEX users_tenant_email_uq
  ON users (tenant_id, lower(email))
  WHERE deleted_at IS NULL;

CREATE TABLE categories (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  bigint NOT NULL REFERENCES tenants (id),
  parent_id  bigint REFERENCES categories (id),
  name       text NOT NULL
);

CREATE TABLE products (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  bigint NOT NULL REFERENCES tenants (id),
  sku        text NOT NULL,
  name       text NOT NULL,
  price      numeric(12, 2) NOT NULL CHECK (price >= 0),
  stock      integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  attributes jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);

-- relation N-N produits <-> catégories
CREATE TABLE product_categories (
  product_id  bigint NOT NULL
              REFERENCES products (id) ON DELETE CASCADE,
  category_id bigint NOT NULL
              REFERENCES categories (id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);

CREATE TABLE orders (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  bigint NOT NULL REFERENCES tenants (id),
  user_id    bigint NOT NULL REFERENCES users (id),
  status     text NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'paid', 'shipped',
                               'cancelled', 'refunded')),
  total      numeric(12, 2) NOT NULL DEFAULT 0,
  currency   char(3) NOT NULL DEFAULT 'EUR',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_tenant_created_idx
  ON orders (tenant_id, created_at DESC);
CREATE INDEX orders_user_idx ON orders (user_id);

CREATE TABLE order_items (
  order_id   bigint NOT NULL
             REFERENCES orders (id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES products (id),
  quantity   integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (order_id, product_id)
);
CREATE INDEX order_items_product_idx ON order_items (product_id);

CREATE TABLE payments (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id        bigint NOT NULL REFERENCES orders (id),
  provider        text NOT NULL,
  provider_ref    text NOT NULL UNIQUE,
  amount          numeric(12, 2) NOT NULL CHECK (amount > 0),
  status          text NOT NULL
                  CHECK (status IN ('pending', 'succeeded',
                                    'failed', 'refunded')),
  idempotency_key text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_idx ON payments (order_id);

CREATE TABLE events (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id  bigint NOT NULL REFERENCES tenants (id),
  user_id    bigint REFERENCES users (id),
  type       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_tenant_created_idx
  ON events (tenant_id, created_at);
```

## Le jeu de données

Petit exprès : tu dois pouvoir vérifier les résultats à la main. Les dates sont relatives à `now()`, donc « le mois dernier » contient toujours des commandes.

::: details seed.sql (à copier)
```sql
INSERT INTO tenants (slug, name, plan) VALUES
  ('acme',   'Acme Store',   'pro'),
  ('globex', 'Globex Shop',  'free'),
  ('initech','Initech Supply','enterprise');

INSERT INTO users (tenant_id, email, name, role, deleted_at) VALUES
  (1, 'alice@acme.io',   'Alice',   'admin',    NULL),
  (1, 'bob@mail.com',    'Bob',     'customer', NULL),
  (1, 'carol@mail.com',  'Carol',   'customer', NULL),
  (1, 'dan@mail.com',    'Dan',     'customer', now()),
  (2, 'eve@globex.io',   'Eve',     'admin',    NULL),
  (2, 'bob@mail.com',    'Bob G.',  'customer', NULL),
  (2, 'frank@mail.com',  'Frank',   'customer', NULL),
  (3, 'grace@initech.io','Grace',   'admin',    NULL);

INSERT INTO categories (tenant_id, parent_id, name) VALUES
  (1, NULL, 'Maison'),       -- 1
  (1, 1,    'Cuisine'),      -- 2
  (1, 2,    'Cafe'),         -- 3
  (1, NULL, 'Bureau'),       -- 4
  (2, NULL, 'Sport');        -- 5

INSERT INTO products
  (tenant_id, sku, name, price, stock, attributes) VALUES
  (1, 'MUG-01', 'Mug isotherme', 19.90, 120,
   '{"color": "noir", "tags": ["cafe", "inox"]}'),
  (1, 'CAF-01', 'Cafetiere italienne', 34.50, 40,
   '{"color": "argent", "tags": ["cafe"]}'),
  (1, 'MOU-01', 'Moulin a cafe', 59.00, 15,
   '{"tags": ["cafe", "manuel"]}'),
  (1, 'LAM-01', 'Lampe de bureau', 45.00, 0,
   '{"color": "blanc", "watts": 8}'),
  (2, 'YOG-01', 'Tapis de yoga', 29.99, 60,
   '{"color": "vert", "tags": ["yoga"]}'),
  (2, 'HAL-01', 'Halteres 2x5kg', 49.00, 25,
   '{"weight_kg": 10}'),
  (2, 'GOU-01', 'Gourde 1L', 12.50, 200,
   '{"color": "bleu", "tags": ["inox"]}'),
  (3, 'PAP-01', 'Ramette papier A4', 5.90, 1000, '{}');

INSERT INTO product_categories VALUES
  (1, 3), (2, 3), (3, 3), (1, 2), (4, 4), (5, 5), (6, 5);

-- dates relatives à now() : les requêtes "le mois dernier"
-- marchent quel que soit le jour où tu charges les données
INSERT INTO orders (tenant_id, user_id, status, total, created_at)
VALUES
  (1, 2, 'paid',      74.30, date_trunc('month', now())
                             - interval '20 days'),  -- 1
  (1, 3, 'shipped',   59.00, date_trunc('month', now())
                             - interval '10 days'),  -- 2
  (1, 2, 'paid',     118.00, date_trunc('month', now())
                             - interval '5 days'),   -- 3
  (1, 3, 'cancelled', 45.00, date_trunc('month', now())
                             - interval '3 days'),   -- 4
  (1, 2, 'pending',   19.90, now() - interval '1 hour'), -- 5
  (2, 6, 'paid',      42.49, date_trunc('month', now())
                             - interval '15 days'),  -- 6
  (2, 7, 'paid',      98.00, date_trunc('month', now())
                             - interval '12 days'),  -- 7
  (2, 7, 'refunded',  29.99, date_trunc('month', now())
                             - interval '2 days'),   -- 8
  (2, 6, 'paid',      37.50, now() - interval '2 days'); -- 9

INSERT INTO order_items
  (order_id, product_id, quantity, unit_price) VALUES
  (1, 1, 2, 19.90), (1, 2, 1, 34.50),
  (2, 3, 1, 59.00),
  (3, 3, 2, 59.00),
  (4, 4, 1, 45.00),
  (5, 1, 1, 19.90),
  (6, 5, 1, 29.99), (6, 7, 1, 12.50),
  (7, 6, 2, 49.00),
  (8, 5, 1, 29.99),
  (9, 7, 3, 12.50);

INSERT INTO payments
  (order_id, provider, provider_ref, amount, status,
   idempotency_key) VALUES
  (1, 'stripe', 'pi_001',  74.30, 'succeeded', 'ord-1-try-1'),
  (2, 'stripe', 'pi_002',  59.00, 'succeeded', 'ord-2-try-1'),
  (3, 'stripe', 'pi_003a', 118.00, 'failed',   'ord-3-try-1'),
  (3, 'stripe', 'pi_003b', 118.00, 'succeeded','ord-3-try-2'),
  (6, 'stripe', 'pi_006',  42.49, 'succeeded', 'ord-6-try-1'),
  (7, 'paypal', 'pp_007',  98.00, 'succeeded', 'ord-7-try-1'),
  (8, 'stripe', 'pi_008',  29.99, 'refunded',  'ord-8-try-1'),
  (9, 'stripe', 'pi_009',  37.50, 'succeeded', 'ord-9-try-1');

INSERT INTO events (tenant_id, user_id, type, payload, created_at)
SELECT o.tenant_id, o.user_id, 'order.created',
       jsonb_build_object('order_id', o.id, 'total', o.total),
       o.created_at
FROM orders o;

INSERT INTO events (tenant_id, user_id, type, payload) VALUES
  (1, 2, 'user.login', '{"ip": "203.0.113.7"}'),
  (2, 7, 'user.login', '{"ip": "198.51.100.4"}'),
  -- événement système : pas d'utilisateur
  (1, NULL, 'stock.low', '{"product_id": 4}');
```
:::

Ce que contient le jeu :

- 3 tenants (`acme`, `globex`, `initech`) ; `initech` n'a **aucune** commande (utile pour les `LEFT JOIN`).
- `bob@mail.com` existe dans deux tenants (normal : unicité *par tenant*).
- Dan est soft-deleted.
- La commande 3 a un paiement échoué puis un réussi.
- Un événement `stock.low` a un `user_id` NULL (piège du `NOT IN`, chapitre 1).

## Ordre de lecture

1. [SQL fondamentaux](/bdd/01-sql-fondamentaux) : la base qu'on te demandera au tableau.
2. [Modélisation](/bdd/02-modelisation) : dessiner un schéma qui tient 5 ans.
3. [Index & EXPLAIN](/bdd/03-index-et-explain) : le chapitre qui rapporte le plus en prod.
4. [Transactions & isolation](/bdd/04-transactions-isolation) : ne jamais débiter deux fois.
5. [Postgres avancé](/bdd/05-postgres-avance) : CTE, window functions, JSONB, VACUUM.
6. [MySQL](/bdd/06-mysql) : ce qui change quand on vient de Postgres.
7. [MongoDB](/bdd/07-mongodb) : penser en documents.
8. [Migrations, ORM & prod](/bdd/08-migrations-orm-en-prod) : déployer sans downtime.
9. [Choisir & scaler](/bdd/09-choisir-et-scaler) : réplicas, cache, outbox.

Les chapitres 1 à 4 sont le socle : fais-les dans l'ordre. Ensuite, pioche.

Côté code, la couche d'accès aux données est vue dans [Architecture backend](/dev/typescript/06-architecture-backend) (TS) et [API Axum + SQLx](/dev/rust/10-api-axum-sqlx) (Rust).
