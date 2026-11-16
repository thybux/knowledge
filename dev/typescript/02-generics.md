<script setup>
import groupBy from "./challenges/group-by";
</script>

# Generics

Ce que tu vas apprendre : écrire des fonctions et des abstractions réutilisables qui **gardent** l'information de type, au lieu de la perdre dans un `any` ou un `unknown` trop tôt.

## Pourquoi les génériques

Sans générique, une fonction utilitaire perd le type :

```ts
function first(items: unknown[]): unknown {
  return items[0];
}
const u = first([{ id: "1" }]); // unknown : inutilisable
```

Avec un paramètre de type, la relation entrée → sortie est préservée :

```ts
function first<T>(items: readonly T[]): T | undefined {
  return items[0];
}
const b = first([{ id: "1" }]); // { id: string } | undefined
```

Un générique exprime une **relation** entre des types. S'il n'y a pas de relation (le `T` n'apparaît qu'une fois), tu n'as pas besoin de générique.

```ts
// Inutile : T n'apparaît qu'en entrée
function log<T>(x: T): void { console.log(x); }
// Équivalent et plus simple
function log2(x: unknown): void { console.log(x); }
```

## Inférence

Dans 95 % des cas tu ne passes pas `<T>` à l'appel : TS l'infère des arguments.

```ts play
function pair<A, B>(a: A, b: B): [A, B] {
  return [a, b];
}
const p = pair("tenant_1", 42); // [string, number]

// const type parameters (TS 5.0) : infère des littéraux
function routes<const T extends readonly string[]>(r: T) {
  return r;
}
const r = routes(["/bookings", "/slots"]);
// readonly ["/bookings", "/slots"]
console.log(p, r);
```

### `NoInfer` (TS 5.4)

Parfois TS infère `T` depuis le **mauvais** argument. `NoInfer<T>` dit « ne déduis pas T d'ici ».

```ts
function createFSM<S extends string>(
  states: S[],
  initial: NoInfer<S>,
) { return { states, current: initial }; }

createFSM(["draft", "published"], "draft");    // ✅
createFSM(["draft", "published"], "archived"); // ❌ enfin une erreur
```

Sans `NoInfer`, TS élargirait `S` à `"draft" | "published" | "archived"`.

## Contraintes : `extends`

`T extends X` = « T doit être au moins un X ». Ça permet d'utiliser les propriétés de `X` dans le corps.

```ts
type Entity = { id: string };

function indexById<T extends Entity>(items: readonly T[]) {
  const map = new Map<string, T>();
  for (const it of items) map.set(it.id, it);
  return map;
}

const m = indexById([{ id: "s1", capacity: 12 }]);
// Map<string, { id: string; capacity: number }>
```

Le retour garde le **vrai** type (`capacity` inclus), pas juste `Entity`. C'est la différence avec `function indexById(items: Entity[])`.

### `keyof` et accès indexé

```ts
function pluck<T, K extends keyof T>(items: readonly T[], key: K) {
  return items.map((it) => it[key]); // T[K][]
}

const bookings = [
  { id: "b1", status: "confirmed" as const, guests: 2 },
];
const statuses = pluck(bookings, "status"); // "confirmed"[]
pluck(bookings, "price"); // ❌ "price" n'est pas une clé
```

`T[K]` (indexed access type) est le type de la propriété `K` de `T`.

### Valeurs par défaut

```ts
type ApiResponse<T = unknown, E = { message: string }> =
  | { ok: true; data: T }
  | { ok: false; error: E };

type R1 = ApiResponse;            // data: unknown
type R2 = ApiResponse<{ id: string }>;
```

## Utility types essentiels

| Type | Effet |
| --- | --- |
| `Partial<T>` | toutes les props optionnelles |
| `Required<T>` | toutes obligatoires |
| `Readonly<T>` | toutes `readonly` (1 niveau) |
| `Pick<T, K>` | garde les clés `K` |
| `Omit<T, K>` | retire les clés `K` |
| `Record<K, V>` | objet clés `K` → `V` |
| `Exclude<U, X>` | retire `X` d'une union |
| `Extract<U, X>` | garde ce qui matche `X` |
| `NonNullable<T>` | retire `null`/`undefined` |
| `ReturnType<F>` | type de retour |
| `Parameters<F>` | tuple des paramètres |
| `Awaited<T>` | déballe les Promise |

### En situation

```ts
type Booking = {
  id: string;
  tenantId: string;
  slotId: string;
  customerEmail: string;
  status: "pending" | "confirmed" | "canceled";
  createdAt: Date;
};

// Ce que le client envoie
type CreateBookingInput = Pick<Booking, "slotId" | "customerEmail">;

// Ce qu'un PATCH accepte : pas l'id ni le tenant
type UpdateBookingInput = Partial<
  Omit<Booking, "id" | "tenantId" | "createdAt">
>;

// Statuts "terminaux"
type FinalStatus = Exclude<Booking["status"], "pending">;
// "confirmed" | "canceled"
```

`ReturnType` + `Awaited` évitent de dupliquer des types que le code définit déjà :

```ts
async function loadDashboard(tenantId: string) {
  return { tenantId, upcoming: 12, revenueCents: 340_000 };
}

type Dashboard = Awaited<ReturnType<typeof loadDashboard>>;
// { tenantId: string; upcoming: number; revenueCents: number }
```

::: warning `Omit` n'est pas strict
`Omit<Booking, "idd">` compile (faute de frappe non détectée) car `K extends keyof any`. Si ça t'inquiète, définis `type StrictOmit<T, K extends keyof T> = Omit<T, K>`.
:::

::: warning `Omit` sur une union
`Omit<A | B, "x">` **aplatit** l'union (il ne garde que les clés communes). Pour une discriminated union, utilise une version distributive : `type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;` (on verra pourquoi au [chapitre 3](/dev/typescript/03-types-avances)).
:::

## Classes et interfaces génériques

### Un repository générique

Le cas réel le plus courant : un contrat de persistance commun à tes entités.

```ts
interface Repository<T extends { id: Id }, Id = string> {
  findById(id: Id): Promise<T | null>;
  insert(entity: T): Promise<void>;
  update(id: Id, patch: Partial<Omit<T, "id">>): Promise<T>;
}
```

Et une implémentation en mémoire, parfaite pour les tests (cf. [Tests](/dev/typescript/08-tests)) :

```ts
class InMemoryRepo<T extends { id: string }>
  implements Repository<T> {
  #rows = new Map<string, T>();

  async findById(id: string) {
    return this.#rows.get(id) ?? null;
  }
  async insert(e: T) {
    if (this.#rows.has(e.id)) throw new Error("duplicate id");
    this.#rows.set(e.id, structuredClone(e));
  }
  async update(id: string, patch: Partial<Omit<T, "id">>) {
    const cur = this.#rows.get(id);
    if (!cur) throw new Error("not found");
    const next = { ...cur, ...patch };
    this.#rows.set(id, next);
    return next;
  }
}

const bookingsRepo = new InMemoryRepo<Booking>();
```

`structuredClone` à l'insertion : sinon le test et le repo partagent le même objet, et une mutation côté test « modifie la DB » sans le dire.

::: tip Ne généralise pas trop tôt
Un `Repository<T>` générique est utile pour les opérations vraiment communes. Les requêtes métier (`findUpcomingBySlot`, `countByTenantAndMonth`) vont dans des repos **spécifiques**. Un « generic repository » qui expose `findWhere(filter: any)` est un anti-pattern : il fuit la DB dans tout le code.
:::

### Fonctions d'ordre supérieur typées

Envelopper une fonction sans perdre sa signature :

```ts
function withTiming<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args) => {
    const t0 = performance.now();
    try {
      return await fn(...args);
    } finally {
      const ms = (performance.now() - t0).toFixed(1);
      console.log(`${name} took ${ms}ms`);
    }
  };
}

const timedLoad = withTiming("dashboard", loadDashboard);
// (tenantId: string) => Promise<{ ... }>
```

Le pattern `A extends unknown[]` + `...args: A` capture les paramètres comme un tuple : noms et optionnalité conservés.

## Génériques et objets : `Record` et maps typées

Une map d'événements typée, base de tout event bus :

```ts play
type Events = {
  "booking.created": { bookingId: string; tenantId: string };
  "booking.canceled": { bookingId: string; reason: string };
};

class TypedEmitter<E extends Record<string, unknown>> {
  #handlers: { [K in keyof E]?: ((p: E[K]) => void)[] } = {};

  on<K extends keyof E>(event: K, h: (p: E[K]) => void) {
    (this.#handlers[event] ??= []).push(h);
    return () => this.off(event, h);
  }
  off<K extends keyof E>(event: K, h: (p: E[K]) => void) {
    this.#handlers[event] = this.#handlers[event]
      ?.filter((x) => x !== h);
  }
  emit<K extends keyof E>(event: K, payload: E[K]) {
    for (const h of this.#handlers[event] ?? []) h(payload);
  }
}

const bus = new TypedEmitter<Events>();
bus.on("booking.canceled", (p) => console.log(p.reason));
bus.emit("booking.canceled", { bookingId: "b1", reason: "sick" });
// bus.emit("booking.created", { bookingId: "b1" }); ❌ tenantId
```

`on` retourne une fonction de désabonnement : indispensable pour éviter les fuites de listeners (cf. [Performance Node](/dev/typescript/09-performance-node)).

## Cas réel

**Client HTTP interne typé.** Ton back-office appelle l'API de réservation. Plutôt que de typer chaque `fetch` à la main (et mentir avec `as`), on décrit les endpoints une fois :

```ts
type Endpoints = {
  "GET /bookings/:id": {
    params: { id: string };
    response: Booking;
  };
  "POST /bookings": {
    body: CreateBookingInput;
    response: Booking;
  };
};

type Route = keyof Endpoints;
type Req<R extends Route> = Omit<Endpoints[R], "response">;
type Res<R extends Route> = Endpoints[R]["response"];
```

```ts
async function call<R extends Route>(
  route: R,
  req: Req<R>,
): Promise<Res<R>> {
  const [method, pathTpl] = route.split(" ") as [string, string];
  const params = "params" in req ? req.params : {};
  const path = pathTpl.replace(/:(\w+)/g, (_, k: string) =>
    encodeURIComponent((params as Record<string, string>)[k] ?? ""),
  );
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: "body" in req ? JSON.stringify(req.body) : undefined,
  });
  if (!res.ok) throw new Error(`${route} -> ${res.status}`);
  return (await res.json()) as Res<R>; // frontière : voir ch. 5
}

const b = await call("GET /bookings/:id", { params: { id: "b1" } });
// b: Booking
```

Le cast final reste un **point de confiance** : le serveur pourrait renvoyer autre chose. Dans un monorepo où front et back partagent le même package de schémas Zod, on remplace le cast par un `schema.parse` (voir [Architecture backend](/dev/typescript/06-architecture-backend)). C'est l'idée de tRPC / ts-rest, en version artisanale.

## Pièges classiques

- **Générique décoratif** : `<T>` utilisé une seule fois. Remplace par `unknown`.
- **Cast dans le corps** : `return {} as T`. Si tu dois mentir pour que ça compile, la signature est probablement fausse (« qui choisit T ? l'appelant ! » : tu ne peux pas fabriquer un `T` arbitraire).
- **Contrainte trop large** : `T extends object` accepte les tableaux et les fonctions.
- `Partial<T>` pour un PATCH, puis `{ ...row, ...patch }` : un `patch.email = undefined` explicite **écrase** la valeur. `exactOptionalPropertyTypes` aide à l'interdire.
- `ReturnType<typeof f>` sur une fonction surchargée : prend la **dernière** surcharge.
- Question d'entretien : « Pourquoi `function f<T>(x: T): T { return 42; }` ne compile pas ? » → parce que `T` peut être `string` ; c'est l'appelant qui fixe `T`, pas l'implémentation.

## Défis

### 1. Que retourne le typage ?

```ts
function wrap<T>(v: T) { return { value: v }; }
const a = wrap("x");
const b = wrap(["x", 1]);
const c = wrap({ k: "x" } as const);
```

::: details Solution
- `a: { value: string }`
- `b: { value: (string | number)[] }` (tableau, pas tuple)
- `c: { value: { readonly k: "x" } }`

Avec `<const T>`, `a` serait `{ value: "x" }` et `b` un tuple `readonly ["x", 1]`.
:::

### 2. Corrige la signature

```ts
function merge<T>(a: T, b: T): T {
  return { ...a, ...b };
}
const r = merge({ id: "1" }, { email: "x@y.z" });
r.email.toUpperCase(); // ❌ 'r.email' is possibly 'undefined'
```

Pourquoi `r.email` peut-il être `undefined` alors qu'on vient de le passer ?

::: details Solution
Avec un seul `T`, TS doit trouver **un** type pour les deux arguments. Il normalise les deux littéraux en union : `T = { id: string; email?: undefined } | { email: string; id?: undefined }`. Le retour est donc « l'un **ou** l'autre », alors que le spread produit « l'un **et** l'autre ». Il faut deux paramètres :

```ts
function merge<A extends object, B extends object>(a: A, b: B)
  : Omit<A, keyof B> & B {
  return { ...a, ...b };
}
```
`Omit<A, keyof B> & B` reflète la vraie sémantique du spread : les clés de `b` gagnent. `A & B` serait faux quand une clé a des types différents des deux côtés.
:::

### 3. `Paginated<T>`

Écris un type `Paginated<T>` (`items`, `nextCursor: string | null`) et une fonction `mapPage` qui transforme les items d'une page en gardant le reste. Elle sert à convertir des rows DB en DTO.

::: details Solution
```ts
type Paginated<T> = { items: T[]; nextCursor: string | null };

function mapPage<T, U>(
  page: Paginated<T>,
  fn: (item: T) => U,
): Paginated<U> {
  return { ...page, items: page.items.map(fn) };
}
```
:::

### 4. `groupBy` typé (exécutable)

Implémente `groupBy` par clé de propriété. Le runtime est simple ; l'intérêt est la signature : `K extends keyof T`, et un résultat `Partial<Record<...>>` (une clé peut ne pas exister). En prod, `Object.groupBy` (Node 21+) existe : il prend une fonction et retourne `Partial<Record<K, T[]>>`.

<Challenge :data="groupBy" />

## À retenir

- Un générique exprime une **relation** entre types ; sans relation, pas de générique.
- Laisse TS inférer ; `const T` pour des littéraux, `NoInfer` pour bloquer une inférence parasite.
- `T extends X` pour contraindre, `K extends keyof T` + `T[K]` pour manipuler des propriétés.
- Dérive les types (`Pick`, `Omit`, `ReturnType`, `Awaited`) au lieu de les dupliquer.
- Repos génériques pour le commun, repos spécifiques pour le métier ; pas de `findWhere(any)`.
