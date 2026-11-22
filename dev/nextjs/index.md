# Next.js

Ce que tu vas trouver ici : le Next.js (App Router) qu'un dev **mid/senior** doit maîtriser en 2026 pour livrer une boutique publique rapide, bien référencée et sûre, et pour tenir un entretien sur le rendu serveur.

La section suppose que tu connais React et TypeScript. Les hooks, TanStack Query et les re-renders de base sont traités dans [React en TypeScript](/dev/typescript/10-frontend-react) : on ne les répète pas, on part de là. Ici, on s'intéresse à ce que Next ajoute au-dessus de React : **où** le code s'exécute, **quand** une page est calculée, **qui** a le droit d'appeler quoi.

## Versions de référence

| Outil | Version visée |
| --- | --- |
| Next.js | 16 (App Router), sans `cacheComponents` sauf mention |
| React | 19 |
| TypeScript | strict |
| Runtime | Node.js 24, image Docker `output: "standalone"` |

::: warning Next 16 a renommé et déprécié des choses
`middleware.ts` s'appelle maintenant `proxy.ts` (et tourne sur Node.js par défaut), `params` et `searchParams` sont des `Promise`, `revalidateTag` prend un second argument, `<Image priority>` est remplacé par `preload`. Si un tuto montre l'ancienne forme, il date d'avant 16.
:::

## Mid vs senior : ce qu'on attend

| Compétence | Mid | Senior |
| --- | --- | --- |
| Rendu | sait mettre `"use client"` | place la frontière au plus bas, compose serveur dans client, lit le bundle |
| Données | `fetch` dans une page | choisit le niveau de cache, sait pourquoi une route est devenue dynamique |
| Mutations | une Server Action qui marche | action mince, validée, autorisée, résultat typé, revalidation ciblée |
| Routing | pages et layouts | route groups, streaming, `proxy`, URLs localisées sans doublon |
| SEO | un `title` par page | canonical, hreflang, sitemap, JSON-LD, 404 vs panne |
| Perf | Lighthouse vert en local | LCP/INP/CLS en mobile réel, budget de bundle, `dynamic()` justifié |
| Sécurité | pas de secret en dur | sait ce qui part au navigateur, CSP, cookies, CSRF, IP derrière proxy |
| Archi | des fonctions qui appellent l'API | services testables par DI, annuaire d'API, multi-boutique sans `if` partout |

En résumé : le mid **fait marcher** la page. Le senior sait **ce qui tourne où**, **ce qui est mis en cache** et **ce qui est exposé**, et il peut l'expliquer.

## Ordre de lecture

Lis dans l'ordre la première fois : chaque chapitre s'appuie sur le précédent.

1. [Server et Client Components](/dev/nextjs/01-server-et-client-components) : modèle mental RSC, frontière `"use client"`, sérialisation, hydratation, composition.
2. [Données et cache](/dev/nextjs/02-donnees-et-cache) : `fetch` serveur, data cache, ISR, `React.cache`, statique vs dynamique, revalidation.
3. [Server Actions](/dev/nextjs/03-server-actions) : endpoint POST public, validation, `ActionResult`, `useTransition`, revalidation.
4. [Routing App Router](/dev/nextjs/04-routing-app-router) : layouts, route groups, `params` en Promise, streaming, `proxy`, i18n.
5. [SEO technique](/dev/nextjs/05-seo-technique) : `generateMetadata`, canonical, hreflang, sitemap, JSON-LD, 404 vs 5xx.
6. [Performance et Web Vitals](/dev/nextjs/06-performance-web-vitals) : LCP, INP, CLS, `next/image`, `next/font`, `dynamic()`.
7. [Sécurité Next.js](/dev/nextjs/07-securite-nextjs) : `NEXT_PUBLIC_*`, cookies, CSRF, XSS, CSP, IP client.
8. [Architecture pro](/dev/nextjs/08-architecture-pro) : services en classes, annuaire d'API, tests, white-label multi-boutique.

## Comment utiliser cette section

- **Un chapitre = une soirée.** Lis la théorie, puis fais au moins un défi.
- Les défis interactifs tournent dans ton navigateur et portent sur de la **logique pure** (clés de cache, résultats d'actions, redirections sûres, réglages multi-boutique) : c'est ce qu'on teste unitairement dans une vraie app Next, loin du framework.
- Les questions d'entretien sont dans chaque « Pièges classiques ».

<script setup>
const ids = [
  "next-cache-key", "next-action-result", "next-safe-return-to",
  "next-shop-setting", "next-merge-filters",
];
</script>

## Ta progression

<Progress :ids="ids" />

## Le fil rouge

Les exemples tournent autour d'une **boutique en ligne de pièces moto et quad, multi-boutique** : un même backend (API REST séparée), un catalogue partagé, deux vitrines de marques différentes. Pages publiques indexables (fiches produit, catégories, vues éclatées de pièces), espace client privé, tunnel de commande avec paiement sur une page hébergée par le prestataire. Le trafic vient surtout de Google, sur mobile : performance et SEO ne sont pas des bonus, c'est le chiffre d'affaires.
