<script setup>
import parseEnv from "./challenges/parse-env";
</script>

# Erreurs & validation

Ce que tu vas apprendre : distinguer les erreurs attendues des bugs, les modéliser (classes métier, `cause`, Result), et valider **toutes** les données qui entrent dans ton app avec Zod.

## Deux familles d'erreurs

| | Erreur attendue | Bug / panne |
| --- | --- | --- |
| Exemples | créneau déjà pris, carte refusée, input invalide | `undefined is not a function`, DB down |
| Qui la gère | le code appelant, l'utilisateur | les logs, l'astreinte |
| Réponse HTTP | 4xx avec message clair | 500 générique |
| Forme | valeur typée ou erreur métier | exception, crash contrôlé |

Mélanger les deux est la source n°1 de mauvaise gestion d'erreurs : des `try/catch` qui avalent des bugs, ou des 500 pour un simple « créneau complet ».

## Le problème des exceptions en TS

TypeScript ne type **pas** les exceptions : une signature ne dit pas ce qu'elle peut lancer, et `catch (e)` donne `unknown`.

```ts
async function book(slotId: string): Promise<Booking> {
  // peut lancer SlotFullError, PaymentError, ou une erreur DB...
  // rien dans le type ne te le dit
}
```

D'où deux outils complémentaires : des **classes d'erreurs** bien nommées pour ce qui remonte loin, et le **pattern Result** pour ce que l'appelant doit traiter tout de suite.

## Classes d'erreurs métier

```ts
export class AppError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name; // "SlotFullError", etc.
  }
}

export class NotFoundError extends AppError {
  constructor(readonly entity: string, readonly id: string) {
    super(`${entity} ${id} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(readonly code: "slot_full" | "already_booked") {
    super(code);
  }
}
```

- `new.target.name` donne le nom de la sous-classe sans le répéter.
- Des **champs structurés** (`entity`, `code`) plutôt que de parser le message. Le message est pour les humains, le code pour les machines.
- `instanceof` marche avec les classes ES2015+ natives (cible ≥ ES2015, ce qui est le cas de toute config moderne).

::: warning Parameter properties et Node
`constructor(readonly entity: string)` est une **parameter property** : syntaxe non effaçable, refusée par le type stripping de Node et par `erasableSyntaxOnly`. Si tu exécutes ton TS directement avec Node, déclare les champs explicitement : `readonly entity: string;` puis `this.entity = entity`.
:::

### `cause` : chaîner sans perdre l'origine

ES2022 : `new Error(message, { cause })`. Indispensable quand tu traduis une erreur bas niveau en erreur métier.

```ts
try {
  await db.insert(bookings).values(row);
} catch (err) {
  if (isUniqueViolation(err)) {
    throw new ConflictError("already_booked");
  }
  throw new AppError("booking insert failed", { cause: err });
}
```

Les loggers (pino) et Node (`util.inspect`) affichent la chaîne de `cause` : en prod, tu vois « booking insert failed » **et** l'erreur Postgres d'origine. Sans `cause`, tu perds la stack d'origine, et le debug devient de la divination.

### Normaliser ce qu'on attrape

```ts
export function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  return new Error(typeof e === "string" ? e : JSON.stringify(e));
}
```

## Le pattern Result

Retourner l'erreur comme une **valeur** typée. L'appelant ne peut pas l'oublier : il doit vérifier `ok` pour accéder à la donnée.

```ts
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T) => ({ ok: true, value }) as const;
export const err = <E>(error: E) => ({ ok: false, error }) as const;
```

```ts
type BookError =
  | { type: "slot_full" }
  | { type: "outside_opening_hours"; opensAt: string }
  | { type: "payment_declined"; reason: string };

async function bookSlot(
  input: BookInput,
): Promise<Result<Booking, BookError>> {
  const slot = await slots.find(input.slotId);
  if (slot.remaining === 0) return err({ type: "slot_full" });
  // ...
  return ok(booking);
}

const r = await bookSlot(input);
if (!r.ok) {
  switch (r.error.type) {
    case "slot_full": return reply.code(409).send(r.error);
    case "outside_opening_hours": return reply.code(422).send(r.error);
    case "payment_declined": return reply.code(402).send(r.error);
  }
}
r.value.id; // narrowing : Booking
```

### Exceptions ou Result ?

Pas de dogme. Une règle qui marche en équipe :

- **Result** pour les échecs **métier attendus** que l'appelant direct doit traiter (validation, règle métier, paiement refusé).
- **Exceptions** pour l'inattendu (DB down, bug, invariant violé) et pour ce qui remonte jusqu'au handler HTTP global.
- Ne pas envelopper **tout** dans des Result : un code où chaque ligne déballe un Result sans rien en faire est pire que des exceptions.

Des libs comme `neverthrow` ou `Effect` poussent le modèle plus loin (chaînage, erreurs typées partout). Le type maison ci-dessus suffit à la plupart des backends.

## Valider aux frontières

Le système de types s'arrête aux frontières de ton process. Tout ce qui entre est `unknown` tant que tu ne l'as pas validé :

- body, query, params, headers HTTP ;
- variables d'environnement ;
- messages de queue (SQS, Kafka, Redis) et webhooks ;
- réponses d'API tierces ;
- colonnes `jsonb` lues depuis la DB ;
- `localStorage`, fichiers, CLI args.

### Zod 4 en bref

Zod décrit un schéma **runtime** dont TS **infère** le type. Une seule source de vérité.

```ts
import { z } from "zod";

export const CreateBooking = z.object({
  slotId: z.uuid(),
  customer: z.object({
    name: z.string().trim().min(1).max(100),
    email: z.email().toLowerCase(),
  }),
  guests: z.int().min(1).max(8).default(1),
  note: z.string().max(500).optional(),
});

export type CreateBooking = z.infer<typeof CreateBooking>;
// { slotId: string; customer: {...}; guests: number; note?: string }
```

Zod 4 a déplacé les formats en fonctions de premier niveau (`z.email()`, `z.uuid()`, `z.url()`, `z.iso.datetime()`, `z.int()`) ; `z.string().email()` existe encore mais est déprécié.

```ts
const parsed = CreateBooking.safeParse(body);
if (!parsed.success) {
  // parsed.error.issues : [{ path, message, code }, ...]
  return reply.code(400).send({
    error: "validation_error",
    issues: parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  });
}
const input = parsed.data; // CreateBooking, trimé, lowercased
```

`parse` lance une `ZodError`, `safeParse` retourne un Result. Pour le debug, `z.prettifyError(error)` donne un texte lisible.

### Input vs output

Un schéma avec `.default()`, `.transform()` ou `z.coerce` a deux types : ce qu'il **accepte** et ce qu'il **produit**.

```ts
const Query = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from: z.iso.datetime().transform((s) => new Date(s)),
});
type QueryIn = z.input<typeof Query>;   // limit?: unknown ...
type QueryOut = z.output<typeof Query>; // limit: number; from: Date
```

`z.infer` = `z.output`. Un query string arrive toujours en string : `z.coerce.number()` le convertit, mais attention, `Number("")` vaut `0`.

### Unions discriminées et branded types

```ts
const WebhookEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("payment.succeeded"),
    data: z.object({ paymentId: z.string(), amount: z.int() }),
  }),
  z.object({
    type: z.literal("payment.failed"),
    data: z.object({ paymentId: z.string(), reason: z.string() }),
  }),
]);

const TenantId = z.uuid().brand<"TenantId">();
type TenantId = z.infer<typeof TenantId>; // string & BRAND<"TenantId">
```

### Règles métier transverses

```ts
const Slot = z.object({
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
}).refine((s) => s.endsAt > s.startsAt, {
  message: "endsAt must be after startsAt",
  path: ["endsAt"],
});
```

(Comparer des strings ISO 8601 UTC de même format marche lexicographiquement ; en cas de doute, compare des `Date`.)

## Parse, don't validate

L'idée (Alexis King, 2019) : une fonction de validation qui retourne `boolean` jette l'information. Une fonction de **parsing** retourne un type plus précis, que le reste du code peut exiger.

```ts
// Validate : le reste du code ne sait pas que c'est vérifié
function isValidEmail(s: string): boolean { /* ... */ return true; }

// Parse : le type porte la preuve
type Email = string & { readonly __brand: "Email" };
function parseEmail(s: string): Email | null {
  const v = s.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? (v as Email) : null;
}

function sendInvoice(to: Email) { /* pas besoin de revalider */ }
```

Conséquences pratiques :

- Valide **une fois**, à l'entrée, et passe des types riches à l'intérieur (le domaine ne reçoit jamais de `unknown` ni de `string` « peut-être email »).
- Les fonctions du cœur métier n'ont plus de `if (!isValid(x)) throw`.
- Le parsing transforme (trim, lowercase, `Date`, `Cents`), il ne fait pas que vérifier.

## Variables d'environnement

L'env est une frontière comme une autre, et la plus sournoise : une variable manquante fait planter l'app **à 3 h du matin** au premier appel qui l'utilise, au lieu du démarrage.

```ts
// src/env.ts
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  JWT_SECRET: z.string().min(32),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"])
    .default("info"),
  ENABLE_CRON: z.stringbool().default(false),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error(z.prettifyError(parsed.error));
  process.exit(1); // fail fast, au démarrage
}
export const env = parsed.data;
```

- `z.stringbool()` (Zod 4) accepte `"true"/"false"/"1"/"0"/"yes"/"no"…`. Ne fais jamais `Boolean(process.env.X)` : `Boolean("false")` vaut `true`.
- Le reste du code importe `env`, **jamais** `process.env` directement (une règle ESLint `no-process-env` peut l'imposer).
- Ne logge pas `env` en entier : il contient des secrets.
- En local, Node lit un fichier `.env` nativement : `node --env-file=.env` (ou `--env-file-if-exists`), plus besoin de `dotenv`.

## Cas réel

**Ingestion d'un fichier de réservations d'un partenaire.** Un partenaire envoie chaque nuit un JSON Lines de 20 000 réservations. Certaines lignes sont invalides. Exigences : ne pas tout rejeter pour une ligne pourrie, produire un rapport, et ne jamais insérer une donnée non validée.

```ts
const PartnerRow = z.object({
  external_id: z.string().min(1),
  slot_start: z.iso.datetime({ offset: true }),
  email: z.email(),
  guests: z.coerce.number().int().min(1),
});

type RowError = { line: number; issues: string[] };

async function ingest(lines: AsyncIterable<string>) {
  const valid: z.infer<typeof PartnerRow>[] = [];
  const errors: RowError[] = [];
  let line = 0;
  for await (const raw of lines) {
    line++;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      errors.push({ line, issues: ["invalid JSON"] });
      continue;
    }
    const r = PartnerRow.safeParse(json);
    if (r.success) valid.push(r.data);
    else errors.push({ line, issues: r.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`) });
  }
  return { valid, errors };
}
```

Puis : insertion par lots des `valid` avec `ON CONFLICT (partner_id, external_id) DO UPDATE` (idempotent si le partenaire renvoie le fichier), et rapport des `errors` envoyé au partenaire. Si plus de 5 % des lignes sont en erreur, on n'insère **rien** et on alerte : c'est probablement un changement de format, pas des fautes isolées.

## Pièges classiques

- `catch (e) { console.log(e.message) }` : `e` est `unknown`, et peut ne pas être une `Error`.
- Avaler les erreurs : `catch {}` vide ou `catch (e) { return null }` qui transforme une panne DB en « pas trouvé ».
- Renvoyer `err.message` d'une erreur interne au client : fuite de détails (noms de tables, requêtes SQL).
- `throw "slot full"` : une string n'a pas de stack trace.
- Valider avec Zod puis **réutiliser l'objet d'origine** au lieu de `parsed.data` : tu perds les transformations et les champs en trop restent (`z.object` les retire par défaut, `z.looseObject` les garde, `z.strictObject` les refuse).
- Schéma Zod et type TS écrits séparément « à la main » : ils divergent. Infère le type du schéma.
- Question d'entretien : « Pourquoi ne pas mettre tout le code métier dans des try/catch ? » → les erreurs inattendues doivent remonter au handler global (log + 500), pas être masquées localement.

## Défis

### 1. Que logge ce code ?

```ts
class DbError extends Error {}
try {
  throw new DbError("timeout");
} catch (e) {
  console.log(e instanceof Error, (e as Error).name);
}
```

::: details Solution
`true "Error"`. `instanceof` marche, mais `name` vaut `"Error"` : il est hérité de `Error.prototype.name` tant qu'on ne le redéfinit pas. D'où le `this.name = new.target.name` dans `AppError`.
:::

### 2. Quel statut HTTP ?

Pour chaque cas : input JSON mal formé, email invalide, token expiré, tenant d'un autre client, créneau complet, double soumission avec la même idempotency key mais un body différent, Postgres injoignable.

::: details Solution
- JSON mal formé : **400**
- email invalide : **400** (ou 422 si tu distingues syntaxe / sémantique ; choisis une convention et tiens-la)
- token expiré : **401**
- ressource d'un autre tenant : **404** (pas 403 : ne confirme pas qu'elle existe)
- créneau complet : **409**
- même idempotency key, body différent : **422** (convention Stripe : 400 ; l'important est d'être cohérent et documenté)
- Postgres injoignable : **503** (ou 500), message générique, détails dans les logs
:::

### 3. Écris le schéma

Écris un schéma Zod pour la query `GET /bookings?status=confirmed&from=2026-11-01T00:00:00Z&limit=50`, où `status` est optionnel parmi `pending|confirmed|canceled`, `from` est une date ISO convertie en `Date`, `limit` un entier entre 1 et 100 par défaut 20.

::: details Solution
```ts
const ListBookingsQuery = z.object({
  status: z.enum(["pending", "confirmed", "canceled"]).optional(),
  from: z.iso.datetime().transform((s) => new Date(s)),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
```
`z.coerce` est nécessaire pour `limit` : tout ce qui vient d'une query string est une string.
:::

### 4. Parser l'env à la main (exécutable)

Sans Zod (le runner n'a pas de dépendances) : écris le parseur d'env avec Result et **toutes** les erreurs collectées. C'est exactement ce que fait `safeParse` pour toi.

<Challenge :data="parseEnv" />

## À retenir

- Sépare erreurs **attendues** (Result ou erreur métier typée, 4xx) et **bugs** (exception, log, 500).
- Classes d'erreurs avec `name` correct et champs structurés ; `cause` pour chaîner sans perdre l'origine.
- Toute donnée externe est `unknown` : valide à **chaque** frontière, y compris env, queues et `jsonb`.
- Zod : le schéma est la source de vérité, le type est **inféré** ; utilise `parsed.data`, pas l'input brut.
- Parse, don't validate : valide une fois à l'entrée, puis fais circuler des types riches.
