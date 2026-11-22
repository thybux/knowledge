<script setup>
import actionResult from "./challenges/action-result";
</script>

# Server Actions

Ce que tu vas apprendre : ce qu'est réellement une Server Action (un endpoint POST public), pourquoi elle doit valider et autoriser comme une route d'API, comment typer son résultat en union discriminée au lieu de lever, garder l'action mince devant un service, l'appeler depuis le client avec `useTransition` ou `useActionState`, et revalider le bon cache après la mutation.

## Ce que fait `"use server"`

Une Server Action (ou Server Function, terme React) est une fonction `async` marquée `"use server"`, appelable depuis le client comme une fonction locale.

```ts
// actions/cart.ts
"use server";

export async function applyCoupon(code: string) {
  // s'exécute sur le serveur
}
```

```tsx
// coupon-form.tsx
"use client";
import { applyCoupon } from "@/actions/cart";

<button onClick={() => applyCoupon(code)}>Appliquer</button>
```

Sous le capot, au build :

1. Le compilateur **remplace** l'implémentation dans le bundle client par une référence : un **action ID** et un petit dispatcher.
2. Au clic, le dispatcher envoie un `POST` sur l'URL de la page courante, avec un en-tête identifiant l'action et les arguments sérialisés dans le body.
3. Le serveur retrouve la fonction par son ID, désérialise les arguments, l'exécute, et renvoie le résultat sérialisé (et, si tu as revalidé, le nouveau payload RSC de la page, dans le même aller-retour).

Le code de la fonction ne part jamais au navigateur. Mais **la route est joignable par n'importe qui** qui rejoue le même POST, avec n'importe quels arguments.

::: danger Une Server Action est un endpoint public
Les IDs sont chiffrés, non déterministes et changent entre les builds ; les actions non référencées sont retirées du bundle. Ce n'est **pas** une protection : un ID visible dans le JS d'une page est appelable avec `curl`. Traite chaque action exportée comme une route `POST /api/...` sans aucune garantie sur ses entrées.
:::

## Valider et autoriser : obligatoire

Les types TypeScript sont **effacés** à l'exécution. `applyCoupon(code: string)` peut recevoir un objet, un nombre, 10 Mo de texte.

```ts
"use server";
import { z } from "zod";

const CouponInput = z.object({
  code: z.string().trim().min(1).max(32)
    .regex(/^[A-Z0-9-]+$/i),
});

export async function applyCoupon(raw: unknown) {
  const parsed = CouponInput.safeParse(raw);
  if (!parsed.success) return fail("Code promo invalide.");

  const user = await getCurrentUser(); // relit la session
  if (!user) return fail("Session expirée : reconnecte-toi.");

  return CartService.forRequest().applyCoupon(parsed.data.code);
}
```

Trois règles :

- **Valide** chaque argument (zod, ou des gardes simples `isValidId`, `cleanText` pour un id ou un texte).
- **Authentifie** dans l'action : relis la session depuis le cookie. Ne fais pas confiance à un `userId` passé en argument.
- **Autorise** au plus près des données : le backend vérifie que la commande 42 appartient bien à ce client. Le front n'est pas une frontière de sécurité ([chapitre 7](/dev/nextjs/07-securite-nextjs)).

```ts
// Mauvais : l'appelant choisit à qui appartient l'adresse
export async function deleteAddress(userId: number, id: number) {}

// Bon : l'identité vient de la session, l'id est vérifié
export async function deleteAddress(id: unknown) {
  if (!isValidId(id)) return fail("Adresse introuvable.");
  return AddressService.forRequest().delete(id);
}
```

Un helper utile, qui ne lève jamais sur une valeur forgée :

```ts
export function isValidId(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id) && id > 0;
}

export function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
```

## Un résultat typé, pas une exception

Que se passe-t-il quand une action **lève** ? En production, Next ne transmet pas le message au client (il pourrait contenir des détails internes) : le client reçoit une erreur générique, avec un `digest` pour retrouver la trace dans les logs, et la promesse côté client est rejetée. Ton composant doit attraper ça, et il n'a aucune information utile à afficher.

Un échec **métier** (code promo expiré, stock insuffisant, email déjà pris) n'est pas une exception : c'est un résultat attendu. Modélise-le en **union discriminée** :

```ts
// common/interfaces/action.ts
export type ActionResult<T = void, F = undefined> =
  | { success: true; data: T; message?: string }
  | { success: false; message: string; details?: F };
```

```ts
// common/lib/utils/action-result.ts
export function ok<T>(data: T, message?: string) {
  return message
    ? { success: true as const, data, message }
    : { success: true as const, data };
}

export function fail<F = undefined>(message: string, details?: F) {
  return details === undefined
    ? { success: false as const, message }
    : { success: false as const, message, details };
}
```

Côté appelant, le narrowing fait le reste :

```ts
const result = await applyCoupon({ code });
if (result.success) {
  setTotal(result.data.total);   // data existe ici
} else {
  setError(result.message);      // message existe ici
}
```

- `message` d'un échec est **toujours lisible par l'utilisateur** : jamais une stack, jamais le message brut d'un 500.
- `details` (le `F`) porte ce que l'écran doit encore montrer : les lignes retirées du panier, le numéro d'une commande créée mais non payée.
- On garde la même clé `success` que l'enveloppe du backend : une seule convention à apprendre.

Le défi de ce chapitre traduit la réponse du backend en `ActionResult`, avec le masquage des messages techniques.

## Des actions minces devant des services

Le fichier `"use server"` est la **surface publique**. Chaque export est un endpoint. Garde-le minuscule : valider la forme, appeler un service, rendre le résultat.

```ts
// actions/checkout.ts
"use server";
import { CheckoutService } from "@/common/checkout/checkout-service";
import type { CheckoutInput } from "@/common/checkout/pure";

export async function placeOrder(input: CheckoutInput) {
  return CheckoutService.forRequest().placeOrder(input);
}

export async function startPayment(orderNumber: unknown) {
  return CheckoutService.forRequest().startPayment(orderNumber);
}
```

Pourquoi :

- **Tout export d'un fichier `"use server"` est exposé.** Un helper exporté « pour le tester » devient un endpoint. La logique vit dans une classe ailleurs, importée seulement par le serveur.
- Le service est **testable** sans Next : on lui passe de faux connecteurs au constructeur ([chapitre 8](/dev/nextjs/08-architecture-pro)).
- La règle de l'appelant ne change pas : il reçoit un `ActionResult`.

::: warning Ne relis jamais un montant venu du client
« Payer » ne prend pas un montant en argument : le service relit la commande **côté backend** et crée la session de paiement avec le montant du backend. Un montant envoyé par le navigateur se forge en une ligne : payer 1 EUR une commande à 8 000 EUR.
:::

## Appeler depuis le client

### `useTransition` pour un bouton

```tsx
"use client";
import { useState, useTransition } from "react";

export function CouponField() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(code: string) {
    startTransition(async () => {
      const r = await callAction(() => applyCoupon({ code }));
      setError(r.success ? null : r.message);
    });
  }
  // <button disabled={pending}>...
}
```

`startTransition` accepte une fonction async depuis React 19 : `pending` reste `true` jusqu'à la fin, y compris pendant le re-rendu provoqué par une revalidation. Pas de `useState(loading)` géré à la main, qui oublie le `finally`.

Le `callAction` est un filet pour ce qui **lève dans le navigateur** : réseau coupé, ou « Server Action not found » quand la page a été servie par l'ancienne version juste avant un déploiement. Sans lui, la promesse rejette et le bouton reste en chargement.

```ts
export async function callAction<T extends { success: boolean }>(
  action: () => Promise<T>,
): Promise<T | { success: false; message: string }> {
  try {
    return await action();
  } catch {
    return { success: false,
      message: "Serveur injoignable. Recharge la page." };
  }
}
```

### `useActionState` pour un formulaire

Pour un `<form>`, React 19 fournit `useActionState` : l'action reçoit l'état précédent et le `FormData`, et rend le nouvel état.

```tsx
"use client";
import { useActionState } from "react";
import { subscribeNewsletter } from "@/actions/newsletter";

export function NewsletterForm() {
  const [state, action, pending] =
    useActionState(subscribeNewsletter, null);
  return (
    <form action={action}>
      <input name="email" type="email" required />
      <button disabled={pending}>S'inscrire</button>
      {state && !state.success && <p role="alert">{state.message}</p>}
    </form>
  );
}
```

Bonus : avec une action serveur, le formulaire **fonctionne avant l'hydratation** (progressive enhancement), car c'est un vrai `<form>` qui POST. Le détail des formulaires avec Zod côté client est dans [React en TypeScript](/dev/typescript/10-frontend-react).

## Revalider après une mutation

Une action qui modifie des données doit dire à Next quoi invalider. Sans ça, la page affiche l'ancienne version (data cache, ISR ou Router cache).

| Outil | Effet | Quand |
| --- | --- | --- |
| `updateTag(tag)` | expire tout de suite, la relecture attend la donnée fraîche | l'utilisateur doit voir **sa** modif |
| `revalidateTag(tag, "max")` | stale-while-revalidate | contenu partagé, un léger retard est acceptable |
| `revalidatePath(path)` | invalide un chemin | une route précise, pas de tag |
| `refresh()` | re-rend la route sans toucher au cache | la vue dépend d'un état hors cache (cookie) |

```ts
export async function saveProfile(input: unknown) {
  const result = await ProfileService.forRequest().save(input);
  if (result.success) updateTag("me");
  return result;
}
```

Avec `updateTag`, `revalidatePath` ou `refresh`, Next re-rend la page côté serveur et renvoie le nouveau payload **dans la réponse de l'action** : un seul aller-retour.

### `redirect()` lève, et c'est voulu

```ts
export async function logout() {
  await AuthService.forRequest().logout();
  redirect("/connexion"); // lève une exception de contrôle
}
```

`redirect()` et `notFound()` fonctionnent en **levant** une erreur spéciale que Next intercepte. Deux conséquences : le code après ne s'exécute pas (revalide **avant**), et un `try/catch` autour l'avale. Si tu dois attraper autre chose, relance ces erreurs avec `unstable_rethrow(error)` en tête du `catch`. Et ne mets pas `callAction` autour d'une action qui redirige.

## Configuration utile

```ts
// next.config.ts
const config: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "11mb", // défaut 1 Mo (upload de pièces)
      allowedOrigins: ["shop.example"], // derrière un proxy
    },
  },
};
```

- `bodySizeLimit` : 1 Mo par défaut. Un formulaire avec pièces jointes l'atteint vite. Monte-le pour ce besoin seulement (c'est global), et valide la taille par fichier dans l'action.
- `allowedOrigins` : Next compare `Origin` et `Host` (ou `X-Forwarded-Host`) et refuse si ça diffère. Derrière un reverse proxy qui réécrit l'hôte, déclare les origines légitimes ([chapitre 7](/dev/nextjs/07-securite-nextjs)).
- Plusieurs replicas : fixe `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (secret) pour que tous les pods déchiffrent les mêmes références.

## Cas réel

**Le tunnel de commande d'une boutique de pièces moto.**

- `actions/checkout.ts` expose quatre fonctions : devis de port, recherche de points relais, création de commande, démarrage du paiement. Chacune fait une ligne : `CheckoutService.forRequest().methode(input)`.
- `CheckoutService` valide (`isValidId` sur les ids, `cleanText` sur les textes), relit l'utilisateur depuis la session, synchronise le panier local avec le panier serveur, appelle le backend, et rend un `ActionResult<PlacedOrder, PaymentFailure>`.
- Un panier qui contient un produit épuisé ne lève pas : `fail("Certains articles ne sont plus disponibles.", { skipped: ["Kit chaîne 520"] })`, et l'écran affiche la liste.
- Le paiement ne reçoit aucun montant : le service relit la commande côté backend puis crée la session chez le prestataire, et renvoie l'URL de la page de paiement hébergée.
- Le retour de paiement n'est **pas** une action : c'est la page `/checkout/retour` qui lit le statut côté serveur. Moins de surface exposée.
- Côté client, chaque bouton fait `startTransition(async () => { const r = await callAction(() => placeOrder(input)); ... })`.

## Pièges classiques

- Faire confiance aux types des arguments : ils n'existent pas à l'exécution.
- Prendre un `userId`, un prix ou un rôle en argument d'action.
- Exporter un helper depuis un fichier `"use server"` : il devient un endpoint.
- Lever une erreur pour un échec métier : en prod, le client reçoit un message générique et ton bouton reste bloqué.
- Afficher `error.message` d'un 500 backend à l'utilisateur.
- Oublier de revalider : « j'ai enregistré mais ça n'a pas changé ».
- `try/catch` autour d'un `redirect()` : la redirection est avalée.
- Pas de filet côté client : après un déploiement, « Server Action not found » laisse le bouton en chargement.
- Question d'entretien : « Une Server Action est-elle sécurisée parce qu'elle s'exécute sur le serveur ? » : non, c'est un endpoint POST public ; l'exécution serveur protège le code, pas l'accès.
- Question d'entretien : « Pourquoi renvoyer un résultat plutôt que lever ? » : un échec attendu fait partie du contrat ; une exception perd le message en prod et force chaque appelant à deviner.

## Défis

### 1. Trouve les failles

```ts
"use server";
export async function updateOrderNote(
  orderId: number, userId: number, note: string,
) {
  await db.order.update({
    where: { id: orderId, userId },
    data: { note },
  });
}
```

::: details Solution
`userId` vient du client : n'importe qui modifie la commande de n'importe qui en devinant deux entiers. Aucune validation : `note` peut faire 50 Mo ou être un objet. Aucun résultat : le client ne sait pas si ça a marché. Correction : identité depuis la session, `isValidId(orderId)`, `cleanText(note).slice(0, 500)`, appel au backend qui vérifie l'appartenance, retour `ActionResult`, `updateTag` de la commande.
:::

### 2. ActionResult (exécutable)

Traduis la réponse du backend en `ActionResult`, en ne montrant jamais un message technique.

<Challenge :data="actionResult" />

### 3. Quel outil de revalidation ?

(a) Le client renomme une adresse et doit la voir tout de suite. (b) Le back-office publie un nouvel article de blog. (c) L'action change la langue préférée (cookie) et la page doit se re-rendre.

::: details Solution
(a) `updateTag("addresses")` : read-your-own-writes. (b) `revalidateTag("blog", "max")` depuis un route handler appelé par le back-office (pas une action du front). (c) `refresh()` : aucune donnée en cache n'a changé, c'est le rendu qui dépend du cookie.
:::

### 4. Pourquoi ce bouton tourne pour toujours ?

```tsx
const [loading, setLoading] = useState(false);
async function onClick() {
  setLoading(true);
  const r = await placeOrder(input);
  setLoading(false);
  if (!r.success) setError(r.message);
}
```

::: details Solution
Si `placeOrder` **rejette** (réseau, déploiement, exception non gérée), `setLoading(false)` n'est jamais appelé. Utilise `useTransition` (le `pending` retombe quoi qu'il arrive) et `callAction` pour convertir le rejet en `ActionResult`.
:::

## À retenir

- `"use server"` = un endpoint POST public par export ; l'ID n'est pas un secret.
- Valide chaque argument, relis l'identité depuis la session, laisse le backend autoriser.
- Résultat en union discriminée `ActionResult` construit par `ok()`/`fail()` ; on ne lève pas pour un échec métier.
- Action mince, logique dans un service testable ; jamais de montant venu du client.
- Côté client : `useTransition` + `callAction`, ou `useActionState` pour un formulaire.
- Revalide après mutation : `updateTag`, `revalidateTag(tag, "max")`, `revalidatePath`, `refresh` ; `redirect()` lève.
