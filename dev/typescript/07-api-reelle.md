<script setup>
import paginate from "./challenges/paginate";
</script>

# Une API réelle

Ce que tu vas apprendre : construire de bout en bout le back-end d'un SaaS de réservation avec **Fastify 5 + Zod 4 + Drizzle ORM + PostgreSQL** : schéma, validation, auth JWT, réservation sans surbooking, pagination par curseur, idempotency key et erreurs HTTP propres.

::: info Ce code a été exécuté
Les morceaux de ce chapitre forment une API qui compile en `strict` et a été testée contre un vrai PostgreSQL 17 (y compris 10 réservations concurrentes sur un créneau de capacité 3). Ce n'est pas du pseudo-code.
:::

## Le domaine

- Un **tenant** = un client du SaaS (une salle de sport).
- Un **slot** = un créneau (cours de yoga du mardi 18 h, capacité 12).
- Une **booking** = une réservation d'un client final sur un slot, pour N personnes.

Endpoints :

| Méthode | Route | Rôle |
| --- | --- | --- |
| `POST` | `/bookings` | réserver (idempotent) |
| `GET` | `/bookings` | lister, paginé par curseur |

Tout est **multi-tenant** : chaque requête porte un `tenantId` issu du token, et **chaque** requête SQL filtre dessus.

## Pourquoi cette stack

- **Fastify** : rapide, plugins encapsulés, hooks, `inject()` pour les tests, logger pino intégré. Hono est une très bonne alternative (multi-runtime : Node, Bun, edge).
- **Zod** + `fastify-type-provider-zod` : un schéma = validation runtime + types du handler + sérialisation de la réponse.
- **Drizzle** : du SQL typé, proche du SQL réel, sans magie. Tu vois les requêtes que tu écris.

```bash
pnpm add fastify fastify-type-provider-zod zod drizzle-orm pg jose
pnpm add -D drizzle-kit @types/pg typescript
```

## 1. Le schéma Drizzle

```ts
// src/db/schema.ts
import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, integer, timestamp, jsonb,
  index, primaryKey, check,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, precision: 3 })
    .notNull().defaultNow();
```

`precision: 3` n'est pas un détail : Postgres stocke les timestamps à la **microseconde**, une `Date` JS à la **milliseconde**. Un curseur construit depuis une `Date` arrondie peut sauter ou dupliquer des lignes. On aligne la DB sur ce que JS sait représenter.

```ts
export const slots = pgTable("slots", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  capacity: integer("capacity").notNull(),
  booked: integer("booked").notNull().default(0),
}, (t) => [
  index("slots_tenant_starts_idx").on(t.tenantId, t.startsAt),
  check("slots_booked_le_capacity",
    sql`${t.booked} <= ${t.capacity}`),
]);
```

```ts
export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  slotId: uuid("slot_id").notNull().references(() => slots.id),
  customerEmail: text("customer_email").notNull(),
  guests: integer("guests").notNull(),
  status: text("status", { enum: ["confirmed", "canceled"] })
    .notNull().default("confirmed"),
  createdAt: createdAt(),
}, (t) => [
  index("bookings_tenant_created_idx")
    .on(t.tenantId, t.createdAt.desc(), t.id.desc()),
]);
```

L'index `(tenant_id, created_at desc, id desc)` correspond **exactement** au tri de la pagination : Postgres lit l'index dans l'ordre et s'arrête après `limit + 1` lignes (cf. [Index & EXPLAIN](/bdd/03-index-et-explain)).

```ts
export const idempotencyKeys = pgTable("idempotency_keys", {
  tenantId: uuid("tenant_id").notNull(),
  key: text("key").notNull(),
  requestHash: text("request_hash").notNull(),
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body"),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.key] })]);
```

Les migrations SQL se génèrent avec `drizzle-kit generate` et se versionnent dans le repo (cf. [Migrations & ORM en prod](/bdd/08-migrations-orm-en-prod)).

```ts
// src/db/client.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export function createDb(url: string) {
  const pool = new Pool({ connectionString: url, max: 10 });
  const db = drizzle({ client: pool, schema });
  return { db, pool };
}
export type Db = ReturnType<typeof createDb>["db"];
```

## 2. Les contrats (schémas Zod)

Dans un monorepo, ce fichier vit dans `packages/contracts` et le front l'importe aussi.

```ts
// src/contracts.ts
import { z } from "zod";

export const CreateBookingBody = z.object({
  slotId: z.uuid(),
  customerEmail: z.email().toLowerCase(),
  guests: z.int().min(1).max(8),
});

export const BookingDto = z.object({
  id: z.uuid(),
  slotId: z.uuid(),
  customerEmail: z.email(),
  guests: z.int(),
  status: z.enum(["confirmed", "canceled"]),
  createdAt: z.iso.datetime(),
});
export type BookingDto = z.infer<typeof BookingDto>;

export const ListBookingsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const ErrorDto = z.object({
  error: z.string(),
  message: z.string(),
});
```

Le **DTO de réponse** est distinct de la row DB : pas de `tenantId` exposé, dates en ISO. Et comme la réponse passe par le serializer Zod, un champ ajouté par erreur à la row ne fuit pas.

## 3. Erreurs HTTP

```ts
// src/http/errors.ts
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message = code) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what: string) =>
  new HttpError(404, "not_found", `${what} not found`);
```

Une seule forme d'erreur pour tous les clients : `{ "error": "slot_full", "message": "..." }`. `error` est un code stable (le front fait un `switch` dessus), `message` est pour les humains. Pour aller plus loin, le standard est **RFC 9457** (Problem Details, `application/problem+json`).

## 4. Auth JWT

```ts
// src/http/auth.ts
import { jwtVerify } from "jose";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { HttpError } from "./errors.js";

export type AuthContext = {
  userId: string;
  tenantId: string;
  role: "owner" | "staff";
};

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}
```

La **declaration merging** de l'interface `FastifyRequest` ajoute `req.auth` à tous les handlers, typé.

```ts
export function registerAuth(app: FastifyInstance, secret: string) {
  const key = new TextEncoder().encode(secret);
  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (req) => {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) return;
    try {
      const { payload } = await jwtVerify(h.slice(7), key, {
        algorithms: ["HS256"],
        issuer: "booking-api",
        audience: "booking-api",
      });
      req.auth = {
        userId: String(payload.sub),
        tenantId: String(payload["tid"]),
        role: payload["role"] === "owner" ? "owner" : "staff",
      };
    } catch {
      throw new HttpError(401, "invalid_token");
    }
  });
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new HttpError(401, "unauthenticated");
  return req.auth;
}
```

Points de sécurité :

- `algorithms: ["HS256"]` **explicite** : ne jamais laisser le token choisir son algorithme (attaque `alg: none` / confusion RS256↔HS256).
- `issuer` et `audience` vérifiés ; `jose` vérifie `exp` et `nbf` tout seul.
- Le `tenantId` vient **du token**, jamais du body ou d'un header contrôlé par le client.
- Le payload d'un JWT est lisible par tous (base64) : rien de secret dedans.

### JWT ou session ?

| | JWT stateless | Session (cookie + store) |
| --- | --- | --- |
| Révocation | difficile (attendre `exp`) | immédiate (supprimer la session) |
| Scalabilité | rien à stocker | un store (Redis/Postgres) |
| Usage typique | API machine-to-machine, mobile | app web first-party |

Pour une app web, une **session** dans un cookie `HttpOnly; Secure; SameSite=Lax` est souvent le meilleur choix (pas de token dans le JS, révocation facile). Les JWT courts (5–15 min) + refresh token conviennent aux API publiques et au mobile.

## 5. Réserver sans surbooking

Le piège classique : `SELECT remaining` puis `INSERT` si `remaining > 0`. Deux requêtes simultanées lisent toutes deux « 1 place », et on surbooke. La solution : **une seule** mise à jour conditionnelle, atomique.

```ts
// src/bookings/repo.ts
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { bookings, slots } from "../db/schema.js";

type NewBooking = {
  tenantId: string; slotId: string;
  customerEmail: string; guests: number;
};
```

```ts
export function makeBookingRepo(db: Db) {
  return {
    async create(input: NewBooking) {
      return db.transaction(async (tx) => {
        const [slot] = await tx.update(slots)
          .set({ booked: sql`${slots.booked} + ${input.guests}` })
          .where(and(
            eq(slots.id, input.slotId),
            eq(slots.tenantId, input.tenantId),
            sql`${slots.booked} + ${input.guests} <= ${slots.capacity}`,
          ))
          .returning({ id: slots.id });
        if (!slot) return null; // complet ou inexistant
        const [booking] = await tx.insert(bookings)
          .values(input).returning();
        return booking!;
      });
    },
    // list(...) et slotExists(...) plus bas
  };
}
```

L'`UPDATE ... WHERE booked + n <= capacity` prend un **verrou de ligne** : la 2e transaction attend la 1re, puis réévalue la condition sur la valeur à jour. Le `CHECK (booked <= capacity)` est un filet de sécurité au niveau DB. Testé : 10 requêtes simultanées sur un créneau de 3 places → exactement 3 `201` et 7 `409`. (Les détails des niveaux d'isolation sont dans [Transactions & isolation](/bdd/04-transactions-isolation).)

## 6. Pagination par curseur

`OFFSET 10000` oblige Postgres à lire et jeter 10 000 lignes, et une insertion entre deux pages décale tout (doublons ou trous). Le **keyset** : « donne-moi les lignes après la dernière que j'ai vue ».

```ts
    async list(
      tenantId: string,
      limit: number,
      after: { createdAt: Date; id: string } | null,
    ) {
      return db.select().from(bookings)
        .where(and(
          eq(bookings.tenantId, tenantId),
          after
            ? sql`(${bookings.createdAt}, ${bookings.id})
                < (${after.createdAt}, ${after.id})`
            : undefined,
        ))
        .orderBy(desc(bookings.createdAt), desc(bookings.id))
        .limit(limit + 1);
    },
```

- La **comparaison de tuples** `(created_at, id) < (x, y)` gère les égalités de `created_at` (l'`id` départage) et utilise l'index composite.
- `limit + 1` : si on récupère une ligne de plus, il y a une page suivante. Pas de `COUNT(*)` coûteux.
- `and(..., undefined)` : Drizzle ignore les conditions `undefined`, pratique pour les filtres optionnels.

Le curseur est **opaque** pour le client (base64url d'un JSON) et **validé** au décodage :

```ts
// src/bookings/cursor.ts
import { z } from "zod";

const Cursor = z.object({ c: z.iso.datetime(), i: z.uuid() });

export function encodeCursor(createdAt: Date, id: string) {
  const json = JSON.stringify({ c: createdAt.toISOString(), i: id });
  return Buffer.from(json).toString("base64url");
}

export function decodeCursor(raw: string) {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const { c, i } = Cursor.parse(JSON.parse(json));
    return { createdAt: new Date(c), id: i };
  } catch {
    return null;
  }
}
```

## 7. Idempotency key

Le réseau mobile coupe, le client renvoie `POST /bookings`. Sans protection : deux réservations (et deux paiements). Le client envoie un header `Idempotency-Key` (un UUID généré **une fois** par intention), et le serveur garantit qu'une même clé produit **un seul** effet.

Algorithme :

1. Hash du body. `INSERT` de la clé `ON CONFLICT DO NOTHING`.
2. Si la clé existait : body différent → `422` ; requête en cours → `409` ; sinon on **rejoue** la réponse stockée.
3. Si c'est nouveau : on exécute, on stocke la réponse. En cas d'erreur, on supprime la clé pour permettre un nouvel essai.

```ts
// src/http/idempotency.ts
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { idempotencyKeys as ik } from "../db/schema.js";
import { HttpError } from "./errors.js";

type Stored = { status: number; body: unknown };

export async function withIdempotency(
  db: Db, tenantId: string, key: string, body: unknown,
  run: () => Promise<Stored>,
): Promise<Stored & { replayed: boolean }> {
  const requestHash = createHash("sha256")
    .update(JSON.stringify(body)).digest("hex");

  const inserted = await db.insert(ik)
    .values({ tenantId, key, requestHash })
    .onConflictDoNothing()
    .returning({ key: ik.key });
```

```ts
  if (inserted.length === 0) {
    const [prev] = await db.select().from(ik)
      .where(and(eq(ik.tenantId, tenantId), eq(ik.key, key)));
    if (!prev) throw new HttpError(409, "idempotency_retry");
    if (prev.requestHash !== requestHash) {
      throw new HttpError(422, "idempotency_key_reused");
    }
    if (prev.responseStatus === null) {
      throw new HttpError(409, "request_in_progress");
    }
    return { status: prev.responseStatus,
             body: prev.responseBody, replayed: true };
  }
```

```ts
  const where = and(eq(ik.tenantId, tenantId), eq(ik.key, key));
  try {
    const res = await run();
    await db.update(ik)
      .set({ responseStatus: res.status, responseBody: res.body })
      .where(where);
    return { ...res, replayed: false };
  } catch (err) {
    await db.delete(ik).where(where);
    throw err;
  }
}
```

À compléter en prod : un job qui purge les clés de plus de 24 h, et un « lock timeout » (une clé restée `in_progress` après un crash du process doit expirer). Le sujet est creusé côté design dans [Paiements & idempotence](/interview/03-system-design/05-paiements-idempotence).

::: tip Variante 100 % transactionnelle
Si l'opération ne touche **que** la DB, fais l'`INSERT` de la clé, le travail et le stockage de la réponse dans **une seule transaction**. Une requête concurrente sur la même clé bloque sur l'index unique jusqu'au commit, puis voit la réponse. Plus d'état « in progress » à gérer. La version en 3 étapes ci-dessus sert quand `run()` appelle un service externe (paiement), qu'on ne peut pas mettre dans une transaction.
:::

## 8. Les routes

```ts
// src/bookings/routes.ts (imports omis)
type Row = NonNullable<Awaited<ReturnType<BookingRepo["create"]>>>;

const toDto = (b: Row): BookingDto => ({
  id: b.id, slotId: b.slotId, customerEmail: b.customerEmail,
  guests: b.guests, status: b.status,
  createdAt: b.createdAt.toISOString(),
});

export const bookingRoutes: FastifyPluginAsyncZod<{
  repo: BookingRepo; db: Db;
}> = async (app, { repo, db }) => {
  // tout ce plugin exige un utilisateur : 401 avant la validation
  app.addHook("onRequest", async (req) => { requireAuth(req); });
  // ...routes
};
```

```ts
  app.post("/bookings", {
    schema: {
      body: CreateBookingBody,
      headers: z.object({
        "idempotency-key": z.string().min(8).max(100),
      }),
      response: { 201: BookingDto, 409: ErrorDto },
    },
  }, async (req, reply) => {
    const { tenantId } = requireAuth(req);
    const key = req.headers["idempotency-key"]; // string, validé
    const res = await withIdempotency(db, tenantId, key, req.body,
      async () => {
        const b = await repo.create({ ...req.body, tenantId });
        if (b) return { status: 201, body: toDto(b) };
        if (!(await repo.slotExists(tenantId, req.body.slotId))) {
          throw notFound("slot");
        }
        throw new HttpError(409, "slot_full");
      });
    if (res.replayed) reply.header("idempotent-replayed", "true");
    return reply.code(201).send(res.body as BookingDto);
  });
```

`req.body` est typé `{ slotId: string; customerEmail: string; guests: number }` **par inférence du schéma** : aucun type écrit à la main. Seuls les succès sont stockés (les erreurs suppriment la clé), d'où le `201` du replay. `slotExists` (non montré) distingue « complet » (`409`) de « inexistant pour ce tenant » (`404`).

```ts
  app.get("/bookings", {
    schema: {
      querystring: ListBookingsQuery,
      response: {
        200: z.object({
          items: z.array(BookingDto),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, async (req) => {
    const { tenantId } = requireAuth(req);
    const { limit, cursor } = req.query; // limit: number (coerce)
    const after = cursor ? decodeCursor(cursor) : null;
    if (cursor && !after) throw new HttpError(400, "invalid_cursor");
    const rows = await repo.list(tenantId, limit, after);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toDto),
      nextCursor: rows.length > limit && last
        ? encodeCursor(last.createdAt, last.id) : null,
    };
  });
```

## 9. L'app et le handler d'erreurs global

```ts
// src/http/app.ts
import Fastify from "fastify";
import {
  serializerCompiler, validatorCompiler,
  hasZodFastifySchemaValidationErrors,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

export function buildApp(deps: {
  repo: BookingRepo; db: Db; jwtSecret: string;
}) {
  const app = Fastify({
    logger: { level: "info" },
    requestIdHeader: "x-request-id",
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler); // ci-dessous

  registerAuth(app, deps.jwtSecret);
  app.register(bookingRoutes, { repo: deps.repo, db: deps.db });
  return app;
}
```

```ts
  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid request",
        issues: err.validation.map((v) => ({
          path: v.instancePath, message: v.message,
        })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status)
        .send({ error: err.code, message: err.message });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({
      error: "internal_error", message: "Something went wrong",
    });
  });
```

Trois catégories, trois traitements : validation (400 avec le détail), erreur métier connue (son code), tout le reste (500 **générique** au client, détail complet dans les logs avec le `reqId`).

`buildApp` prend ses dépendances en paramètre et ne fait pas `listen` : c'est ce qui permet de la tester avec `app.inject()` (voir [Tests](/dev/typescript/08-tests)). Le `main.ts` (composition root) fait `createDb`, `buildApp`, `listen`, et l'arrêt propre (`app.close()` puis `pool.end()` sur SIGTERM).

## Cas réel

Les réponses observées sur l'API ci-dessus, en conditions réelles :

| Scénario | Réponse |
| --- | --- |
| réservation valide | `201` + DTO |
| même clé, même body | `201` + `idempotent-replayed: true`, même `id` |
| même clé, body différent | `422 idempotency_key_reused` |
| créneau plein | `409 slot_full` |
| créneau d'un autre tenant | `404 not_found` |
| `guests: 0` | `400 validation_error`, path `/guests` |
| pas de token | `401 unauthenticated` |
| token invalide | `401 invalid_token` |
| curseur bidouillé | `400 invalid_cursor` |
| 3 requêtes simultanées, même clé | une passe, les autres `409 request_in_progress` |

Ce qu'il reste pour la prod : rate limiting (`@fastify/rate-limit`, par tenant), CORS (`@fastify/cors`), `helmet`, health checks (`/healthz` qui ping la DB), OpenAPI généré depuis les schémas Zod (`@fastify/swagger` + `jsonSchemaTransform`), et le déploiement (cf. [Déployer une vraie app](/infra/11-deployer-une-vraie-app)).

## Pièges classiques

- Oublier `tenantId` dans **une** requête : fuite de données entre clients. Mets-le dans la signature de chaque méthode de repo (ou utilise Row-Level Security Postgres en filet).
- `SELECT` puis `UPDATE` pour vérifier une capacité : race condition. Une mise à jour conditionnelle atomique ou un `SELECT ... FOR UPDATE`.
- Pagination `OFFSET` sur une grosse table, ou curseur sur une colonne non unique sans départage.
- Renvoyer la row DB telle quelle : colonnes internes exposées. Toujours un DTO + schéma de réponse.
- Laisser les erreurs Postgres remonter au client (`duplicate key value violates unique constraint "users_email_key"`).
- `jwt.decode` au lieu de `verify`, ou algorithme non fixé.
- Question d'entretien : « Comment rendre un `POST` de paiement sûr face aux retries ? » → idempotency key côté client, stockage de la réponse côté serveur, scope par tenant, hash du body.

## Défis

### 1. Trouve la faille

```ts
app.get("/bookings/:id", async (req) => {
  const { id } = req.params as { id: string };
  const [b] = await db.select().from(bookings)
    .where(eq(bookings.id, id));
  return b;
});
```

::: details Solution
- **IDOR** : aucun filtre `tenantId` ; n'importe quel utilisateur authentifié lit les réservations des autres clients en devinant/collectant des ids. Ajoute `eq(bookings.tenantId, auth.tenantId)` et renvoie **404** si absent.
- Pas d'auth exigée sur la route.
- `req.params as` : pas de validation (un id non-UUID fait planter Postgres → 500). Schéma `params: z.object({ id: z.uuid() })`.
- Retour de la row brute (pas de DTO, pas de schéma de réponse), et `undefined` → 200 avec un body vide au lieu de 404.
:::

### 2. Ajoute l'annulation

Écris `POST /bookings/:id/cancel` : seul un `owner` peut annuler, pas moins de 24 h avant le créneau, et il faut libérer les places du slot. Quelles opérations doivent être dans la même transaction ?

::: details Solution
Dans **une** transaction : `UPDATE bookings SET status='canceled' WHERE id=$1 AND tenant_id=$2 AND status='confirmed' RETURNING slot_id, guests` (la condition sur le statut rend l'annulation idempotente et évite de libérer deux fois), puis `UPDATE slots SET booked = booked - $guests WHERE id = $slot_id`. La règle des 24 h se vérifie avant (lecture du slot, avec l'horloge injectée) ; le rôle se vérifie dans le handler (`auth.role !== "owner"` → 403). Si l'`UPDATE` ne retourne rien : 404 (inexistant) ou 409 (déjà annulée), à distinguer par une lecture.
:::

### 3. Pourquoi `limit + 1` ?

Quelle alternative coûterait plus cher, et pourquoi le client ne doit-il pas construire le curseur lui-même ?

::: details Solution
Sans la ligne en plus, il faudrait un `COUNT(*)` (parcours de toutes les lignes du tenant) ou renvoyer un curseur même sur la dernière page (une requête vide de plus côté client). Le curseur est opaque pour pouvoir changer son contenu (ajouter une colonne de tri) sans casser les clients, et il est validé côté serveur car c'est une entrée utilisateur comme une autre.
:::

### 4. Pagination keyset (exécutable)

Réimplémente la logique de `list` + curseur en mémoire : tri, départage par `id`, `limit + 1`, curseur opaque, curseur invalide.

<Challenge :data="paginate" />

## À retenir

- Un schéma Zod par entrée/sortie : validation, types du handler et sérialisation de la réponse en une seule déclaration.
- Le `tenantId` vient du token et filtre **chaque** requête ; ressource d'un autre tenant = 404.
- Concurrence : mise à jour conditionnelle atomique + contrainte `CHECK`, jamais « lire puis écrire ».
- Pagination keyset `(created_at, id) <` + index composite + `limit + 1` + curseur opaque validé.
- Idempotency key pour tout `POST` qui crée de la valeur ; handler d'erreurs global à trois branches.
