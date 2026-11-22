# SEO technique

Ce que tu vas apprendre : produire les balises `<head>` avec la Metadata API, poser un canonical et des hreflang justes, générer `sitemap.xml` et `robots.txt` depuis le code, injecter du JSON-LD sans ouvrir une faille XSS, distinguer une vraie 404 d'une panne du backend, et garder des slugs stables.

## La Metadata API

Pas de `<head>` écrit à la main : chaque `layout` ou `page` exporte un objet `metadata` (statique) ou une fonction `generateMetadata` (dynamique). Next fusionne du layout racine vers la page.

```tsx
// app/layout.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL!),
  title: { default: "Pièces moto et quad", template: "%s | Acme Moto" },
  openGraph: { siteName: "Acme Moto", locale: "fr_FR" },
};
```

- `metadataBase` : base des URLs relatives (canonical, images Open Graph). Sans elle, Next avertit et les URLs relatives sont fausses.
- `title.template` : chaque page donne son titre court, le layout ajoute la marque. La page ne répète pas « | Acme Moto ».

```tsx
// app/[locale]/(boutique)/products/[slug]/page.tsx
export async function generateMetadata(
  props: PageProps<"/[locale]/products/[slug]">,
): Promise<Metadata> {
  const { locale, slug } = await props.params;
  const product = await getProduct(slug, locale); // React.cache
  if (!product) return { robots: { index: false } };
  return {
    title: product.seoTitle,                 // <= 60 caractères
    description: product.seoDescription,     // <= 160 caractères
    ...localizedMetadata(locale, `/products/${slug}`),
    openGraph: { type: "website", images: [product.ogImage] },
  };
}
```

`generateMetadata` et la page lisent la même donnée : `getProduct` est enveloppé dans `React.cache` pour ne faire qu'un appel ([chapitre 2](/dev/nextjs/02-donnees-et-cache)).

::: info Streaming metadata
Next peut envoyer la page **avant** que `generateMetadata` soit fini et ajouter les balises plus tard dans le flux (Googlebot exécute le JS et les lit). Pour les robots qui ne lisent que le HTML brut (aperçus de liens des réseaux sociaux), Next détecte le User-Agent et attend la metadata avant d'envoyer, pour qu'elle soit dans le `<head>`. Le réglage `htmlLimitedBots` change cette liste ; le défaut suffit presque toujours.
:::

## Canonical

Le canonical dit à Google : « l'URL de référence de ce contenu, c'est celle-ci ». Sans lui, `?utm_source=x`, `?sort=price` ou un slash final créent des doublons qui diluent le signal.

```ts
alternates: {
  canonical: "https://shop.example/produits/kit-chaine-520",
}
```

Règles :

- **Absolu** de préférence, construit depuis une seule source (`SITE_URL`), jamais un domaine en dur.
- **Sans** paramètres de tracking ni de tri. Pour la pagination, chaque page garde son propre canonical (`?page=2` pointe vers `?page=2`, pas vers la page 1).
- **Une seule URL servie** pour un contenu : le canonical n'excuse pas de servir trois variantes ; redirige-les ([chapitre 4](/dev/nextjs/04-routing-app-router)).
- Multi-boutique avec le même produit sur deux domaines : choisis le domaine principal comme canonical, ou assume deux contenus réellement différents.

## hreflang

Pour un site multilingue, `hreflang` relie les versions d'une même page. Il doit être **réciproque** (FR pointe vers EN, EN pointe vers FR) et inclure la page elle-même.

```ts
export function localizedMetadata(locale: Locale, path: string) {
  const languages = Object.fromEntries(
    LOCALES.map((l) => [l, absoluteUrl(path, l)]),
  );
  return {
    alternates: {
      canonical: absoluteUrl(path, locale),
      languages: { ...languages, "x-default": absoluteUrl(path, "fr") },
    },
  };
}
```

Next produit `<link rel="alternate" hreflang="fr" href="...">` pour chaque entrée. `x-default` désigne la version à servir quand aucune langue ne correspond. Un helper **unique** évite qu'une page oublie une langue ou mélange les segments traduits.

## `sitemap.ts` et `robots.ts`

Deux fichiers spéciaux à la racine de `app/`, qui renvoient des objets typés.

```ts
// app/sitemap.ts
import type { MetadataRoute } from "next";

export default async function sitemap()
  : Promise<MetadataRoute.Sitemap> {
  const products = await getSitemapProducts(); // slug + updatedAt
  return products.map((p) => ({
    url: absoluteUrl(`/products/${p.slug}`, "fr"),
    lastModified: p.updatedAt,
    alternates: { languages: {
      en: absoluteUrl(`/products/${p.slug}`, "en"),
    } },
  }));
}
```

- Au-delà de 50 000 URLs (limite du protocole), découpe avec `generateSitemaps()`.
- Un `lastModified` **vrai** (date de modification du produit) aide le crawl ; un `new Date()` sur tout est du bruit.
- Le sitemap ne liste que des URLs **canoniques, indexables, en 200**.

```ts
// app/robots.ts
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/",
      disallow: ["/compte", "/panier", "/checkout", "/api"] }],
    sitemap: `${process.env.SITE_URL}/sitemap.xml`,
  };
}
```

::: warning robots.txt figé au build
Sans donnée dynamique, `robots.ts` est rendu **au build** : `SITE_URL` y est gravée. Si l'image Docker est construite une fois et déployée en préprod puis en prod, la prod sert le robots de la préprod. Passe `SITE_URL` en argument de build par environnement, ou rends le fichier dynamique.
:::

`Disallow` empêche le crawl, pas l'indexation : une page privée doit aussi porter `robots: { index: false, follow: false }` dans sa metadata. Pour les crawlers IA (GPTBot, ClaudeBot, PerplexityBot...), les bloquer ou non est une **décision business** : sur une boutique, être cité par un assistant est un canal d'acquisition.

## JSON-LD

Les données structurées (schema.org) donnent à Google et aux moteurs génératifs des faits non ambigus : prix, disponibilité, fil d'Ariane, FAQ.

```tsx
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: product.name,
  sku: product.sku,
  brand: { "@type": "Brand", name: product.brand },
  offers: {
    "@type": "Offer",
    price: product.priceTtc.toFixed(2),
    priceCurrency: "EUR",
    availability: product.inStock
      ? "https://schema.org/InStock"
      : "https://schema.org/OutOfStock",
    url: absoluteUrl(`/products/${product.slug}`, locale),
  },
};

<script type="application/ld+json"
  dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
```

::: danger `JSON.stringify` n'échappe pas `<`
Un nom de produit scrapé ou un avis client qui contient `</script><script>...` **ferme** ta balise et la suite s'exécute : XSS stocké. Échappe `<` en `<` (le JSON reste valide et identique une fois parsé) :

```ts
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
```
:::

Règles :

- Le JSON-LD doit **correspondre au contenu visible**. Un prix qui diffère de la page est pire que pas de JSON-LD.
- Un nœud par entité : si un composant d'avis émet déjà `AggregateRating`, ne le duplique pas dans le nœud `Product`.
- Teste avec l'outil de test des résultats enrichis de Google.

## 404 ou panne ? Ne désindexe pas sur une panne

Le piège le plus coûteux en SEO technique. Une fiche produit charge la donnée ; le backend répond :

| Cas | Ce que tu dois rendre | Pourquoi |
| --- | --- | --- |
| 200 avec produit | la page | normal |
| 404 du backend | `notFound()` (404 + noindex) | le produit n'existe pas |
| 5xx, 429, timeout, réseau | **lever** (500) ou garder la version ISR | panne temporaire |

Le réflexe naïf, « pas de produit → `notFound()` », transforme une panne de 10 minutes en **404 noindex** sur tout le catalogue visité pendant la panne. Google désindexe, et le trafic met des semaines à revenir.

```ts
export class BackendUnavailableError extends Error {}

const isOutage = (status?: number) =>
  status === undefined || status === 429 || status >= 500;

export const getProduct = cache(async (slug: string) => {
  const res = await getPublicApi().productBySlug(slug);
  if (res.success) return toDetail(res.data);
  if (isOutage(res.statusCode)) {
    throw new BackendUnavailableError(`product ${slug}`);
  }
  return null; // vrai 4xx : la page fera notFound()
});
```

Quand la lecture **lève** pendant une régénération ISR, Next garde la dernière version servie (le visiteur ne voit rien). Sans version en cache, il rend une 500 via `error.tsx` : Google réessaiera plus tard, sans désindexer.

Ce traitement est réservé aux lectures qui **décident si la page existe**. Les listes et la navigation restent résilientes : backend en panne = liste vide, page servie.

## Slugs stables

Une URL est un actif : elle accumule des liens et du classement. La changer, c'est repartir de zéro.

- **Déterministe** : le slug se calcule depuis des données stables (nom normalisé, référence), par du code. Jamais par une IA (deux générations = deux slugs différents).
- **Lisible** : minuscules, tirets, mots-clés, pas d'id numérique nu.
- **Unique** : en cas de collision, suffixe déterministe (`-2`, ou la référence).
- **Changement = 301** : garde une table ancien slug → nouveau, servie par le proxy.

```ts
export function slugify(input: string): string {
  return input
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
// slugify("Kit chaîne 520 / 15-45") -> "kit-chaine-520-15-45"
```

## Cas réel

**Une boutique de pièces moto, 80 % du trafic par Google.**

- Layout racine : `metadataBase` depuis `SITE_URL`, template de titre, JSON-LD `Organization`.
- Chaque page publique : `generateMetadata` avec titre ≤ 60, description ≤ 160, canonical et hreflang absolus via un helper unique `localizedMetadata(locale, path)`, Open Graph 1200×630.
- Fiche : JSON-LD `Product` + `Offer` dans la page, `BreadcrumbList` émis par le composant fil d'Ariane, `FAQPage` par le composant FAQ. Tout passe par `jsonLdString`.
- Les lectures qui décident de l'existence d'une page (fiche, catégorie, vue éclatée) lèvent `BackendUnavailableError` sur 429/5xx/réseau : pendant une panne, l'ISR sert la dernière version ou une 500, jamais une 404.
- `sitemap.ts` alimenté par un endpoint léger (slug + date de modification), `robots.ts` qui interdit les zones privées et autorise les crawlers IA.
- Les slugs des pièces sont calculés par gabarit déterministe ; l'IA écrit des descriptions, jamais une URL.

## Pièges classiques

- `notFound()` sur toute erreur du backend : désindexation pendant une panne.
- Un canonical relatif sans `metadataBase`, ou qui pointe vers la préprod.
- hreflang non réciproques, ou qui pointent vers des URLs redirigées.
- JSON-LD avec `JSON.stringify` brut sur du contenu tiers : XSS.
- JSON-LD qui contredit la page (prix, stock).
- `robots.txt` gravé au build avec la mauvaise URL.
- Compter sur `Disallow` pour cacher une page privée : il faut aussi `noindex`.
- Slugs générés par une IA ou recalculés à chaque import : URLs instables.
- Un titre qui répète la marque deux fois (template + page).
- Question d'entretien : « Comment gérer une page produit quand l'API est en panne, côté SEO ? » : ne jamais rendre 404/noindex ; lever pour obtenir une 5xx ou garder la version ISR.
- Question d'entretien : « À quoi sert le canonical, à quoi sert hreflang ? » : le canonical désigne l'URL de référence d'un contenu ; hreflang relie les traductions d'une même page.

## Défis

### 1. Le canonical d'une liste

`/categories/freins?page=3&sort=price&utm_source=newsletter`. Quel canonical ?

::: details Solution
`https://shop.example/categories/freins?page=3` : on garde la pagination (contenu différent), on retire le tri (même contenu réordonné) et le tracking. La construction passe par la même fonction que la clé de cache stable ([défi du chapitre 2](/dev/nextjs/02-donnees-et-cache)) avec une liste blanche de paramètres.
:::

### 2. Trouve le bug

```ts
export const getProduct = cache(async (slug: string) => {
  try {
    return await api.productBySlug(slug);
  } catch {
    return null;
  }
});
// page : if (!product) notFound();
```

::: details Solution
Toute erreur (timeout, 503) devient `null` donc 404 noindex. Distingue : 4xx du backend → `null` ; panne (pas de statut, 429, 5xx) → relance une erreur typée. La page laisse remonter l'erreur : ISR garde l'ancienne version, sinon `error.tsx` en 500.
:::

### 3. hreflang

Écris les `alternates` d'une fiche disponible en FR (sans préfixe, segment `produits`) et EN (`/en/products`), domaine `https://shop.example`, slug identique.

::: details Solution
```ts
alternates: {
  canonical: "https://shop.example/produits/kit-520",
  languages: {
    fr: "https://shop.example/produits/kit-520",
    en: "https://shop.example/en/products/kit-520",
    "x-default": "https://shop.example/produits/kit-520",
  },
}
```
Sur la version EN, le canonical devient l'URL EN, les `languages` restent identiques (réciprocité).
:::

### 4. Le JSON-LD piégé

Un avis client contient `Super ! </script><img src=x onerror=alert(1)>`. Que se passe-t-il avec `JSON.stringify` seul, et avec `jsonLdString` ?

::: details Solution
Avec `JSON.stringify`, le HTML voit `</script>` et ferme la balise : la suite est parsée comme du HTML, `onerror` s'exécute (et une CSP qui autorise l'inline ne l'arrête pas). Avec `jsonLdString`, `<` devient `<` : le parseur HTML ne voit plus de balise fermante, et le JSON parsé contient le texte original intact.
:::

## À retenir

- `metadata`/`generateMetadata` par page, `metadataBase` + template de titre dans le layout racine.
- Canonical absolu, sans tracking ; hreflang réciproques via un helper unique.
- `sitemap.ts` et `robots.ts` depuis le code ; attention à ce qui est figé au build.
- JSON-LD exact et échappé (`<` → `<`).
- Vrai 4xx → 404 ; panne → lever (5xx ou version ISR), jamais 404/noindex.
- Slugs déterministes, stables, jamais générés par une IA ; tout changement = 301.
