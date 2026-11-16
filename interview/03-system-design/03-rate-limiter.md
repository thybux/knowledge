# Rate limiter

Ce que tu vas apprendre : concevoir un rate limiter distribué pour une API publique — les 5 algorithmes et leurs compromis, l'implémentation atomique dans Redis, les en-têtes HTTP, et le comportement en cas de panne.

## Exigences

**Fonctionnelles** :

1. Limiter les requêtes par **clé d'API** selon le plan du client (ex. Free : 60 req/min, Pro : 1 000 req/min).
2. Limiter les tentatives de **login** par IP et par compte (10 par 15 min) contre le brute force.
3. Répondre `429 Too Many Requests` avec les infos pour réessayer.
4. Règles modifiables sans redéploiement.

**Non fonctionnelles** :

- Fonctionne avec **N instances** d'API derrière un load balancer (limite globale, pas par instance).
- Surcoût de latence minimal : < 2 ms par requête.
- Tolérant aux pannes : la panne du limiter ne doit pas faire tomber l'API (à discuter : *fail-open* vs *fail-closed*).
- Précision « raisonnable » : dépasser de 1–2 % une limite est acceptable, pas de 2×.

## Estimations

```text
Trafic total      : 10 000 req/s au pic
Clés d'API actives: 1 M
État par clé      : ~100 o (compteur + timestamp + overhead)
-> 1 M × 100 o ≈ 100 Mo dans Redis : trivial
1 aller-retour Redis par requête : ~0,5 ms (même DC)
10 000 ops/s : une instance Redis suffit (~100k ops/s)
```

## Où le placer ?

```text
client -> [ API gateway / reverse proxy ] -> API
              rate limit "grossier" (IP)
                         |
                         v
               [ middleware applicatif ]
               rate limit "métier" (clé, plan,
               endpoint, tenant)
```

- **Edge / gateway** (Nginx `limit_req`, Envoy, Cloudflare) : protège contre les floods par IP avant même d'atteindre ton code.
- **Middleware applicatif** : seul endroit qui connaît la clé d'API authentifiée, le plan et le tenant. C'est celui qu'on conçoit ici.

Les deux sont complémentaires.

## Les algorithmes

| Algorithme | Pour | Contre |
| --- | --- | --- |
| Fenêtre fixe | Trivial (1 INCR) | Rafale ×2 en bordure |
| Journal glissant | Exact | Mémoire O(requêtes) |
| Fenêtre glissante approx. | Précis, O(1) | Approximation |
| Token bucket | Rafales contrôlées | 2 valeurs, Lua |
| Leaky bucket | Débit lissé | Ajoute de la latence |

### Fenêtre fixe

Un compteur par fenêtre : `rl:{key}:{minute}`. `INCR`, et si le résultat > limite → 429.

```text
limite 100/min
12:00:59  100 requêtes  (fenêtre 12:00, OK)
12:01:00  100 requêtes  (fenêtre 12:01, OK)
-> 200 requêtes en 2 secondes
```

Le problème de bordure est réel mais souvent acceptable pour des limites généreuses.

### Journal glissant (sliding log)

Un *sorted set* Redis avec le timestamp de chaque requête ; on supprime ceux de plus d'une minute et on compte. Exact, mais une clé à 1 000 req/min stocke 1 000 entrées. Réservé aux petites limites (login : 10 par 15 min).

### Fenêtre glissante approximée

On garde le compteur de la fenêtre courante et de la précédente, et on pondère :

```text
estimé = courant + précédent × (1 - écoulé / fenêtre)
ex. 12:01:15, précédent=80, courant=30
    30 + 80 × (1 - 15/60) = 30 + 60 = 90
```

Deux compteurs par clé, très bonne précision : c'est un excellent choix par défaut.

### Token bucket

Un seau de capacité `C` qui se recharge de `r` jetons par seconde ; chaque requête consomme un jeton. Autorise des **rafales** jusqu'à `C`, avec un débit moyen `r`. C'est le modèle de la plupart des API publiques (AWS, Stripe…).

Tu l'as implémenté dans [Défis Rust](/interview/02-pratique/02-defis-rust) (exercice 5) : recharge paresseuse calculée à la demande, horloge injectée.

### Leaky bucket

Une file de taille fixe vidée à débit constant : les requêtes sont **retardées** plutôt que rejetées. Utile pour lisser des appels *sortants* vers un partenaire qui impose un débit strict, moins pour une API publique.

## Implémentation distribuée avec Redis

L'état doit être **partagé** entre les instances et mis à jour **atomiquement**. Le piège classique :

```ts
// ❌ race condition : deux instances lisent 99
const n = Number(await redis.get(key));
if (n >= limit) return reject();
await redis.set(key, n + 1);
```

### Fenêtre fixe : `INCR` est atomique

```ts
const windowSec = 60;
const slot = Math.floor(Date.now() / 1000 / windowSec);
const key = `rl:${apiKey}:${slot}`;

// node-redis : exec() renvoie les valeurs
// (ioredis renvoie des paires [err, valeur])
const [count] = await redis
  .multi()
  .incr(key)
  .expire(key, windowSec * 2)
  .exec();

if (count > limit) return tooManyRequests(res, slot);
```

### Token bucket : script Lua

Plusieurs lectures/écritures doivent être atomiques → un script Lua, exécuté par Redis sans interruption.

```lua
-- KEYS[1] = clé du seau
-- ARGV : capacité, jetons/s, maintenant (ms)
local cap  = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now  = tonumber(ARGV[3])

local b = redis.call("HMGET", KEYS[1], "tokens", "ts")
local tokens = tonumber(b[1]) or cap
local ts     = tonumber(b[2]) or now

local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(cap, tokens + elapsed * rate)

local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call("HSET", KEYS[1], "tokens", tokens, "ts", now)
redis.call("PEXPIRE", KEYS[1],
  math.ceil(cap / rate * 1000) + 1000)
return { allowed, tokens }
```

Points à mentionner :

- L'**horloge** : si chaque instance envoie son `Date.now()`, une instance en avance de 2 s fausse le calcul. Utilise `redis.call("TIME")` dans le script pour une horloge unique.
- Le **TTL** : un seau inactif se remplit ; après `cap / rate` secondes, il est plein, donc on peut le supprimer → la mémoire ne grossit pas avec les clés inactives.
- Charger le script une fois (`SCRIPT LOAD`) puis `EVALSHA` : la plupart des clients le font automatiquement.

## Configuration des règles

```sql
CREATE TABLE rate_limit_rules (
  id          serial PRIMARY KEY,
  plan        text NOT NULL,        -- 'free' | 'pro'
  route       text NOT NULL,        -- '*' | 'POST /v1/charges'
  capacity    int  NOT NULL CHECK (capacity > 0),
  refill_rate numeric NOT NULL,     -- jetons/s
  UNIQUE (plan, route)
);
```

Les règles sont lues au démarrage et rafraîchies toutes les 30 s (ou sur notification), et gardées **en mémoire** de chaque instance : on ne va pas lire Postgres à chaque requête.

## Architecture

```text
 client
   |
   v
[ LB / gateway ] -- limite IP grossière
   |
   v
[ API ] x N
   | 1. auth -> api_key, plan
   | 2. règle (cache mémoire)
   | 3. EVALSHA token_bucket ----> [ Redis ]
   |    allowed ?                  (primaire +
   | 4a. non -> 429                 réplica)
   | 4b. oui -> handler
   v
[ Postgres ] (règles, données métier)
```

## La réponse HTTP

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 12
RateLimit-Policy: "default";q=100;w=60
RateLimit: "default";r=0;t=12
Content-Type: application/json

{ "error": "rate_limited", "retryAfter": 12 }
```

`Retry-After` est standard (RFC 9110) et compris par les clients. Les en-têtes `RateLimit` / `RateLimit-Policy` viennent d'un **brouillon IETF** dont le format a changé entre versions ; beaucoup d'API exposent encore les anciens `X-RateLimit-Limit` / `X-RateLimit-Remaining`. Renvoie-les aussi sur les réponses 200 pour que les clients puissent ralentir avant d'être bloqués.

## Points de défaillance

**Redis indisponible** : la décision clé.

- **Fail-open** (laisser passer) : l'API reste disponible, mais sans protection pendant la panne. Choix habituel pour les limites de **confort** (quota par plan).
- **Fail-closed** (tout refuser) : sûr, mais transforme une panne Redis en panne totale. Pour les limites de **sécurité** (login, envoi de SMS payants), on peut préférer un repli : un limiter **local** en mémoire par instance avec `limite / N`.

Toujours : timeout court sur l'appel Redis (ex. 50 ms) et circuit breaker, sinon un Redis lent ralentit **toutes** les requêtes.

**Clé chaude** : un seul client à 5 000 req/s concentre tout sur une clé Redis, donc un seul shard d'un cluster. Option : pré-filtrer localement (si le client a déjà été refusé il y a 100 ms, refuser sans appeler Redis).

**Multi-région** : un Redis par région = limites par région (le client peut doubler sa limite en touchant deux régions). Synchroniser globalement coûte une latence inter-région. Le compromis courant : limite par région, ou quota global réparti entre régions.

## Questions de relance

::: details « Pourquoi ne pas limiter en mémoire dans chaque instance ? »
Avec N instances derrière un LB en round-robin, chaque instance voit ~1/N du trafic : la limite effective devient N × limite, et change à chaque autoscaling. Ça peut marcher en approximation (`limite / N` par instance) si N est stable, et c'est un bon **repli** quand Redis est en panne. Mais la source de vérité doit être partagée.
:::

::: details « Comment limiter des requêtes coûteuses différemment ? »
Pondérer : chaque requête consomme un **coût** en jetons (`GET` = 1, export = 50, requête GraphQL = coût calculé). Le script Lua prend le coût en argument au lieu de 1. C'est ce que font les API GraphQL publiques avec un budget de points.
:::

::: details « Comment éviter qu'un client bloqué revienne en boucle ? »
`Retry-After` explicite, puis côté client un backoff exponentiel avec jitter. Côté serveur, pour les abus, un *ban* temporaire après X refus (clé `ban:{ip}` avec TTL) vérifiée au niveau gateway, avant tout calcul.
:::

::: details « Le rate limiter suffit-il contre un DDoS ? »
Non. Un DDoS sature la bande passante ou le LB avant d'atteindre ton code. Il faut une protection en amont (CDN/WAF type Cloudflare, AWS Shield). Le rate limiter applicatif protège contre l'abus d'un client authentifié et le brute force, pas contre un flood réseau.
:::

::: details « Limite de login par IP : quel problème ? »
Des milliers d'utilisateurs derrière la même IP (NAT d'entreprise, opérateur mobile CGNAT) partagent la limite. Et un attaquant avec un botnet change d'IP. Combine : limite par **compte ciblé** (10 échecs → délai croissant ou CAPTCHA), par IP plus large, et détection de *credential stuffing* (beaucoup de comptes différents depuis la même source).
:::

::: details « Comment le tester ? »
La logique pure (token bucket avec horloge injectée) en tests unitaires instantanés. Le script Lua contre un vrai Redis en conteneur (Testcontainers) : rafale, recharge, expiration, concurrence (100 requêtes en parallèle → exactement `cap` acceptées). Puis un test de charge pour mesurer le surcoût de latence.
:::

## Pièges classiques

- `GET` puis `SET` non atomique : la limite est dépassée sous concurrence.
- Oublier le `EXPIRE` : Redis grossit sans fin avec les clés de fenêtres passées.
- Horloges des instances différentes dans le calcul.
- Appeler Redis sans timeout dans le chemin critique.
- Ne pas renvoyer `Retry-After` : les clients réessaient immédiatement.
- Limiter par IP derrière un proxy sans lire correctement `X-Forwarded-For` (on limite alors… le load balancer). Et ne faire confiance à cet en-tête que s'il est posé par ton propre proxy.

## Défis

1. Fenêtre glissante approximée, limite 100/min. À 12:03:40, la fenêtre 12:02 a 90 requêtes, la fenêtre 12:03 en a 35. La requête suivante passe-t-elle ?
2. Écris un middleware Express/Fastify (pseudo-code) qui applique la fenêtre fixe Redis et pose les en-têtes `X-RateLimit-Remaining` et `Retry-After`.
3. Un token bucket de capacité 10, recharge 1 jeton/s. Un client envoie 10 requêtes à t=0, puis 1 requête par seconde. Combien sont acceptées sur les 30 premières secondes ?

::: details Solution
1. Écoulé = 40 s sur 60. Estimé = 35 + 90 × (1 − 40/60) = 35 + 30 = 65 < 100 → elle passe.
2. Une version :

```ts
async function rateLimit(req, res, next) {
  const limit = 100, win = 60;
  const slot = Math.floor(Date.now() / 1000 / win);
  const key = `rl:${req.apiKey}:${slot}`;
  const [count] = await redis.multi()
    .incr(key).expire(key, win * 2).exec();
  res.set("X-RateLimit-Limit", String(limit));
  res.set("X-RateLimit-Remaining",
    String(Math.max(0, limit - count)));
  if (count > limit) {
    const reset = (slot + 1) * win - Date.now() / 1000;
    res.set("Retry-After", String(Math.ceil(reset)));
    return res.status(429).json({ error: "rate_limited" });
  }
  next();
}
```

3. Les 10 requêtes de t=0 vident le seau. Ensuite 1 jeton/s est rechargé et le client consomme 1 req/s : chacune passe. Donc 10 + 29 ≈ 39 acceptées (toutes), le débit soutenu étant égal au taux de recharge.
:::

## À retenir

- Token bucket (rafales) ou fenêtre glissante approximée (précision O(1)) sont les bons défauts.
- L'état est partagé dans Redis et mis à jour **atomiquement** (`INCR`, script Lua).
- Une seule horloge (Redis `TIME`), un TTL sur chaque clé.
- Décide explicitement fail-open vs fail-closed selon la nature de la limite.
- `429` + `Retry-After`, et les en-têtes de quota sur toutes les réponses.
