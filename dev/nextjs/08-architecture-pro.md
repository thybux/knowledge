<script setup>
import shopSetting from "./challenges/shop-setting";
import mergeFilters from "./challenges/merge-filters";
</script>

# Architecture pro

Ce que tu vas apprendre : organiser le code serveur d'une app Next pour qu'il reste testable et lisible à dix mille lignes : services en classes avec injection de dépendances par constructeur et `static forRequest()`, un annuaire d'API typé côté serveur, des tests Vitest avec de faux connecteurs plutôt que des mocks de modules, et deux façons de faire du white-label multi-boutique (au build ou au runtime) avec leurs compromis.

## Le problème : la logique qui fuit partout

Sans structure, une app Next finit avec des `fetch` dans les pages, de la logique métier dans les Server Actions, et des `cookies()` appelés au hasard. Trois symptômes :

- impossible de tester une règle sans démarrer Next ;
- une même règle (le coupon s'applique-t-il ?) recodée dans trois actions ;
- une page publique qui devient dynamique parce qu'un helper lit les cookies ([chapitre 2](/dev/nextjs/02-donnees-et-cache)).

Une organisation qui tient :

```
app/                 -> routes : pages minces, lisent des getters
actions/             -> Server Actions minces : 1 ligne par export
common/
  interfaces/        -> types partagés (seul dossier sûr côté client)
  catalog/api.ts     -> getters de lecture (React.cache)
  checkout/
    checkout-service.ts  -> classe, logique d'écriture
    pure.ts              -> fonctions pures, testées sans mock
  lib/
    api/server-api.ts    -> annuaire : une méthode = un endpoint
    factory/             -> getPublicApi() / getSessionApi()
```

Lecture au rendu = un **getter** (fonction enveloppable dans `React.cache`). Écriture = une **méthode de service**, appelée par une action mince.

## Services en classes, DI par constructeur

Un service reçoit **au constructeur** tout ce qui parle à l'extérieur : API, passerelle de paiement, utilisateur courant, cookie. Il ne va rien chercher lui-même.

```ts
export interface CheckoutDeps {
  connect: () => Promise<ServerApi>;
  currentUser: () => Promise<User | null>;
  payment: PaymentGateway;
  pendingOrder: { read(): Promise<string | null>;
    write(n: string): Promise<void> };
}

export class CheckoutService {
  constructor(private readonly deps: CheckoutDeps) {}

  static forRequest(): CheckoutService {
    return new CheckoutService({
      connect: getSessionApi,
      currentUser: getCurrentUser,
      payment: PaymentGateway.fromEnv(),
      pendingOrder: new PendingOrderCookie(),
    });
  }
  // ...
}
```

Deux idées distinctes :

- **Injection de dépendances (DI) par constructeur** : la classe déclare ce dont elle a besoin (`CheckoutDeps`), l'appelant le fournit. Pas de conteneur, pas de décorateur : juste un paramètre.
- **`static forRequest()`** : une **fabrique** (factory method) qui câble les vraies dépendances pour la requête en cours. C'est le seul endroit qui connaît `cookies()`, l'env et les implémentations concrètes. On l'appelle à chaque requête : un service ne garde aucun état entre deux visiteurs.

```ts
async startPayment(orderNumber: unknown)
  : Promise<ActionResult<{ redirectUrl: string }>> {
  if (typeof orderNumber !== "string") return fail("Commande invalide.");
  const user = await this.deps.currentUser();
  if (!user) return fail("Session expirée : reconnecte-toi.");
  const api = await this.deps.connect();
  const order = await api.orders.get(orderNumber); // montant relu
  if (!order.success) return fail("Commande introuvable.");
  const session = await this.deps.payment.createSession(order.data);
  await this.deps.pendingOrder.write(orderNumber);
  return ok({ redirectUrl: session.url });
}
```

::: info Pourquoi pas un conteneur DI ?
NestJS ou InversifyJS résolvent les dépendances automatiquement. Dans une app Next, les dépendances sont peu nombreuses et dépendent de la **requête** (cookies, session) : un `forRequest()` explicite se lit de haut en bas, sans magie, et se remplace en test. Coût : un peu de câblage manuel. Alternative encore plus simple : des fonctions qui reçoivent leurs dépendances en paramètre ; elle marche, mais les signatures s'allongent vite quand un service a cinq méthodes qui partagent les mêmes quatre dépendances.
:::

Interfaces étroites : le service dépend de `Pick<CartService, "sync">`, pas de tout le `CartService`. Le test n'a qu'une méthode à simuler, et le couplage est visible dans le type.

## L'annuaire d'API côté serveur

Au lieu de `fetch` éparpillés, **une** classe qui liste tous les endpoints du backend, groupés par domaine. Une méthode = un endpoint, typée par les contrats partagés.

```ts
// common/lib/api/server-api.ts
import "server-only";

export class ServerApi {
  constructor(private readonly http: HttpClient) {}

  readonly products = {
    bySlug: (slug: string, locale: string) =>
      this.http.get<ProductDetailResponse>(
        `/public/products/slug/${slug}`,
        { query: { locale }, revalidate: CATALOG_REVALIDATE },
      ),
  };

  readonly orders = {
    get: (number: string) =>
      this.http.get<OrderResponse>(`/orders/${number}`),
  };
}
```

Ce que ça apporte :

- **Un seul endroit** où se décide le cache de chaque endpoint (`revalidate`), ses en-têtes, son timeout.
- Les types de réponse viennent du **package de contrats** partagé avec le backend (schémas zod) : un changement d'API casse la compilation du front, pas la prod.
- Un `grep` sur l'annuaire répond à « quels endpoints le front utilise-t-il ? ».

Le client HTTP en dessous ne **lève jamais** sur une réponse non-2xx : il rend l'enveloppe `{ success, data, message, statusCode }`. L'appelant décide (liste vide, 404, ou erreur de panne, [chapitre 5](/dev/nextjs/05-seo-technique)).

Les fabriques choisissent ce que l'annuaire envoie :

| Fabrique | Lit | Rendu | Usage |
| --- | --- | --- | --- |
| `getPublicApi()` | rien (sync) | garde l'ISR | catalogue public |
| `getSessionApi()` | cookies, en-têtes | dynamique | compte, checkout, actions |

## Tester sans mocker des modules

Avec la DI, un test **construit** le service avec des doubles. Pas de `vi.mock("@/common/lib/auth")` qui remplace un module pour tout le fichier et casse au premier renommage.

```ts
// tests/common/checkout/checkout-test-kit.ts
export function makeCheckout(over: Partial<CheckoutDeps> = {}) {
  const api = fakeServerApi();
  const payment = new FakePaymentGateway();
  const service = new CheckoutService({
    connect: async () => api,
    currentUser: async () => aUser(),
    payment,
    pendingOrder: new MemoryPendingOrder(),
    ...over,
  });
  return { service, api, payment };
}
```

```ts
import { describe, expect, it } from "vitest";

describe("CheckoutService.startPayment", () => {
  it("montant relu côté backend, pas celui du client", async () => {
    const { service, api, payment } = makeCheckout();
    api.orders.seed({ number: "A-1", totalTtc: 8000 });
    await service.startPayment("A-1");
    expect(payment.sessions[0].amount).toBe(8000);
  });

  it("sans session : échec lisible, aucun paiement", async () => {
    const { service, payment } =
      makeCheckout({ currentUser: async () => null });
    const r = await service.startPayment("A-1");
    expect(r).toEqual({ success: false,
      message: "Session expirée : reconnecte-toi." });
    expect(payment.sessions).toHaveLength(0);
  });
});
```

| | Fake passé au constructeur | `vi.mock` de module |
| --- | --- | --- |
| Portée | ce test | tout le fichier |
| Refactor | suit les types | casse au renommage de chemin |
| Lisibilité | le test montre ses dépendances | magie hors champ |
| Vérifie | le résultat (état du fake) | souvent la forme d'un appel |

Les fonctions **pures** (`pure.ts` : calcul de récapitulatif, règle de coupon, construction du DTO) se testent sans aucun double. C'est là que va le plus de logique possible. Ce qui dépend du vrai backend (course entre deux commandes, contrainte d'unicité) se teste en intégration, pas avec un fake.

## White-label multi-boutique

Une même base de code, plusieurs vitrines (marques, couleurs, logos, textes légaux, catalogue filtré). Deux stratégies.

### Choisie au build

Un build par boutique : `SHOP=acme pnpm build`. Le profil de la boutique est une constante typée :

```ts
// shops/profiles.ts
type ShopProfile = {
  id: number;
  name: string;
  theme: "acme" | "rider";
  locales: readonly Locale[];
  features: { financing: boolean; workshop: boolean };
};

export const PROFILES = {
  acme: { id: 1, name: "Acme Moto", theme: "acme",
    locales: ["fr", "en"],
    features: { financing: true, workshop: false } },
  rider: { id: 2, name: "Rider Parts", theme: "rider",
    locales: ["fr"],
    features: { financing: false, workshop: true } },
} as const satisfies Record<string, ShopProfile>;
```

`satisfies` vérifie que chaque profil respecte le type **sans élargir** les littéraux : `PROFILES.acme.theme` reste `"acme"`, et un champ oublié est une erreur de compilation.

Le style passe par des **tokens CSS** posés sur `<html data-tenant="acme">`, pas par des classes conditionnelles :

```css
:root[data-tenant="acme"]  { --brand: #c8102e; --radius: 4px; }
:root[data-tenant="rider"] { --brand: #0057b8; --radius: 12px; }
.button { background: var(--brand); border-radius: var(--radius); }
```

Et les différences de contenu passent par des **slots**, pas par des `if` :

```tsx
// Mauvais : chaque composant connaît toutes les boutiques
{shop === "acme" ? <AcmeHero /> : shop === "rider"
  ? <RiderHero /> : null}

// Bon : le profil fournit le composant, la page ne sait rien
const SLOTS = {
  acme: { Hero: AcmeHero, Footer: AcmeFooter },
  rider: { Hero: RiderHero, Footer: DefaultFooter },
} satisfies Record<ShopKey, ShopSlots>;

const { Hero } = SLOTS[currentShop];
<Hero />;
```

Ajouter une boutique = ajouter une entrée, pas toucher vingt composants.

### Choisie au runtime, par hostname

Un seul build, une seule image ; `proxy.ts` lit le `Host`, résout la boutique et la passe à l'app (en-tête de requête ou segment réécrit).

```ts
// proxy.ts
const BY_HOST: Record<string, ShopKey> = {
  "acme.example": "acme",
  "rider.example": "rider",
};

export function proxy(request: NextRequest) {
  const shop = BY_HOST[request.headers.get("host") ?? ""];
  if (!shop) return new Response("Unknown shop", { status: 404 });
  const url = request.nextUrl.clone();
  url.pathname = `/${shop}${url.pathname}`; // segment [shop]
  return NextResponse.rewrite(url);
}
```

Réécrire vers un segment `app/[shop]/...` plutôt que lire un en-tête dans les pages est **essentiel** : lire `headers()` rendrait tout dynamique, alors qu'un segment garde l'ISR, avec une entrée de cache par boutique.

### Le tableau des compromis

| Critère | Au build | Au runtime (hostname) |
| --- | --- | --- |
| Builds et images | un par boutique | un seul |
| `NEXT_PUBLIC_*` | une valeur par boutique | **une seule valeur** pour toutes : ce qui diffère doit venir du serveur |
| Cache ISR | séparé naturellement | par segment `[shop]` (sinon mélange entre boutiques) |
| Code mort | profils et slots inutiles éliminés du bundle | tous les slots dans le bundle (ou `dynamic()`) |
| Ajouter une boutique | nouveau pipeline, nouveau déploiement | une ligne de config + DNS |
| Risque | dérive entre builds | fuite entre boutiques (cache, canonical, cookies) |
| Adapté à | 2-3 vitrines stables | beaucoup de vitrines, onboarding fréquent |

Dans les deux cas : le **backend** reste la frontière. Le front envoie l'id de boutique, le backend filtre le catalogue sur `shopId IN (0, id)` (0 = partagé). Un filtre ajouté par le front n'est que de l'UX.

### Les réglages par boutique

Les réglages (seuil de livraison offerte, devise, bannière) se résolvent avec repli : valeur de la boutique, sinon valeur globale (`shopId = 0`), sinon défaut. Et les filtres de listing combinent un périmètre imposé par la boutique avec les choix du visiteur. Ce sont deux fonctions pures, testables, et les deux défis de ce chapitre.

## Cas réel

**Le front d'une boutique de pièces moto, deux vitrines sur un backend.**

- `actions/*.ts` : chaque export appelle `<Service>.forRequest().methode()` et rend un `ActionResult`. Aucune logique.
- Services en classes (`CheckoutService`, `CartService`, `AddressService`...) avec des `Deps` étroites ; `forRequest()` câble session, passerelle de paiement, cookies.
- Un annuaire `ServerApi` unique ; deux fabriques, `getPublicApi()` pour le catalogue en ISR, `getServerApi()` pour la session.
- Tests Vitest : un `checkout-test-kit.ts` construit les services avec de faux connecteurs ; les règles pures (coupon, stock, DTO de commande) sont testées sans double.
- White-label **au build** aujourd'hui (une vitrine dédiée à une marque) : `data-tenant` sur `<html>`, tokens CSS, `SHOPID` en variable serveur. La résolution par hostname dans le proxy est prévue pour quand les vitrines se multiplieront, avec un segment `[shop]` pour garder l'ISR séparée.
- Le catalogue est borné par le **backend** (réglage de catégories racines par boutique) : le front n'envoie aucun périmètre.

## Pièges classiques

- Logique métier dans les Server Actions : non testable, dupliquée, et chaque helper exporté devient un endpoint.
- Un service qui appelle `cookies()` ou lit `process.env` lui-même : impossible à tester sans mocker Next.
- Un service singleton module qui garde un état : partagé entre visiteurs.
- `vi.mock` partout : des tests qui vérifient la forme des appels et cassent au moindre renommage.
- `fetch` sauvage dans une page au lieu d'une méthode de l'annuaire.
- White-label à coups de `if (shop === ...)` dans les composants.
- Multi-tenant au runtime en lisant `headers()` dans les pages : plus d'ISR. Ou ISR sans le tenant dans le chemin : la boutique A servie sur le domaine B.
- Compter sur une `NEXT_PUBLIC_*` pour différencier des tenants servis par une même image.
- Question d'entretien : « Comment rendre testable un code qui dépend des cookies et d'une API ? » : injecter ces dépendances au constructeur, câbler les vraies dans une fabrique, passer des fakes en test.
- Question d'entretien : « Multi-tenant au build ou au runtime ? » : au build pour peu de vitrines stables (isolation, bundle minimal), au runtime pour beaucoup de vitrines (un déploiement), en gardant le tenant dans le chemin pour le cache.

## Défis

### 1. Réglage boutique avec repli (exécutable)

<Challenge :data="shopSetting" />

### 2. Périmètre de filtres (exécutable)

<Challenge :data="mergeFilters" />

### 3. Rends ce code testable

```ts
export async function applyCoupon(code: string) {
  "use server";
  const token = (await cookies()).get("access_token")?.value;
  const res = await fetch(`${process.env.API}/cart/coupon`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code }),
  });
  return res.json();
}
```

::: details Solution
Sortir la logique dans `CartService` dont le constructeur reçoit `connect: () => Promise<ServerApi>` ; ajouter `cart.applyCoupon(code)` à l'annuaire ; `CartService.forRequest()` câble `getSessionApi`. L'action devient `return CartService.forRequest().applyCoupon(code)`. Le service valide `code` (`cleanText`, longueur, motif) et traduit la réponse en `ActionResult`. Test : `new CartService({ connect: async () => fakeApi })`, on vérifie le résultat et l'état du fake.
:::

### 4. Le bug du multi-tenant

Un seul build sert `acme.example` et `rider.example`. Le proxy pose `x-shop: acme` en en-tête de requête, les pages ne le lisent pas encore, et le catalogue est en ISR. Les deux sites affichent parfois les produits de l'autre. Pourquoi ?

::: details Solution
L'ISR met en cache par **chemin** : `/produits/kit-520` a une seule entrée pour les deux domaines. La première boutique qui la génère gagne pour tout le monde. Il faut que la boutique soit **dans le chemin** : rewrite vers `/acme/produits/kit-520` avec un segment `app/[shop]/`. Lire `headers()` dans la page réglerait le mélange mais tuerait l'ISR.
:::

## À retenir

- Pages et actions minces ; lecture = getter (`React.cache`), écriture = méthode de service.
- Services en classes : dépendances étroites au constructeur, vraies dépendances câblées par `static forRequest()`.
- Un annuaire `ServerApi` typé par les contrats partagés ; deux fabriques, publique (ISR) et de session (dynamique).
- Tests : fakes passés au constructeur, logique pure testée sans double ; pas de `vi.mock` de modules.
- White-label au build (profils `satisfies`, tokens CSS, slots) ou au runtime par hostname (tenant dans le chemin pour l'ISR, `NEXT_PUBLIC_*` unique).
- Le backend borne toujours le périmètre d'une boutique ; le front ne fait que de l'UX.
