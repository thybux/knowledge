# URL shortener

Ce que tu vas apprendre : concevoir un raccourcisseur d'URL (type bit.ly) de bout en bout — génération d'identifiants, redirection rapide, cache, statistiques de clics — et répondre aux relances classiques.

C'est le sujet d'échauffement le plus fréquent : simple en apparence, il permet de parler d'ID uniques, de cache, de ratio lecture/écriture et d'analytics.

## Exigences

**Fonctionnelles** (à valider avec l'intervieweur) :

1. Créer un lien court à partir d'une URL longue.
2. Rediriger `sho.rt/aZ3kP9q` vers l'URL longue.
3. Alias personnalisé optionnel (`sho.rt/soldes-ete`) et date d'expiration optionnelle.
4. Statistiques simples : nombre de clics par jour.

Hors scope : comptes et facturation, édition du lien, QR codes.

**Non fonctionnelles** :

- Redirection **rapide** : p99 < 50 ms côté serveur.
- Très **disponible** en lecture : un lien imprimé sur une affiche doit marcher.
- Un code ne doit jamais pointer vers deux URL (pas de collision).
- Codes **non devinables** (sinon on peut énumérer tous les liens privés).
- Les stats peuvent avoir quelques minutes de retard (cohérence éventuelle OK).

## Estimations

```text
Créations   : 10 M/mois  ≈ 4 écritures/s (pic ~20/s)
Redirections: 1 Md/mois  ≈ 400 req/s (pic ~2 000/s)
Ratio lecture/écriture ≈ 100:1

Stockage d'un lien ≈ 500 o (URL moy. 200 o + métadonnées)
10 M × 12 × 500 o ≈ 60 Go/an  -> tient sur un Postgres

Espace de codes, base62 (a-z A-Z 0-9) :
  62^6 ≈ 5,7 × 10^10   62^7 ≈ 3,5 × 10^12
120 M liens/an : 7 caractères laissent une marge énorme
```

Conclusion à dire : **l'écriture est triviale, tout le design tourne autour de la lecture** (cache) et de la génération de codes.

## API

```http
POST /v1/links
Authorization: Bearer …
{ "url": "https://shop.fr/p/123?utm=…",
  "alias": "soldes-ete",          (optionnel)
  "expiresAt": "2026-09-01T00:00:00Z" }
-> 201 { "code": "soldes-ete",
         "shortUrl": "https://sho.rt/soldes-ete" }
-> 409 alias déjà pris   -> 422 URL invalide

GET /{code}
-> 302 Location: https://shop.fr/p/123?utm=…
-> 404 inconnu           -> 410 expiré

GET /v1/links/{code}/stats?from=…&to=…
-> 200 { "daily": [{ "day": "2026-06-01", "clicks": 1234 }] }
```

::: details 301 ou 302 pour la redirection ?
`301 Moved Permanently` est mis en cache par le navigateur : les clics suivants ne passent plus par ton serveur → moins de charge, mais **stats faussées** et impossible de changer ou d'expirer le lien pour ce navigateur. `302 Found` (ou `307`) n'est pas mis en cache par défaut : chaque clic est compté. Pour un service avec analytics : 302. On peut ajouter `Cache-Control: private, max-age=60` pour un compromis.
:::

## Modèle de données

```sql
CREATE TABLE links (
  code       text PRIMARY KEY,      -- 'aZ3kP9q'
  target_url text NOT NULL,
  owner_id   uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CHECK (length(code) BETWEEN 4 AND 64)
);
CREATE INDEX ON links (owner_id, created_at DESC);

-- Stats agrégées, jamais une ligne par clic
CREATE TABLE link_clicks_daily (
  code   text NOT NULL REFERENCES links (code),
  day    date NOT NULL,
  clicks bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (code, day)
);
```

La clé primaire sur `code` garantit l'unicité et sert la redirection (lecture par clé). L'index `owner_id` sert « mes liens » dans le dashboard.

Pourquoi Postgres ? 60 Go/an, 400 lectures/s (dont l'essentiel servi par le cache) : largement dans ses capacités. Un key-value (DynamoDB, Cassandra) se justifierait à des centaines de milliards de liens ou en multi-région active-active.

## Architecture

```text
 navigateur
     |
     v
 [ CDN / edge ]   (optionnel : cache 302
     |             des liens très populaires)
     v
 [ Load balancer ]
     |
     v
 [ API redirect + API links ] x N
     |          |           |
     |          v           v
     |      [ Redis ]   [ Queue ]
     |    code -> URL   événements clic
     v                      |
 [ Postgres ] <--- agrégation (worker)
  primaire + réplica       toutes les minutes
```

**Redirection** : `GET /aZ3kP9q` → Redis `GET link:aZ3kP9q` → hit : 302 immédiat ; miss : lecture Postgres (réplica), mise en cache avec TTL, 302. En parallèle, on publie un événement de clic **sans attendre**.

**Création** : validation de l'URL → génération du code → `INSERT` → 201. Pas besoin de cache à l'écriture.

## Deep dive : générer le code

C'est LE sujet de la relance. Compare les options :

| Option | Pour | Contre |
| --- | --- | --- |
| Hash de l'URL | Déterministe | Collisions, tronqué |
| Compteur + base62 | Pas de collision | Devinable, SPOF |
| Aléatoire + retry | Simple, sûr | Retry si collision |
| Plages par instance | Rapide, sans BDD | Trous, complexité |

**Hash** (MD5/SHA-256 tronqué à 7 caractères) : même URL → même code, ce qui empêche deux utilisateurs d'avoir des stats séparées pour la même URL. Et la troncature crée des collisions qu'il faut gérer quand même.

**Compteur** (séquence Postgres encodée en base62) : unique par construction, mais `aaaab`, `aaaac`… sont **énumérables** : n'importe qui peut parcourir tous les liens. On peut brouiller l'encodage (permutation réversible, type Sqids/Hashids) mais ce n'est pas de la sécurité.

**Aléatoire** : 7 caractères base62 tirés avec un générateur cryptographique. Avec 120 M de liens sur 3,5 × 10^12, la probabilité qu'un nouveau code tombe sur un existant est ~0,003 % : on insère, et sur violation d'unicité on retire. C'est le choix recommandé ici.

```ts
import { randomInt } from "node:crypto";

const ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function randomCode(len = 7): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(62)];
  return s;
}

// INSERT ... ; si erreur 23505 (unique_violation) -> on retire
export async function createLink(db: Db, url: string, owner: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const r = await db.query(
      `INSERT INTO links (code, target_url, owner_id)
       VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
      [code, url, owner],
    );
    if (r.rowCount === 1) return code;
  }
  throw new Error("code generation failed");
}
```

`randomInt` utilise le CSPRNG et évite le **biais modulo** de `Math.random() * 62 | 0` (et `Math.random` n'est pas cryptographique).

En Rust, la même idée avec la crate `rand` :

```rust
use rand::Rng;

const ALPHABET: &[u8] =
    b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

fn random_code(len: usize) -> String {
    let mut rng = rand::rng(); // rand 0.9 (ex-thread_rng)
    (0..len)
        .map(|_| ALPHABET[rng.random_range(0..62)] as char)
        .collect()
}
```

**Alias personnalisés** : même table, même contrainte d'unicité ; on refuse les alias réservés (`api`, `admin`, `login`) et on limite les caractères (`^[a-z0-9-]{4,64}$`).

## Deep dive : les clics

Écrire une ligne en base **par clic** = 400 écritures/s, 1 Md de lignes/mois : inutile et coûteux. Options :

1. **Événement en queue** (Kafka, SQS, Redis Streams) puis un worker qui agrège et fait un `UPSERT` par minute :

```sql
INSERT INTO link_clicks_daily (code, day, clicks)
VALUES ($1, $2, $3)
ON CONFLICT (code, day)
DO UPDATE SET clicks = link_clicks_daily.clicks
                     + EXCLUDED.clicks;
```

2. **`INCR` Redis** par `(code, jour)` et un job qui vide les compteurs en base toutes les minutes. Plus simple, mais on perd les clics non vidés si Redis perd ses données.

Le clic ne doit **jamais** ralentir la redirection : publication *fire-and-forget* avec un buffer local, et tant pis pour quelques clics perdus en cas de crash (exigence : stats approximatives OK).

## Cache

- **Cache-aside** dans Redis : clé `link:{code}`, valeur = URL cible (+ `expires_at`), TTL 24 h.
- Les liens sont quasi immuables : l'invalidation n'est un sujet qu'à la suppression ou l'expiration (`DEL` à la suppression, TTL ≤ temps restant avant expiration).
- **Cache négatif** : mettre en cache les codes inconnus quelques minutes (`link:{code} = "∅"`), sinon un bot qui scanne des codes aléatoires frappe la BDD à chaque requête.
- Distribution très inégale (loi de puissance : quelques liens viraux font l'essentiel du trafic) → un petit cache a un excellent taux de hit. Un cache LRU **en mémoire** de chaque instance (quelques milliers d'entrées) devant Redis absorbe les liens viraux.

## Points de défaillance

| Composant en panne | Effet | Mitigation |
| --- | --- | --- |
| Redis | Plus de cache | Lecture BDD, réplica |
| Postgres primaire | Plus de création | Failover ; redirect OK via cache/réplica |
| Queue de clics | Stats en retard | Buffer local, perte tolérée |
| Une instance API | Rien | LB + stateless |
| Lien malveillant | Phishing | Vérif. Safe Browsing, signalement |

Le chemin de redirection doit dépendre du **minimum** de composants : cache + réplica, pas le primaire ni la queue.

## Questions de relance

::: details « Et si on doit gérer 100× plus de liens (centaines de milliards) ? »
Le stockage dépasse un seul Postgres. Options : partitionner la table `links` par hash du `code` (le code est aléatoire → répartition uniforme), puis sharder sur plusieurs instances avec le code comme clé de sharding (la redirection ne lit qu'une clé, donc pas de requête multi-shard). Ou passer à un key-value managé (DynamoDB) dont c'est le cas d'usage parfait. Les stats, elles, partent vers une base analytique (ClickHouse, BigQuery).
:::

::: details « La même URL raccourcie deux fois doit-elle donner le même code ? »
À clarifier. Si oui (dédoublonnage) : index unique sur `(owner_id, hash(target_url))` et on renvoie le lien existant. Mais deux campagnes marketing différentes veulent souvent des stats séparées pour la même URL : par défaut, un nouveau code à chaque création.
:::

::: details « Comment empêcher les abus (spam, phishing) ? »
Rate limit des créations par utilisateur et par IP (voir [Rate limiter](/interview/03-system-design/03-rate-limiter)), vérification des URL contre une liste de domaines malveillants (Google Safe Browsing API) à la création **et** périodiquement, page intermédiaire d'avertissement pour les liens signalés, bouton de signalement, et suppression rapide (avec purge du cache).
:::

::: details « Comment expirer les liens ? »
À la lecture : si `expires_at < now()` → 410, même si le lien est encore en cache (on stocke `expires_at` dans la valeur cachée). Nettoyage asynchrone par un job batch (`DELETE ... WHERE expires_at < now() - interval '30 days'` par lots), ou partitionnement par date si le volume est énorme.
:::

::: details « Pourquoi ne pas utiliser un UUID comme code ? »
Unique sans coordination, mais 36 caractères (22 en base64) : on perd tout l'intérêt d'un lien **court**. 7 caractères aléatoires base62 donnent un espace suffisant avec une collision rarissime gérée par la contrainte d'unicité.
:::

::: details « Redirection multi-région ? »
Lecture : réplicas en lecture ou cache par région, et/ou mise en cache à l'edge (CDN, Workers). Les liens étant quasi immuables, la réplication asynchrone ne pose presque aucun problème. Écriture : une région primaire suffit (4 écritures/s). Le risque : un lien créé il y a 200 ms pas encore répliqué → en cas de miss local, retomber sur la région primaire.
:::

## Pièges classiques

- Utiliser un compteur séquentiel sans voir le problème d'énumération.
- Hash tronqué « sans collision » : avec assez de liens, il y en aura (paradoxe des anniversaires).
- Écrire chaque clic en base dans le chemin de la redirection.
- 301 alors qu'on veut des stats.
- Oublier le cache négatif et laisser un scanner marteler la BDD.
- `Math.random()` pour un identifiant qui doit être imprévisible.

## Défis

1. Avec des codes aléatoires de 6 caractères base62, à partir de combien de liens la probabilité qu'**une** collision ait eu lieu dépasse-t-elle 50 % ? (indice : paradoxe des anniversaires, ≈ 1,18 × √N)
2. Écris la requête qui renvoie le top 10 des liens d'un utilisateur par clics sur les 7 derniers jours.
3. L'intervieweur dit : « Redis est en panne et un lien viral fait 50 000 req/s. » Que se passe-t-il, et que fais-tu ?

::: details Solution
1. N = 62^6 ≈ 5,7 × 10^10, √N ≈ 2,4 × 10^5, donc ≈ 280 000 liens. Bien sûr, le retry sur contrainte unique la gère, mais ça montre qu'on n'a pas « zéro collision » avec un tirage aléatoire.
2. Une requête :

```sql
SELECT l.code, l.target_url, sum(c.clicks) AS clicks
FROM links l
JOIN link_clicks_daily c ON c.code = l.code
WHERE l.owner_id = $1
  AND c.day >= current_date - 6
GROUP BY l.code, l.target_url
ORDER BY clicks DESC
LIMIT 10;
```

3. Sans Redis, tout le trafic tombe sur les réplicas Postgres, qui risquent de saturer. Défenses en couches : cache LRU **en mémoire** de chaque instance (le lien viral y est forcément), cache CDN court sur la réponse 302, coalescing des requêtes concurrentes pour la même clé (une seule lecture BDD en vol par code), et circuit breaker pour ne pas noyer la BDD.
:::

## À retenir

- Ratio lecture/écriture ≈ 100:1 : tout se joue sur le chemin de lecture.
- Codes aléatoires base62 (CSPRNG) + contrainte `UNIQUE` + retry : simple et non devinable.
- 302 si on veut compter les clics ; 301 si on veut décharger le serveur.
- Les clics sont agrégés de façon asynchrone, jamais écrits un par un dans le chemin critique.
- Cache-aside + cache négatif + cache local pour les liens viraux.
