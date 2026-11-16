# Roadmap 12 mois

Objectif : passer de junior à **mid** (et poser les bases du senior) en TypeScript et Rust, avec l'infra et les bases de données qu'on attend d'un dev back autonome.

Le rythme visé est tenable même avec un boulot à plein temps :

| Quand | Quoi | Durée |
|---|---|---|
| Soir en semaine (×3) | 1 chapitre à lire sur téléphone | 20–40 min |
| Soir en semaine (×2) | 2–3 défis (cette doc ou LeetCode) | 30 min |
| Week-end | 1 mini-projet réel sur ordi | 2–3 h |

::: tip La règle d'or
Lire ne suffit pas. Un chapitre est « acquis » quand tu as fait ses défis **sans regarder la solution** et que tu as réutilisé la notion dans un vrai bout de code le week-end.
:::

## Trimestre 1 — Fondations solides

**But :** plus aucune hésitation sur le langage lui-même.

| Mois | TypeScript | Rust | À côté |
|---|---|---|---|
| 1 | [Types fondamentaux](/dev/typescript/01-types-fondamentaux), [Generics](/dev/typescript/02-generics) | [Ownership](/dev/rust/01-ownership-borrowing), [Structs & enums](/dev/rust/02-structs-enums-pattern-matching) | [Méthode & Big-O](/interview/01-algo/01-methode-big-o), [Tableaux & hashing](/interview/01-algo/02-tableaux-hashing) |
| 2 | [Async & event loop](/dev/typescript/04-async-event-loop) | [Traits](/dev/rust/03-traits-generics), [Lifetimes](/dev/rust/04-lifetimes) | [SQL fondamentaux](/bdd/01-sql-fondamentaux), [Linux](/infra/01-linux-essentiels) |
| 3 | [Erreurs & validation](/dev/typescript/05-erreurs-et-validation) | [Erreurs](/dev/rust/05-gestion-erreurs), [Collections](/dev/rust/06-collections-iterateurs) | [Two pointers](/interview/01-algo/03-two-pointers-sliding-window), [Stack](/interview/01-algo/04-stack-queue) |

**Projet du trimestre :** une CLI Rust qui lit un CSV de transactions et sort un rapport (voir [CLI avec clap](/dev/rust/11-cli-clap)), et son équivalent en script TS. Compare les deux.

## Trimestre 2 — Construire de vraies apps

**But :** savoir livrer une API propre, testée, conteneurisée.

| Mois | TypeScript | Rust | À côté |
|---|---|---|---|
| 4 | [Architecture backend](/dev/typescript/06-architecture-backend) | [Smart pointers](/dev/rust/07-smart-pointers) | [Modélisation](/bdd/02-modelisation), [Docker](/infra/03-docker) |
| 5 | [API réelle](/dev/typescript/07-api-reelle) | [Concurrence](/dev/rust/08-concurrence) | [Index & EXPLAIN](/bdd/03-index-et-explain), [Compose](/infra/04-docker-compose) |
| 6 | [Tests](/dev/typescript/08-tests) | [Async Tokio](/dev/rust/09-async-tokio) | [Binary search](/interview/01-algo/05-binary-search), [Listes](/interview/01-algo/06-listes-chainees), [Arbres](/interview/01-algo/07-arbres) |

**Projet du trimestre :** une API de réservation (TS + Postgres) avec auth, pagination, tests d'intégration, et un `docker compose up` qui lance tout.

## Trimestre 3 — Production

**But :** déployer, observer, ne pas casser la prod.

| Mois | Dev | BDD | Infra |
|---|---|---|---|
| 7 | [API Axum + SQLx](/dev/rust/10-api-axum-sqlx) | [Transactions](/bdd/04-transactions-isolation) | [CI/CD](/infra/05-ci-cd-github-actions) |
| 8 | [Tests & outillage Rust](/dev/rust/12-tests-et-outillage) | [Postgres avancé](/bdd/05-postgres-avance) | [Reverse proxy & TLS](/infra/06-reverse-proxy-tls), [Réseau](/infra/02-reseau-pour-devs) |
| 9 | [Perf Node](/dev/typescript/09-performance-node) | [Migrations en prod](/bdd/08-migrations-orm-en-prod) | [Observabilité](/infra/08-observabilite), [Déployer une vraie app](/infra/11-deployer-une-vraie-app) |

Algo en parallèle : [Graphes](/interview/01-algo/08-graphes), [Heap](/interview/01-algo/09-heap-top-k), [Backtracking](/interview/01-algo/10-backtracking).

**Projet du trimestre :** réécris l'API du T2 en Rust (Axum + SQLx), déploie-la sur un VPS avec CI, TLS, backups et un dashboard de métriques.

## Trimestre 4 — Vers le senior

**But :** choisir, arbitrer, expliquer. Être prêt pour les entretiens.

| Mois | Dev & archi | Données & infra | Entretiens |
|---|---|---|---|
| 10 | [Types avancés](/dev/typescript/03-types-avances), [Macros & unsafe](/dev/rust/13-macros-et-unsafe) | [MySQL](/bdd/06-mysql), [MongoDB](/bdd/07-mongodb) | [Prog. dynamique](/interview/01-algo/11-programmation-dynamique) |
| 11 | [Frontend React](/dev/typescript/10-frontend-react) | [Kubernetes](/infra/07-kubernetes), [Terraform](/infra/09-terraform) | [Intervalles & greedy](/interview/01-algo/12-intervalles-greedy), [Design](/interview/01-algo/13-design-structures) |
| 12 | [Défis TS](/interview/02-pratique/01-defis-typescript), [Défis Rust](/interview/02-pratique/02-defis-rust) | [Choisir & scaler](/bdd/09-choisir-et-scaler), [Sécurité](/infra/10-securite-et-secrets) | [System design](/interview/03-system-design/), [Questions](/interview/02-pratique/03-questions-entretien) |

**Projet du trimestre :** ajoute à ton API un worker de jobs (file Postgres `SKIP LOCKED` ou Redis), des webhooks idempotents, et écris un *design doc* d'une page qui justifie tes choix. C'est exactement ce qu'on te demandera de défendre en entretien.

## Checklist « je suis mid »

Coche mentalement. Si tu peux tout faire **seul et l'expliquer**, tu y es.

- ☐ Je lis une erreur du borrow checker ou de `tsc` et je sais quoi changer sans tâtonner.
- ☐ Je conçois une API REST : validation, erreurs, pagination, auth, idempotence.
- ☐ Je modélise un schéma SQL et je justifie mes index avec `EXPLAIN`.
- ☐ Je sais quel niveau d'isolation j'utilise et quelle anomalie il permet.
- ☐ J'écris des tests qui attrapent de vrais bugs (pas seulement de la couverture).
- ☐ Je conteneurise et déploie une app avec CI, et je sais faire un rollback.
- ☐ Je diagnostique un incident : logs, métriques, `ss`, `top`, requêtes lentes.
- ☐ Je résous un LeetCode *medium* en 30–40 min en expliquant ma complexité.
- ☐ Je découpe une feature floue en tâches et j'en estime les risques.

## Et LeetCode ?

Continue en parallèle, mais **par pattern** et pas au hasard : quand tu lis le chapitre *Sliding window*, fais 5 problèmes de ce pattern dans la semaine. Les défis de ce site couvrent les classiques ; LeetCode sert à varier et à t'habituer au chrono.
