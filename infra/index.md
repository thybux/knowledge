# Infra & DevOps

Ce que tu vas apprendre : tout ce qu'un dev back mid/senior doit savoir faire en infra pour livrer et faire tourner ses propres services, sans être SRE.

## Pourquoi un dev back doit s'y mettre

En 2026, « ça marche sur ma machine » ne suffit plus. Même dans une équipe qui a des SRE ou une équipe plateforme, on attend d'un dev back qu'il :

- écrive le `Dockerfile` et le workflow CI de son service ;
- sache lire des logs, une métrique, une trace quand la prod brûle ;
- comprenne ce qui se passe entre le client et son handler (DNS, TLS, proxy, load balancer) ;
- ne laisse pas traîner un secret dans un repo ou une image.

Le fil rouge de la section : deux apps réalistes.

- **`billing-api`** : une API de facturation en TypeScript (Node 22/24, pnpm, Fastify ou Express), avec Postgres et Redis, plus un **worker** qui envoie les factures par mail.
- **`ingest`** : un service Rust (Axum + SQLx, binaire unique) qui ingère des événements en HTTP et les écrit dans Postgres.

## Mid vs senior : ce qu'on attend de toi

| Sujet | Mid | Senior |
|---|---|---|
| Linux | Debug un service via `systemctl`, `journalctl`, `ss` | Diagnostique CPU/IO/mémoire, `strace`, limites |
| Docker | Dockerfile multi-stage propre | Images minimales, cache CI, supply chain |
| CI/CD | Écrit un workflow lint/test/build | Conçoit le pipeline, OIDC, stratégie de déploiement |
| Réseau | DNS, ports, TLS, CORS | NAT, MTU, HTTP/2-3, timeouts en chaîne |
| K8s | Lit et modifie un manifest | Probes, ressources, HPA, rollout sans downtime |
| Observabilité | Logs structurés, lit un dashboard | Définit SLO, alertes utiles, traces distribuées |
| IaC | Lance un `terraform plan` | Structure modules + state, revue de plan |
| Sécurité | Pas de secret en clair, deps à jour | Least privilege, rotation, backups testés |

::: tip La règle d'or
Le mid sait **faire marcher**. Le senior sait **pourquoi ça casse**, comment le **détecter avant les users**, et comment **revenir en arrière** en 2 minutes.
:::

## Ordre de lecture

1. [Linux essentiels](/infra/01-linux-essentiels) : la base de tout, à lire en premier.
2. [Réseau pour devs](/infra/02-reseau-pour-devs) : DNS, TCP, TLS, HTTP, CORS.
3. [Docker](/infra/03-docker) puis [Docker Compose](/infra/04-docker-compose).
4. [CI/CD GitHub Actions](/infra/05-ci-cd-github-actions).
5. [Reverse proxy & TLS](/infra/06-reverse-proxy-tls).
6. [Observabilité](/infra/08-observabilite) : à lire tôt, c'est ce qui te sauve en prod.
7. [Sécurité & secrets](/infra/10-securite-et-secrets).
8. [Déployer une vraie app](/infra/11-deployer-une-vraie-app) : le chapitre de synthèse.
9. [Kubernetes](/infra/07-kubernetes) et [Terraform](/infra/09-terraform) : quand le reste est solide.

::: info Rythme conseillé
Un chapitre par soirée, les défis le lendemain. Le chapitre 11 se fait idéalement **en vrai** sur un VPS à 5 €/mois : c'est là que tout s'imbrique.
:::

## Liens avec le reste du book

- Côté code : [API réelle en TS](/dev/typescript/07-api-reelle) et [API Axum + SQLx](/dev/rust/10-api-axum-sqlx) sont les apps qu'on déploie ici.
- Côté données : [Migrations & ORM en prod](/bdd/08-migrations-orm-en-prod) complète le chapitre CI/CD.
- Fiche perso : [WireGuard, ajouter un client](/vpn/wireguard/new-user) : un bon exemple de procédure ops à garder sous la main (et le VPN est la bonne façon d'accéder à tes admins internes, cf. chapitre sécurité).

## À retenir

- Tu n'as pas besoin d'être SRE, mais tu dois pouvoir livrer et déboguer ton service seul.
- Linux, réseau et Docker sont le socle : tout le reste s'appuie dessus.
- Observabilité et rollback avant les features d'infra « cool ».
- Chaque chapitre finit par des scénarios d'incident : traite-les comme des astreintes.
