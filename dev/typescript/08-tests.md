<script setup>
import fakeClock from "./challenges/fake-clock";
</script>

# Tests

Ce que tu vas apprendre : tester un backend TypeScript avec Vitest de façon à **attraper de vrais bugs** : unitaire vs intégration vs e2e, fakes plutôt que mocks, API testée contre un vrai PostgreSQL (Testcontainers), tests de types, et surtout ce qui mérite (ou pas) un test.

## Ce qu'un test doit t'apporter

Un bon test :

- **échoue** quand le comportement casse (sinon il ne sert à rien) ;
- **ne casse pas** quand tu refactores sans changer le comportement (sinon il te freine) ;
- est **rapide** et **déterministe** (sinon personne ne le lance, ou tout le monde l'ignore).

Le deuxième point élimine la plupart des tests « qui mockent tout » : ils testent l'implémentation (« la fonction a appelé `repo.save` avec ces arguments »), pas le comportement.

## Vitest en 2 minutes

Vitest est le standard en 2026 pour TS : ESM et TS natifs (via Vite), API compatible Jest, watch mode rapide.

```ts
// src/pricing.test.ts
import { describe, expect, it } from "vitest";
import { priceFor } from "./pricing.js";

describe("priceFor", () => {
  it("applique le tarif heures creuses avant 10h", () => {
    const p = priceFor({ basePriceCents: 2000,
      startsAt: new Date("2026-11-16T08:00:00Z") });
    expect(p).toBe(1500);
  });

  it.each([
    [1, 2000],
    [4, 7200], // -10 % à partir de 4 personnes
  ])("%i personnes -> %i centimes", (guests, expected) => {
    expect(priceFor({ basePriceCents: 2000, guests,
      startsAt: new Date("2026-11-16T12:00:00Z") })).toBe(expected);
  });
});
```

Matchers utiles : `toEqual` (égalité profonde), `toStrictEqual` (+ `undefined` et classes), `toMatchObject` (sous-ensemble), `toThrow`, `resolves`/`rejects`, `expect.any(String)`, `toHaveBeenCalledWith`.

## La pyramide, version pragmatique

| Type | Teste | Vitesse | Quantité |
| --- | --- | --- | --- |
| Unitaire | une fonction / un use case, deps en fakes | ms | beaucoup |
| Intégration | API + vraie DB, en process | 10–100 ms | assez |
| E2E | le système déployé (navigateur, réseau) | secondes | peu |

Pour un backend, la zone la plus rentable est souvent l'**intégration** : `app.inject()` contre un vrai Postgres. Elle teste le SQL, les contraintes, les transactions, la validation et la sérialisation **ensemble**, là où vivent la majorité des bugs réels. Les tests unitaires couvrent la logique pure (prix, règles, parsing) et les cas limites nombreux.

## Mocks, stubs, fakes

| | Ce que c'est | Exemple |
| --- | --- | --- |
| Stub | retourne une valeur fixe | `findSlot: async () => slot` |
| Mock | stub + vérifie les appels | `vi.fn()` + `toHaveBeenCalledWith` |
| Fake | implémentation simplifiée qui marche | `InMemoryBookingRepo` |

### Préfère les fakes

```ts
class InMemoryBookingRepo implements BookingRepo {
  slots = new Map<string, Slot>();
  bookings: Booking[] = [];

  async findSlot(tenantId: TenantId, slotId: SlotId) {
    const s = this.slots.get(slotId);
    return s && s.tenantId === tenantId ? s : null;
  }
  async insert(b: NewBooking) {
    const booking = { ...b, id: crypto.randomUUID(),
      status: "confirmed" as const };
    this.bookings.push(booking);
    return booking;
  }
}
```

```ts
it("refuse un créneau passé", async () => {
  const repo = new InMemoryBookingRepo();
  repo.slots.set(SLOT_ID, aSlot({
    startsAt: new Date("2026-11-16T08:00:00Z"),
  }));
  const bookSlot = makeBookSlot({
    repo,
    mailer: new FakeMailer(),
    clock: { now: () => new Date("2026-11-16T09:00:00Z") },
  });

  const r = await bookSlot(aCommand({ slotId: SLOT_ID }));

  expect(r).toEqual({ ok: false, error: { type: "slot_in_past" } });
  expect(repo.bookings).toHaveLength(0);
});
```

Le test vérifie un **état** (« aucune réservation créée »), pas une séquence d'appels. Si demain `insert` est remplacé par `insertMany`, il passe toujours. Et le fake est réutilisable dans 50 tests. Le contrat du fake doit rester fidèle au vrai : idéalement, une même suite de tests tourne contre le fake **et** contre l'implémentation Drizzle (contract tests).

Les helpers `aSlot(overrides)` / `aCommand(overrides)` (test data builders) donnent des valeurs par défaut valides : chaque test n'écrit que ce qui compte pour lui.

### Quand `vi.fn` est le bon outil

Pour les **effets de bord sortants** dont l'appel est le comportement attendu :

```ts
const mailer = { sendConfirmation: vi.fn(async (_b: Booking) => {}) };
// ...
expect(mailer.sendConfirmation).toHaveBeenCalledOnce();
expect(mailer.sendConfirmation).toHaveBeenCalledWith(
  expect.objectContaining({ customerEmail: "ada@x.io" }),
);
```

### `vi.mock` : en dernier recours

`vi.mock("./mailer.js", ...)` remplace un **module** entier. Utile pour du code legacy qui importe des singletons, mais c'est un signe que la dépendance n'est pas injectée (cf. [Architecture backend](/dev/typescript/06-architecture-backend)). `vi.mock` est hoisté en haut du fichier, ce qui surprend.

## Le temps : fake timers

Tout ce qui dépend du temps (retry, TTL, debounce, « 24 h avant ») doit être testable **sans attendre**.

```ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("retente avec backoff puis réussit", async () => {
  const fn = vi.fn<() => Promise<string>>()
    .mockRejectedValueOnce(new Error("503"))
    .mockRejectedValueOnce(new Error("503"))
    .mockResolvedValue("ok");

  const p = retry(fn, { retries: 3, baseMs: 100 });

  await vi.advanceTimersByTimeAsync(100);
  expect(fn).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(200);
  await expect(p).resolves.toBe("ok");
});
```

- `advanceTimersByTimeAsync` (version **Async**) laisse les Promises se résoudre entre les timers. La version synchrone avec du code `async` donne des tests qui bloquent.
- `vi.setSystemTime(date)` fige `Date.now()`. Mais une `Clock` injectée reste plus simple et plus explicite.
- Pour un rejet attendu : crée l'assertion `expect(p).rejects...` **avant** d'avancer le temps, sinon le rejet est signalé comme non géré.

## Tests d'API avec une vraie base

`app.inject()` (Fastify) simule une requête HTTP **sans réseau** : rapide, et ça passe par tout le pipeline (hooks, validation, sérialisation, handler d'erreurs).

### Testcontainers : un Postgres jetable

```ts
// test/global-setup.ts
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .start();
  const url = container.getConnectionUri();
  await runMigrations(url); // drizzle-kit migrate, ou migrate()
  project.provide("databaseUrl", url);
  return async () => { await container.stop(); };
}

declare module "vitest" {
  export interface ProvidedContext { databaseUrl: string }
}
```

Le conteneur démarre **une fois** pour toute la suite, et `provide`/`inject` passe l'URL aux fichiers de test de façon typée.

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["src/**/*.test.ts"] } },
      {
        test: {
          name: "integration",
          include: ["test/**/*.int.test.ts"],
          globalSetup: ["test/global-setup.ts"],
          testTimeout: 20_000,
        },
      },
    ],
  },
});
```

`vitest --project unit` en watch pendant que tu codes, les deux en CI.

### Le test

```ts
// test/bookings.int.test.ts
const { db, pool } = createDb(inject("databaseUrl"));
const app = buildApp({ repo: makeBookingRepo(db), db,
  jwtSecret: SECRET });

beforeEach(async () => {
  await db.execute(sql`truncate bookings, idempotency_keys`);
  await db.execute(sql`update slots set booked = 0`);
});
afterAll(async () => { await app.close(); await pool.end(); });
```

```ts
it("ne surbooke pas sous concurrence", async () => {
  const auth = `Bearer ${await tokenFor(TENANT)}`;
  const res = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    app.inject({
      method: "POST", url: "/bookings",
      headers: { authorization: auth,
                 "idempotency-key": `key-${i}-abcdef` },
      payload: { slotId: SLOT, customerEmail: "a@b.co", guests: 1 },
    })));
  const codes = res.map((r) => r.statusCode);
  expect(codes.filter((c) => c === 201)).toHaveLength(3);
  expect(codes.filter((c) => c === 409)).toHaveLength(7);
});

it("le créneau d'un autre tenant est invisible", async () => {
  const r = await app.inject({ /* token d'un autre tenant */ });
  expect(r.statusCode).toBe(404);
  expect(r.json()).toMatchObject({ error: "not_found" });
});
```

Ce test de concurrence attrape un bug **qu'aucun test unitaire avec mock ne peut voir** : il faut un vrai moteur de transactions. (Ce code tourne tel quel contre l'API du [chapitre précédent](/dev/typescript/07-api-reelle).)

Isolation entre tests, du plus simple au plus rapide :

- `TRUNCATE` dans un `beforeEach` (simple, quelques ms) ;
- une transaction par test, `ROLLBACK` à la fin (rapide, mais incompatible avec le code qui ouvre ses propres transactions) ;
- une base par worker Vitest (cloner une base template avec `CREATE DATABASE ... TEMPLATE`) pour paralléliser.

## Tester les types

Pour une lib interne avec des types avancés (cf. [Types avancés](/dev/typescript/03-types-avances)), les types sont une API publique : teste-les.

```ts
import { expectTypeOf, it } from "vitest";

it("RouteParams extrait les paramètres", () => {
  expectTypeOf<RouteParams<"/t/:tenantId/b/:id">>()
    .toEqualTypeOf<{ tenantId: string; id: string }>();
});

it("retry préserve le type de retour", () => {
  expectTypeOf(retry(async () => 42, opts))
    .resolves.toEqualTypeOf<number>();
});

it("parseTenantId refuse les strings brutes", () => {
  // @ts-expect-error : string n'est pas TenantId
  cancelBooking("t1", bookingId);
});
```

- `expectTypeOf` est vérifié par `tsc`, pas à l'exécution : lance `vitest --typecheck` (ou mets ces tests dans des fichiers `*.test-d.ts`).
- `// @ts-expect-error` échoue si la ligne **compile** : parfait pour vérifier qu'un mauvais usage est bien refusé.
- En CI, `tsc --noEmit` sur tout le projet reste le premier « test ».

## Ce qui mérite un test

**Oui, en priorité :**

- règles métier et calculs (prix, capacité, fenêtres d'annulation, droits) ;
- tout ce qui touche à l'**argent** et aux **autorisations** (isolation tenant) ;
- parsing et validation des frontières (webhooks, imports) ;
- les bugs corrigés : un test de non-régression par bug de prod ;
- la concurrence et l'idempotence (en intégration).

**Peu ou pas :**

- les getters, le code de câblage, les mappers triviaux ;
- les détails d'implémentation (« appelle `findById` avant `update` ») ;
- le framework lui-même (Fastify valide bien ton schéma Zod, pas besoin de 30 tests par champ ; un ou deux pour vérifier le branchement).

::: tip La couverture n'est pas un objectif
80 % de couverture avec des tests qui ne vérifient rien vaut moins que 50 % de tests de comportement. Regarde la couverture pour trouver le code **critique** non testé, pas pour atteindre un chiffre. (`vitest --coverage` avec `@vitest/coverage-v8`.)
:::

## Cas réel

**Le bug du changement d'heure.** Une salle de sport à Paris : les rappels « la veille à la même heure » partent une heure trop tard le dernier week-end d'octobre. Le code faisait `startsAt - 24 * 3600 * 1000` : à travers un changement d'heure, « la veille à 18 h » n'est **pas** 24 h avant (c'est 25 h en octobre, 23 h en mars).

Le test de non-régression, déterministe grâce à l'horloge injectée :

```ts
it("rappel 24h avant, à travers le passage à l'heure d'hiver", () => {
  // cours le dimanche 25/10/2026 à 18:00 Europe/Paris (UTC+1)
  const startsAt = new Date("2026-10-25T17:00:00Z");
  const at = reminderTime(startsAt, "Europe/Paris");
  // la veille à 18:00 heure de Paris, encore en UTC+2
  expect(at.toISOString()).toBe("2026-10-24T16:00:00.000Z");
});
```

Les dates sont le terrain idéal pour les tests **paramétrés** (`it.each`) : changements d'heure, fin de mois, années bissextiles, fuseaux. Et la preuve qu'une `Clock` injectée n'est pas de la sur-ingénierie.

## Pièges classiques

- Tests qui dépendent de l'ordre d'exécution ou d'un état partagé (une base pas nettoyée) : ils passent seuls et échouent ensemble.
- `Date.now()` / `Math.random()` non contrôlés : tests flaky.
- Oublier `await` sur `expect(...).rejects` : le test passe toujours.
- Mocker la base de données pour tester… des requêtes SQL. Tu testes ton mock.
- Mocks qui divergent de la réalité (le vrai repo lance une erreur sur doublon, le mock non).
- Snapshots géants (`toMatchSnapshot` sur 300 lignes de JSON) que tout le monde met à jour sans lire.
- Question d'entretien : « mock vs fake ? » → un mock vérifie des interactions, un fake est une implémentation qui fonctionne ; les fakes donnent des tests moins couplés à l'implémentation.

## Défis

### 1. Ce test est-il utile ?

```ts
it("createBooking appelle le repo", async () => {
  const repo = { insert: vi.fn().mockResolvedValue({ id: "b1" }) };
  const service = new BookingService(repo as any);
  await service.create({ slotId: "s1", email: "a@b.c" });
  expect(repo.insert).toHaveBeenCalledWith({
    slotId: "s1", email: "a@b.c",
  });
});
```

::: details Solution
Peu. Il répète l'implémentation (« create appelle insert avec ses arguments ») et ne vérifie aucune règle. Il cassera au premier refactor (ajout d'un champ `status`), et passera même si la réservation sur un créneau complet est acceptée. Le `as any` masque en plus que le faux repo ne respecte pas l'interface. Mieux : un fake repo, un scénario métier (« créneau plein → erreur `slot_full`, aucune réservation créée »).
:::

### 2. Pourquoi ce test passe toujours ?

```ts
it("rejette un token expiré", () => {
  expect(verifyToken(expiredToken)).rejects.toThrow("expired");
});
```

::: details Solution
L'assertion `rejects` retourne une Promise qui n'est ni `await`ée ni retournée : le test se termine avant qu'elle soit évaluée. Écris `await expect(verifyToken(expiredToken)).rejects.toThrow("expired")` dans un test `async`. (Les versions récentes de Vitest avertissent pour ce cas, mais ne compte pas dessus ; la règle ESLint `vitest/valid-expect` le détecte aussi.)
:::

### 3. Choisis le niveau de test

Pour chacun : unitaire, intégration ou e2e ? (a) le calcul de remboursement partiel selon le délai d'annulation ; (b) l'unicité d'un email par tenant ; (c) le parcours « réserver puis payer avec 3-D Secure » ; (d) le parsing des webhooks du prestataire de paiement.

::: details Solution
(a) unitaire, paramétré sur les délais. (b) intégration : c'est une contrainte `UNIQUE (tenant_id, email)` en base, seul un vrai Postgres la teste. (c) e2e (Playwright) avec le mode test du prestataire, peu de cas, sur le parcours critique. (d) unitaire avec des payloads réels enregistrés (fixtures), y compris malformés.
:::

### 4. Une horloge factice (exécutable)

Implémente le cœur de `vi.useFakeTimers()` : programmer, annuler et faire avancer le temps de façon déterministe.

<Challenge :data="fakeClock" />

## À retenir

- Un test utile casse quand le comportement casse, et seulement là.
- Fakes (repo en mémoire, horloge injectée) plutôt que mocks ; `vi.fn` pour les effets sortants ; `vi.mock` en dernier recours.
- Intégration avec `app.inject()` + Testcontainers : c'est là que vivent SQL, transactions, concurrence et sérialisation.
- Fake timers en version `Async`, `await` sur chaque `expect(...).rejects`.
- `expectTypeOf` + `@ts-expect-error` pour les types qui font partie de l'API ; `tsc --noEmit` en CI.
