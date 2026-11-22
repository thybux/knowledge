# Rust en service

Ce que tu vas apprendre : la suite « production » du parcours [Rust](/dev/rust/). Tu sais écrire du Rust ; ici tu apprends à en faire un **service système** qui tourne seul, la nuit, sans toi : un job planifié qui synchronise le catalogue d'un fournisseur, un scraper de catalogues qui tourne plusieurs heures, un worker qui publie sur RabbitMQ.

## De quoi on parle

Un « service système » n'est pas une API web. C'est du code qui :

- démarre, fait un travail borné, puis **sort** avec un code de sortie (un job batch, une CLI one-shot lancée par un CronJob) ;
- parle à des systèmes qu'il ne contrôle pas : un site tiers lent, un broker de messages, un disque ;
- doit survivre aux pannes ordinaires (réseau qui coupe, pod tué, queue pleine) sans corrompre les données ni spammer les alertes.

Le fil rouge de la section : un crate Rust qui contient deux CLI.

| CLI | Travail | Sortie |
|---|---|---|
| `sync` | lit le flux de stock et de prix d'un fournisseur (des milliers de lignes) | un message par produit sur la queue `upsert_product` |
| `scraper` | parcourt un catalogue web (marques → modèles → vues → pièces) pendant des heures | un message par vue sur la queue `scraping`, images sur S3 |

Les deux publient sur RabbitMQ, consommé par des workers **TypeScript**. C'est le cas typique où Rust est un choix raisonnable dans une équipe TS : du travail long, réseau, qui doit tenir en peu de mémoire et ne pas tomber.

::: tip Pourquoi pas tout en TS ?
Un job Node ferait le travail. Rust apporte ici trois choses concrètes : la mémoire constante sur un parcours de plusieurs heures (pas de GC qui gonfle), des erreurs typées qui forcent à traiter chaque cas réseau, et un binaire unique dans une image de 30 Mo. Le coût : un second langage, un second outillage, et un contrat de messages à maintenir entre les deux mondes (chapitre 3).
:::

## Versions de référence

Tout le code de la section est vérifié contre ces versions (fin 2026) :

| Outil / crate | Version | Rôle |
|---|---|---|
| Rust | 1.95, édition 2024 | toolchain figée par `rust-toolchain.toml` |
| `tokio` | 1.54 | runtime async |
| `tokio-util` | 0.7 | `CancellationToken` |
| `reqwest` | 0.13 (`rustls`, `cookies`) | client HTTP |
| `lapin` | 4.12 | client AMQP (RabbitMQ) |
| `rusqlite` | 0.41 (`bundled`) | état local SQLite |
| `tracing` / `tracing-subscriber` | 0.1 / 0.3 (`json`) | logs structurés |
| `clap` | 4.6 (`derive`) | arguments |
| `serde` / `serde_json` | 1 | sérialisation des messages |
| `thiserror` / `anyhow` | 2 / 1 | erreurs |
| `wiremock` | 0.6 | faux serveur HTTP en test |

## Mid vs senior : ce qu'on attend de toi

| Sujet | Mid | Senior |
|---|---|---|
| Structure | une lib + des binaires, modules par responsabilité | la lib ne lit jamais l'environnement, chaque frontière est testable sans réseau |
| Config | lit des variables d'env | config typée, validée au démarrage, toutes les erreurs d'un coup, secrets masqués |
| HTTP | un client avec timeout | un seul client, retry seulement sur le transitoire, `Retry-After`, politesse envers le site tiers |
| Broker | publie un message JSON | publisher confirms, déclaration passive, contrat testé par golden files, backpressure |
| Reprise | relance tout depuis zéro | état local, marqueur posé **après** l'effet distant, verrou d'instance |
| Observabilité | `println!` puis `tracing` | logs JSON avec spans, zéro PII, signal de vie, bilan de run |
| Arrêt | le pod est tué | SIGTERM intercepté, nettoyage borné, codes de sortie qui pilotent Kubernetes |
| Déploiement | une image Docker | image multi-stage non root, CronJob borné (`Forbid`, deadline), ressources mesurées |
| Tests | tests unitaires | faux serveur HTTP, faux broker par trait, horloge en pause, vrai RabbitMQ en CI |

## Ordre de lecture

Prérequis : le socle du parcours Rust, surtout [Gestion d'erreurs](/dev/rust/05-gestion-erreurs), [Async & Tokio](/dev/rust/09-async-tokio), [CLI avec clap](/dev/rust/11-cli-clap) et [Tests & outillage](/dev/rust/12-tests-et-outillage). Cette section ne les refait pas.

1. [Architecture : une lib, des binaires](/dev/rust-service/01-architecture-lib-et-binaires) — où vit quoi, config typée, erreurs par couche.
2. [Un client HTTP résilient](/dev/rust-service/02-client-http-resilient) — timeouts, retry, backoff, politesse.
3. [Publier sur RabbitMQ](/dev/rust-service/03-broker-amqp) — confirms, contrat avec le TS, backpressure.
4. [État local et incrémental](/dev/rust-service/04-etat-et-incremental) — reprendre un job sans tout refaire.
5. [Observabilité et arrêt propre](/dev/rust-service/05-observabilite-et-arret-propre) — `tracing`, signal de vie, SIGTERM.
6. [Déployer un job planifié](/dev/rust-service/06-deployer-un-job-planifie) — image Docker, CronJob k3s.
7. [Tester un service](/dev/rust-service/07-tests-d-un-service) — faux serveur, faux broker, golden files, CI.

## À retenir

- Un service système fait un travail borné et **sort** : son code de sortie est son API vers l'orchestrateur.
- Toute attente réseau est bornée, toute erreur est classée (transitoire ou définitive).
- Un contrat entre deux langages (queues, payloads) a **un seul** propriétaire et des tests des deux côtés.
- Rejouer un job ne doit jamais corrompre : idempotence côté consumer, marqueur après l'effet côté producteur.
- Rust paie quand le travail est long et réseau ; pour un script de 50 lignes, reste en TS.
