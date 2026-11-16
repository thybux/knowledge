# Questions d'entretien

Ce que tu vas apprendre : les ~70 questions qui reviennent le plus en entretien mid TypeScript/Rust, avec une réponse courte qu'on peut dire en 30 secondes. Lis la question, réponds à voix haute, **puis** ouvre.

::: tip Méthode flashcard
Une réponse d'entretien efficace = **définition en une phrase + exemple concret + nuance/compromis**. Si tu ne peux donner que la définition, c'est une réponse junior.
:::

## TypeScript & JavaScript

::: details `type` vs `interface` ?
Les deux décrivent la forme d'un objet. `interface` peut être **ré-ouverte** (declaration merging, utile pour augmenter `Express.Request`) et s'étend avec `extends`. `type` peut exprimer des unions, des tuples, des types conditionnels et mappés. En pratique : `interface` pour les contrats d'objets publics, `type` pour le reste ; surtout, être cohérent dans le projet.
:::

::: details `unknown` vs `any` ?
`any` désactive le typage (tout passe, et ça se propage). `unknown` accepte tout mais **interdit** de l'utiliser sans l'avoir affiné (`typeof`, `instanceof`, schéma Zod). Tout ce qui vient de l'extérieur (`JSON.parse`, `catch (e)`, body HTTP) devrait être `unknown`.
:::

::: details Qu'est-ce qu'une union discriminée ?
Une union de types qui partagent une propriété littérale (`type: "card" | "sepa"`). Un `switch` sur cette propriété **affine** le type dans chaque branche. Avec un `default` qui assigne à `never`, le compilateur signale toute variante oubliée.
:::

::: details À quoi sert `never` ?
Le type sans valeur : une fonction qui ne retourne jamais (`throw`), une branche impossible. Usage clé : le contrôle d'exhaustivité (`const _: never = x`) et le filtrage dans les types conditionnels (`T extends X ? never : T`).
:::

::: details `satisfies`, c'est quoi ?
Vérifie qu'une valeur respecte un type **sans** élargir son type inféré. `const routes = {...} satisfies Record<string, Route>` : erreur si une route est mal formée, mais `routes.home` garde son type littéral précis (avec une annotation `: Record<...>`, on perdrait les clés).
:::

::: details Generics : à quoi sert une contrainte `extends` ?
À exiger une capacité du type paramètre : `function byId<T extends { id: string }>(xs: T[])`. On peut alors lire `x.id` tout en renvoyant le type exact `T` (et pas juste `{ id: string }`).
:::

::: details Les types n'existent pas au runtime : conséquence ?
TypeScript est effacé à la compilation. Un `as User` sur un body HTTP ne vérifie **rien**. Il faut une validation runtime (Zod, Valibot, TypeBox) à chaque frontière : requêtes, variables d'env, messages de queue, réponses d'API tierces.
:::

::: details `==` vs `===` ?
`==` applique des conversions (`"0" == 0`, `null == undefined` sont `true`). `===` compare sans conversion. Toujours `===`, sauf l'idiome `x == null` pour tester `null` ou `undefined` (beaucoup préfèrent `x ?? ...`).
:::

::: details `??` vs `||` ?
`a || b` prend `b` si `a` est *falsy* (`0`, `""`, `false` inclus). `a ?? b` seulement si `a` est `null`/`undefined`. `limit || 20` transforme `limit = 0` en 20 : bug. Utilise `??`.
:::

::: details Qu'est-ce qu'une closure ? Un exemple réel ?
Une fonction qui capture les variables de sa portée de création. Exemples : un middleware `requireRole("admin")` qui renvoie une fonction ; un compteur privé ; `debounce` qui garde son `timer`. Piège : une closure capture une **référence** à la variable, pas sa valeur.
:::

::: details Comment `this` est-il déterminé ?
Par la façon d'appeler une fonction classique (`obj.m()` → `obj` ; appel nu → `undefined` en mode strict). Les arrow functions n'ont pas leur propre `this` : elles prennent celui du contexte. D'où le bug `setTimeout(this.method, 100)`, corrigé par une arrow ou `.bind(this)`.
:::

::: details Prototype et classes ?
Les classes JS sont du sucre au-dessus des prototypes : les méthodes vivent sur `Class.prototype`, et la recherche de propriété remonte la chaîne. `#private` est un vrai champ privé runtime ; `private` de TS n'existe qu'à la compilation.
:::

## Async & Node.js

::: details Explique l'event loop en 30 secondes.
Node exécute ton JS sur **un seul thread**. Les opérations d'I/O sont déléguées (OS, pool libuv) et leurs callbacks sont mis en file. Après chaque tâche, Node vide la file des **microtâches** (promesses, `queueMicrotask`) avant de passer aux phases suivantes (timers, I/O, `setImmediate`). Conséquence : un calcul CPU de 2 s bloque toutes les requêtes.
:::

::: details Que affiche : `setTimeout(log 1)`, `Promise.resolve().then(log 2)`, `log 3` ?
`3, 2, 1`. Le code synchrone d'abord, puis les microtâches (la promesse), puis les macrotâches (le timer). `process.nextTick` passe même avant les promesses.
:::

::: details `Promise.all` vs `allSettled` vs `race` vs `any` ?
`all` : toutes réussissent, sinon rejette à la première erreur. `allSettled` : attend tout, renvoie `{status, value|reason}` (batchs tolérants). `race` : la première **terminée** (succès ou échec), typique pour un timeout. `any` : la première **réussie**, rejette avec `AggregateError` si toutes échouent.
:::

::: details Comment gérer une tâche CPU lourde dans une API Node ?
La sortir de la boucle principale : `worker_threads` (pool type Piscina) pour du calcul ponctuel, ou une file de jobs (BullMQ, pg-boss) traitée par un worker séparé si c'est long ou doit survivre à un redémarrage. Ou un autre langage (Rust via napi-rs) si c'est critique.
:::

::: details Qu'est-ce qu'une unhandled rejection ?
Une promesse rejetée sans `catch`. Depuis Node 15, elle **fait crasher** le processus par défaut. Cause fréquente : appel async sans `await` (« fire and forget »). Solution : `await`, ou attacher explicitement `.catch(log)`.
:::

::: details Pourquoi les streams ?
Pour traiter des données plus grosses que la RAM morceau par morceau (export CSV de 5 Go, upload S3). `pipeline()` (de `node:stream/promises`) chaîne les streams, gère le **backpressure** (on ne lit pas plus vite qu'on n'écrit) et propage les erreurs.
:::

::: details CommonJS vs ESM ?
CJS : `require`, synchrone, historique. ESM : `import`, standard, chargement asynchrone, `top-level await`. Node 22+ sait faire `require()` d'un module ESM synchrone. Un nouveau projet : ESM (`"type": "module"`).
:::

::: details Comment arrêter proprement un serveur Node (graceful shutdown) ?
Sur `SIGTERM` : arrêter d'accepter de nouvelles connexions (`server.close()`), passer le readiness probe à KO, finir les requêtes en cours, fermer le pool de BDD et les consumers de queue, puis `process.exit`. Avec un délai max. Kubernetes envoie `SIGTERM` puis `SIGKILL` après `terminationGracePeriodSeconds` (30 s par défaut).
:::

## Rust

::: details Les 3 règles de l'ownership ?
Chaque valeur a **un** propriétaire ; il n'y en a qu'un à la fois (affectation = déplacement) ; quand le propriétaire sort de portée, la valeur est libérée (`Drop`). Résultat : pas de GC, pas de double free.
:::

::: details Règles d'emprunt ?
À un instant donné : soit **plusieurs** références partagées `&T`, soit **une seule** référence mutable `&mut T`. Et une référence ne doit pas survivre à la valeur. Ça élimine les data races à la compilation.
:::

::: details `String` vs `&str` ?
`String` : possède un buffer UTF-8 sur le tas, modifiable. `&str` : vue empruntée sur des octets UTF-8 (d'une `String`, d'un littéral…). En paramètre, prends `&str` (accepte les deux) ; en champ de struct qui doit vivre longtemps, `String`.
:::

::: details Qu'est-ce qu'une lifetime ?
Une annotation qui relie la durée de validité des références entre elles, pour que le compilateur prouve qu'aucune ne pend. Elle ne change pas la durée de vie réelle. `fn longest<'a>(a: &'a str, b: &'a str) -> &'a str` : le résultat vit au plus aussi longtemps que le plus court des deux.
:::

::: details `Box`, `Rc`, `Arc`, `RefCell`, `Mutex` : quand ?
`Box<T>` : valeur sur le tas, un propriétaire (types récursifs, `dyn Trait`). `Rc<T>` : plusieurs propriétaires, mono-thread. `Arc<T>` : idem, multi-thread (compteur atomique). `RefCell<T>` : mutabilité intérieure vérifiée au runtime, mono-thread. `Mutex<T>`/`RwLock<T>` : la même chose entre threads. Combo classique : `Arc<Mutex<T>>`.
:::

::: details `Send` et `Sync` ?
`Send` : on peut **déplacer** la valeur vers un autre thread. `Sync` : on peut **partager** `&T` entre threads. `Rc` n'est ni l'un ni l'autre ; `RefCell` est `Send` mais pas `Sync`. Une future tokio spawnée doit être `Send` : garder un `MutexGuard` de std à travers un `.await` la rend souvent non-`Send`.
:::

::: details `unwrap`, `expect`, `?` : quand ?
`?` : propager l'erreur à l'appelant (cas normal). `expect("raison")` : quand un échec est un **bug** (invariant violé), avec un message utile. `unwrap` : tests, prototypes. En code de prod, un `unwrap` sur une entrée utilisateur est un crash qui attend son heure.
:::

::: details `thiserror` vs `anyhow` ?
`thiserror` : pour définir des **enums d'erreurs** précises dans une lib ou un domaine (l'appelant peut faire un `match`). `anyhow` : pour une **application** qui veut juste propager et contextualiser (`.context("lecture config")`) sans typer chaque cas. Souvent les deux : `thiserror` dans le domaine, `anyhow` dans `main`.
:::

::: details Generics vs `dyn Trait` ?
Generics (`impl Trait`, `<T: Trait>`) : **monomorphisation**, une copie du code par type, appel direct, plus rapide, binaire plus gros. `dyn Trait` : un seul code, appel via vtable, permet des collections hétérogènes (`Vec<Box<dyn Handler>>`). Par défaut generics ; `dyn` quand le type concret n'est connu qu'au runtime.
:::

::: details Qu'est-ce qu'une `Future` en Rust ?
Une valeur **paresseuse** : rien ne se passe tant qu'un runtime (tokio) ne la `poll`. `async fn` renvoie une machine à états. Un `.await` rend la main au runtime si la valeur n'est pas prête. D'où : ne jamais bloquer (`std::thread::sleep`, gros calcul) dans une tâche async — utiliser `spawn_blocking`.
:::

::: details `Clone` vs `Copy` ?
`Copy` : copie bit à bit implicite, pour des petits types sans ressource (`i32`, `bool`, `&T`). `Clone` : copie explicite (`.clone()`), qui peut allouer (`String`, `Vec`). Un type qui implémente `Drop` ne peut pas être `Copy`.
:::

## SQL & bases de données

::: details Qu'est-ce qu'un index, et son coût ?
Une structure (B-tree le plus souvent) qui permet de trouver des lignes sans parcourir la table : O(log n) au lieu de O(n). Coût : espace disque, et **chaque écriture** doit aussi mettre à jour l'index. On indexe les colonnes des `WHERE`, `JOIN` et `ORDER BY` fréquents, pas tout.
:::

::: details Index composite `(a, b)` : quelles requêtes en profitent ?
Celles qui filtrent sur `a`, ou sur `a` **et** `b`, ou `a` puis tri par `b`. Pas celles qui filtrent seulement sur `b` (règle du préfixe gauche). Mets en premier la colonne d'égalité, puis celle de plage ou de tri.
:::

::: details Comment savoir pourquoi une requête est lente ?
`EXPLAIN (ANALYZE, BUFFERS)` dans Postgres : on regarde les `Seq Scan` sur de grosses tables, l'écart entre lignes estimées et réelles (statistiques périmées → `ANALYZE`), les tris sur disque. En amont : `pg_stat_statements` pour trouver les requêtes qui coûtent le plus au total.
:::

::: details ACID ?
**Atomicité** (tout ou rien), **Cohérence** (les contraintes restent vraies), **Isolation** (les transactions concurrentes ne se voient pas à moitié), **Durabilité** (un commit survit au crash, grâce au WAL).
:::

::: details Niveaux d'isolation et anomalies ?
Read Committed (défaut Postgres) : chaque requête voit les données commitées à son début ; anomalies possibles : lecture non répétable, lost update. Repeatable Read : snapshot pour toute la transaction (défaut MySQL InnoDB). Serializable : comme si les transactions étaient en série ; Postgres peut annuler une transaction (erreur `40001`) qu'il faut **réessayer**.
:::

::: details Le problème N+1 ?
Charger 50 commandes (1 requête) puis leurs clients un par un (50 requêtes). Fréquent avec les ORM en lazy loading. Solution : un `JOIN`, un `WHERE id = ANY($1)` en lot, ou le DataLoader en GraphQL.
:::

::: details Comment éviter un lost update sur un solde ?
Mise à jour atomique : `UPDATE accounts SET balance = balance - 10 WHERE id = 1 AND balance >= 10`. Ou verrou pessimiste `SELECT ... FOR UPDATE` dans la transaction. Ou verrou optimiste : colonne `version`, `UPDATE ... WHERE version = $v`, et réessayer si 0 ligne modifiée.
:::

::: details Normaliser ou dénormaliser ?
Normaliser (une donnée à un seul endroit) par défaut : pas d'incohérence. Dénormaliser **ciblé** pour la lecture (compteur `comments_count`, vue matérialisée, `JSONB` de snapshot pour une facture qui doit figer l'adresse). Toujours avec un mécanisme qui maintient la copie à jour.
:::

::: details Comment faire une migration sans downtime ?
**Expand / contract** : ajouter la nouvelle colonne nullable, déployer le code qui écrit dans les deux, backfiller par lots, basculer la lecture, puis supprimer l'ancienne colonne. Éviter les verrous longs : `CREATE INDEX CONCURRENTLY`, `lock_timeout` court, contraintes `NOT VALID` puis `VALIDATE`.
:::

::: details SQL vs NoSQL (MongoDB) ?
Relationnel : schéma strict, jointures, transactions multi-lignes matures — le bon défaut pour du métier. Document : schéma flexible, un document = un agrégat lu d'un coup, scaling horizontal natif via sharding. Mongo a des transactions multi-documents depuis 4.0, mais si tu en as partout, ton modèle est probablement relationnel.
:::

## HTTP & API

::: details Méthodes idempotentes ?
`GET`, `PUT`, `DELETE`, `HEAD`, `OPTIONS` : les rejouer N fois a le même effet qu'une fois. `POST` (et `PATCH` en général) ne l'est pas : il faut une **clé d'idempotence** pour pouvoir le réessayer sans doublon.
:::

::: details 401 vs 403 ? 400 vs 422 ? 409 ?
401 : pas authentifié (token absent/invalide). 403 : authentifié mais pas le droit. 400 : requête mal formée (JSON invalide). 422 : bien formée mais invalide métier (email déjà pris, champ hors bornes). 409 : conflit avec l'état actuel (version obsolète, clé d'idempotence réutilisée avec un autre body).
:::

::: details Pagination offset vs curseur ?
`OFFSET 10000` oblige la BDD à lire puis jeter 10 000 lignes, et saute/duplique des éléments si des lignes sont insérées entre deux pages. Curseur (keyset) : `WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT 50` → constant et stable. Offset seulement pour un back-office avec numéros de page.
:::

::: details REST vs GraphQL vs gRPC ?
REST : simple, cacheable HTTP, le défaut pour une API publique. GraphQL : le client choisit ses champs, idéal quand beaucoup de clients front différents ; attention au N+1 et au coût des requêtes. gRPC : binaire (Protobuf), contrat typé, streaming, pour la communication service à service.
:::

::: details Comment versionner une API ?
Le plus courant : dans l'URL (`/v1/`). Ou un en-tête / une date de version (modèle Stripe). Surtout : ne **jamais casser** une version publiée (ajouter des champs, pas en retirer), déprécier avec une date de fin et l'en-tête `Deprecation`/`Sunset`.
:::

::: details Qu'est-ce que CORS ?
Une protection **du navigateur** : un script de `app.com` ne peut pas lire la réponse de `api.com` sauf si `api.com` l'autorise (`Access-Control-Allow-Origin`). Pour les requêtes « non simples », le navigateur envoie d'abord un preflight `OPTIONS`. CORS ne protège pas ton serveur (curl l'ignore) ; ce n'est pas de l'authentification.
:::

::: details Cache HTTP : `ETag` et `Cache-Control` ?
`Cache-Control: max-age=60` : le client/CDN réutilise sans redemander pendant 60 s. `private` : pas de cache partagé (données utilisateur). `ETag` : empreinte de la ressource ; le client renvoie `If-None-Match`, le serveur répond `304 Not Modified` sans body si rien n'a changé.
:::

::: details Que se passe-t-il quand tu tapes une URL ?
DNS (résolution du nom) → connexion TCP (ou QUIC pour HTTP/3) → handshake TLS (vérif du certificat) → requête HTTP → load balancer / reverse proxy → app → BDD → réponse → rendu par le navigateur. En entretien, choisis une étape et approfondis là où on te pousse.
:::

## Infra & DevOps

::: details Conteneur vs VM ?
Une VM virtualise le matériel et embarque son propre noyau. Un conteneur partage le noyau de l'hôte et isole un processus (namespaces pour la visibilité, cgroups pour les ressources). Plus léger et rapide à démarrer, mais isolation plus faible.
:::

::: details Comment réduire une image Docker ?
Build **multi-stage** (on compile dans une image avec le toolchain, on copie seulement le binaire / `dist` dans une image finale minimale), image de base slim/distroless, `.dockerignore`, ordonner les `COPY` pour profiter du cache (dépendances avant le code). Un binaire Rust statique peut tenir dans une image de quelques Mo.
:::

::: details Liveness vs readiness probe ?
Readiness : « puis-je recevoir du trafic ? » — en échec, le pod est retiré du Service (démarrage, BDD indisponible). Liveness : « suis-je bloqué ? » — en échec, Kubernetes **redémarre** le conteneur. Erreur classique : une liveness qui teste la BDD, et une panne de BDD redémarre tous les pods en boucle.
:::

::: details Deployment rolling, blue/green, canary ?
Rolling : remplace les pods progressivement (défaut Kubernetes). Blue/green : deux environnements complets, on bascule le trafic d'un coup (rollback instantané, coût double). Canary : une petite part du trafic sur la nouvelle version, on surveille les métriques, puis on augmente.
:::

::: details Logs, métriques, traces : différence ?
Logs : événements détaillés (« paiement 42 refusé »), pour enquêter. Métriques : nombres agrégés dans le temps (taux d'erreur, p99), pour alerter. Traces : le parcours d'**une** requête à travers les services, avec la durée de chaque étape, pour trouver où ça coince. OpenTelemetry unifie les trois.
:::

::: details Qu'est-ce qu'un SLO ?
Un objectif mesurable de fiabilité : « 99,9 % des requêtes `/checkout` en moins de 300 ms sur 30 jours ». Le **budget d'erreur** (0,1 %) dit combien de risque on peut encore prendre : s'il est consommé, on gèle les features et on fiabilise. Le SLA est la version contractuelle, avec pénalités.
:::

## Sécurité

::: details Comment stocker des mots de passe ?
Jamais en clair ni avec un hash rapide (SHA-256, MD5). Utiliser une fonction **lente et salée** dédiée : Argon2id (recommandée), bcrypt ou scrypt. Le sel est unique par utilisateur et stocké avec le hash.
:::

::: details Injection SQL : cause et parade ?
Concaténer une entrée utilisateur dans une requête : `"... WHERE email = '" + email + "'"`. Parade : requêtes **paramétrées** (`$1`), que tous les drivers et ORM supportent. Pour les noms de colonnes dynamiques (tri), une liste blanche.
:::

::: details XSS et CSRF ?
XSS : injecter du script dans une page vue par d'autres (commentaire non échappé). Parade : échapper la sortie (React le fait par défaut, sauf `dangerouslySetInnerHTML`), en-tête CSP. CSRF : faire envoyer au navigateur d'une victime une requête authentifiée par ses cookies. Parade : cookies `SameSite=Lax`/`Strict`, token CSRF, vérification de l'`Origin`.
:::

::: details JWT : avantages et pièges ?
Token signé, vérifiable sans BDD (stateless). Pièges : impossible à révoquer avant expiration (garder une durée courte + refresh token révocable), ne pas accepter `alg: none`, ne rien mettre de secret dedans (c'est juste du base64), et pour un navigateur, un cookie `HttpOnly` + `Secure` plutôt que `localStorage` (lisible par un XSS).
:::

::: details Qu'est-ce qu'une IDOR ?
*Insecure Direct Object Reference* : `GET /invoices/1043` renvoie la facture d'un autre client parce que le serveur vérifie qu'on est connecté, mais pas que la facture **nous appartient**. Dans un SaaS multi-tenant, chaque requête doit filtrer par `tenant_id` (ou utiliser la Row-Level Security de Postgres).
:::

::: details Où mettre les secrets ?
Jamais dans le repo ni dans l'image Docker. Dans un gestionnaire de secrets (Vault, AWS Secrets Manager, secrets chiffrés type SOPS/Sealed Secrets), injectés à l'exécution par variables d'env ou fichiers. Rotation possible, accès audité, principe du moindre privilège.
:::

## Architecture

::: details Monolithe ou microservices ?
Monolithe **modulaire** par défaut : un déploiement, des transactions simples, refactoring facile. Les microservices résolvent des problèmes d'**organisation** (équipes indépendantes, déploiements séparés) et de scaling différencié, au prix du réseau, de la cohérence éventuelle et de l'observabilité. On découpe quand la douleur est réelle.
:::

::: details Pourquoi une file de messages ?
Découpler un producteur rapide d'un traitement lent ou fragile (envoi d'email, génération de PDF), absorber des pics, réessayer en cas d'échec. Contrepartie : livraison **au moins une fois** → consommateurs idempotents, et une dead letter queue pour les messages qui échouent toujours.
:::

::: details Qu'est-ce que le pattern outbox ?
Écrire l'événement à publier dans une table `outbox` **dans la même transaction** que la donnée métier ; un relais lit la table et publie vers la queue. Résout le problème « commit OK mais publication échouée » (ou l'inverse) sans transaction distribuée.
:::

::: details Cache-aside : comment ça marche, et le piège ?
Lecture : chercher dans le cache, sinon lire la BDD et remplir le cache avec un TTL. Écriture : écrire en BDD puis **invalider** la clé (plutôt que la mettre à jour, pour éviter des courses). Pièges : données périmées, et le *cache stampede* quand une clé populaire expire (verrou ou recalcul anticipé).
:::

::: details Architecture hexagonale / clean, en une phrase ?
Le domaine (règles métier) ne dépend de rien ; il définit des **ports** (interfaces : `PaymentGateway`, `OrderRepository`) et l'infra fournit des **adaptateurs** (Stripe, Postgres). Bénéfice : tester le métier sans BDD et changer de fournisseur sans toucher au cœur. Risque : sur-abstraire un CRUD simple.
:::

::: details Cohérence forte vs éventuelle ?
Forte : toute lecture voit la dernière écriture (une BDD primaire). Éventuelle : les copies convergent après un délai (réplicas, caches, événements). Choisir par cas d'usage : un solde de compte veut du fort ; un compteur de likes supporte l'éventuel.
:::

## Comportemental

::: tip La méthode STAR
**S**ituation (contexte en 1 phrase), **T**âche (ton rôle, l'enjeu), **A**ction (ce que **tu** as fait — « je », pas « on »), **R**ésultat (chiffré si possible, et ce que tu as appris). Vise 1 min 30 à 2 min. Prépare 5–6 histoires réutilisables : un bug difficile, un désaccord, un échec, une initiative, un délai serré, un apprentissage rapide.
:::

::: details Exemple STAR : « Parle-moi d'un bug difficile. »
**S** : « Dans mon équipe, une API Node de facturation renvoyait des 502 aléatoires, environ 1 % des requêtes, depuis une mise en prod. »
**T** : « J'étais d'astreinte, je devais trouver la cause sans pouvoir reproduire en local. »
**A** : « J'ai corrélé les 502 avec les logs du load balancer : ils arrivaient toujours sur des connexions réutilisées après ~60 s. J'ai vu que le keep-alive de Node (5 s par défaut) était plus court que l'idle timeout du LB (60 s) : Node fermait des connexions que le LB pensait encore ouvertes. J'ai passé `keepAliveTimeout` au-dessus du timeout du LB et ajouté une alerte sur le taux de 502. »
**R** : « Les 502 sont tombés à zéro. J'ai écrit un post-mortem et ajouté ce réglage à notre template de service. J'en ai retenu de toujours regarder les timeouts aux frontières entre composants. »
:::

::: details « Parle-moi d'un désaccord avec un collègue. »
Montre que tu sépares la personne du problème : tu as écouté ses arguments, cherché un critère objectif (benchmark, coût de maintenance, avis de l'équipe, petit prototype), accepté la décision même si elle n'était pas la tienne, ou changé d'avis devant les faits. Évite les histoires où tu « avais raison » contre un idiot.
:::

::: details « Parle-moi d'un échec. »
Un vrai échec (pas « je suis trop perfectionniste »), ta part de responsabilité assumée, ce que tu as fait pour réparer, et surtout ce que tu fais **différemment depuis** (un test ajouté, une checklist de déploiement, demander de l'aide plus tôt).
:::

::: details « Pourquoi veux-tu quitter ton poste / nous rejoindre ? »
Positif et tourné vers l'avenir : ce que tu veux apprendre (ex. « travailler sur des systèmes à plus forte charge, en Rust »), et pourquoi **cette** entreprise (son produit, sa stack, un article de leur blog tech). Ne critique jamais ton employeur actuel.
:::

::: details « Comment tu gères une tâche que tu ne sais pas faire ? »
Timeboxer la recherche seul (doc, code existant, une heure ou deux), préparer une question précise (« j'ai essayé X et Y, je bloque sur Z »), puis demander. Montrer qu'on ne reste ni bloqué trois jours en silence, ni dépendant au moindre doute.
:::

::: details « Quelles questions as-tu pour nous ? »
Toujours en avoir 3. Exemples : « À quoi ressemble une semaine type pour ce poste ? », « Comment se passent les revues de code et les mises en prod ? », « Quel est le plus gros défi technique de l'équipe en ce moment ? », « Comment un dev mid évolue-t-il vers senior chez vous ? ».
:::

::: details « Quel est ton niveau en Rust, honnêtement ? »
Sois précis plutôt que modeste ou vantard : « J'ai écrit une CLI et une petite API Axum + SQLx, je suis à l'aise avec l'ownership, les erreurs et les traits ; je suis moins expérimenté sur l'async avancé et l'`unsafe`. » Puis un exemple de ce que tu as construit.
:::

## Pièges classiques

- Réciter une définition sans exemple : ajoute toujours « par exemple, dans une API de paiement… ».
- Dire « je ne sais pas » et s'arrêter. Dis plutôt : « je ne l'ai pas utilisé, mais je suppose que… parce que… ».
- Répondre trop long : 30 s à 1 min, puis laisser l'intervieweur creuser.
- Inventer : un intervieweur senior le voit tout de suite. L'honnêteté sur une limite vaut mieux qu'un bluff.
- En comportemental : dire « on » tout le temps. L'intervieweur évalue **ton** rôle.

## Défis

1. Choisis 10 questions au hasard, enregistre-toi au téléphone en répondant, réécoute. Coupe ce qui dépasse 1 minute.
2. Écris tes 5 histoires STAR (bug, désaccord, échec, initiative, apprentissage) en 6 lignes chacune.
3. Pour chaque section, trouve **une** question qui manque ici et rédige sa réponse en 3 phrases.

::: details Solution
Pas de corrigé unique. Critère de réussite : chaque réponse tient en moins d'une minute, contient un exemple concret tiré d'un vrai contexte (ton travail, un projet perso), et nomme au moins un compromis ou une limite.
:::

## À retenir

- Réponse type : définition, exemple réel, compromis.
- Les « pourquoi » valent plus que les « quoi » : pourquoi `unknown`, pourquoi un curseur, pourquoi `Arc`.
- Les questions de sécurité et de BDD départagent souvent les mids des juniors.
- Prépare tes histoires STAR à l'avance : on ne les improvise pas bien.
- Garde 3 questions pour l'intervieweur.
