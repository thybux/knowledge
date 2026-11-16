<script setup>
import bookingReducer from "./challenges/booking-reducer";
</script>

# React en TypeScript

Ce que tu vas apprendre : typer proprement composants et hooks, séparer **server state** et **client state** (TanStack Query), comprendre quand et pourquoi React re-rend, situer les Server Components, et construire des formulaires validés par les mêmes schémas Zod que le back.

## Typer les props

```tsx
type BookingCardProps = {
  booking: BookingDto;
  onCancel?: (id: string) => void;
  children?: React.ReactNode;
};

export function BookingCard({ booking, onCancel, children }:
  BookingCardProps) {
  return (
    <article>
      <h3>{booking.customerEmail}</h3>
      {children}
      {onCancel && (
        <button onClick={() => onCancel(booking.id)}>Annuler</button>
      )}
    </article>
  );
}
```

- Une fonction avec des props typées suffit. `React.FC` n'est plus nécessaire (et n'apporte rien depuis qu'il n'ajoute plus `children` implicitement).
- `React.ReactNode` pour tout ce qui est rendable (string, élément, tableau, `null`).

### Étendre un élément natif

```tsx
import type { ComponentProps } from "react";

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "danger";
  loading?: boolean;
};

export function Button({ variant = "primary", loading = false,
  children, ...rest }: ButtonProps) {
  return (
    <button {...rest} disabled={loading || rest.disabled}
      data-variant={variant}>
      {loading ? "…" : children}
    </button>
  );
}
```

`ComponentProps<"button">` donne `onClick`, `type`, `aria-*`… et **`ref`** : depuis React 19, `ref` est une prop normale pour les composants fonction, `forwardRef` n'est plus nécessaire.

### Props en union discriminée

```tsx
type PriceProps =
  | { kind: "free" }
  | { kind: "paid"; amountCents: number; currency: "EUR" | "USD" };

function Price(p: PriceProps) {
  if (p.kind === "free") return <span>Gratuit</span>;
  const fmt = new Intl.NumberFormat("fr-FR",
    { style: "currency", currency: p.currency });
  return <span>{fmt.format(p.amountCents / 100)}</span>;
}

<Price kind="paid" amountCents={1990} currency="EUR" />;
// <Price kind="paid" /> ❌ amountCents manquant
```

Même principe qu'au [chapitre 1](/dev/typescript/01-types-fondamentaux) : pas de `amountCents?` optionnel qui oblige chaque usage à deviner.

### Composants génériques

```tsx
type SelectProps<T> = {
  items: readonly T[];
  value: T | null;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  onChange: (item: T) => void;
};

export function Select<T>({ items, value, getKey, getLabel,
  onChange }: SelectProps<T>) {
  return (
    <select value={value ? getKey(value) : ""}
      onChange={(e) => {
        const it = items.find((i) => getKey(i) === e.target.value);
        if (it) onChange(it);
      }}>
      {items.map((i) => (
        <option key={getKey(i)} value={getKey(i)}>{getLabel(i)}</option>
      ))}
    </select>
  );
}

// T inféré = Slot ; onChange reçoit un Slot
<Select items={slots} value={slot} getKey={(s) => s.id}
  getLabel={(s) => s.startsAt} onChange={setSlot} />;
```

## Typer les hooks

```tsx
// Inféré : number
const [guests, setGuests] = useState(1);

// Valeur initiale null : précise le type
const [selected, setSelected] = useState<Slot | null>(null);

// Ref vers un élément DOM
const inputRef = useRef<HTMLInputElement>(null);
inputRef.current?.focus();

// Événements
function onChange(e: React.ChangeEvent<HTMLInputElement>) {
  setGuests(Number(e.target.value));
}
```

Un hook custom qui retourne un tuple : ajoute `as const`, sinon TS infère un tableau d'union.

```tsx
function useToggle(initial = false) {
  const [on, setOn] = useState(initial);
  const toggle = useCallback(() => setOn((v) => !v), []);
  return [on, toggle] as const; // readonly [boolean, () => void]
}
```

### `useReducer` + union discriminée

Pour un état à plusieurs étapes (formulaire, wizard, upload), un reducer avec un état en union rend les **états impossibles impossibles** : pas de `isLoading && error && data` simultanés.

```tsx
type State =
  | { status: "editing"; values: Values; errors: Errors }
  | { status: "submitting"; values: Values }
  | { status: "success"; bookingId: string }
  | { status: "error"; values: Values; message: string };

const [state, dispatch] = useReducer(reducer, initialState);

if (state.status === "success") {
  return <p>Réservation {state.bookingId} confirmée</p>;
}
```

C'est le défi de ce chapitre.

## Server state vs client state

La distinction la plus importante du front moderne.

| | Server state | Client state |
| --- | --- | --- |
| Source de vérité | le serveur | le navigateur |
| Exemples | réservations, créneaux, profil | modale ouverte, onglet actif, brouillon |
| Problèmes | cache, périmé, refetch, dédoublonnage | juste le stocker |
| Outil | TanStack Query (ou loader du framework) | `useState`, `useReducer`, URL, Zustand |

L'erreur classique : `useEffect` + `fetch` + `useState` pour des données serveur. Tu réécris (mal) un cache : pas de dédoublonnage, pas de gestion des courses entre requêtes, pas d'invalidation, des états de chargement incohérents.

::: tip L'URL est un state
Filtres, page, onglet, créneau sélectionné : mets-les dans l'URL (search params). Partageable, survit au refresh, bouton retour qui marche. Beaucoup de « state management » disparaît comme ça.
:::

### TanStack Query (v5)

```tsx
import { queryOptions, useQuery } from "@tanstack/react-query";

export const slotsQuery = (tenantId: string, day: string) =>
  queryOptions({
    queryKey: ["slots", tenantId, day] as const,
    queryFn: () => api.listSlots(tenantId, day),
    staleTime: 30_000,
  });

function SlotList({ tenantId, day }: Props) {
  const { data, isPending, error } = useQuery(slotsQuery(tenantId, day));
  if (isPending) return <Spinner />;
  if (error) return <ErrorBox message={error.message} />;
  return <ul>{data.map((s) => <SlotRow key={s.id} slot={s} />)}</ul>;
}
```

- La **queryKey** identifie la donnée en cache. Elle contient **tout** ce dont dépend la requête (tenant, jour, filtres).
- `queryOptions` centralise clé + fonction : réutilisable pour `prefetchQuery`, `useSuspenseQuery`, `getQueryData`, et bien typé partout.
- Après `if (isPending)` et `if (error)`, `data` est réduit à `Slot[]` (narrowing sur l'union retournée).
- `staleTime` : pendant 30 s, la donnée est considérée fraîche (pas de refetch au remount). Par défaut c'est 0.

Les mutations invalident le cache concerné :

```tsx
const qc = useQueryClient();
const book = useMutation({
  mutationFn: api.createBooking,
  onSuccess: () =>
    qc.invalidateQueries({ queryKey: ["slots", tenantId] }),
});

<Button loading={book.isPending}
  onClick={() => book.mutate({ slotId: s.id, guests: 1 })}>
  Réserver
</Button>;
```

`invalidateQueries` avec un préfixe de clé (`["slots", tenantId]`) invalide tous les jours de ce tenant. Pour une UX instantanée, l'**optimistic update** (`onMutate` qui modifie le cache, `onError` qui restaure) est possible, mais coûte en complexité : réserve-le aux actions fréquentes et peu risquées (like, toggle), pas à une réservation payante.

## Rendering et re-renders

Un composant se re-rend quand :

1. son **state** change (`setState` avec une nouvelle valeur) ;
2. son **parent** se re-rend (même si ses props n'ont pas changé) ;
3. un **context** qu'il lit change.

Re-rendre n'est pas un bug : c'est exécuter la fonction, puis React ne touche au DOM que pour ce qui a changé. Ça ne devient un problème que si le rendu est coûteux (longue liste, graphiques) ou très fréquent (frappe clavier, drag).

### Les vrais pièges

```tsx
// ❌ state dérivé copié : se désynchronise
const [total, setTotal] = useState(0);
useEffect(() => { setTotal(items.reduce(sum, 0)); }, [items]);

// ✅ calculé pendant le rendu
const total = items.reduce(sum, 0);
```

```tsx
// ❌ key = index : l'état des lignes "glisse" quand on supprime
{bookings.map((b, i) => <BookingRow key={i} booking={b} />)}
// ✅ key = identité stable
{bookings.map((b) => <BookingRow key={b.id} booking={b} />)}
```

```tsx
// ❌ un context "fourre-tout" : chaque changement re-rend tout
<AppContext value={{ user, theme, cart, setCart }}>
// ✅ des contexts séparés par fréquence de changement
```

(React 19 permet `<Context value={...}>` directement au lieu de `<Context.Provider>`.)

### `memo`, `useMemo`, `useCallback` et le React Compiler

`memo(Component)` saute le re-render si les props sont égales (comparaison superficielle) ; `useMemo`/`useCallback` gardent la même référence entre deux rendus. Ils ne servent **que** si quelque chose en aval compare les références.

Le **React Compiler** (stable depuis fin 2025) mémoïse automatiquement composants et valeurs au build, ce qui rend la plupart des `useMemo`/`useCallback` manuels inutiles. Sur un projet qui l'active, n'en ajoute que si un profil le justifie. Dans tous les cas, mesure avec le **React DevTools Profiler** avant d'optimiser.

## Server Components, en bref

Avec un framework qui les supporte (Next.js App Router, et d'autres comme React Router qui les adoptent), un composant peut s'exécuter **sur le serveur uniquement** :

```tsx
// app/[tenant]/bookings/page.tsx : Server Component (par défaut)
export default async function BookingsPage({ params }: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const bookings = await db.listBookings(tenant); // accès direct
  return <BookingTable bookings={bookings} />;
}
```

```tsx
// BookingTable.tsx : interactif, donc client
"use client";
export function BookingTable({ bookings }: { bookings: BookingDto[] }) {
  const [sort, setSort] = useState<"date" | "name">("date");
  // ...
}
```

À retenir :

- Server Component : peut être `async`, lit la DB, n'envoie **pas** son code au navigateur. Pas de `useState`, pas d'`useEffect`, pas d'événements.
- `"use client"` marque une **frontière** : ce composant et ce qu'il importe partent dans le bundle client.
- Les props qui traversent la frontière doivent être **sérialisables** (pas de fonctions, pas de classes ; `Date` est supporté par le protocole RSC, mais des DTO en string ISO restent plus prévisibles).
- `"use server"` marque des **Server Functions** (actions) appelables depuis le client : ce sont des endpoints publics, donc **valide les entrées et vérifie l'auth** dedans comme dans une route d'API.

## Formulaires avec Zod

Le bénéfice du monorepo : le **même** schéma valide côté client (UX) et côté serveur (sécurité). La validation client est un confort, jamais une protection.

### React Hook Form + `zodResolver`

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const BookingForm = z.object({
  name: z.string().trim().min(1, "Nom requis"),
  email: z.email("Email invalide"),
  guests: z.coerce.number<string>().int().min(1).max(8),
});
type FormIn = z.input<typeof BookingForm>;   // guests: string
type FormOut = z.output<typeof BookingForm>; // guests: number
```

```tsx
function BookingFormView({ onSubmit }: {
  onSubmit: (v: FormOut) => Promise<void>;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting } }
    = useForm<FormIn, unknown, FormOut>({
      resolver: zodResolver(BookingForm),
      defaultValues: { name: "", email: "", guests: "1" },
    });
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register("name")} aria-invalid={!!errors.name} />
      {errors.name && <p role="alert">{errors.name.message}</p>}
      <input type="email" {...register("email")} />
      <input type="number" {...register("guests")} />
      <Button type="submit" loading={isSubmitting}>Réserver</Button>
    </form>
  );
}
```

Les trois génériques de `useForm<Input, Context, Output>` distinguent ce que contient le formulaire (des strings) de ce que reçoit `onSubmit` (après coercition). `z.coerce.number<string>()` précise que l'input attendu est une string.

### Version React 19 : `useActionState`

Sans lib, avec une action (fonction serveur ou client) :

```tsx
type State =
  | { ok: false; errors: Record<string, string[] | undefined> }
  | { ok: true; bookingId: string }
  | null;

async function bookAction(_prev: State, fd: FormData)
  : Promise<State> {
  const parsed = BookingForm.safeParse(Object.fromEntries(fd));
  if (!parsed.success) {
    return { ok: false,
      errors: z.flattenError(parsed.error).fieldErrors };
  }
  return { ok: true, bookingId: await api.book(parsed.data) };
}

function QuickBook() {
  const [state, action, pending] = useActionState(bookAction, null);
  return (
    <form action={action}>
      <input name="name" />
      {state?.ok === false && <p>{state.errors["name"]?.[0]}</p>}
      <button disabled={pending}>Réserver</button>
    </form>
  );
}
```

`z.flattenError` (Zod 4) donne `{ fieldErrors: { name?: string[] } }`, pratique pour afficher les erreurs par champ.

## Cas réel

**L'écran « Planning du jour » d'un back-office.** Un réceptionniste voit les créneaux du jour, filtre par salle, et inscrit des clients au téléphone.

- Le jour et la salle sont dans l'**URL** (`?day=2026-11-16&room=studio-a`) : lien partageable, refresh sans perte.
- Les créneaux viennent de `useQuery(slotsQuery(tenant, day, room))` avec `refetchInterval: 30_000` (d'autres réceptionnistes réservent en même temps) ; `placeholderData: keepPreviousData` évite le flash de chargement quand on change de jour.
- Le formulaire d'inscription utilise le schéma `CreateBookingBody` du package `@acme/contracts`, **le même** que l'API. Un `409 slot_full` du serveur est affiché sur le champ créneau (`setError("slotId", ...)`), car le client ne peut pas savoir qu'un collègue vient de prendre la dernière place.
- Après succès : `invalidateQueries({ queryKey: ["slots", tenant, day] })`, et le compteur de places se met à jour.
- La modale ouverte et le créneau sélectionné sont du **client state** local (`useState`) : rien à faire dans un store global.

## Pièges classiques

- `useEffect` pour synchroniser deux states, ou pour calculer une valeur dérivée : calcule pendant le rendu.
- `useEffect` + `fetch` sans gestion d'annulation : réponse d'une requête précédente qui écrase la plus récente (race). TanStack Query gère ça.
- Copier des données serveur dans un store global (Redux/Zustand) « pour les avoir partout » : deux sources de vérité.
- `key={index}` sur une liste qui change.
- Typer les événements en `any` (`(e: any) => ...`) : `React.ChangeEvent<HTMLInputElement>`, `React.FormEvent<HTMLFormElement>`.
- `useState<Booking>()` sans valeur initiale : le type devient `Booking | undefined`, et l'oubli du cas `undefined` est un crash.
- Croire que la validation Zod côté client protège l'API.
- Question d'entretien : « Pourquoi mon composant se re-rend alors que ses props n'ont pas changé ? » → parce que son parent s'est re-rendu ; `memo` l'évite si les props sont stables (ou le React Compiler).

## Défis

### 1. Combien de requêtes ?

Trois composants montés en même temps appellent `useQuery(slotsQuery("t1", "2026-11-16"))`. Combien de requêtes réseau ? Et si l'un utilise `["slots", "t1", "2026-11-16"]` et un autre `["slots", "t1", new Date("2026-11-16")]` ?

::: details Solution
Une seule : même queryKey = même entrée de cache, les requêtes en vol sont dédoublonnées. Dans le second cas, deux requêtes : les clés sont comparées par un hachage déterministe (sérialisation JSON avec clés d'objet triées), et la `Date` devient `"2026-11-16T00:00:00.000Z"`, différent de `"2026-11-16"`. Garde des clés faites de valeurs primitives normalisées.
:::

### 2. Trouve le bug

```tsx
function SlotPicker({ slots }: { slots: Slot[] }) {
  const [available, setAvailable] = useState(
    slots.filter((s) => s.remaining > 0),
  );
  return <List items={available} />;
}
```

::: details Solution
`useState(initial)` n'utilise la valeur initiale qu'au **premier** rendu. Quand `slots` change (refetch), `available` reste l'ancienne liste. C'est du state dérivé : calcule-le à chaque rendu (`const available = slots.filter(...)`), éventuellement avec `useMemo` si c'est coûteux.
:::

### 3. Type ce composant

Écris les props d'un composant `<DataTable>` générique qui reçoit des `rows: T[]` et des `columns` où chaque colonne a un `header: string` et soit une `key: keyof T`, soit une fonction `render: (row: T) => ReactNode`.

::: details Solution
```tsx
type Column<T> =
  | { header: string; key: keyof T & string }
  | { header: string; render: (row: T) => React.ReactNode };

type DataTableProps<T> = {
  rows: readonly T[];
  columns: readonly Column<T>[];
  getRowKey: (row: T) => string;
};

function cell<T>(row: T, c: Column<T>): React.ReactNode {
  return "render" in c ? c.render(row) : String(row[c.key]);
}
```
L'union discriminée par la présence de `render` interdit une colonne qui aurait les deux (ou aucun).
:::

### 4. Reducer de formulaire (exécutable)

Implémente le reducer d'un formulaire de réservation avec un état en union discriminée et des transitions strictes (pas de `succeeded` hors de `submitting`).

<Challenge :data="bookingReducer" />

## À retenir

- Props typées avec des fonctions simples, `ComponentProps<"x">` pour étendre le natif, unions discriminées pour les variantes ; `ref` est une prop en React 19.
- Server state → TanStack Query (`queryOptions`, clés complètes, invalidation) ; client state → `useState`/`useReducer`/URL.
- Re-render = parent, state ou context ; calcule le dérivé au rendu, `key` stable, mesure avant de mémoïser (ou laisse faire le React Compiler).
- Server Components : `async`, sans state, frontière `"use client"`, props sérialisables ; Server Functions = endpoints publics à valider.
- Un seul schéma Zod front + back ; la validation client est de l'UX, la sécurité est côté serveur.
