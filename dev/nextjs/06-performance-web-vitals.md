# Performance et Web Vitals

Ce que tu vas apprendre : ce que mesurent LCP, INP et CLS et un levier concret pour chacun, bien utiliser `next/image` et `next/font`, charger un composant lourd seulement quand il sert avec `dynamic()`, tenir un budget de bundle, et utiliser le streaming pour afficher plus tôt.

## Les trois Core Web Vitals

Google les mesure **chez de vrais visiteurs** (données terrain, Chrome UX Report), au **75e percentile**, et en tient compte dans le classement. Sur une boutique dont le trafic est surtout mobile, c'est le téléphone moyen en 4G qui compte, pas ton MacBook en fibre.

| Métrique | Mesure | Bon | Cause n°1 |
| --- | --- | --- | --- |
| **LCP** (Largest Contentful Paint) | quand le plus gros élément visible est affiché | ≤ 2,5 s | image principale découverte tard ou trop lourde |
| **INP** (Interaction to Next Paint) | délai entre une interaction et l'image suivante | ≤ 200 ms | trop de JS sur le thread principal |
| **CLS** (Cumulative Layout Shift) | sauts de mise en page inattendus | ≤ 0,1 | image ou bloc sans taille réservée, police qui change |

Lighthouse en local donne des données **de labo** : utile pour diagnostiquer, pas pour conclure. Mesure aussi le terrain :

```tsx
// app/_components/web-vitals.tsx
"use client";
import { useReportWebVitals } from "next/web-vitals";

const report = (metric: { name: string; value: number }) => {
  navigator.sendBeacon("/api/beacon", JSON.stringify(metric));
};

export function WebVitals() {
  useReportWebVitals(report); // référence stable : pas de doublons
  return null;
}
```

## LCP : faire arriver l'image principale tôt

Sur une fiche produit, le LCP est presque toujours la **photo principale**. Elle doit être découverte dans le HTML initial (pas après hydratation), en priorité haute, à la bonne taille.

```tsx
import Image from "next/image";

<Image
  src={product.cover}
  alt={`${product.name} ${product.brand}`}
  width={800}
  height={800}
  sizes="(min-width: 1024px) 50vw, 100vw"
  preload
/>
```

- `preload` (Next 16) insère un `<link rel="preload">` dans le `<head>` : le navigateur la demande avant même d'avoir parsé le `<body>`. Il **remplace `priority`**, déprécié en 16. Pour une image LCP qui peut varier selon l'écran (deux visuels, mobile et desktop), préfère `fetchPriority="high"` ou `loading="eager"` sans `preload`.
- Une seule image en `preload` par page : si tout est prioritaire, rien ne l'est.
- **Jamais** l'image LCP en lazy-loading (le défaut de `next/image` est `loading="lazy"`).
- Le LCP dépend aussi du **TTFB** : une page ISR servie depuis le cache part en quelques ms ; une page dynamique attend tous ses `await`. D'où l'intérêt de garder le catalogue statique ([chapitre 2](/dev/nextjs/02-donnees-et-cache)).

## `next/image` : tailles et formats

`next/image` génère un `srcset` (plusieurs largeurs), sert de l'AVIF/WebP selon le navigateur, et réserve la place de l'image.

`sizes` est l'attribut le plus mal compris. Il dit au navigateur **quelle largeur l'image occupera à l'écran**, pour qu'il choisisse le bon fichier dans le `srcset` *avant* d'avoir calculé la mise en page.

```tsx
// Grille : 2 colonnes sur mobile, 4 au-delà de 1024 px
<Image src={p.image} alt={p.name} width={400} height={400}
  sizes="(min-width: 1024px) 25vw, 50vw" />
```

Sans `sizes` sur une image responsive, le navigateur suppose `100vw` : un mobile télécharge une image deux fois trop large pour une vignette.

Réglages de `next.config.ts` à connaître :

```ts
images: {
  remotePatterns: [{ protocol: "https",
    hostname: "cdn.shop.example" }], // liste blanche
  qualities: [75], // défaut en 16 : une seule qualité autorisée
},
```

Le coût : l'optimisation tourne **sur ton serveur** Next (CPU, cache disque) à la première demande de chaque taille. En auto-hébergé avec beaucoup d'images, surveille le CPU, ou délègue à un CDN d'images via un `loader`.

## CLS : réserver la place

Un saut de mise en page arrive quand un élément apparaît ou change de taille **après** le premier rendu et pousse le reste.

```tsx
// Mauvais : hauteur inconnue jusqu'au chargement
<img src={banner} alt="" style={{ width: "100%" }} />

// Bon : ratio réservé
<Image src={banner} alt="" width={1200} height={400}
  sizes="100vw" style={{ width: "100%", height: "auto" }} />
```

Les autres sources fréquentes :

- une bannière cookies ou promo injectée **au-dessus** du contenu après hydratation : mets-la en `position: fixed` en bas, ou réserve sa place ;
- un squelette (`loading.tsx`) de taille différente du contenu final ;
- un bloc qui dépend d'un `useEffect` (badge, prix « pro ») sans place réservée ;
- les **polices web**.

## `next/font` : polices sans saut

```tsx
// app/layout.tsx
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export default function RootLayout({ children }: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
```

Sous le capot :

- la police est **téléchargée au build et servie depuis ton domaine** : pas de requête vers un tiers au runtime (performance et vie privée) ;
- Next génère une police de repli **ajustée** (`size-adjust`, métriques ascent/descent) pour que le texte affiché avant chargement occupe la même place : le `swap` ne fait presque plus sauter la page ;
- seuls les sous-ensembles demandés sont inclus.

Charge-la **une fois** dans le layout racine et expose-la en variable CSS. Une police instanciée dans plusieurs fichiers est dupliquée.

## INP : moins de JS, moins de travail par interaction

L'INP mesure le pire délai entre un clic/une frappe et la mise à jour visible. Il se dégrade quand le thread principal est occupé : hydratation d'un gros arbre, handler qui recalcule une longue liste, script tiers.

Leviers, du plus rentable au plus fin :

1. **Moins de Client Components** : ce qui reste serveur n'est ni téléchargé, ni hydraté ([chapitre 1](/dev/nextjs/01-server-et-client-components)).
2. **Scripts tiers** différés : analytics, chat, A/B test chargés après l'interactivité, et seulement après consentement.
3. **Mises à jour non urgentes** en transition : React peut interrompre un rendu lourd pour traiter la frappe suivante.

```tsx
"use client";
const [query, setQuery] = useState("");
const [filter, setFilter] = useState("");
const [, startTransition] = useTransition();

<input value={query} onChange={(e) => {
  setQuery(e.target.value);          // urgent : le champ
  startTransition(() =>
    setFilter(e.target.value));      // non urgent : la liste
}} />
```

```tsx
import Script from "next/script";
// chargé quand le navigateur est inactif
<Script src="https://widget.example/chat.js" strategy="lazyOnload" />
```

Les optimisations React (memo, React Compiler) sont dans [React en TypeScript](/dev/typescript/10-frontend-react).

## `dynamic()` : charger un composant lourd à la demande

Une carte interactive (points relais), un éditeur riche, un graphe : des centaines de Ko de JS, utiles à une minorité de visiteurs ou plus bas dans la page.

```tsx
// relay-point-picker.tsx
"use client";
import dynamic from "next/dynamic";

const RelayMap = dynamic(
  () => import("./relay-point-map").then((m) => m.RelayPointMap),
  { ssr: false, loading: () => <MapPlaceholder /> },
);

export function RelayPointPicker({ points }: { points: RelayPoint[] }) {
  const [showMap, setShowMap] = useState(false);
  return showMap
    ? <RelayMap points={points} />
    : <button onClick={() => setShowMap(true)}>Voir la carte</button>;
}
```

Mécanisme : `dynamic()` crée un **chunk JS séparé**, téléchargé seulement quand le composant est rendu. `ssr: false` le saute aussi au rendu serveur (utile pour une lib qui touche `window` au chargement).

Contraintes et coûts :

- `ssr: false` n'est accepté que dans un **Client Component** (erreur dans un Server Component).
- Le contenu n'est pas dans le HTML initial : **jamais** pour du contenu important pour le SEO.
- Un chargement différé = une attente au clic. Le `loading` doit avoir la taille finale (CLS).
- Alternative plus simple : si le composant est en bas de page mais toujours affiché, un import normal suffit souvent ; `dynamic()` brille quand le composant est **conditionnel**.

## Budget de bundle

Un budget transforme « le site est lent » en règle vérifiable : par exemple, **≤ 150 Ko de JS compressé** chargé sur la fiche produit.

Comment le tenir :

- Mesure avec l'analyseur de bundle (`next analyze` avec Turbopack) et la colonne « First Load JS » de `next build`.
- Regarde ce que coûte une dépendance **avant** de l'ajouter (taille compressée, tree-shaking).
- Importe les fonctions, pas les barrels : `import { format } from "date-fns"` plutôt qu'une lib entière ; et côté client, jamais un barrel qui mélange serveur et pur.
- Une lib de validation dans le bundle d'une page catalogue publique est rarement justifiée : valide côté serveur.

## Streaming : afficher plus tôt

Le streaming ([chapitre 4](/dev/nextjs/04-routing-app-router)) ne rend pas le serveur plus rapide, il **réordonne** : le haut de page et le LCP partent sans attendre les parties lentes.

```tsx
<ProductHero product={product} />          {/* LCP, tout de suite */}
<Suspense fallback={<RelatedSkeleton />}>
  <RelatedProducts productId={product.id} /> {/* 900 ms */}
</Suspense>
```

Sans `Suspense`, le LCP attend la requête la plus lente de la page.

## Cas réel

**La fiche produit mobile d'une boutique de pièces moto, de 4,1 s à 1,9 s de LCP.**

- Diagnostic terrain : LCP 4,1 s au p75, la photo principale était chargée en lazy par un carrousel client et téléchargée en 1600 px sur mobile.
- La première photo est rendue par le serveur avec `next/image`, `preload` et `sizes="(min-width: 1024px) 50vw, 100vw"` ; le carrousel client ne gère que le swipe.
- La page était dynamique à cause d'un `cookies()` dans le header (prix « pro ») : passée en ISR, le prix pro est demandé après hydratation pour les seuls clients connectés, dans un bloc de hauteur réservée.
- La carte des points relais (une lib de cartographie) est en `dynamic(..., { ssr: false })` dans le tunnel, et chargée au clic sur « Point relais ».
- Les analytics se chargent après consentement, `lazyOnload`.
- Police unique via `next/font`, variable CSS, repli ajusté : CLS de 0,18 à 0,02.
- Budget vérifié en CI sur la sortie de `next build`.

## Pièges classiques

- Juger la performance sur Lighthouse desktop en local.
- Utiliser `priority` en Next 16 (déprécié) ou le mettre sur dix images.
- Image LCP en lazy-loading, ou rendue seulement côté client.
- Oublier `sizes` sur une image responsive : mobile qui télécharge du 1600 px.
- Bannière injectée au-dessus du contenu après hydratation : CLS.
- `dynamic(..., { ssr: false })` sur du contenu SEO, ou dans un Server Component.
- Ajouter une dépendance de 80 Ko pour une fonction.
- Une page dynamique pour un détail personnalisé : le TTFB et donc le LCP en pâtissent.
- Question d'entretien : « Comment améliorer le LCP d'une page produit ? » : rendre l'image côté serveur, la précharger, servir la bonne taille, réduire le TTFB (cache/ISR), streamer le reste.
- Question d'entretien : « Qu'est-ce que l'INP et comment le réduire ? » : le délai entre interaction et rendu suivant ; moins de JS, tâches longues découpées, mises à jour non urgentes en transition, tiers différés.

## Défis

### 1. Le bon `sizes`

Une grille produit : 2 colonnes sous 768 px, 3 colonnes de 768 à 1279 px, 4 colonnes au-delà, avec un conteneur max de 1280 px. Écris `sizes`.

::: details Solution
`sizes="(min-width: 1280px) 320px, (min-width: 768px) 33vw, 50vw"`. Au-delà de 1280 px, le conteneur est plafonné : 1280 / 4 = 320 px fixes. Les media queries sont lues dans l'ordre, la première qui matche gagne.
:::

### 2. Diagnostique le CLS

CLS terrain de 0,25 sur la home. Le HTML initial est complet. Après hydratation, un bandeau « Livraison offerte dès 100 EUR » apparaît en haut, et le prix des cartes passe de « 12 EUR » à « 12,00 EUR ». Que corriger ?

::: details Solution
Le bandeau : le rendre côté serveur (il ne dépend de rien de personnel), ou le passer en `position: fixed`, ou réserver sa hauteur. Le prix : formatage différent serveur/client (mismatch et texte plus large) ; un seul helper de formatage avec locale explicite, appelé côté serveur.
:::

### 3. `dynamic()` ou pas ?

(a) Un éditeur de texte riche dans le back-office, sur la page d'édition produit. (b) Le fil d'Ariane d'une fiche. (c) Un configurateur 3D affiché après clic sur « Voir en 3D ».

::: details Solution
(a) oui, pour alléger les autres pages du back-office (pas d'enjeu SEO, `ssr: false` acceptable). (b) non : contenu SEO, serveur, quasi 0 JS. (c) oui, chargé au clic, `ssr: false`, placeholder à la taille finale.
:::

### 4. Pourquoi l'INP est mauvais ?

Une page catégorie hydrate 48 cartes produit, chacune Client Component avec un bouton « favori » et un survol animé en JS. INP 450 ms.

::: details Solution
48 îlots hydratés et autant de handlers : beaucoup de JS. Cartes en Server Components ; survol en CSS ; le bouton favori seul en Client Component minuscule (ou un seul gestionnaire délégué). Mesure ensuite avec le profiler Performance de Chrome, en throttling CPU 4x.
:::

## À retenir

- LCP, INP, CLS se jugent sur le terrain, au p75, sur mobile.
- LCP : image principale rendue serveur, `preload` (pas `priority` en 16), `sizes` juste, TTFB bas grâce au cache.
- CLS : place réservée pour images, bannières et contenu tardif ; `next/font` pour les polices.
- INP : moins de Client Components, tiers différés, `useTransition` pour le non urgent.
- `dynamic()` pour un composant lourd et conditionnel, jamais pour du contenu SEO ; `ssr: false` seulement côté client.
- Un budget de bundle chiffré et vérifié ; le streaming pour ne pas attendre le plus lent.
