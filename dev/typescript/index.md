# TypeScript

Ce que tu vas trouver ici : le TypeScript (et le Node.js) qu'un dev **mid/senior** doit maîtriser en 2026, avec du code tiré de vraies apps backend et front.

La section suppose que tu sais déjà écrire du JavaScript et un peu de TS (interfaces, `string[]`, fonctions typées). On part de là pour aller vers ce qui fait la différence en entretien et en prod : un système de types qui **empêche les bugs** au lieu de juste décorer le code, un async maîtrisé, des frontières validées, une architecture testable.

## Versions de référence

| Outil | Version visée |
| --- | --- |
| TypeScript | 5.x (5.8+), `strict` |
| Node.js | 22 / 24 LTS |
| Zod | 4 |
| Vitest | 4+ |
| React | 19 |

::: info Node exécute du TS
Depuis Node 22.18 et Node 24, `node fichier.ts` marche sans flag : Node **efface** les types (type stripping) sans les vérifier. Ça impose une syntaxe « effaçable » (pas d'`enum`, pas de `namespace` runtime, pas de parameter properties). L'option `erasableSyntaxOnly` (TS 5.8) le vérifie pour toi. Le typecheck reste le job de `tsc --noEmit` en CI.
:::

## Mid vs senior : ce qu'on attend

| Compétence | Mid | Senior |
| --- | --- | --- |
| Types | unions, narrowing, génériques simples | modélise le domaine, branded types, sait quand arrêter |
| Async | async/await, `Promise.all` | event loop, annulation, backpressure, concurrence bornée |
| Erreurs | try/catch, classes d'erreurs | Result vs exceptions assumé, `cause`, erreurs HTTP propres |
| Validation | Zod sur le body | toutes les frontières (env, queue, webhooks, DB JSON) |
| Archi | contrôleur / service / repo | ports & adapters light, DI sans framework, monorepo |
| Tests | tests unitaires avec mocks | pyramide pensée, intégration sur vraie DB, fakes > mocks |
| Perf | sait lire un temps de réponse | profile CPU/heap, trouve une fuite, worker_threads |
| Front | hooks typés, props | server state vs client state, re-renders, RSC |

En résumé : le mid **fait marcher** le code. Le senior fait en sorte qu'il soit **dur à casser** (types, validation, tests) et **explicable** (logs, erreurs, archi lisible).

## Ordre de lecture

Lis dans l'ordre la première fois : chaque chapitre réutilise le précédent.

1. [Types fondamentaux](/dev/typescript/01-types-fondamentaux) : typage structurel, unions, narrowing, `unknown`/`never`, `satisfies`.
2. [Generics](/dev/typescript/02-generics) : contraintes, inférence, utility types, repos génériques.
3. [Types avancés](/dev/typescript/03-types-avances) : conditional, mapped, template literal, branded types… et quand s'abstenir.
4. [Async & event loop](/dev/typescript/04-async-event-loop) : phases, microtasks, `AbortController`, concurrence, streams.
5. [Erreurs & validation](/dev/typescript/05-erreurs-et-validation) : Result, erreurs métier, Zod, parse don't validate.
6. [Architecture backend](/dev/typescript/06-architecture-backend) : couches, DI, monorepo pnpm, config, logs, tsconfig.
7. [Une API réelle](/dev/typescript/07-api-reelle) : Fastify + Zod + Drizzle + PostgreSQL, de bout en bout.
8. [Tests](/dev/typescript/08-tests) : Vitest, fakes, Testcontainers, tests de types.
9. [Performance Node](/dev/typescript/09-performance-node) : profiling, fuites mémoire, worker_threads.
10. [React en TypeScript](/dev/typescript/10-frontend-react) : props, hooks, TanStack Query, re-renders, formulaires.

## Comment utiliser cette section

- **Un chapitre = une soirée.** Lis la théorie, puis fais au moins un défi.
- Les blocs marqués **▶ Ouvrir dans TS Playground** sont autonomes : ouvre-les, survole les types, casse le code exprès pour voir l'erreur.
- Les défis interactifs tournent dans ton navigateur. Ta progression est sauvegardée localement.
- Pour t'entraîner façon entretien, enchaîne avec les [défis TypeScript](/interview/02-pratique/01-defis-typescript) et les [questions d'entretien](/interview/02-pratique/03-questions-entretien).

<script setup>
const ids = [
  "ts-parse-webhook", "ts-group-by", "ts-deep-merge", "ts-retry",
  "ts-p-limit", "ts-parse-env", "ts-compose", "ts-cursor-pagination",
  "ts-fake-clock", "ts-lru-ttl", "ts-booking-reducer",
];
</script>

## Ta progression

<Progress :ids="ids" />

## Le fil rouge

Beaucoup d'exemples tournent autour d'un **SaaS de réservation multi-tenant** (des salles de sport, des cabinets médicaux… qui prennent des rendez-vous en ligne) : tenants, créneaux, réservations, paiements Stripe-like, webhooks, worker d'emails. Ça permet de voir le même domaine sous l'angle des types, de l'async, de l'archi, des tests et du front, et ça ressemble à ce que tu croiseras en vrai.
