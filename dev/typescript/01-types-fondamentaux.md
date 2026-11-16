<script setup>
import parseWebhook from "./challenges/parse-webhook";
</script>

# Types fondamentaux

Ce que tu vas apprendre : comment TypeScript raisonne (typage structurel, narrowing), et comment modéliser un domaine pour que les états invalides ne compilent pas.

## Typage structurel

TypeScript compare les types par leur **forme**, pas par leur nom. Si un objet a les propriétés attendues, il est accepté, peu importe d'où il vient.

```ts play
type User = { id: string; email: string };
type Admin = { id: string; email: string; role: "admin" };

function sendEmail(u: User) {
  console.log(`mail to ${u.email}`);
}

const admin: Admin = { id: "1", email: "a@x.io", role: "admin" };
sendEmail(admin); // OK : Admin a (au moins) la forme de User
```

Conséquence directe : deux types de même forme sont interchangeables. `UserId` et `OrderId` déclarés comme `string` sont **le même type**. On verra comment corriger ça avec les branded types au [chapitre 3](/dev/typescript/03-types-avances).

### Excess property check

Exception à connaître : un **littéral objet** passé directement est vérifié strictement.

```ts
sendEmail({ id: "1", email: "a@x.io", role: "admin" });
// ❌ Object literal may only specify known properties

const tmp = { id: "1", email: "a@x.io", role: "admin" };
sendEmail(tmp); // ✅ plus de check (pas un littéral "frais")
```

C'est une aide contre les fautes de frappe (`emial`), pas une garantie : à l'exécution, l'objet peut toujours contenir des champs en trop. Si tu le sérialises tel quel dans une réponse HTTP, tu peux **fuiter** des données (hash de mot de passe…). D'où la validation/sérialisation explicite aux frontières.

### `type` vs `interface`

| | `type` | `interface` |
| --- | --- | --- |
| Unions, tuples, mapped | oui | non |
| `extends` / fusion | `&` | `extends`, declaration merging |
| Usage courant | modèles, unions | contrats publics, augmentation de libs |

En pratique : `type` par défaut, `interface` quand tu veux étendre un type de lib (ex. `FastifyRequest`) via declaration merging.

## Unions et intersections

Une **union** `A | B` = « l'un ou l'autre ». Une **intersection** `A & B` = « les deux à la fois ».

```ts
type Id = string | number;

type Timestamps = { createdAt: Date; updatedAt: Date };
type Tenant = { id: string; name: string };
type TenantRow = Tenant & Timestamps;
```

Sur une union, tu ne peux utiliser que ce qui est **commun** à tous les membres. Pour aller plus loin, il faut **réduire** (narrowing).

::: warning Intersection impossible
`{ a: string } & { a: number }` donne `a: never`. Ça compile, mais aucune valeur ne peut exister. Si tu vois `never` apparaître de nulle part, cherche une intersection contradictoire.
:::

## Narrowing

Le compilateur suit ton flot de contrôle et affine le type dans chaque branche.

### `typeof`, `instanceof`, `in`, égalité

```ts play
function formatAmount(v: number | string | null) {
  if (v === null) return "—";
  if (typeof v === "string") return v; // v: string
  return (v / 100).toFixed(2) + " €";  // v: number
}

type Card = { kind: "card"; last4: string };
type Sepa = { iban: string };

function label(m: Card | Sepa) {
  if ("iban" in m) return `SEPA ${m.iban.slice(-4)}`;
  return `CB •••• ${m.last4}`;
}

function errMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  return String(e);
}
console.log(formatAmount(1990), label({ iban: "FR76123" }));
```

### Discriminated unions

L'outil n°1 pour modéliser un domaine : une propriété littérale commune (`status`, `type`, `kind`) qui identifie chaque cas.

```ts
type Payment =
  | { status: "pending"; id: string }
  | { status: "succeeded"; id: string; paidAt: Date }
  | { status: "failed"; id: string; reason: string };

function describe(p: Payment): string {
  switch (p.status) {
    case "pending":
      return "En attente";
    case "succeeded":
      return `Payé le ${p.paidAt.toISOString()}`;
    case "failed":
      return `Échec : ${p.reason}`;
  }
}
```

Compare avec la version « sac de champs optionnels » :

```ts
type PaymentBad = {
  status: string;
  paidAt?: Date;
  reason?: string;
};
// Rien n'empêche { status: "succeeded", reason: "?" }
// et chaque lecture de paidAt doit gérer undefined.
```

::: tip Make impossible states impossible
Si deux champs ne peuvent pas coexister, ils ne doivent pas être dans la même branche de l'union. C'est **la** compétence qui sépare un mid d'un senior en modélisation.
:::

### Type predicates

Quand le narrowing demande une logique perso, écris une fonction qui retourne `x is T` :

```ts
type Slot = { start: Date; end: Date };

function isSlot(v: unknown): v is Slot {
  return (
    typeof v === "object" && v !== null &&
    "start" in v && v.start instanceof Date &&
    "end" in v && v.end instanceof Date
  );
}
```

Attention : TS te **croit sur parole**. Un predicate faux = un mensonge au compilateur. Depuis TS 5.5, il **infère** des predicates simples tout seul :

```ts
const ids = ["a", null, "b"].filter((x) => x !== null);
// TS 5.5+ : string[] (avant : (string | null)[])
```

### Assertion functions

Variante qui **lance** au lieu de retourner un booléen. Après l'appel, le type est réduit pour la suite du bloc.

```ts
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertIsDefined<T>(v: T, name: string)
  : asserts v is NonNullable<T> {
  if (v == null) throw new Error(`${name} is required`);
}

declare const header: string | undefined;
assertIsDefined(header, "x-tenant-id");
header.toLowerCase(); // header: string
```

Contrainte bizarre mais réelle : une assertion function doit être déclarée avec une annotation explicite (`function` ou `const f: Asserts = ...`), sinon erreur « Assertions require every name in the call target to be declared with an explicit type annotation ».

## `unknown` vs `any` vs `never`

| Type | Signification | Usage |
| --- | --- | --- |
| `any` | « débranche le typecheck » | migration, jamais en code neuf |
| `unknown` | « je ne sais pas encore » | entrées externes, `catch` |
| `never` | « impossible » | branches mortes, exhaustivité |

`any` est **contagieux** : `any.foo.bar()` compile et `const x: User = anyValue` aussi. `unknown` t'oblige à prouver le type avant usage.

```ts
function handle(body: unknown) {
  body.amount;            // ❌ 'body' is of type 'unknown'
  if (typeof body === "object" && body !== null
      && "amount" in body && typeof body.amount === "number") {
    body.amount;          // ✅ number
  }
}
```

Avec `strict` (qui inclut `useUnknownInCatchVariables`), la variable de `catch (e)` est `unknown`. C'est voulu : n'importe quoi peut être `throw`, même une string.

::: danger `JSON.parse` et `res.json()` retournent `any`
Ce sont les deux trous les plus fréquents. Type-les en `unknown` puis valide (Zod, voir [Erreurs & validation](/dev/typescript/05-erreurs-et-validation)) :
`const data: unknown = await res.json();`
:::

## Exhaustiveness check

Le cas typique : tu ajoutes `"refunded"` à l'union `Payment` et tu veux que **chaque** `switch` du projet casse à la compilation.

```ts
function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

function icon(p: Payment): string {
  switch (p.status) {
    case "pending": return "⏳";
    case "succeeded": return "✅";
    case "failed": return "❌";
    default: return assertNever(p);
    // si un cas manque : p n'est pas never -> erreur
  }
}
```

Le `throw` couvre aussi le runtime : une valeur inattendue venue de la DB plante bruyamment au lieu de retourner `undefined`.

Alternative sans fonction : `const _exhaustive: never = p;`. Et avec ESLint : la règle `@typescript-eslint/switch-exhaustiveness-check`.

## `as const`, `satisfies`, `readonly`

### `as const`

Fige une valeur : littéraux au lieu de `string`, tableaux en tuples `readonly`.

```ts
const ROLES = ["owner", "admin", "member"] as const;
type Role = (typeof ROLES)[number];
// "owner" | "admin" | "member"

function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v);
}
```

Une seule source de vérité pour la liste runtime **et** le type. C'est aussi la bonne alternative à `enum` (non effaçable, donc incompatible avec le type stripping de Node).

### `satisfies` (TS 4.9+)

Vérifie qu'une valeur respecte un type **sans** élargir son type inféré.

```ts play
type Plan = "free" | "pro" | "enterprise";
type Limits = { seats: number; bookingsPerMonth: number | null };

// Avec une annotation, on perd l'info précise :
const a: Record<Plan, Limits> = {
  free: { seats: 1, bookingsPerMonth: 50 },
  pro: { seats: 10, bookingsPerMonth: null },
  enterprise: { seats: 500, bookingsPerMonth: null },
};

// Avec satisfies : vérifié (clé manquante = erreur) ET précis
const PLAN_LIMITS = {
  free: { seats: 1, bookingsPerMonth: 50 },
  pro: { seats: 10, bookingsPerMonth: null },
  enterprise: { seats: 500, bookingsPerMonth: null },
} as const satisfies Record<Plan, Limits>;

const n = PLAN_LIMITS.free.bookingsPerMonth; // 50, pas number | null
console.log(a.free.seats, n);
```

Règle : annotation (`: T`) quand tu veux **imposer** le type, `satisfies` quand tu veux **vérifier** sans perdre l'inférence (configs, tables de routage, maps de handlers).

### `readonly`

```ts
type Booking = {
  readonly id: string;
  readonly slots: readonly Slot[];
};

function total(items: readonly { price: number }[]) {
  // items.push(...) -> ❌ ; la fonction promet de ne pas muter
  return items.reduce((s, i) => s + i.price, 0);
}
```

`readonly` est **superficiel** et **compile-time** : `Object.freeze` pour le runtime, et un `readonly T[]` n'empêche pas de muter les objets dedans. Prends `readonly T[]` en paramètre par défaut : ça accepte les deux (`T[]` est assignable à `readonly T[]`, pas l'inverse).

## Les options qui changent tout

Trois flags de `tsconfig` modifient le comportement des types de base. Active-les sur un nouveau projet :

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true
}
```

- `noUncheckedIndexedAccess` : `arr[0]` et `record[key]` sont `T | undefined`. Plus honnête, un peu plus verbeux.
- `exactOptionalPropertyTypes` : `{ a?: string }` n'accepte plus `{ a: undefined }` explicite. Distingue « absent » de « présent mais undefined » (utile pour les PATCH).

```ts
const prices: Record<string, number> = { pro: 29 };
const p = prices["team"]; // number | undefined avec le flag
if (p !== undefined) console.log(p * 12);
```

## Cas réel

**Webhooks d'un prestataire de paiement.** Ton SaaS de réservation reçoit des événements `payment.succeeded`, `payment.failed`, `refund.created`. Le corps arrive en `unknown` (c'est du JSON externe), et chaque type d'événement déclenche une action différente.

```ts
type PaymentEvent =
  | { type: "payment.succeeded"; id: string; bookingId: string;
      amount: number }
  | { type: "payment.failed"; id: string; bookingId: string;
      reason: string }
  | { type: "refund.created"; id: string; paymentId: string;
      amount: number };

type Handlers = {
  [E in PaymentEvent as E["type"]]: (e: E) => Promise<void>;
};
```

Le mapped type `Handlers` (détaillé au [chapitre 3](/dev/typescript/03-types-avances)) génère un handler par type, chacun recevant **le bon** sous-type :

```ts
const handlers = {
  "payment.succeeded": async (e) => {
    await bookings.confirm(e.bookingId); // e.bookingId: string
  },
  "payment.failed": async (e) => {
    await notify.paymentFailed(e.bookingId, e.reason);
  },
  "refund.created": async (e) => {
    await ledger.recordRefund(e.paymentId, e.amount);
  },
} satisfies Handlers;

async function dispatch(e: PaymentEvent) {
  const h = handlers[e.type] as (e: PaymentEvent) => Promise<void>;
  await h(e);
}
```

Ajoute un type d'événement à l'union → `satisfies Handlers` signale le handler manquant. Le cast dans `dispatch` est le seul endroit « non prouvé » : TS ne sait pas corréler `handlers[e.type]` et `e` (limite connue, cf. « correlated unions »). Un cast localisé et commenté est acceptable ; le `switch` + `assertNever` est l'alternative sans cast.

Ce qui manque : **valider** que le JSON reçu est bien un `PaymentEvent`. C'est le défi ci-dessous, et le sujet du [chapitre 5](/dev/typescript/05-erreurs-et-validation).

## Pièges classiques

- Utiliser `as User` sur un `JSON.parse` : un cast n'est **pas** une vérification. Zéro code généré, zéro protection.
- Croire qu'un type existe au runtime : `if (x instanceof User)` ne marche que pour une **classe**, pas pour un `type`/`interface`.
- `!` (non-null assertion) partout pour faire taire le compilateur : chaque `!` est un `undefined is not a function` potentiel.
- `enum` numériques : `Status.Active` vaut `0`, accepte n'importe quel `number` dans certains cas, et n'est pas effaçable. Préfère union de littéraux + `as const`.
- `{}` comme type : il signifie « tout sauf `null`/`undefined` » (même `42`). Pour « un objet », utilise `Record<string, unknown>` ou `object`.
- Narrowing perdu dans un callback : après `if (user)`, `items.map(() => user.id)` reste OK pour une `const`, mais pas pour une variable `let` réassignée ensuite.
- Question d'entretien : « différence entre `unknown` et `any` ? » → `unknown` est le top type **sûr** : assignable depuis tout, utilisable pour rien sans narrowing.

## Défis

### 1. Que vaut le type de `x` ?

```ts
const config = { env: "prod", retries: 3 };
const x = config.env;
const frozen = { env: "prod", retries: 3 } as const;
const y = frozen.env;
```

::: details Solution
`x: string` (une propriété d'objet mutable est élargie), `y: "prod"` (`as const` garde le littéral et rend la propriété `readonly`).
:::

### 2. Pourquoi ça ne compile pas ?

```ts
type Shape =
  | { kind: "circle"; r: number }
  | { kind: "rect"; w: number; h: number };

function area(s: Shape) {
  if (s.kind === "circle") return Math.PI * s.r ** 2;
  return s.w * s.h;
}

const s = { kind: "rect", w: 2, h: 3 };
area(s);
```

::: details Solution
`s` est inféré `{ kind: string; w: number; h: number }` : `kind` est élargi en `string`, qui n'est pas assignable à `"circle" | "rect"`. Corrections : `const s: Shape = ...`, `{ kind: "rect" as const, ... }`, ou `... satisfies Shape`. La fonction `area` elle-même est correcte.
:::

### 3. Modéliser un abonnement

Un abonnement SaaS peut être : en essai (avec date de fin d'essai), actif (avec prochaine échéance et plan), en retard de paiement (avec nombre de relances), ou annulé (avec date d'effet). Écris le type, et une fonction `canBook(sub)` qui refuse la réservation si annulé et dont la date d'effet est passée, avec un check d'exhaustivité.

::: details Solution
```ts
type Plan = "pro" | "team";
type Subscription =
  | { status: "trialing"; trialEndsAt: Date }
  | { status: "active"; plan: Plan; renewsAt: Date }
  | { status: "past_due"; plan: Plan; dunningAttempts: number }
  | { status: "canceled"; effectiveAt: Date };

function canBook(sub: Subscription, now = new Date()): boolean {
  switch (sub.status) {
    case "trialing": return sub.trialEndsAt > now;
    case "active": return true;
    case "past_due": return sub.dunningAttempts < 3;
    case "canceled": return sub.effectiveAt > now;
    default: {
      const _x: never = sub;
      return false;
    }
  }
}
```
Pas de `plan?` ni `trialEndsAt?` optionnels : chaque statut porte exactement ses données.
:::

### 4. Parser un webhook (exécutable)

Transforme un `unknown` en `PaymentEvent | null` à la main, sans cast sauvage. Utilise des type predicates.

<Challenge :data="parseWebhook" />

## À retenir

- Typage **structurel** : la forme compte, pas le nom. Les champs en trop passent au runtime.
- Discriminated unions + `switch` + `assertNever` = modélisation qui casse à la compilation quand le domaine évolue.
- `unknown` pour tout ce qui vient de l'extérieur, `any` jamais ; un cast `as` n'est pas une validation.
- `satisfies` vérifie sans élargir ; `as const` crée des littéraux et une source de vérité unique.
- Active `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` sur tout projet neuf.
