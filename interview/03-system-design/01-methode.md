# Méthode

Ce que tu vas apprendre : un déroulé en 7 étapes pour tenir 45 minutes de system design sans te perdre, avec des phrases toutes faites et un mini exemple complet (un export CSV asynchrone de back-office).

## Le plan en 45 minutes

```text
 0-5   1. Exigences (fonctionnelles + non fonct.)
 5-10  2. Estimations (charge, stockage)
10-15  3. API
15-20  4. Modèle de données
20-30  5. Architecture haut niveau
30-40  6. Deep dive (1 ou 2 composants)
40-45  7. Compromis, pannes, évolutions
```

Ce n'est pas une prison : si l'intervieweur veut creuser l'API tout de suite, suis-le. Mais avoir le plan en tête t'empêche de passer 25 minutes sur un détail et d'oublier les pannes.

::: tip Écris au fur et à mesure
Sur le tableau (ou le doc partagé), garde une colonne « Exigences » et une colonne « Chiffres » visibles tout le temps. Tu y reviendras pour justifier chaque choix : « on a dit p99 < 200 ms, donc… ».
:::

## 1. Exigences (5 min)

**Fonctionnelles** : ce que le système fait. Limite-toi à 3–4 cas d'usage principaux et dis explicitement ce que tu laisses de côté.

**Non fonctionnelles** : comment il doit le faire.

- Volume : combien d'utilisateurs, de requêtes, de données ?
- Latence : temps réel, interactif (< 200 ms), ou batch ?
- Disponibilité : que coûte une panne d'1 h ?
- Cohérence : peut-on lire une donnée périmée ?
- Durabilité : peut-on perdre des données ? (jamais pour un paiement, OK pour un compteur de vues)
- Sécurité, multi-tenant, conformité (RGPD : suppression, localisation des données).

Phrases utiles :

- « Je propose de me concentrer sur X et Y, et de laisser Z hors scope. Ça te va ? »
- « Est-ce qu'il vaut mieux être lent ou être faux ici ? »

## 2. Estimations (5 min)

Le but n'est pas la précision mais **l'ordre de grandeur** qui orientera les choix (1 Postgres ou du sharding ? cache nécessaire ?).

```text
Utilisateurs actifs/jour (DAU)  : 1 M
Actions par utilisateur/jour    : 10
-> 10 M req/jour ≈ 120 req/s, pic ×3 ≈ 400 req/s
Ratio lecture/écriture          : 10:1
Taille d'un objet               : 1 Ko
Stockage/an : 1 M écritures/jour × 1 Ko × 365 ≈ 365 Go
```

Conclus toujours : « donc une base Postgres bien indexée suffit, pas besoin de sharder au départ ». Voir les chiffres de [System design](/interview/03-system-design/).

## 3. API (5 min)

Liste les endpoints principaux, avec entrée, sortie et codes d'erreur importants. Ça force à clarifier le comportement.

```http
POST /v1/orders
Idempotency-Key: 8f1c…
{ "items": [...], "currency": "EUR" }
-> 201 { "id": "ord_123", "status": "pending" }
-> 409 si la clé est réutilisée avec un autre body
```

Points à évoquer : authentification, pagination par curseur, idempotence des `POST`, versionnage, sync (`200`) vs async (`202 Accepted` + ressource de suivi).

## 4. Modèle de données (5 min)

Les tables principales, les clés, les **index** justifiés par les requêtes de l'API. C'est le moment où un dev backend marque des points.

```sql
CREATE TABLE orders (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  status      text NOT NULL,
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- sert GET /orders?status=…, trié par date
CREATE INDEX ON orders (tenant_id, status, created_at DESC);
```

Questions à te poser : quelle est la clé d'accès principale ? Quelles requêtes doivent être rapides ? Quelles contraintes protègent les invariants (`UNIQUE`, `CHECK`, FK) ? SQL ou autre chose, et **pourquoi** ? Voir [Modélisation](/bdd/02-modelisation).

## 5. Architecture haut niveau (10 min)

Dessine les boîtes et les flèches pour les cas d'usage principaux, puis **déroule une requête** de bout en bout. Commence par le minimum qui marche.

```text
client -> LB -> API (x3) -> Postgres
                  |
                  +-> Redis (cache)
                  +-> Queue -> Worker
```

Pour chaque boîte ajoutée, une phrase de justification liée aux exigences : « le cache parce qu'on a 10 lectures pour 1 écriture et un p99 à 50 ms ».

## 6. Deep dive (10 min)

Souvent choisi par l'intervieweur, sinon propose le point le plus risqué. Sujets classiques :

- génération d'identifiants uniques ;
- stratégie de cache et invalidation ;
- garanties de livraison d'une queue (at-least-once → idempotence) ;
- concurrence (deux requêtes qui modifient la même ligne) ;
- scaling de la BDD (réplicas, partitionnement, sharding).

Va jusqu'au concret : la requête SQL, la clé Redis, le pseudo-code du worker.

## 7. Compromis et pannes (5 min)

Passe chaque composant en revue : « s'il tombe, que se passe-t-il ? ».

| Panne | Réponse type |
| --- | --- |
| Une instance API | LB la retire, stateless |
| Redis | Mode dégradé, lire la BDD |
| Postgres primaire | Failover vers réplica |
| Worker crash | Message re-livré, idempotent |
| Dépendance lente | Timeout + circuit breaker |

Termine par les évolutions : « à 10× la charge, je ferais d'abord X, puis Y ».

## Mini exemple : export CSV asynchrone

**Énoncé** : « Dans le back-office d'un SaaS, les admins veulent exporter toutes les commandes d'une période en CSV. »

### Exigences

- Fonctionnel : lancer un export (période, filtres), suivre son état, télécharger le fichier. Hors scope : planification récurrente.
- Non fonctionnel : jusqu'à 5 M de lignes par export, ne doit **pas** ralentir l'API, fichier disponible 7 jours, un tenant ne voit que ses exports.

### Estimations

```text
5 000 tenants, ~200 exports/jour -> charge API nulle
Pire export : 5 M lignes × 200 o ≈ 1 Go de CSV
Lecture BDD : 5 M lignes, plusieurs minutes
-> impossible en synchrone (timeout HTTP ~30-60 s)
```

### API

```http
POST /v1/exports  { "from": "2026-01-01", "to": "2026-03-31" }
-> 202 { "id": "exp_42", "status": "queued" }

GET /v1/exports/exp_42
-> 200 { "status": "done", "url": "https://…signed…" }
```

### Modèle

```sql
CREATE TABLE exports (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL,
  params     jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'queued',
  -- queued | running | done | failed
  file_key   text,
  error      text,
  attempts   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### Architecture

```text
admin -> API --INSERT--> exports (queued)
                |
                +--> queue (job exp_42)
                          |
                          v
                       Worker
                  stream SELECT (réplica)
                  -> CSV gzip -> S3
                  -> UPDATE status=done
admin <- GET -> URL S3 pré-signée (15 min)
```

### Deep dive : le worker

- Lire en **streaming** (curseur côté serveur / `COPY ... TO STDOUT`), jamais 5 M lignes en mémoire.
- Écrire en **multipart upload** vers S3 au fil de l'eau.
- Lire sur un **réplica** pour ne pas charger le primaire.
- Si le worker crashe : le job est re-livré (`attempts + 1`), on recommence l'export de zéro (simple, et l'upload S3 est écrasé sous la même clé → idempotent).
- Après 3 échecs : `status = failed` et alerte.

```ts
// Le cœur du worker (Node) : stream de bout en bout
await pipeline(
  pgCopyStream(client, sql),   // lignes CSV
  createGzip(),
  s3MultipartUpload(bucket, key),
);
```

Voir [Performance Node](/dev/typescript/09-performance-node) pour `pipeline` et le backpressure.

### Compromis

- Un job par table `exports` + polling (pg-boss, `SELECT ... FOR UPDATE SKIP LOCKED`) évite d'ajouter un broker. Une vraie queue (SQS, RabbitMQ) se justifie si le volume de jobs explose.
- Polling du statut côté front (toutes les 3 s) vs notification (email, websocket) : polling d'abord, c'est suffisant.
- Expiration : règle de cycle de vie S3 à 7 jours + nettoyage des lignes.

## Questions de relance

::: details « Pourquoi ne pas générer le CSV directement dans la requête HTTP ? »
Un export de plusieurs minutes dépasse les timeouts du LB et du navigateur, bloque une connexion BDD longtemps et ne survit pas à un redéploiement. L'asynchrone (202 + suivi) découple la durée du traitement de la durée de la requête. Pour de petits exports (< 10 000 lignes), on peut garder un endpoint synchrone en streaming.
:::

::: details « Deux admins lancent le même export en même temps ? »
Soit on accepte deux jobs (coût faible ici), soit on déduplique : contrainte d'unicité sur `(tenant_id, hash(params))` pour les exports `queued`/`running` (index unique partiel), et on renvoie l'export existant.
:::

::: details « Comment éviter qu'un tenant monopolise les workers ? »
Limiter le nombre d'exports concurrents **par tenant** (compteur en base ou dans Redis, vérifié au dépôt du job), ou des files par priorité. C'est un problème de *fairness* classique en multi-tenant.
:::

::: details « Comment garantir qu'un admin ne télécharge pas l'export d'un autre tenant ? »
`GET /exports/:id` filtre par `tenant_id` de la session (404 sinon), et l'URL S3 pré-signée a une durée courte. Le bucket n'est jamais public.
:::

## Pièges classiques

- Ne jamais revenir aux exigences : tes choix semblent arbitraires.
- Rester flou (« on stocke en base ») au lieu de montrer le schéma et l'index.
- Tout faire en synchrone, ou au contraire tout mettre dans des queues sans raison.
- Ignorer l'intervieweur qui essaie de t'orienter vers un deep dive.
- Finir sans avoir parlé des pannes.

## Défis

1. Applique les étapes 1 et 2 à : « un service de stockage de reçus de caisse (photos) pour une app de notes de frais ». Donne 3 exigences non fonctionnelles et une estimation de stockage annuel.
2. Pour le mini exemple, que se passe-t-il si le worker crashe après l'upload S3 mais avant l'`UPDATE status = done` ?

::: details Solution
1. Exemples : photos jamais perdues (durabilité, stockage objet répliqué), upload rapide sur mobile en 4G (upload direct vers S3 en URL pré-signée), données conservées 10 ans pour la compta mais supprimables par utilisateur (RGPD). Estimation : 200 000 utilisateurs × 20 reçus/mois × 500 Ko ≈ 2 To/mois ≈ 24 To/an → stockage objet (avec classe d'archivage après 1 an), métadonnées en Postgres.
2. Le job est re-livré, le worker refait l'export et réécrit **la même clé** S3 (dérivée de l'id d'export), puis fait l'`UPDATE`. Résultat correct, juste du travail en double : c'est l'idempotence par écrasement. Si l'opération n'était pas rejouable sans effet (envoyer un email), il faudrait tracer l'étape déjà faite.
:::

## À retenir

- 7 étapes : exigences, estimations, API, données, archi, deep dive, pannes.
- Chaque composant ajouté est justifié par une exigence ou un chiffre.
- Le schéma SQL + les index et l'API sont ton terrain fort de dev backend : soigne-les.
- Déroule une requête de bout en bout sur ton diagramme.
- Termine toujours par « s'il tombe, que se passe-t-il ? » et « à 10×, je ferais… ».
