# System design

Ce que tu vas apprendre : ce qu'on attend d'un mid (et d'un senior) dans un entretien de system design, le vocabulaire de base expliqué simplement, et les ordres de grandeur à connaître par cœur pour estimer sans calculatrice.

## Ce qu'on attend de toi

L'entretien dure 45–60 min. Il n'y a **pas** de bonne réponse unique : on évalue ta démarche et ta capacité à justifier des compromis.

| Attendu | Mid | Senior |
| --- | --- | --- |
| Exigences | Les poser avec aide | Les mener, prioriser |
| Archi | Classique et correcte | Adaptée, chiffrée |
| Deep dive | 1 composant | Plusieurs, en profondeur |
| Compromis | Les citer | Les quantifier |
| Pannes | Points évidents | Modes de défaillance fins |

Pour un **mid**, l'objectif réaliste :

- poser les exigences fonctionnelles et non fonctionnelles sans qu'on te les souffle ;
- dessiner une architecture standard qui fonctionne (client → LB → API stateless → BDD + cache + queue) ;
- concevoir un **schéma de données** et une **API** propres : c'est là qu'un dev backend mid brille ;
- approfondir un point (index, idempotence, file de jobs) et dire ce qui casse.

Le **senior** ajoute : estimation chiffrée qui guide les choix, plusieurs alternatives comparées, stratégie de migration, coût, opérabilité (monitoring, on-call), impact organisationnel.

::: tip L'erreur n°1
Dessiner Kafka, Kubernetes et 12 microservices pour une app à 50 requêtes/s. Commence simple, et fais grossir **quand un chiffre l'exige**. « Une seule instance Postgres tient largement cette charge » est une excellente phrase d'entretien… si tu l'as justifiée par une estimation.
:::

## Vocabulaire essentiel

### Latence et débit

- **Latence** : temps pour traiter **une** requête (ms). On parle en percentiles : p50 (médiane), p95, p99. Le p99 est ce que vivent tes pires utilisateurs ; une moyenne cache tout.
- **Débit** (throughput) : nombre de requêtes traitées par seconde (RPS, QPS).

Les deux sont liés mais distincts : un batch peut avoir un gros débit et une latence de plusieurs minutes.

```text
Loi de Little : en vol = débit × latence
200 req/s × 0,05 s = 10 requêtes simultanées
-> un pool de 10 connexions BDD est déjà juste
```

### Scalabilité

- **Verticale** (scale up) : une plus grosse machine. Simple, plafond physique et coût.
- **Horizontale** (scale out) : plus de machines. Exige des services **stateless** (l'état est en BDD, Redis, S3 — pas en mémoire du process).

### Disponibilité

Pourcentage du temps où le service répond correctement.

| SLO | Indispo / an | Indispo / mois |
| --- | --- | --- |
| 99 % | 3,65 jours | 7,3 h |
| 99,9 % | 8,8 h | 44 min |
| 99,95 % | 4,4 h | 22 min |
| 99,99 % | 53 min | 4,4 min |

Les dépendances **en série** multiplient leurs disponibilités : trois composants à 99,9 % donnent ≈ 99,7 %. Les redondances **en parallèle** l'améliorent.

### Cohérence

- **Forte** : une lecture après une écriture voit toujours la nouvelle valeur.
- **Éventuelle** : les copies (réplicas, caches) convergent après un délai. Ex : tu publies un commentaire, ton collègue le voit 1 s plus tard.
- **Read-your-writes** : compromis courant ; l'auteur voit immédiatement sa propre écriture (on lit sur le primaire juste après une écriture).

### CAP, en simple

Dans un système distribué, une **partition réseau** (P) finira par arriver. À ce moment-là, il faut choisir :

- **C** (cohérence) : refuser de répondre plutôt que répondre faux. Ex : un solde bancaire.
- **A** (disponibilité) : répondre quand même, avec une donnée peut-être périmée. Ex : un panier, un fil d'actualité.

« CA » n'existe pas vraiment en distribué : on ne choisit pas d'avoir des partitions.

### PACELC, la version utile

CAP ne parle que des pannes. PACELC ajoute le cas normal : **si P**artition, choisir **A** ou **C** ; **E**lse (fonctionnement normal), choisir **L**atence ou **C**ohérence.

```text
Réplication synchrone   -> cohérent, mais chaque écriture
                           attend le réplica (latence)
Réplication asynchrone  -> rapide, mais un réplica peut
                           être en retard (lecture périmée)
```

C'est le compromis que tu fais tous les jours en lisant sur un réplica Postgres.

### Autres termes à placer

- **Idempotence** : rejouer une opération N fois = l'effet d'une fois. Indispensable dès qu'il y a des retries. Voir [Paiements & idempotence](/interview/03-system-design/05-paiements-idempotence).
- **Sharding / partitionnement** : répartir les données sur plusieurs nœuds selon une clé. Voir [Choisir & scaler](/bdd/09-choisir-et-scaler).
- **Réplication** : copies d'une même donnée (lecture, haute dispo).
- **Back-pressure** : ralentir le producteur quand le consommateur sature.
- **SPOF** : *single point of failure*, un composant dont la panne arrête tout.

## Les chiffres à connaître

### Latences (ordres de grandeur)

| Opération | Ordre |
| --- | --- |
| Accès RAM | 100 ns |
| Lecture SSD NVMe aléatoire | 20–100 µs |
| Aller-retour même datacenter | 0,5 ms |
| GET Redis (réseau inclus) | < 1 ms |
| Requête SQL simple indexée | 1–5 ms |
| Aller-retour Paris ↔ New York | 70–90 ms |
| Handshake TLS + TCP lointain | 150–250 ms |
| Seek disque dur (HDD) | 5–10 ms |

À retenir : mémoire ≪ réseau local ≪ disque ≪ réseau intercontinental. Un appel réseau de plus dans une boucle coûte des millisecondes, pas des nanosecondes.

### Débits (une instance, ordre de grandeur)

| Composant | Ordre |
| --- | --- |
| API Node / Rust stateless | 1k–20k req/s |
| Postgres, lectures indexées | 10k+ req/s |
| Postgres, écritures | 1k–10k tx/s |
| Redis | ~100k ops/s |
| Kafka (partition) | 10+ Mo/s |

Ces chiffres varient énormément selon la machine et la requête : sers-t'en pour savoir si tu as besoin de **1 ou de 100** machines, pas pour dimensionner au pourcent près.

### Conversions utiles

```text
1 jour        ≈ 86 400 s ≈ 10^5 s
1 M req/jour  ≈ 12 req/s
100 M req/jour≈ 1 200 req/s (pic ≈ ×2 à ×5)
1 an          ≈ 3 × 10^7 s
1 Ko × 1 M    = 1 Go
1 Ko × 1 Md   = 1 To
```

### Tailles typiques

- Un UUID : 16 octets (36 en texte). Un `BIGINT` : 8 octets.
- Une ligne « utilisateur » : ~1 Ko. Un événement JSON : 0,5–2 Ko.
- Une image compressée : 100 Ko – 2 Mo.

## Le squelette d'architecture standard

Presque tous les sujets partent de là, puis on ajoute ce que les chiffres demandent.

```text
 client
   |
   v
[ CDN ] (statique, cache)
   |
   v
[ Load balancer ]
   |
   v
[ API stateless ] x N ----> [ Redis ]
   |        |               (cache, rate limit)
   |        v
   |    [ Queue ] ---> [ Workers ]
   v                       |
[ Postgres primaire ] <----+
   |
   v (réplication async)
[ Réplicas lecture ]
```

## Les études de cas

1. [Méthode](/interview/03-system-design/01-methode) : le déroulé en 45 minutes.
2. [URL shortener](/interview/03-system-design/02-url-shortener) : génération d'ID, cache, lecture massive.
3. [Rate limiter](/interview/03-system-design/03-rate-limiter) : algorithmes, Redis, distribué.
4. [Notifications](/interview/03-system-design/04-notifications) : files, retries, préférences.
5. [Paiements & idempotence](/interview/03-system-design/05-paiements-idempotence) : le sujet qui sépare les seniors.

## Pièges classiques

- Sauter les exigences et dessiner directement.
- Utiliser des mots (« on shard », « eventual consistency ») sans pouvoir expliquer le coût.
- Oublier les **pannes** : que se passe-t-il si Redis tombe ? si le worker crashe au milieu ?
- Confondre latence et débit, ou raisonner en moyenne au lieu du p99.
- Mettre de l'état en mémoire d'un service qu'on veut scaler horizontalement.

## Défis

1. Une API reçoit 50 M requêtes par jour, avec un pic à ×4. Combien de req/s au pic ? Une seule instance Node suffit-elle ?
2. Ton service appelle 4 dépendances en série, chacune à 99,9 %. Quelle est ta disponibilité maximale ?
3. Une requête fait 30 appels Redis séquentiels dans une boucle. Ordre de grandeur de la latence ajoutée ? Correction ?

::: details Solution
1. 50 M / 10^5 s ≈ 500 req/s en moyenne, ≈ 2 000 req/s au pic. Une instance pourrait tenir sur un endpoint simple, mais il en faut **au moins 2–3** pour la haute dispo et les déploiements sans coupure.
2. 0,999^4 ≈ 0,996 → 99,6 %, soit ~35 h d'indisponibilité par an. D'où l'intérêt des timeouts, fallbacks et appels en parallèle.
3. 30 × ~0,5 ms ≈ 15 ms juste en allers-retours réseau. Utiliser `MGET` ou un pipeline Redis (1 aller-retour).
:::

## À retenir

- Mid : exigences claires, architecture standard correcte, bon schéma de données, un deep dive solide.
- Raisonne en p99, et en ordres de grandeur (1 M/jour ≈ 12/s).
- CAP = que faire pendant une partition ; PACELC ajoute latence vs cohérence au quotidien.
- Simple d'abord ; chaque composant ajouté doit être justifié par un chiffre ou une exigence.
- Parle toujours des pannes et des retries.
