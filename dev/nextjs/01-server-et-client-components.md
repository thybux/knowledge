# Server et Client Components

Ce que tu vas apprendre : ce qu'est vraiment un React Server Component (RSC), ce que fait la directive `"use client"` sous le capot, ce qui part (ou pas) dans le bundle du navigateur, pourquoi l'hydratation casse parfois, et comment composer serveur et client sans tout basculer côté client.

## Le modèle mental : deux arbres, un seul rendu

Dans l'App Router, **tout composant est serveur par défaut**. Une requête sur `/produits/kit-chaine-520` se passe ainsi :

1. Next exécute les Server Components **sur le serveur** (ils peuvent être `async`, lire une API, une base).
2. React produit le **RSC Payload** : une description sérialisée de l'arbre rendu. Les Server Components y apparaissent déjà résolus (du HTML virtuel), les Client Components y apparaissent comme **références** (« ici, le module `add-to-cart.js`, avec ces props »).
3. Next en tire le **HTML initial** (Client Components compris, pré-rendus côté serveur) et l'envoie, avec le payload.
4. Dans le navigateur, React **hydrate** : il télécharge le JS des seuls Client Components, les exécute, et attache les événements au HTML existant.

```tsx
// app/[locale]/products/[slug]/page.tsx : Server Component
import { AddToCart } from "./add-to-cart"; // Client Component

export default async function ProductPage({ params }: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProduct(slug); // appel API serveur
  return (
    <main>
      <h1>{product.name}</h1>
      <p>{product.description}</p>
      <AddToCart productId={product.id} price={product.price} />
    </main>
  );
}
```

Le code de `ProductPage`, de `getProduct` et de leurs imports **n'est jamais envoyé** au navigateur. Seul `AddToCart` l'est.

::: info SSR n'est pas RSC
Le SSR (Server-Side Rendering) existait avant : tout le composant est rendu en HTML côté serveur **puis tout son code est renvoyé** au client pour l'hydratation. Avec RSC, une partie de l'arbre ne quitte **jamais** le serveur. Les Client Components, eux, sont toujours SSR puis hydratés.
:::

## La frontière `"use client"`

`"use client"` en tête de fichier ne veut pas dire « ce composant tourne seulement dans le navigateur ». Ça veut dire : **ce module est un point d'entrée du bundle client**. Le bundler (Turbopack par défaut en 16) coupe le graphe d'imports ici.

```tsx
// add-to-cart.tsx
"use client";

import { useState } from "react";
import { formatPrice } from "@/common/i18n/format";

export function AddToCart({ productId, price }: {
  productId: number;
  price: number;
}) {
  const [qty, setQty] = useState(1);
  return (
    <div>
      <input type="number" value={qty} min={1}
        onChange={(e) => setQty(Number(e.target.value))} />
      <button onClick={() => addToCart(productId, qty)}>
        Ajouter ({formatPrice(price * qty)})
      </button>
    </div>
  );
}
```

Conséquences :

- Tout ce que `add-to-cart.tsx` **importe** part aussi dans le bundle : `formatPrice` et ses dépendances. Un import d'une grosse lib dans un fichier client = des kilo-octets pour chaque visiteur.
- Il suffit de la directive **une fois** à l'entrée : les composants importés par un fichier client sont client, sans directive.
- Ce qui a besoin du navigateur impose le client : `useState`, `useEffect`, contexte, événements (`onClick`), `window`, `localStorage`.

### Où placer la frontière

La règle : **le plus bas possible**, sur les feuilles interactives.

```tsx
// Mauvais : toute la fiche devient client pour un bouton
"use client";
export function ProductPage() { /* titre, specs, avis, bouton */ }

// Bon : la page reste serveur, seule la feuille est client
export default async function ProductPage() {
  return (
    <>
      <Specs product={product} />      {/* serveur, 0 JS */}
      <Reviews productId={product.id} /> {/* serveur */}
      <AddToCart productId={product.id} price={product.price} />
    </>
  );
}
```

Le coût d'une frontière trop haute : plus de JS à télécharger et à exécuter sur mobile (INP, chapitre 6), et du contenu qui n'est plus calculé côté serveur.

## Sérialisation des props

Les props passées d'un Server Component à un Client Component voyagent dans le RSC Payload. Elles doivent être **sérialisables par React** :

| Passe | Ne passe pas |
| --- | --- |
| string, number, boolean, `null`, `undefined` | fonctions classiques (callbacks) |
| tableaux et objets simples | instances de classe (`new Money()`), méthodes perdues |
| `Date`, `Map`, `Set`, `BigInt`, typed arrays | symboles non globaux |
| éléments JSX (`<Specs />`) | une connexion, un client HTTP |
| Promises (lues avec `use()` côté client) | |
| Server Functions (`"use server"`) | |

```tsx
// Erreur au rendu : une fonction ne se sérialise pas
<AddToCart onAdded={() => console.log("ok")} />

// OK : une Server Action est une référence sérialisable
import { addToCartAction } from "@/actions/cart";
<AddToCart action={addToCartAction} />
```

::: warning Tout ce que tu passes est visible
Les props d'un Client Component sont **dans le HTML** (le payload est inliné dans des `<script>`). Passer l'objet produit complet de l'API pour n'afficher que le prix, c'est publier aussi le prix d'achat, la marge, le stock fournisseur. Passe un **view-model** réduit, construit côté serveur.
:::

```ts
// Construit côté serveur, seul ce qui est affiché
type ProductCard = {
  slug: string;
  name: string;
  priceTtc: number;
  inStock: boolean;
};

function toCard(p: ApiProduct): ProductCard {
  return { slug: p.seo.slug, name: p.name,
    priceTtc: p.priceTtc, inStock: p.stock > 0 };
}
```

## Ce qui part dans le bundle

Pour savoir, ne devine pas : mesure.

```bash
# Next 16 + Turbopack : UI d'analyse du bundle
pnpm next analyze   # "experimental-analyze" sur les 16.x anciennes
# avec webpack : le plugin @next/bundle-analyzer
```

Ce qui gonfle un bundle sans qu'on le voie :

- un **barrel** (`index.ts` qui réexporte tout un dossier) importé depuis un fichier client : selon le bundler et les side effects, tu tires des modules dont tu n'as pas besoin, parfois du code serveur ;
- une lib de validation ou de dates importée dans un composant client pour une seule fonction ;
- un composant client qui importe un composant « juste visuel » lui-même lourd (carte, éditeur, graphe).

::: tip Barrels côté client
Pratique réelle d'une boutique : les composants client importent les modules **par leur fichier** (`@/common/i18n/format`), jamais par un barrel qui mélange du pur et du serveur. Un seul import de barrel a suffi à charger une vingtaine de modules client inutiles sur toutes les pages.
:::

## `server-only` : empêcher la fuite à la compilation

Un module qui lit un secret ou des cookies ne doit jamais être importé dans le graphe client. Si ça arrive, au mieux il plante dans le navigateur, au pire il embarque une constante sensible.

```ts
// common/payment/gateway.ts
import "server-only";

export class PaymentGateway {
  constructor(private readonly apiSecret: string) {}
  // ...
}
```

Le mécanisme : le package `server-only` est résolu différemment selon la « condition » d'export. Dans le graphe client, Next le fait **échouer au build** avec un message explicite. Next gère ce module en interne (l'installer est optionnel, sauf si ton linter râle sur une dépendance non déclarée). Son symétrique `client-only` protège un module qui touche `window`.

Coût : quasi nul. Alternative plus simple : faire confiance aux conventions de nommage. Elle tient jusqu'au premier refactor fait vite.

::: info Et les variables d'environnement ?
Côté client, seules les `NEXT_PUBLIC_*` existent : elles sont **inlinées au build**. Une variable sans préfixe vaut `undefined` dans le navigateur. Détails au [chapitre 7](/dev/nextjs/07-securite-nextjs).
:::

## Hydratation et hydration mismatch

À l'hydratation, React rejoue le rendu des Client Components dans le navigateur et **compare** avec le HTML reçu. S'ils diffèrent, React lève une erreur d'hydratation (en dev, l'overlay te montre le diff) et, selon le cas, re-rend côté client tout le sous-arbre : flash visuel, travail perdu.

Causes classiques :

```tsx
"use client";
// 1. Valeur qui change entre serveur et client
<p>Mis à jour à {new Date().toLocaleTimeString()}</p>

// 2. Lecture du navigateur au rendu
<p>{typeof window !== "undefined" ? "client" : "serveur"}</p>

// 3. localStorage pendant le rendu (panier invité)
const count = JSON.parse(localStorage.getItem("cart") ?? "[]").length;
```

Autres sources : HTML invalide (`<div>` dans un `<p>`), formatage `Intl` qui dépend du fuseau ou de la locale du serveur, extensions de navigateur qui modifient le DOM.

Corrections :

```tsx
"use client";
import { useEffect, useState } from "react";

export function CartBadge() {
  // Même valeur au serveur et au 1er rendu client : 0
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(readLocalCart().length); // après hydratation
  }, []);
  return <span aria-label="Articles">{count}</span>;
}
```

- Une valeur qui ne dépend que du navigateur se lit **après** l'hydratation (`useEffect`), ou le composant est chargé sans SSR (`dynamic(..., { ssr: false })`, chapitre 6).
- Une date : formate-la **côté serveur** avec un fuseau explicite (`timeZone: "Europe/Paris"`), et passe la chaîne.
- `suppressHydrationWarning` sur un élément : dernier recours, pour un écart attendu d'un seul niveau (un horodatage). Il ne corrige rien, il fait taire.

## Composition : un Server Component en `children` d'un Client

Une règle déroute au début : **un Client Component ne peut pas importer un Server Component** (l'import le ferait basculer client). Mais il peut en **recevoir un en props** : `children` ou un slot.

```tsx
// drawer.tsx
"use client";
import { useState, type ReactNode } from "react";

export function Drawer({ trigger, children }: {
  trigger: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>{trigger}</button>
      {open && <aside>{children}</aside>}
    </>
  );
}
```

```tsx
// header.tsx : Server Component
import { Drawer } from "./drawer";
import { CategoryNav } from "./category-nav"; // serveur, async

export function Header() {
  return (
    <Drawer trigger="Menu">
      <CategoryNav /> {/* rendu sur le serveur, passé tout fait */}
    </Drawer>
  );
}
```

Sous le capot, `<CategoryNav />` est rendu **avant** d'arriver au Drawer : le Drawer reçoit un morceau d'arbre déjà calculé, pas du code. Il peut l'afficher ou non, il ne peut pas le ré-exécuter.

C'est la technique pour garder serveur un gros contenu (menu catalogue, specs, FAQ) dans un conteneur interactif (drawer, onglets, accordéon).

::: tip Et sans JS du tout
Pour ouvrir/fermer, `<details>`/`<summary>` ou un `:hover` CSS évitent même le Client Component. Un mega-menu en CSS pur coûte 0 octet de JS.
:::

## Context et providers

Un contexte React est client. Le pattern : un provider client fin, placé dans un layout serveur, qui reçoit le reste en `children`.

```tsx
// app/layout.tsx : serveur
import { CartProvider } from "@/components/cart/cart-provider";

export default function RootLayout({ children }: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}
```

`children` reste serveur : le provider n'en fait pas des Client Components. Seuls les composants qui **lisent** le contexte (`useContext`) sont client.

## Cas réel

**La fiche produit d'une boutique de pièces moto.** Elle doit charger vite sur mobile, être lisible par Google et par les crawlers IA (qui n'exécutent souvent pas le JS), et proposer un panier.

- Page, titre, prix, specs (`<dl>`), compatibilités véhicules, FAQ, JSON-LD : **Server Components**. Tout le contenu décisif est dans le HTML initial.
- Le panneau d'achat (quantité, ajout au panier, choix d'une variante) : **un** Client Component `purchase-panel.tsx`, qui reçoit un view-model réduit (prix TTC, stock, id).
- La galerie : Server Component pour les images, avec une feuille client minuscule pour la loupe.
- Le header : serveur, mega-menu en CSS, seuls le bouton panier et le drawer mobile sont client. Le drawer reçoit la navigation déjà rendue en `children`.
- Le badge du panier lit `localStorage` dans un `useEffect` : zéro mismatch, le chiffre apparaît après hydratation.
- `common/payment/*` et la session importent `server-only` : un import accidentel depuis un composant client casse le build, pas la prod.

Résultat : quelques dizaines de Ko de JS par page au lieu de centaines, et un HTML complet pour les robots.

## Pièges classiques

- Mettre `"use client"` en haut d'une page « parce que ça plantait » : tu perds l'accès serveur et tu envoies tout au navigateur. Cherche le hook ou l'événement qui l'impose et isole-le dans une feuille.
- Passer une fonction en prop à un Client Component depuis un Server Component : erreur de sérialisation. Passe une Server Action ou déplace la logique.
- Passer l'objet API complet à un Client Component : fuite de champs internes dans le HTML.
- Importer un barrel serveur depuis un composant client.
- Lire `localStorage`, `window` ou `Date.now()` pendant le rendu d'un Client Component : hydration mismatch.
- Croire qu'un Client Component ne s'exécute que dans le navigateur : il est aussi rendu côté serveur (SSR). `window` y est `undefined`.
- Question d'entretien : « Quelle différence entre SSR et Server Components ? » : le SSR rend du HTML puis renvoie tout le code pour hydrater ; un Server Component ne renvoie jamais son code, seul son résultat sérialisé.
- Question d'entretien : « Comment afficher un composant serveur dans une modale client ? » : en le passant en `children` (composition), pas en l'important.
- Question d'entretien : « Qu'est-ce qui cause une erreur d'hydratation ? » : un rendu client initial différent du HTML serveur (date, `window`, `localStorage`, HTML invalide, extension).

## Défis

### 1. Où est la frontière ?

Une page catégorie affiche : un titre, une liste de 48 produits, un sélecteur de tri, un bouton « Charger plus », une FAQ. Quels composants sont client ?

::: details Solution
Le sélecteur de tri et le bouton « Charger plus » (événements, état). Titre, cartes produit, FAQ : serveur. Encore mieux : le tri peut être un lien ou un `<form method="get">` qui change `?sort=` dans l'URL, et la page serveur relit `searchParams`. Plus de JS du tout, et le tri devient partageable. Coût : un aller-retour serveur à chaque tri.
:::

### 2. Trouve le bug

```tsx
"use client";
export function Price({ cents }: { cents: number }) {
  const fmt = new Intl.NumberFormat(undefined,
    { style: "currency", currency: "EUR" });
  return <span>{fmt.format(cents / 100)}</span>;
}
```

::: details Solution
`undefined` = la locale de l'environnement. Le serveur (souvent `en-US` dans un conteneur) rend `€12.90`, le navigateur français rend `12,90 €` : mismatch. Fixe la locale (`"fr-FR"`, ou la locale de la route) et, mieux, formate côté serveur avec un seul helper.
:::

### 3. Composition

Tu as un composant client `<Tabs>` et trois onglets dont le contenu est lourd et serveur (specs, compatibilités, avis). Comment les garder serveur ?

::: details Solution
Passe-les en props :

```tsx
const panels = {
  specs: <Specs />,
  compat: <Compat />,
  reviews: <Reviews />,
};
<Tabs panels={panels} />;
```

Ils sont rendus côté serveur et transmis déjà calculés ; `Tabs` choisit lequel afficher. Coût : les trois sont rendus et envoyés même si un seul est vu. Si un onglet est très lourd, charge-le à la demande (route ou Suspense).
:::

### 4. Qu'est-ce qui fuit ?

```tsx
const product = await api.getProduct(slug); // 40 champs
return <PurchasePanel product={product} />; // client
```

::: details Solution
Les 40 champs sont sérialisés dans le HTML, y compris ce que tu n'affiches pas (prix d'achat, remise fournisseur, notes internes). Construis côté serveur un type `PurchasePanelProps` avec les 4 champs utiles. Bonus : un payload plus petit, donc un HTML plus léger.
:::

## À retenir

- Server Component par défaut : son code ne quitte jamais le serveur, seul son résultat sérialisé voyage.
- `"use client"` = point d'entrée du bundle client ; tout ce qu'il importe suit. Place-le sur les feuilles.
- Props serveur vers client : sérialisables, et **publiques**. Passe des view-models réduits.
- `server-only` transforme une fuite de code serveur en erreur de build.
- Hydration mismatch = premier rendu client différent du HTML ; ce qui dépend du navigateur se lit après hydratation.
- Un Server Component peut vivre dans un Client Component s'il est passé en `children` ou en slot.
