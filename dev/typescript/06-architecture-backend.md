<script setup>
import compose from "./challenges/compose";
</script>

# Architecture backend

Ce que tu vas apprendre : organiser un backend TypeScript pour qu'il reste testable et lisible à 50 000 lignes : couches, ports & adapters « light », injection de dépendances sans framework, monorepo pnpm, config, logs structurés et tsconfig strict.

## Le problème à éviter

Le handler qui fait tout :

```ts
app.post("/bookings", async (req, reply) => {
  const body = req.body as any;
  const slot = await pool.query("SELECT * FROM slots WHERE id=$1",
    [body.slotId]);
  if (slot.rows[0].remaining === 0) return reply.code(409).send();
  await pool.query("INSERT INTO bookings ...");
  await fetch("https://api.sendgrid.com/...", { /* ... */ });
  return { ok: true };
});
```

Impossible à tester sans DB et sans SendGrid, règle métier (« créneau plein ») noyée dans du SQL et du HTTP, et dupliquée le jour où un job CLI doit aussi réserver.

## Trois couches, une règle

```
http/       routes, validation, codes HTTP      (adapter entrant)
domain/     règles métier, use cases            (cœur)
infra/      DB, emails, paiement, cache         (adapters sortants)
```

**La règle de dépendance** : `domain` n'importe **rien** de `http` ni de `infra`. Il définit des **ports** (interfaces) que l'infra implémente.

```ts
// domain/ports.ts
export interface BookingRepo {
  findSlot(tenantId: TenantId, slotId: SlotId): Promise<Slot | null>;
  insert(b: NewBooking): Promise<Booking>;
}

export interface Mailer {
  sendConfirmation(b: Booking): Promise<void>;
}

export interface Clock {
  now(): Date;
}
```

```ts
// domain/book-slot.ts
export function makeBookSlot(deps: {
  repo: BookingRepo;
  mailer: Mailer;
  clock: Clock;
}) {
  return async function bookSlot(
    cmd: BookSlotCommand,
  ): Promise<Result<Booking, BookError>> {
    const slot = await deps.repo.findSlot(cmd.tenantId, cmd.slotId);
    if (!slot) return err({ type: "slot_not_found" });
    if (slot.startsAt <= deps.clock.now()) {
      return err({ type: "slot_in_past" });
    }
    if (slot.remaining < cmd.guests) return err({ type: "slot_full" });
    const booking = await deps.repo.insert({ ...cmd, slot });
    await deps.mailer.sendConfirmation(booking);
    return ok(booking);
  };
}
```

C'est ça, l'architecture hexagonale « light » : pas de dossiers `application/`, `domain/`, `infrastructure/`, `interfaces/` à 6 niveaux, juste **le métier ne connaît pas les détails techniques**. L'horloge injectée (`Clock`) semble excessive… jusqu'au premier test de « on ne peut pas réserver un créneau passé ».

::: tip Organise par feature, pas par type
Au-delà de quelques modules, préfère `src/bookings/{routes,service,repo}.ts`, `src/billing/...` à `src/routes/*`, `src/services/*`. Une feature = un dossier qu'on peut lire (et supprimer) d'un bloc.
:::

## Injection de dépendances sans framework

Pas besoin d'InversifyJS ni de décorateurs. Des **fonctions factory** et un **composition root** : un seul endroit qui instancie tout et câble les dépendances.

```ts
// main.ts : composition root
import { env } from "./env.js";
import { createDb } from "./infra/db.js";
import { DrizzleBookingRepo } from "./infra/booking-repo.js";
import { ResendMailer } from "./infra/mailer.js";
import { makeBookSlot } from "./domain/book-slot.js";
import { buildApp } from "./http/app.js";

const db = createDb(env.DATABASE_URL);
const clock = { now: () => new Date() };

const bookSlot = makeBookSlot({
  repo: new DrizzleBookingRepo(db),
  mailer: new ResendMailer(env.RESEND_API_KEY),
  clock,
});

const app = buildApp({ bookSlot, logger });
await app.listen({ port: env.PORT, host: "0.0.0.0" });
```

Dans les tests, tu câbles autrement :

```ts
const bookSlot = makeBookSlot({
  repo: new InMemoryBookingRepo(),
  mailer: { sendConfirmation: vi.fn(async () => {}) },
  clock: { now: () => new Date("2026-11-16T09:00:00Z") },
});
```

Pourquoi c'est mieux qu'un container :

- tout est **explicite** et vérifié par le compilateur (dépendance manquante = erreur TS) ;
- pas de magie à l'exécution, pas de décorateurs ni de `reflect-metadata` ;
- « aller à la définition » marche.

Quand le graphe grossit, regroupe par module (`makeBookingModule(deps)` qui retourne ses use cases), mais garde un seul composition root.

::: warning Évite les singletons importés
`import { db } from "./db"` partout est pratique et c'est un piège : impossible de remplacer `db` en test sans mocker le module, et l'ordre d'import décide de l'initialisation. Passe les dépendances en paramètre.
:::

## Monorepo avec pnpm workspaces

Typique pour un SaaS : une API, un worker, un front, et du code partagé.

```
.
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── apps/
│   ├── api/        (Fastify)
│   ├── worker/     (jobs, emails)
│   └── web/        (React)
└── packages/
    ├── contracts/  (schémas Zod partagés front/back)
    ├── db/         (schéma Drizzle, migrations)
    └── config/     (eslint, tsconfig partagés)
```

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
catalog:
  zod: ^4.1.0
  typescript: ^5.9.0
```

```json
// apps/api/package.json
{
  "name": "@acme/api",
  "type": "module",
  "dependencies": {
    "@acme/contracts": "workspace:*",
    "zod": "catalog:"
  }
}
```

- `workspace:*` lie le package local (symlink), pas de publication npm.
- `catalog:` (pnpm 9.5+) centralise les versions : un seul endroit pour monter `zod`.
- `pnpm --filter @acme/api dev`, `pnpm -r build` pour tout builder.

Le package partagé peut exposer directement ses sources TS (simple, pas d'étape de build interne) :

```json
// packages/contracts/package.json
{
  "name": "@acme/contracts",
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

Ça marche si **tous** les consommateurs compilent du TS (Vite côté front, `tsx`/type stripping ou un bundler côté back). Sinon, builde le package vers `dist/` et utilise les TS project references (`composite: true`, `tsc -b`). Pour un monorepo moyen, Turborepo ou Nx ajoutent du cache de build ; pas indispensable au départ.

## Configuration

Une config = un objet **validé et typé** au démarrage (cf. [Erreurs & validation](/dev/typescript/05-erreurs-et-validation)), puis passé aux factories.

```ts
// config.ts
export function loadConfig(env: NodeJS.ProcessEnv) {
  const e = EnvSchema.parse(env);
  return {
    http: { port: e.PORT, corsOrigins: e.CORS_ORIGINS },
    db: { url: e.DATABASE_URL, poolMax: e.DB_POOL_MAX },
    features: { waitlist: e.FEATURE_WAITLIST },
  } as const;
}
export type Config = ReturnType<typeof loadConfig>;
```

- **12-factor** : la config vient de l'env, pas de fichiers commités par environnement.
- Les secrets viennent d'un secret manager injecté en variables d'env (cf. [Sécurité & secrets](/infra/10-securite-et-secrets)).
- `loadConfig(env)` prend l'env en **paramètre** : testable sans toucher `process.env`.

## Logging structuré

Des logs JSON, une ligne par événement, avec des champs requêtables. **pino** est le standard Node (c'est le logger de Fastify).

```ts
import pino from "pino";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: ["req.headers.authorization", "*.password", "*.cardNumber"],
  base: { service: "api", version: process.env.GIT_SHA },
});

logger.info({ tenantId, bookingId, durationMs: 42 },
  "booking created");
// {"level":30,"time":...,"service":"api","tenantId":"t_1",
//  "bookingId":"b_9","durationMs":42,"msg":"booking created"}
```

- Le **message** est constant, les **données** sont dans les champs. `` logger.info(`booking ${id} created`) `` est impossible à agréger.
- `redact` pour ne jamais logger tokens et données sensibles.
- Erreurs : `logger.error({ err }, "charge failed")` ; pino sérialise `err` avec stack et `cause`.
- En dev, `pino-pretty` pour lire ; en prod, du JSON brut vers stdout, collecté par la plateforme (cf. [Observabilité](/infra/08-observabilite)).

### Corréler une requête : `AsyncLocalStorage`

Pour avoir le `requestId` et le `tenantId` dans **tous** les logs d'une requête sans les passer partout :

```ts
import { AsyncLocalStorage } from "node:async_hooks";

type Ctx = { requestId: string; tenantId?: string };
export const als = new AsyncLocalStorage<Ctx>();

export const log = () => {
  const ctx = als.getStore();
  return ctx ? logger.child(ctx) : logger;
};

// dans un hook HTTP :
// als.run({ requestId: req.id }, () => handle(req));
```

Fastify fournit déjà `req.log` (child logger avec `reqId`) ; `AsyncLocalStorage` sert pour le code profond (repos, clients HTTP) qui n'a pas `req` sous la main. C'est aussi ce qu'utilise OpenTelemetry pour propager le contexte de trace.

## tsconfig strict recommandé (2026)

Pour un backend Node 22/24 en ESM :

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "module": "nodenext",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "erasableSyntaxOnly": true,
    "noUncheckedSideEffectImports": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

Les options qui comptent, et pourquoi :

| Option | Effet |
| --- | --- |
| `module: nodenext` | résolution comme Node : ESM/CJS selon `type`, `exports` respectés |
| `verbatimModuleSyntax` | `import type` obligatoire pour les types ; ce que tu écris est ce qui est émis |
| `isolatedModules` | chaque fichier compilable seul (esbuild, swc, Node) |
| `erasableSyntaxOnly` | interdit `enum`, `namespace`, parameter properties |
| `noUncheckedSideEffectImports` | erreur si `import "./setup"` ne résout pas |

Conséquences au quotidien :

```ts
// module nodenext + ESM : extension obligatoire, en .js
import { makeBookSlot } from "./domain/book-slot.js";
// verbatimModuleSyntax : les types en import type
import type { Booking } from "./domain/types.js";
```

L'extension `.js` dans un fichier `.ts` surprend : c'est le chemin **du fichier émis**. Alternative si tu exécutes le TS directement (Node type stripping, `tsx`) : importer en `.ts` avec `allowImportingTsExtensions` (+ `noEmit`) ou `rewriteRelativeImportExtensions` (TS 5.7) si tu émets.

::: info Et `tsc --init` ?
Depuis TS 5.9, `tsc --init` génère une config moderne proche de celle-ci (`nodenext`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`…). TypeScript 6 et 7 (compilateur natif) continuent dans cette direction en dépréciant les vieux réglages (`moduleResolution: node`, `target: es5`). Une config comme ci-dessus est prête pour la migration.
:::

## Cas réel

**Le même use case, trois points d'entrée.** Ton SaaS doit pouvoir réserver depuis l'API publique, depuis le back-office (un admin réserve pour un client par téléphone) et depuis un import CSV en CLI. Avec un use case injecté, les trois adapters sont minces :

```ts
// http/bookings.routes.ts
app.post("/bookings", { schema: { body: CreateBooking } },
  async (req, reply) => {
    const r = await deps.bookSlot({
      ...req.body, tenantId: req.auth.tenantId,
      source: "public_api",
    });
    if (!r.ok) return sendBookError(reply, r.error);
    return reply.code(201).send(toDto(r.value));
  });
```

```ts
// cli/import-bookings.ts
for await (const row of readCsv(file)) {
  const r = await bookSlot({ ...row, tenantId, source: "import" });
  if (!r.ok) report.push({ row, error: r.error.type });
}
```

La règle « pas de réservation dans le passé » est écrite **une** fois, testée **une** fois, sans HTTP ni CSV. Les adapters ne font que traduire (HTTP ↔ commande, CSV ↔ commande, erreur métier ↔ code HTTP). C'est le bénéfice concret de l'archi, bien plus que le nom des dossiers.

Et le **modèle oignon** des middlewares (auth, logging, timing) que tous les frameworks HTTP utilisent est l'objet du défi 4.

## Pièges classiques

- Architecture cérémonielle : 4 couches, un DTO, un mapper et une interface par entité pour un CRUD de 3 tables. Commence simple, extrais quand la complexité arrive.
- Le domaine qui importe le client Drizzle ou `FastifyRequest` : la règle de dépendance est cassée, le test unitaire devient un test d'intégration.
- Une interface avec une seule implémentation **et** aucun test qui la remplace : abstraction inutile.
- Logs en `console.log` avec des messages interpolés : impossible à filtrer par `tenantId` en prod.
- Lire `process.env.X` au fil du code : variable manquante découverte au runtime, en prod.
- Mélanger ESM et CJS sans comprendre `type` dans `package.json`. Depuis Node 22.12, `require()` d'un module ESM synchrone fonctionne, mais vise du **tout ESM** pour un projet neuf.
- Question d'entretien : « Comment tu testes un service qui envoie un email ? » → l'email est un port injecté ; en test, un fake qui enregistre les appels.

## Défis

### 1. Où est la fuite d'abstraction ?

```ts
// domain/cancel-booking.ts
import { eq } from "drizzle-orm";
import { bookings } from "../infra/schema.js";

export async function cancelBooking(db: Db, id: string) {
  const [b] = await db.select().from(bookings)
    .where(eq(bookings.id, id));
  if (b.startsAt.getTime() - Date.now() < 24 * 3600_000) {
    throw new Error("too late");
  }
  await db.update(bookings).set({ status: "canceled" })
    .where(eq(bookings.id, id));
}
```

::: details Solution
- Le domaine importe Drizzle et le schéma : il dépend de l'infra. Introduis un port `BookingRepo` (`findById`, `markCanceled`).
- `Date.now()` : dépendance cachée à l'horloge, la règle des 24 h est intestable. Injecte un `Clock`.
- `b` peut être `undefined` (avec `noUncheckedIndexedAccess`, TS le signale) : `NotFound` manquant.
- `throw new Error("too late")` : une erreur métier attendue, à modéliser (`Result` ou `ConflictError("cancellation_window_passed")`).
- Pas de filtre `tenantId` : un tenant peut annuler la réservation d'un autre (IDOR).
:::

### 2. Dessine le composition root

Le worker d'emails a besoin de : config, logger, un pool Postgres, un client de queue (pg-boss), un `Mailer`, et un use case `sendReminders(repo, mailer, clock)`. Écris le `main.ts` du worker, en gérant l'arrêt propre sur SIGTERM.

::: details Solution
```ts
const config = loadConfig(process.env);
const logger = pino({ level: config.logLevel });
const pool = new pg.Pool({ connectionString: config.db.url });
const boss = new PgBoss(config.db.url);
const mailer = new ResendMailer(config.resendKey, logger);
const sendReminders = makeSendReminders({
  repo: new PgReminderRepo(pool),
  mailer,
  clock: systemClock,
});

await boss.start();
await boss.work("reminders", async () => { await sendReminders(); });

process.once("SIGTERM", async () => {
  logger.info("shutting down");
  await boss.stop({ graceful: true }); // finit les jobs en cours
  await pool.end();
  process.exit(0);
});
```
L'ordre de fermeture est l'inverse de l'ouverture : on arrête de prendre des jobs, on attend ceux en cours, puis on ferme la DB.
:::

### 3. Pourquoi ça plante au runtime ?

`tsconfig` : `module: nodenext`, `package.json` : `"type": "module"`. Le code compile et produit `dist/main.js` qui importe `./config`. Node lance `ERR_MODULE_NOT_FOUND`.

::: details Solution
En ESM, Node exige le chemin complet avec extension : `./config.js`. Avec `module: nodenext`, `tsc` signale d'ailleurs `import "./config"` (« Relative import paths need explicit file extensions »). Si ça « compile », c'est que la config ne correspond pas (ancienne `moduleResolution: node`). Corrige l'import en `./config.js` et la config en `nodenext`.
:::

### 4. `compose` de middlewares (exécutable)

Implémente le cœur d'un framework HTTP : la composition de middlewares en oignon, avec la détection du double `next()`.

<Challenge :data="compose" />

## À retenir

- Le domaine ne dépend de rien de technique ; il définit des ports que l'infra implémente.
- DI = factories + un composition root. Pas de container, pas de singletons importés.
- Monorepo pnpm : `workspace:*`, `catalog:`, packages partagés (schémas Zod) entre front et back.
- Config validée au démarrage, logs JSON avec pino (`redact`, champs structurés, `AsyncLocalStorage`).
- tsconfig : `strict` + `nodenext` + `verbatimModuleSyntax` + `erasableSyntaxOnly` + `noUncheckedIndexedAccess`.
