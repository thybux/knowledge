<script setup>
import cacheKey from "./challenges/cache-key";
</script>

# Données et cache

Ce que tu vas apprendre : charger des données côté serveur, distinguer les **quatre niveaux** de cache qui se superposent dans Next, savoir pourquoi une route est statique ou dynamique, revalider proprement après un changement, et éviter le piège du `fetch` qui n'est pas dédoublonné.

## `fetch` côté serveur

Dans un Server Component, tu charges les données directement, sans `useEffect` ni lib client :

```tsx
// app/[locale]/categories/[slug]/page.tsx
export default async function CategoryPage({ params }: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const res = await fetch(`${API}/public/categories/${slug}`, {
    next: { revalidate: 300, tags: ["catalog"] },
  });
  const category: Category = await res.json();
  return <ProductGrid products={category.products} />;
}
```

`fetch` ici est le `fetch` natif, **étendu par Next** : l'option `next` (`revalidate`, `tags`) pilote le cache serveur. Pour une source qui n'est pas `fetch` (ORM, SDK), même résultat avec `unstable_cache` ou, dans le nouveau modèle, `"use cache"` (fin de chapitre).

::: tip Les chargements parallèles
Deux `await` à la suite = deux requêtes en série. Si elles sont indépendantes, lance-les ensemble :

```ts
const [product, reviews] = await Promise.all([
  getProduct(slug), getReviews(slug),
]);
```

Encore mieux pour l'UX : ne pas attendre les avis du tout, et les streamer dans un `<Suspense>` ([chapitre 4](/dev/nextjs/04-routing-app-router)).
:::

## Les niveaux de cache

C'est **la** question d'entretien Next. Quatre mécanismes, quatre durées de vie, à ne pas confondre.

| Niveau | Où | Durée | Ce qui est gardé | Se pilote avec |
| --- | --- | --- | --- | --- |
| Request memoization | serveur, mémoire | **un rendu** | résultat d'un `fetch` GET identique | automatique, `React.cache` |
| Data cache | serveur, disque/handler | entre requêtes | réponse d'un `fetch` | `cache`, `next.revalidate`, `next.tags` |
| Full Route Cache (ISR) | serveur, disque/handler | entre requêtes | HTML + RSC payload d'une route statique | statique vs dynamique, `revalidate` |
| Router cache | navigateur, mémoire | la session | segments RSC déjà visités | `router.refresh()`, revalidation |

Par-dessus, le **cache HTTP** (navigateur, CDN, reverse proxy) qui obéit aux en-têtes `Cache-Control` que Next pose.

### 1. Request memoization

Pendant **un seul rendu**, deux `fetch` GET avec la même URL et les mêmes options ne partent qu'une fois. La page, le layout et `generateMetadata` peuvent donc appeler `getProduct(slug)` chacun de leur côté sans doubler la requête.

C'est une mémoire de rendu, pas un cache : elle disparaît à la fin de la requête.

### 2. Data cache

Persistant entre les requêtes. Depuis Next 15, **un `fetch` n'y entre pas par défaut** : tu dois le demander.

```ts
// Gardé jusqu'à invalidation explicite
fetch(url, { cache: "force-cache" });
// Gardé 300 s, puis stale-while-revalidate
fetch(url, { next: { revalidate: 300 } });
// Jamais gardé
fetch(url, { cache: "no-store" });
```

**Stale-while-revalidate** : passé 300 s, la requête suivante reçoit encore l'ancienne valeur **immédiatement**, et Next relance le `fetch` en arrière-plan. Le visiteur n'attend jamais, la donnée est au pire en retard d'une régénération.

::: warning La clé du data cache contient les en-têtes
L'URL, la méthode, le body **et les en-têtes** de la requête forment la clé. Si tu ajoutes l'IP ou le User-Agent du visiteur à un `fetch` avec `revalidate`, tu crées **une entrée par visiteur** : cache inutile et disque qui gonfle. Les en-têtes propres au visiteur vont sur les appels dynamiques (session, actions), jamais sur une lecture publique mise en cache.
:::

### 3. Full Route Cache et ISR

Une route **statique** est rendue au build (ou à la première visite) et son résultat, HTML + payload RSC, est stocké. Les visites suivantes servent ce résultat sans exécuter tes composants.

L'**ISR** (Incremental Static Regeneration) régénère ce résultat quand la durée expire. La durée de la route est la **plus petite** `revalidate` parmi ses `fetch` et ses segments. Un seul `fetch` à `revalidate: 60` dans le layout fait régénérer toutes les pages en dessous toutes les 60 s.

### 4. Router cache

Côté navigateur, Next garde les segments déjà visités pour que le retour arrière et la navigation soient instantanés. Après une mutation, une Server Action qui revalide met aussi à jour ce cache ; sinon `router.refresh()` le force.

### Le cache HTTP

Next pose des `Cache-Control` adaptés : une page ISR part avec `s-maxage` + `stale-while-revalidate` (un CDN peut la garder), une page dynamique en `private, no-store`. Ne réécris pas ces en-têtes à la main sans savoir ce que fait ton CDN.

::: danger Plusieurs pods = plusieurs caches
En auto-hébergé, le data cache et l'ISR vivent par défaut **sur le disque de chaque instance**. Trois replicas = trois caches, régénérés chacun de leur côté, et un `revalidateTag` qui n'atteint que le pod qui l'a reçu. Pour un cache partagé : un `cacheHandler` (Redis, par exemple) ; sinon, accepte des durées courtes et des écarts temporaires entre pods.
:::

## Statique ou dynamique : qui décide ?

Sans `cacheComponents`, Next décide **par route**. Elle devient dynamique (rendue à chaque requête) dès qu'elle utilise une **API de requête** :

```ts
import { cookies, headers } from "next/headers";
import { connection } from "next/server";

await cookies();   // dynamique
await headers();   // dynamique
await connection(); // dynamique, explicitement
// + searchParams lu dans la page
// + fetch(url, { cache: "no-store" })
```

Un seul `cookies()` dans **un** composant, même tout en bas, et toute la route passe dynamique : plus d'ISR, une exécution complète à chaque visite.

```ts
// Le piège : un helper "pratique" qui lit toujours les cookies
export async function getApi() {
  const token = (await cookies()).get("access_token")?.value;
  return new ApiClient({ token });
}
// appelé depuis la fiche produit publique -> plus d'ISR
```

La parade : **deux fabriques**, une publique synchrone sans cookies pour le catalogue, une de session (async, cookies) pour l'espace client. Le nom dit le coût.

```ts
export function getPublicApi(): ApiClient {
  return new ApiClient({ token: null }); // garde l'ISR
}

export async function getSessionApi(): Promise<ApiClient> {
  const token = (await cookies()).get("access_token")?.value;
  return new ApiClient({ token: token ?? null }); // dynamique
}
```

Vérifie le résultat dans la sortie de `next build` : chaque route est marquée statique (`○`), SSG avec params (`●`) ou dynamique (`ƒ`).

## `generateStaticParams`

Pour une route à segment dynamique (`[slug]`), `generateStaticParams` liste les valeurs à pré-rendre au build.

```ts
export async function generateStaticParams() {
  const slugs = await getTopCategorySlugs(); // les 200 plus vues
  return slugs.map((slug) => ({ slug }));
}
```

- Les slugs listés sont rendus au build.
- Les autres sont rendus **à la première visite** puis gardés (ISR), sauf si tu poses `export const dynamicParams = false` (alors 404).
- Retourner `[]` est utile : la route est considérée statique et **tout** est rendu à la demande puis mis en cache. Sans `generateStaticParams`, une route `[slug]` est rendue dynamiquement.

Ne pré-rends pas 80 000 fiches au build : le build dure une heure et martèle l'API. Pré-rends ce qui compte, laisse l'ISR faire le reste.

## Revalider après un changement

Deux outils dans une Server Action ou un route handler :

```ts
import { revalidatePath, revalidateTag } from "next/cache";

// Une page précise (ou tout un layout)
revalidatePath("/fr/produits/kit-chaine-520");
revalidatePath("/[locale]/products/[slug]", "page");

// Toutes les données marquées "catalog", sur toutes les pages
revalidateTag("catalog", "max");
```

En Next 16, `revalidateTag` prend un **second argument** : combien de temps on accepte de servir l'ancienne valeur pendant la régénération. `"max"` (recommandé) = stale-while-revalidate ; `{ expire: 0 }` = la prochaine requête attend la donnée fraîche. La forme à un argument est dépréciée.

Pour le « je viens de modifier, je veux voir ma modif » dans une Server Action, Next 16 ajoute `updateTag(tag)` : expiration immédiate, la requête suivante attend la donnée fraîche. Il n'est appelable **que** depuis une Server Action.

```ts
"use server";
import { updateTag } from "next/cache";

export async function renameAddress(id: number, name: string) {
  await AddressService.forRequest().rename(id, name);
  updateTag(`addresses:${id}`); // l'utilisateur voit sa modif
}
```

Le catalogue, lui, est modifié par le back-office (une autre app) : il expose un route handler protégé qui appelle `revalidateTag("catalog", "max")`, ou il s'appuie simplement sur `revalidate: 300`.

## Le piège du `fetch` avec `signal`

La memoization de rendu ne s'applique **pas** à un `fetch` qui porte un `signal`. Or un client HTTP sérieux met un timeout sur chaque appel, souvent via `AbortSignal.timeout(ms)` :

```ts
export async function getProduct(slug: string) {
  return http.get(`/public/products/slug/${slug}`, {
    signal: AbortSignal.timeout(5_000),
    next: { revalidate: 300 },
  });
}
```

Résultat : `generateMetadata` et la page appellent `getProduct` chacun → **deux** requêtes au backend par rendu. Avec le data cache chaud ce n'est qu'un aller-retour local, mais à froid ou à la régénération, tu doubles la charge.

La correction : `React.cache`, une memoization **par rendu** explicite.

```ts
import { cache } from "react";

export const getProduct = cache(async (slug: string) => {
  const res = await http.get(`/public/products/slug/${slug}`, {
    signal: AbortSignal.timeout(5_000),
    next: { revalidate: 300 },
  });
  return res.success ? toDetail(res.data) : null;
});
```

Sous le capot, `cache(fn)` garde, pour la durée de la requête serveur en cours, une table « arguments → promesse ». Le deuxième appel avec le même `slug` reçoit **la même promesse**, même si le premier n'est pas fini. Les arguments sont comparés par identité (`Object.is`) : passe des primitives, pas un objet recréé à chaque appel.

| | `React.cache` | data cache (`revalidate`) |
| --- | --- | --- |
| Durée | un rendu | entre requêtes |
| Partagé entre visiteurs | non | oui |
| Pour | dédoublonner dans un rendu | ne pas rappeler l'API |

Ils se combinent : `React.cache` autour d'un `fetch` avec `revalidate`.

## Le nouveau modèle : Cache Components

Next 16 propose un modèle opt-in, activé par `cacheComponents: true` dans `next.config.ts`. Tout y est **dynamique par défaut**, et tu marques ce qui est cacheable avec la directive `"use cache"` sur une fonction ou un composant `async` :

```ts
import { cacheLife, cacheTag } from "next/cache";

export async function getCategoryTree() {
  "use cache";
  cacheLife("hours");
  cacheTag("catalog");
  return api.getCategoryTree();
}
```

Avantage : une page mélange une coquille statique (pré-rendue) et des îlots dynamiques streamés, au lieu du tout-ou-rien par route. Coût : une migration (les `export const revalidate`/`dynamic` disparaissent, cookies et headers se lisent hors des scopes cachés et se passent en arguments). Sur un projet existant qui marche avec `fetch` + `revalidate`, ce n'est pas une urgence.

## Cas réel

**Le catalogue d'une boutique de pièces moto, servi en ISR.**

- Toutes les lectures du catalogue passent par un annuaire d'API avec `next: { revalidate: 300 }` (constante unique `CATALOG_REVALIDATE`). Aucune page n'exporte `revalidate` : le cache est piloté au niveau `fetch`, à un seul endroit.
- Le header affiche le mega-menu construit depuis le catalogue (ISR 300 s). Si le backend est en panne, la nav est vide mais la page reste servable.
- `generateStaticParams` sur les catégories et les fiches les plus vues ; le reste est rendu à la demande.
- Les getters qui décident de l'existence d'une page (fiche par slug) sont enveloppés dans `React.cache`, car le client HTTP met un `signal` de timeout : sans ça, `generateMetadata` et la page doublaient les appels.
- L'espace client utilise une autre fabrique (`getSessionApi`) qui lit les cookies : dynamique, assumé.
- Un clic « m'alerter du retour en stock » est une Server Action, pas un `cookies()` au rendu : la fiche reste statique pour tout le monde.

## Pièges classiques

- Croire qu'un `fetch` est mis en cache par défaut (c'était vrai en Next 13-14, plus depuis 15).
- Lire `cookies()` dans un helper partagé et perdre l'ISR de tout le catalogue sans s'en rendre compte. Vérifie la sortie de `next build`.
- Poser des en-têtes propres au visiteur sur un `fetch` mis en cache : une entrée de cache par visiteur.
- Un `revalidate: 10` dans un layout racine « pour tester » qui reste en prod : tout le site se régénère toutes les 10 s.
- `fetch` avec `signal` appelé dans `generateMetadata` et la page : requête doublée. `React.cache`.
- `React.cache` avec un objet en argument : nouvelle référence à chaque appel, aucun dédoublonnage.
- `revalidateTag("x")` sans second argument : déprécié en 16.
- Plusieurs replicas sans cache partagé : invalidation qui ne touche qu'un pod.
- Question d'entretien : « Quelle différence entre request memoization et data cache ? » : l'une dure un rendu et dédoublonne, l'autre persiste entre requêtes et entre visiteurs.
- Question d'entretien : « Qu'est-ce que l'ISR et que voit l'utilisateur pendant la régénération ? » : l'ancienne version, immédiatement ; la nouvelle est calculée en arrière-plan (stale-while-revalidate).

## Défis

### 1. Statique ou dynamique ?

Pour chaque page, la route est-elle statique ou dynamique ? (a) fiche produit qui `fetch` avec `revalidate: 300` ; (b) même fiche, mais le layout lit `cookies()` pour afficher « Bonjour Léa » ; (c) page de recherche qui lit `searchParams.q`.

::: details Solution
(a) statique (ISR 300 s). (b) dynamique : `cookies()` dans un layout rend dynamiques toutes les routes en dessous. Sors le « Bonjour » dans un Client Component qui interroge une route `/api/me` après hydratation, ou accepte le dynamique. (c) dynamique : `searchParams` est une API de requête (et une page de recherche n'a de toute façon pas vocation à être en cache).
:::

### 2. Combien d'appels ?

`generateMetadata` et la page appellent `getProduct(slug)`, un `fetch` GET **sans** signal avec `revalidate: 300`. Cache froid. Combien d'appels au backend ? Et avec un `signal` ?

::: details Solution
Sans signal : un seul (request memoization). Avec signal : deux, la memoization est désactivée. `React.cache` autour de `getProduct` ramène à un seul.
:::

### 3. Clé de cache stable (exécutable)

Une page de listing est mise en cache par URL. `?page=2&brand=acme` et `?brand=acme&page=2` doivent donner la même clé (et la même URL canonique), sinon tu caches deux fois la même page et Google voit deux URLs.

<Challenge :data="cacheKey" />

### 4. Revalidation

Le back-office change le prix d'un produit. Quelle stratégie pour que la fiche, la catégorie et la home soient à jour en moins d'une minute, sans régénérer tout le site ?

::: details Solution
Taguer les lectures : `tags: ["product:123"]` sur la fiche, `["catalog"]` sur les listes. Le back-office appelle un route handler protégé (secret partagé, comparaison à temps constant) qui fait `revalidateTag("product:123", "max")` puis `revalidateTag("catalog", "max")`. Les pages se régénèrent à leur prochaine visite. Sans tags : `revalidatePath` sur les trois chemins, plus fragile (il faut connaître tous les chemins, dans toutes les langues). Avec plusieurs pods, il faut un cache handler partagé, sinon l'invalidation ne touche qu'un pod.
:::

## À retenir

- Quatre caches : memoization (un rendu), data cache (entre requêtes), Full Route Cache/ISR (la page), Router cache (navigateur). Plus le cache HTTP.
- `fetch` n'est pas caché par défaut depuis Next 15 : `revalidate` ou `force-cache` pour l'activer.
- Un seul `cookies()`/`headers()`/`searchParams` rend la route dynamique : deux fabriques d'API, publique et de session.
- `generateStaticParams` pré-rend l'essentiel, l'ISR fait le reste à la demande.
- Après mutation : `revalidateTag(tag, "max")`, `updateTag` en Server Action, `revalidatePath` pour un chemin.
- Un `fetch` avec `signal` n'est pas dédoublonné : `React.cache`.
