<script setup>
import deepMerge from "./challenges/deep-merge";
</script>

# Types avancés

Ce que tu vas apprendre : les outils type-level (conditional, mapped, template literal, branded types), la variance, et surtout **quand t'arrêter** avant de rendre ton code illisible.

## Conditional types

Un `if` au niveau des types : `T extends U ? X : Y`.

```ts
type IsString<T> = T extends string ? true : false;
type A = IsString<"x">;  // true
type B = IsString<42>;   // false
```

### Distribution sur les unions

Quand `T` est un paramètre « nu » et qu'on lui passe une union, le conditional s'applique **à chaque membre** puis réunit les résultats.

```ts
type ToArray<T> = T extends unknown ? T[] : never;
type C = ToArray<string | number>; // string[] | number[]

// Pour bloquer la distribution : entoure de [ ]
type ToArrayND<T> = [T] extends [unknown] ? T[] : never;
type D = ToArrayND<string | number>; // (string | number)[]
```

C'est comme ça que sont écrits `Exclude` et `Extract` :

```ts
type MyExclude<T, U> = T extends U ? never : T;
type Status = "pending" | "paid" | "refunded";
type Open = MyExclude<Status, "refunded">; // "pending" | "paid"
```

`never` disparaît d'une union (`A | never = A`) : retourner `never` dans une branche = « filtrer ce membre ».

## `infer` : extraire un morceau de type

`infer X` déclare une variable de type capturée par le pattern matching.

```ts
type ElementOf<T> = T extends readonly (infer E)[] ? E : never;
type E1 = ElementOf<string[]>; // string

type PromiseValue<T> = T extends Promise<infer V> ? V : T;

type FirstArg<F> = F extends (first: infer A, ...rest: any[]) => any
  ? A : never;
type F1 = FirstArg<(id: string, opts: object) => void>; // string
```

`ReturnType`, `Parameters`, `Awaited` sont tous écrits avec `infer`. Tu peux contraindre la variable inférée : `infer N extends number`.

## Mapped types

Construire un type objet en itérant sur des clés : `{ [K in Keys]: ... }`.

```ts
type Flags<T> = { [K in keyof T]: boolean };

type Features = { billing: () => void; sso: () => void };
type FeatureFlags = Flags<Features>;
// { billing: boolean; sso: boolean }
```

Modificateurs : `?`, `readonly`, et leur suppression avec `-`.

```ts
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Concrete<T> = { [K in keyof T]-?: T[K] }; // = Required<T>
```

### Key remapping avec `as` (TS 4.1+)

```ts play
type Getters<T> = {
  [K in keyof T & string as `get${Capitalize<K>}`]: () => T[K];
};

type Tenant = { name: string; plan: "free" | "pro" };
type TenantGetters = Getters<Tenant>;
// { getName: () => string; getPlan: () => "free" | "pro" }

// Filtrer des clés : remapper vers never les supprime
type OnlyStrings<T> = {
  [K in keyof T as T[K] extends string ? K : never]: T[K];
};
type S = OnlyStrings<{ id: string; n: number; e: string }>;
// { id: string; e: string }

const g: TenantGetters = {
  getName: () => "Gym Paris", getPlan: () => "pro",
};
console.log(g.getName());
```

Le remapping sur une union discriminée est le pattern qu'on a utilisé pour les handlers de webhooks au [chapitre 1](/dev/typescript/01-types-fondamentaux) :

```ts
type HandlerMap<U extends { type: string }> = {
  [E in U as E["type"]]: (event: E) => Promise<void>;
};
```

## Template literal types

Des types string calculés.

```ts
type Entity = "booking" | "slot";
type Action = "created" | "updated" | "deleted";
type EventName = `${Entity}.${Action}`;
// "booking.created" | "booking.updated" | ... (6 membres)

type CssVar = `--${string}`;
const ok: CssVar = "--brand";   // ✅
// const ko: CssVar = "brand";  // ❌
```

Avec `infer`, on peut **parser** des strings au niveau type. Exemple réel : extraire les paramètres d'une route.

```ts play
type RouteParams<P extends string> =
  P extends `${string}:${infer Name}/${infer Rest}`
    ? { [K in Name | keyof RouteParams<`/${Rest}`>]: string }
    : P extends `${string}:${infer Name}`
      ? { [K in Name]: string }
      : {};

type P = RouteParams<"/tenants/:tenantId/bookings/:bookingId">;
// { tenantId: string; bookingId: string }

function link<R extends string>(route: R, params: RouteParams<R>) {
  return route.replace(/:(\w+)/g, (_, k) =>
    (params as Record<string, string>)[k] ?? "");
}
console.log(link("/tenants/:tenantId/bookings/:bookingId", {
  tenantId: "t1", bookingId: "b9",
}));
```

Hono, les types d'Express (`@types/express`) et les routeurs front (TanStack Router) font exactement ça. C'est utile **dans une lib** ; dans ton code applicatif, c'est rarement rentable.

## Branded types

Le typage structurel rend `UserId` et `OrderId` interchangeables s'ils sont tous deux `string`. Un **brand** ajoute une propriété fantôme qui n'existe qu'au niveau type.

```ts
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

type TenantId = Brand<string, "TenantId">;
type BookingId = Brand<string, "BookingId">;

function cancelBooking(tenant: TenantId, booking: BookingId) {}

declare const t: TenantId;
declare const b: BookingId;
cancelBooking(t, b); // ✅
cancelBooking(b, t); // ❌ les deux sont des strings, mais non
cancelBooking("t1", "b1"); // ❌ une string brute ne suffit pas
```

Comment obtenir un `TenantId` ? **Uniquement** via une fonction qui valide : c'est le seul endroit où le cast est autorisé.

```ts
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseTenantId(raw: string): TenantId {
  if (!UUID_RE.test(raw)) throw new Error("invalid tenant id");
  return raw as TenantId;
}
```

Zod le fait nativement : `z.uuid().brand<"TenantId">()` (cf. [chapitre 5](/dev/typescript/05-erreurs-et-validation)).

Autres brands utiles en prod :

- `Cents` vs `Euros` : jamais additionner les deux.
- `Email` normalisé (lowercased, trim) vs `string` brute.
- `SanitizedHtml` : seule la fonction de sanitization en produit.
- `UtcIsoString` pour les dates qui transitent en string.

::: tip Le brand ne coûte rien au runtime
`raw as TenantId` est effacé à la compilation. La valeur reste une `string` : JSON, DB, logs, tout marche sans conversion.
:::

## Variance

« Si `Dog` est un sous-type de `Animal`, est-ce que `Box<Dog>` est un sous-type de `Box<Animal>` ? » Ça dépend de comment `Box` **utilise** `T`.

| Position de T | Variance | Exemple |
| --- | --- | --- |
| sortie (retour) | covariant | `() => T` |
| entrée (paramètre) | contravariant | `(x: T) => void` |
| les deux | invariant | `{ get(): T; set(x: T) }` |

```ts
type Animal = { name: string };
type Dog = Animal & { bark(): void };

type Handler<T> = (x: T) => void;
declare const handleAnimal: Handler<Animal>;
const h: Handler<Dog> = handleAnimal; // ✅ qui gère tout animal gère un chien

declare const handleDog: Handler<Dog>;
const h2: Handler<Animal> = handleDog; // ❌ (avec strictFunctionTypes)
```

Deux trous de soundness à connaître :

1. **Les tableaux sont covariants** alors qu'ils sont mutables : `const dogs: Dog[] = []; const animals: Animal[] = dogs; animals.push({ name: "cat" });` compile, et `dogs` contient maintenant un chat. Raison de plus pour prendre `readonly T[]` en paramètre.
2. **Les méthodes sont bivariantes** : `strictFunctionTypes` ne s'applique qu'aux propriétés de type fonction (`handle: (x: T) => void`), pas à la syntaxe méthode (`handle(x: T): void`). Pour un contrat strict, préfère la syntaxe propriété.

Tu peux annoter la variance explicitement (TS 4.7+) : `interface Producer<out T>`, `interface Consumer<in T>`. Utile surtout pour les perfs de typecheck dans les libs et pour documenter.

## Quand NE PAS faire de type-level magic

Le type-level TS est Turing-complet. Ce n'est pas une raison.

**Signes que tu vas trop loin :**

- Un collègue (ou toi dans 3 mois) ne peut pas expliquer le type en 30 secondes.
- Les messages d'erreur font 40 lignes et pointent dans ton utilitaire, pas dans le code fautif.
- L'IDE rame, `tsc` passe de 10 s à 60 s (« Type instantiation is excessively deep »).
- Tu as écrit des tests de types plus longs que le code.

**Règles pratiques :**

- Code applicatif : unions, génériques simples, utility types standards, brands. C'est 95 % du besoin.
- Type-level avancé : **dans une lib** interne bien isolée, avec des tests de types (`expectTypeOf`, cf. [Tests](/dev/typescript/08-tests)).
- Si le runtime doit valider de toute façon, fais porter le type par le **schéma** (Zod infère) plutôt que de le recalculer à la main.
- Un type explicite et un peu redondant vaut mieux qu'un type « malin » et opaque. Nomme les types intermédiaires.

```ts
// Trop malin pour du code métier
type DeepKeys<T> = T extends object
  ? { [K in keyof T & string]: K | `${K}.${DeepKeys<T[K]>}` }[
      keyof T & string]
  : never;

// Souvent suffisant, et lisible
type SortField = "createdAt" | "startsAt" | "customerName";
```

## Cas réel

**Config multi-environnements avec override.** Ton SaaS a une config par défaut et des overrides par environnement et par tenant (un gros client a un rate limit plus élevé). On veut que l'override soit **partiel à tous les niveaux**, mais vérifié.

```ts
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]                      // un tableau se remplace en entier
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

type AppConfig = {
  http: { port: number; cors: { origins: string[] } };
  rateLimit: { perMinute: number; burst: number };
  features: { waitlist: boolean; sms: boolean };
};

const tenantOverride: DeepPartial<AppConfig> = {
  rateLimit: { perMinute: 600 },
  features: { sms: true },
};
```

Remarque le choix explicite sur les tableaux : sans la première branche, `DeepPartial<string[]>` rendrait les éléments optionnels, ce qui n'a pas de sens pour une liste d'origines CORS. C'est le genre de **décision de sémantique** qu'un type avancé doit documenter. Il ne reste qu'à écrire le `deepMerge` qui va avec (défi 4).

## Pièges classiques

- Oublier la distribution : `type X<T> = T extends string ? "s" : "o"` donne `"s" | "o"` pour `string | number`, et `X<never>` donne `never` (union vide).
- `keyof` sur une union retourne les clés **communes** seulement : `keyof (A | B)` = clés de A ∩ clés de B.
- Brand avec `string & { __brand: "X" }` simple : marche, mais la propriété apparaît dans l'autocomplétion. `unique symbol` la cache.
- Croire qu'un brand valide quelque chose : seul le **constructeur** valide. Un `as UserId` sauvage ailleurs casse la garantie (interdis-le en review).
- Récursion de types sans cas d'arrêt : erreur « excessively deep ». Ajoute une profondeur max ou simplifie.
- Question d'entretien : « Pourquoi `Array<Dog>` assignable à `Array<Animal>` est un problème ? » → covariance sur un type mutable, voir la section variance.

## Défis

### 1. Que valent ces types ?

```ts
type A = Exclude<"a" | "b" | "c", "a" | "z">;
type B = ReturnType<() => Promise<string[]>>;
type C = Awaited<B>[number];
type D = `${"GET" | "POST"} /${"users" | "slots"}`;
```

::: details Solution
- `A = "b" | "c"`
- `B = Promise<string[]>`
- `C = string`
- `D = "GET /users" | "GET /slots" | "POST /users" | "POST /slots"` (produit cartésien)
:::

### 2. Écris `PickByValue`

`PickByValue<T, V>` garde seulement les propriétés dont le type est assignable à `V`.

```ts play
type PickByValue<T, V> = never; // TODO

type Booking = {
  id: string; guests: number; note: string | null; paid: boolean;
};
type Nums = PickByValue<Booking, number>; // { guests: number }
const x: Nums = { guests: 2 };
console.log(x);
```

::: details Solution
```ts
type PickByValue<T, V> = {
  [K in keyof T as T[K] extends V ? K : never]: T[K];
};
```
Attention : `PickByValue<Booking, string>` ne garde pas `note` (`string | null` n'est pas assignable à `string`).
:::

### 3. `Cents` et `Euros`

Écris deux brands `Cents` et `Euros`, une fonction `toCents(e: Euros): Cents` (arrondie), et une fonction `add(a: Cents, b: Cents): Cents`. Vérifie que `add(prixEnEuros, frais)` ne compile pas.

::: details Solution
```ts play
declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };
type Cents = Brand<number, "Cents">;
type Euros = Brand<number, "Euros">;

const euros = (n: number) => n as Euros;
const cents = (n: number) => {
  if (!Number.isInteger(n)) throw new Error("cents must be int");
  return n as Cents;
};
const toCents = (e: Euros) => cents(Math.round(e * 100));
const add = (a: Cents, b: Cents) => (a + b) as Cents;

const fee = cents(150);
const price = euros(19.9);
console.log(add(toCents(price), fee)); // 2140
// add(price, fee); // ❌ Euros n'est pas Cents
```
Note : `a + b` donne un `number` (le brand est perdu par l'arithmétique), d'où le cast **dans** `add`, seul endroit autorisé.
:::

### 4. `deepMerge` (exécutable)

Implémente le `deepMerge` du cas réel. Contraintes : ne pas muter les entrées, remplacer les tableaux, ignorer `undefined`, et ignorer les clés `__proto__`/`constructor`/`prototype` (sinon **prototype pollution** quand l'override vient d'un JSON utilisateur, une CVE classique des libs de merge).

<Challenge :data="deepMerge" />

## À retenir

- Conditional types **distribuent** sur les unions ; `never` filtre ; `[T]` bloque la distribution.
- `infer` extrait, mapped types + `as` transforment et filtrent les clés.
- Branded types : zéro coût runtime, un seul constructeur qui valide, jamais de `as Brand` sauvage.
- Variance : retour covariant, paramètre contravariant ; tableaux et méthodes sont des trous connus.
- Le type-level avancé va dans des libs testées. Dans le code métier : simple, nommé, lisible.
