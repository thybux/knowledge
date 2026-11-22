# Routing App Router

Ce que tu vas apprendre : organiser l'arbre `app/` avec des layouts imbriqués et des route groups, lire des segments dynamiques (`params` est une Promise en 16), utiliser `loading`, `error` et `not-found`, streamer une page avec Suspense, intercepter les requêtes dans `proxy.ts`, et servir des URLs localisées sans contenu dupliqué.

## Le système de fichiers est le routeur

Chaque dossier sous `app/` est un **segment** d'URL. Un segment devient une route quand il contient un `page.tsx`.

```
app/
  layout.tsx              -> <html>, polices, providers
  [locale]/
    layout.tsx            -> langue, dictionnaire
    (boutique)/
      layout.tsx          -> header + footer de la boutique
      page.tsx            -> /
      products/[slug]/
        page.tsx          -> /products/kit-chaine-520
        loading.tsx
      categories/[slug]/page.tsx
      error.tsx
      not-found.tsx
    (prive)/
      layout.tsx          -> noindex, garde de session
      compte/page.tsx     -> /compte
      checkout/page.tsx
  api/search/route.ts     -> route handler GET /api/search
  sitemap.ts, robots.ts
```

Fichiers spéciaux d'un segment : `layout`, `page`, `loading`, `error`, `not-found`, `route` (route handler), `template`, `default`. Tout autre fichier est privé (un dossier `_sections/` préfixé `_` est exclu du routage).

## Layouts imbriqués

Un `layout.tsx` enveloppe toutes les pages en dessous. Les layouts **s'emboîtent** et **persistent** à la navigation : passer de `/products/a` à `/products/b` ne re-rend pas le header, son état client (menu ouvert, recherche) survit.

```tsx
// app/[locale]/(boutique)/layout.tsx
export default async function ShopLayout(
  { children, params }: LayoutProps<"/[locale]">,
) {
  const { locale } = await params;
  return (
    <>
      <Header locale={locale} />
      <main>{children}</main>
      <Footer locale={locale} />
    </>
  );
}
```

`LayoutProps<"/route">` et `PageProps<"/route">` sont des helpers **globaux** générés par Next (pas d'import) : ils typent `params` à partir du chemin réel.

::: warning Un layout n'est pas une garde
Layout et page sont rendus **en parallèle**, pas l'un après l'autre. Un `requireUser()` dans le layout ne bloque pas les `fetch` lancés par la page. La page doit vérifier elle-même, ou la vérification se fait plus tôt (dans `proxy.ts`, au moins pour la présence du cookie), et le backend autorise toujours.
:::

Variante : `template.tsx` a la même place qu'un layout mais est **remonté** à chaque navigation (état réinitialisé). Rarement utile, sauf animation d'entrée ou formulaire à remettre à zéro.

## Route groups : `(nom)`

Un dossier entre parenthèses **n'apparaît pas dans l'URL**. Il sert à donner des layouts différents à des pages du même niveau :

- `(boutique)` : header, footer, pages indexables ;
- `(prive)` : panier, checkout, compte, layout `noindex` et garde de session ;
- `(auth)` : connexion, inscription, layout épuré.

`/compte` et `/produits/x` sont au même niveau d'URL mais ne partagent pas le même chrome. Coût : deux groupes ne peuvent pas définir la même URL (conflit au build).

## Segments dynamiques et `params`

| Dossier | Exemple d'URL | `params` |
| --- | --- | --- |
| `[slug]` | `/products/kit-chaine` | `{ slug: "kit-chaine" }` |
| `[...path]` | `/docs/a/b` | `{ path: ["a", "b"] }` |
| `[[...path]]` | `/docs` ou `/docs/a` | `{ path?: string[] }` |

En Next 16, `params` et `searchParams` sont des **Promise** (l'accès synchrone toléré en 15 a disparu) :

```tsx
export default async function PartsPage(
  props: PageProps<"/[locale]/pieces/[brand]/[year]">,
) {
  const { brand, year } = await props.params;
  const { view } = await props.searchParams;
  if (!/^\d{4}$/.test(year)) notFound();
  // ...
}
```

Pourquoi une Promise : Next peut commencer à rendre ce qui ne dépend pas des params (ou les pré-rendre) avant de les résoudre. Côté client, `useParams()` reste synchrone, et un Client Component qui reçoit `params` en prop le lit avec `use(params)`.

::: tip Valide les params
Un segment dynamique est une **entrée utilisateur**. Avant d'appeler l'API, passe le slug dans un motif strict (`/^[a-z0-9-]{1,255}$/`) : une URL forgée ne doit pas devenir une requête bizarre vers ton backend.
:::

## `loading`, `error`, `not-found`

```
products/[slug]/
  loading.tsx    -> <Suspense fallback> autour de la page
  error.tsx      -> error boundary autour de la page
  not-found.tsx  -> rendu par notFound()
```

`loading.tsx` est du sucre pour un `<Suspense>` : Next enveloppe la page dedans, et le squelette s'affiche **instantanément** à la navigation pendant que la page charge.

`error.tsx` est un **Client Component** (une error boundary React) :

```tsx
"use client";

export default function ProductError({ error, retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <section>
      <h2>Cette page n'a pas pu se charger.</h2>
      <button onClick={() => retry()}>Réessayer</button>
    </section>
  );
}
```

- `retry()` (stable depuis 16.3) re-récupère et re-rend le segment ; `reset()` existe toujours mais re-rend **sans** re-récupérer les données. Sur une version 16 antérieure, seul `reset` existe.
- `error.tsx` est rendu **sous** le layout du même dossier : le header reste. Une erreur du layout lui-même remonte au `error.tsx` du parent ; le dernier filet est `app/global-error.tsx`, qui remplace `<html>`.
- En prod, `error.message` d'une erreur serveur est remplacé par un texte générique ; utilise `digest` pour retrouver la trace dans les logs.

`notFound()` lève une erreur de contrôle et rend le `not-found.tsx` le plus proche.

## Streaming avec Suspense

Sans streaming, le serveur attend **toutes** les données avant d'envoyer un octet. Avec, il envoie la coquille tout de suite et complète au fil de l'eau.

```tsx
import { Suspense } from "react";

export default async function ProductPage(
  props: PageProps<"/[locale]/products/[slug]">,
) {
  const { slug } = await props.params;
  const product = await getProduct(slug); // essentiel : on attend
  if (!product) notFound();
  return (
    <>
      <ProductHero product={product} />
      <Suspense fallback={<ReviewsSkeleton />}>
        <Reviews productId={product.id} /> {/* lent : streamé */}
      </Suspense>
    </>
  );
}
```

Mécanisme : la réponse HTTP est un flux. React envoie le HTML de la coquille avec le fallback, garde la connexion ouverte, puis envoie un fragment HTML + un petit script qui remplace le fallback quand `Reviews` est prêt. Le navigateur affiche le haut de page (et le LCP) sans attendre les avis.

::: warning Le statut HTTP part avec le premier octet
Une réponse streamée commence en **200**. Si un `notFound()` est appelé **après** le début du flux (dans un composant sous un `Suspense` ou après un `loading.tsx`), Next ne peut plus changer le statut : il insère `<meta name="robots" content="noindex">`, et certains outils y verront un « soft 404 ». Les vérifications qui décident du statut (la fiche existe-t-elle ?) se font **avant** toute frontière Suspense, dans la page elle-même.
:::

À noter : un `loading.tsx` dans le dossier démarre le flux avant la page. Si la page doit pouvoir rendre un vrai 404, fais l'existence check le plus tôt possible et vérifie le statut obtenu (`curl -I`).

## Route handlers

`route.ts` expose une API HTTP classique (`GET`, `POST`...) sans UI : autocomplétion de recherche, relais d'un PDF de facture, webhook, `llms.txt`.

```ts
// app/api/search/suggest/route.ts
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (q.length < 2 || q.length > 64) return Response.json([]);
  const items = await getPublicApi().suggest(q);
  return Response.json(items);
}
```

Pas de memoization des `fetch` dans un route handler (il n'est pas dans l'arbre React). Pour une mutation appelée depuis l'UI, préfère une Server Action ; un route handler sert les appels hors React (formulaire HTML simple, service externe, téléchargement).

## `proxy.ts` (ex-middleware)

En Next 16, `middleware.ts` est **renommé** `proxy.ts` (l'ancien nom est déprécié). Il s'exécute **avant** le routage, sur chaque requête qui matche, et peut rediriger, réécrire, poser des en-têtes ou répondre directement. Il tourne sur **Node.js** par défaut (l'option `runtime` n'y est plus acceptée).

```ts
// proxy.ts (racine du projet)
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/compte")
      && !request.cookies.has("access_token")) {
    const url = new URL("/connexion", request.url);
    url.searchParams.set("suite", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|api/|.*\\.[a-z0-9]+$).*)"],
};
```

Règles :

- **Rapide** : il est sur le chemin de chaque page. Pas d'appel lourd au backend, pas de rendu.
- **Présence, pas validité** : vérifier qu'un cookie existe évite des allers-retours inutiles, mais la vraie vérification reste côté serveur (page + backend).
- Un `matcher` qui exclut `_next`, les assets et ce qui n'a pas besoin du proxy.
- Pour communiquer avec la page : en-têtes de requête, cookies, rewrite. Pas de variables globales partagées.

Usages typiques : langue, redirections d'URL canoniques, garde de présence de session, rotation silencieuse du jeton, anti-scraping de premier niveau, page de maintenance, nonce CSP.

## URLs localisées : segment `[locale]`

Pattern : toutes les pages vivent sous `app/[locale]/`. Le layout de langue vérifie la locale :

```tsx
// app/[locale]/layout.tsx
export function generateStaticParams() {
  return [{ locale: "fr" }, { locale: "en" }];
}

export default async function LocaleLayout(
  { children, params }: LayoutProps<"/[locale]">,
) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <LocaleProvider locale={locale}>{children}</LocaleProvider>;
}
```

Deux choix d'URL à faire, et à figer :

| Choix | Option A | Option B |
| --- | --- | --- |
| Langue par défaut | préfixée (`/fr/...`) | sans préfixe (`/...`) |
| Segments traduits | non (`/en/products`) | oui (`/produits`, `/en/products`) |

Avec la langue par défaut sans préfixe et des segments traduits, le proxy fait la traduction **URL publique → dossier** :

```ts
// /produits/kit -> rewrite interne vers /fr/products/kit
// /en/products/kit -> /en/products/kit (rien à faire)
// /fr/produits/kit -> 308 vers /produits/kit (une seule URL)
// /en/produits/kit -> 301 vers /en/products/kit
```

Une **table unique** dossier → segment par langue, lue par le proxy (sens public → dossier) et par le helper de liens (sens dossier → public). Le code écrit toujours le dossier (`/products/x`) et passe par `localeHref(path, locale)`. Toute variante non canonique est **redirigée**, jamais servie : deux URLs pour un même contenu, c'est du contenu dupliqué pour Google.

::: tip Rewrite vs redirect
Un **rewrite** sert le contenu d'un autre chemin sans changer l'URL du navigateur (invisible). Un **redirect** renvoie une 301/308 et le navigateur change d'URL (visible, et Google transfère le signal). On réécrit pour mapper l'URL publique sur l'arbre de fichiers ; on redirige pour éliminer les doublons.
:::

## Parallel et intercepting routes, en bref

- **Parallel routes** (`@slot/`) : plusieurs pages rendues en même temps dans un layout (un tableau de bord avec `@stats` et `@orders`), chacune avec son propre `loading`/`error`.
- **Intercepting routes** (`(.)photo/[id]`) : ouvrir une page dans une modale lors d'une navigation interne, tout en gardant une vraie page sur accès direct (galerie, aperçu produit).

Puissants, mais ils compliquent l'arbre. Ne les sors que pour un vrai besoin.

## Cas réel

**L'arbre d'une boutique bilingue de pièces moto.**

- `app/[locale]/` avec trois route groups : `(boutique)` indexable, `(prive)` en `noindex` avec garde de session, `(auth)`.
- Français sans préfixe, anglais sous `/en`, segments traduits (`/pieces` et `/en/spare-parts`). Une table `ROUTE_SEGMENTS` unique sert au proxy et aux liens.
- `proxy.ts` enchaîne des étapes dans un ordre contractuel : maintenance → anti-scraping → rotation de session → garde de présence sur `/compte` → langue. Chaque étape rend une réponse ou passe.
- Les pièces détachées : `pieces/[brand]/[year]/[model]/[view]`. Chaque niveau valide son param (motif de slug, année sur 4 chiffres) avant d'appeler l'API.
- `error.tsx` sous `(boutique)` garde le header et propose « Réessayer » ; sous `(prive)`, il renvoie vers le tableau de bord du compte.
- La fiche produit vérifie l'existence avant toute frontière Suspense, puis streame les avis et les produits associés.

## Pièges classiques

- Lire `params.slug` sans `await` : en 16, `params` est une Promise.
- Croire qu'un `redirect` dans un layout protège la page : layout et page se rendent en parallèle.
- Un `loading.tsx` qui démarre le flux avant le `notFound()` : 200 + noindex au lieu d'un vrai 404.
- Logique lourde (appel API complet) dans `proxy.ts` : chaque page paie la latence.
- Créer `middleware.ts` sur un projet Next 16 : déprécié, renomme en `proxy.ts` (fonction exportée `proxy`).
- Servir la même page sur `/fr/produits/x` et `/produits/x` sans redirection : contenu dupliqué.
- Liens écrits en dur (`href="/produits/x"`) au lieu de passer par le helper de liens localisés.
- Question d'entretien : « Différence entre layout et template ? » : le layout persiste entre navigations (état conservé), le template est remonté à chaque fois.
- Question d'entretien : « Comment le streaming améliore-t-il le temps de chargement perçu ? » : la coquille et le contenu essentiel partent tout de suite, les parties lentes arrivent ensuite dans la même réponse HTTP.

## Défis

### 1. Dessine l'arbre

Tu dois servir `/compte/commandes/[id]` avec un layout « compte » (menu latéral), en `noindex`, sans le header marketing de la boutique, mais sous la même langue. Où vont les fichiers ?

::: details Solution
`app/[locale]/(prive)/layout.tsx` (noindex, sans header marketing) puis `app/[locale]/(prive)/compte/layout.tsx` (menu latéral) et `app/[locale]/(prive)/compte/commandes/[id]/page.tsx`. La page valide `id` (entier positif) et relit la session ; le backend vérifie que la commande appartient au client et renvoie 404 sinon.
:::

### 2. Le 404 qui n'en est pas un

`curl -I /produits/n-existe-pas` renvoie `200`. La page appelle `notFound()` et le HTML contient bien `noindex`. Pourquoi, et comment obtenir un vrai 404 ?

::: details Solution
Le flux a démarré avant le `notFound()` : un `loading.tsx` dans le dossier, ou un `Suspense` au-dessus de la lecture du produit. Le statut est figé à 200. Fais la lecture du produit et le `notFound()` en tête de la page, sans frontière Suspense au-dessus, et retire le `loading.tsx` si nécessaire (ou accepte le 200 + noindex en connaissant le compromis). Vérifie avec `curl -I` sur un build de prod.
:::

### 3. Rewrite ou redirect ?

Pour chaque URL, que fait le proxy ? (a) `/en/brands/acme` ; (b) `/marques/acme` ; (c) `/fr/marques/acme` ; (d) `/en/marques/acme`. Le dossier s'appelle `marques/`, le français est sans préfixe, l'anglais traduit en `brands`.

::: details Solution
(a) rewrite interne vers `/en/marques/acme`. (b) rewrite vers `/fr/marques/acme`. (c) 308 vers `/marques/acme` (préfixe de la langue par défaut). (d) 301 vers `/en/brands/acme` (mauvais segment pour la langue). Seules (a) et (b) sont des URLs canoniques servies.
:::

### 4. Que streamer ?

Fiche produit : titre/prix/photo (API produit, 80 ms), stock en temps réel (API stock, 300 ms), avis (API avis, 600 ms), « souvent achetés ensemble » (moteur de reco, 900 ms). Qu'attends-tu avant d'envoyer, que streames-tu ?

::: details Solution
On attend l'API produit (elle décide du 404, du titre, du LCP). Le reste en `Suspense` séparés : stock, avis, reco. Le stock est un cas limite : s'il est décisif pour le SEO (disponibilité dans le JSON-LD), mieux vaut la valeur en cache de l'API produit dans la page et le stock temps réel en îlot client ou streamé.
:::

## À retenir

- Un dossier = un segment ; `page.tsx` le rend routable ; les layouts s'emboîtent et persistent.
- Route groups `(nom)` : des layouts différents sans changer l'URL.
- `params` et `searchParams` sont des Promise en 16 ; `PageProps<"/route">` les type ; valide-les comme des entrées utilisateur.
- `loading` = Suspense, `error` = error boundary client (`retry`), `not-found` via `notFound()`.
- Le streaming envoie la coquille tout de suite, mais fige le statut à 200 : décide du 404 avant.
- `proxy.ts` remplace `middleware.ts` : rapide, présence et non validité, une seule URL canonique par contenu.
