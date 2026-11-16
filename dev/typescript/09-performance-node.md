<script setup>
import lru from "./challenges/lru-cache";
</script>

# Performance Node

Ce que tu vas apprendre : mesurer avant d'optimiser, profiler le CPU et la mémoire, trouver une fuite, ne pas bloquer l'event loop, et savoir quand sortir les `worker_threads`, le `cluster` ou un cache.

## Règle n°1 : mesurer

Sans mesure, tu optimises au hasard. Les trois questions :

1. **Quoi** est lent ? (quelle route, quel percentile : p50, p95, p99)
2. **Où** passe le temps ? (CPU dans ton code, attente DB, attente réseau, GC)
3. **Est-ce que** ma modif a amélioré ? (même charge, avant/après)

Dans un backend typique, la cause n°1 n'est **pas** le JavaScript : c'est la base (requête sans index, N+1, pool saturé) ou un appel réseau externe. Vérifie ça avant de micro-optimiser une boucle (cf. [Index & EXPLAIN](/bdd/03-index-et-explain)).

### Générer de la charge

```bash
# 50 connexions pendant 20 s
npx autocannon -c 50 -d 20 http://localhost:3000/bookings
```

Regarde la **latence p99** et le **débit**, pas la moyenne. Une moyenne de 20 ms peut cacher 1 % de requêtes à 2 s.

### Mesurer dans le code

```ts
import { performance } from "node:perf_hooks";

const t0 = performance.now();
const rows = await repo.list(tenantId, 50, null);
const ms = performance.now() - t0;
req.log.info({ ms, count: rows.length }, "bookings.list");
```

`performance.now()` est monotone et précis (sub-ms), contrairement à `Date.now()` qui peut sauter (NTP).

## La santé de l'event loop

Une seule métrique résume « mon process est-il bloqué ? » : le **retard de l'event loop** (event loop delay/lag).

```ts
import {
  monitorEventLoopDelay, performance,
} from "node:perf_hooks";

const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();
let elu = performance.eventLoopUtilization();

setInterval(() => {
  const next = performance.eventLoopUtilization(elu);
  logger.info({
    loopDelayP99Ms: h.percentile(99) / 1e6, // ns -> ms
    elu: next.utilization,                  // 0..1
  }, "event loop");
  elu = performance.eventLoopUtilization();
  h.reset();
}, 10_000).unref();
```

- **Delay p99** > ~50–100 ms : quelque chose bloque la boucle (CPU synchrone).
- **ELU** (event loop utilization) proche de 1 : la boucle n'est jamais au repos, le process est saturé en CPU. C'est un meilleur signal d'autoscaling que le CPU% de la machine.
- `.unref()` : ce timer ne garde pas le process en vie à l'arrêt.

## Profiler le CPU

```bash
# Génère un .cpuprofile à la sortie du process
node --cpu-prof --cpu-prof-dir=./profiles dist/main.js
# (lance la charge, puis Ctrl+C)
```

Ouvre le fichier dans Chrome DevTools (onglet Performance, ou chrome://inspect → Open dedicated DevTools for Node) : tu obtiens un **flame graph**. Les barres larges en haut de pile = là où le CPU passe son temps.

En live : `node --inspect dist/main.js`, puis `chrome://inspect`, onglet Profiler, Start/Stop pendant la charge. Ne laisse **jamais** `--inspect` ouvert sur une interface publique en prod (exécution de code à distance).

Coupables fréquents en flame graph :

- `JSON.stringify`/`parse` de gros objets (réponses non paginées, logs de payloads entiers) ;
- validation Zod de très gros tableaux à chaque requête ;
- regex catastrophiques (ReDoS) ;
- `bcrypt`/`pbkdf2` synchrones ;
- logging trop verbeux (sérialisation de chaque objet en `debug`).

## Ne pas bloquer l'event loop

Rappel du [chapitre async](/dev/typescript/04-async-event-loop) : pendant qu'un callback tourne, **aucune** autre requête n'avance.

```ts
// ❌ bloque le serveur ~100 ms par login
const hash = crypto.pbkdf2Sync(pw, salt, 600_000, 32, "sha256");

// ✅ exécuté dans le thread pool libuv
import { promisify } from "node:util";
const pbkdf2 = promisify(crypto.pbkdf2);
const hash2 = await pbkdf2(pw, salt, 600_000, 32, "sha256");
```

Les API async de `crypto`, `zlib` et `fs` passent par le **thread pool de libuv** (4 threads par défaut, `UV_THREADPOOL_SIZE` pour changer). S'il est saturé (beaucoup de hash + lectures fichier), les tâches font la queue : la latence monte sans que le CPU de la boucle bouge.

Pour du **ton** code CPU-intensif (pas une API Node), trois options :

1. Découper le travail et rendre la main (`await setImmediate()` de `node:timers/promises` tous les N éléments) ;
2. le déplacer dans un **worker thread** ;
3. le sortir du serveur HTTP (un job en queue traité par un worker séparé), souvent la meilleure option.

```ts
import { setImmediate as yieldLoop } from "node:timers/promises";

async function scoreAll(items: Item[]) {
  const out: number[] = [];
  for (let i = 0; i < items.length; i++) {
    out.push(score(items[i]!));
    if (i % 1000 === 0) await yieldLoop(); // laisse passer les I/O
  }
  return out;
}
```

## `worker_threads`

Des threads JS **avec leur propre isolate V8** (pas de mémoire partagée par défaut, communication par messages).

```ts
// pdf-worker.ts
import { parentPort } from "node:worker_threads";

parentPort!.on("message", (invoice: InvoiceData) => {
  const pdf = renderInvoicePdf(invoice); // CPU lourd, synchrone
  parentPort!.postMessage(pdf, [pdf.buffer]); // transfert, pas copie
});
```

En pratique, utilise un **pool** (créer un worker coûte ~dizaines de ms et de la mémoire) : la lib **Piscina** est la référence.

```ts
import { Piscina } from "piscina";

const pool = new Piscina({
  filename: new URL("./render-pdf.js", import.meta.url).href,
  maxThreads: 4,
});

app.get("/invoices/:id.pdf", async (req, reply) => {
  const data = await invoices.load(req.params.id);
  const pdf: Uint8Array = await pool.run(data);
  return reply.type("application/pdf").send(Buffer.from(pdf));
});
```

- Les messages sont copiés (structured clone) : envoyer 50 Mo à chaque appel coûte cher. Transfère des `ArrayBuffer` (liste de transfert) ou utilise `SharedArrayBuffer` + `Atomics` pour du vrai partage.
- Les workers **n'accélèrent pas les I/O** : pour attendre la DB, l'event loop suffit.

## `cluster` et le scaling horizontal

`node:cluster` lance N **processus** qui partagent un port. Utile sur une VM seule pour utiliser tous les cœurs.

En 2026, dans un conteneur orchestré (Kubernetes, ECS, Cloud Run), la pratique courante est **un process Node par conteneur**, et on scale en **réplicas** : redémarrage, logs, limites mémoire et health checks restent simples et gérés par la plateforme (cf. [Kubernetes](/infra/07-kubernetes)).

| Besoin | Outil |
| --- | --- |
| Utiliser N cœurs pour du HTTP | réplicas (ou `cluster` sur une VM) |
| Calcul CPU lourd ponctuel | `worker_threads` (Piscina) |
| Traitements longs / batch | queue + process worker séparé |

## Mémoire et fuites

### Les bases

```ts
const m = process.memoryUsage();
// rss : mémoire totale du process
// heapUsed / heapTotal : tas V8 (tes objets JS)
// external / arrayBuffers : Buffers hors tas
```

Une **fuite** se voit comme un `heapUsed` qui monte **après chaque GC**, en dents de scie croissantes, jusqu'au crash `JavaScript heap out of memory` ou au OOM kill du conteneur.

::: tip Limite de heap et conteneurs
La taille max du heap V8 est calculée par défaut d'après la mémoire vue par le process, ce qui ne colle pas toujours à la limite du conteneur selon la version et la config. En conteneur, fixe `--max-old-space-size` (en Mo) explicitement, avec ~25 % de marge sous la limite pour les Buffers, la stack et le code natif. Ainsi tu obtiens une erreur de heap lisible plutôt qu'un OOM kill silencieux.
:::

### Les 4 fuites classiques

**1. Cache non borné**

```ts
const cache = new Map<string, Tenant>(); // ❌ grandit pour toujours
export async function getTenant(id: string) {
  let t = cache.get(id);
  if (!t) { t = await db.findTenant(id); cache.set(id, t); }
  return t;
}
```

Avec des clés venant de l'utilisateur (un id par requête, un token…), ce `Map` est une fuite garantie. Un cache doit **toujours** avoir une taille max et/ou un TTL (package `lru-cache`, ou le défi ci-dessous).

**2. Listeners jamais retirés**

```ts
app.get("/events", (req, reply) => {
  const onBooking = (b: Booking) => reply.raw.write(sse(b));
  bus.on("booking.created", onBooking);
  // ❌ sans ça, chaque client déconnecté laisse un listener
  req.raw.on("close", () => bus.off("booking.created", onBooking));
});
```

Le warning `MaxListenersExceededWarning: Possible EventEmitter memory leak detected` est **presque toujours** une vraie fuite. Ne le fais pas taire avec `setMaxListeners(0)`.

**3. Closures qui capturent trop**

```ts
function track(req: FastifyRequest) {
  const body = req.body; // peut faire 5 Mo
  return setInterval(() => {
    metrics.inc("active", { tenant: (body as any).tenantId });
  }, 60_000); // ❌ jamais clear : body vit pour toujours
}
```

Une closure garde en vie **tout** ce qu'elle référence. Extrais la petite valeur nécessaire (`const tenantId = ...`) et nettoie les timers.

**4. Timers et Promises orphelins**

`setInterval` jamais `clearInterval`, ou des Promises jamais résolues qui retiennent leurs callbacks (un `await` sur un événement qui n'arrive jamais, par requête).

### Trouver une fuite : la méthode des 3 snapshots

```bash
node --heapsnapshot-signal=SIGUSR2 dist/main.js
kill -USR2 <pid>   # snapshot 1 (après warm-up)
# ... charge pendant quelques minutes ...
kill -USR2 <pid>   # snapshot 2
# ... encore ...
kill -USR2 <pid>   # snapshot 3
```

Charge les 3 fichiers `.heapsnapshot` dans DevTools (onglet Memory), vue **Comparison** : les objets dont le nombre augmente entre 1→2 **et** 2→3 sont les suspects. Le panneau **Retainers** montre la chaîne de références qui les garde en vie (souvent : un `Map`, un tableau d'un module, un listener).

Attention : prendre un snapshot **fige** le process (secondes) et demande autant de mémoire que le heap. À faire sur une instance retirée du load balancer.

### `WeakMap` et `WeakRef`

```ts
// Métadonnées attachées à un objet sans l'empêcher d'être GC
const meta = new WeakMap<object, { seenAt: number }>();
```

Utile pour associer des données à des objets dont tu ne contrôles pas la durée de vie. `WeakRef` et `FinalizationRegistry` existent mais leur comportement dépend du GC : n'en fais pas la base d'une logique métier.

## Caches

Avant d'ajouter un cache, demande-toi : la requête est-elle lente **parce qu'il manque un index** ? Un cache ajoute de l'invalidation, de la donnée périmée, et de la mémoire.

| Niveau | Pour | Attention |
| --- | --- | --- |
| Mémoire du process | config tenant, données lues très souvent | une copie par réplica, incohérence |
| Redis | partagé entre réplicas, sessions, rate limit | réseau, sérialisation |
| HTTP (`Cache-Control`, ETag) | ressources publiques ou par utilisateur | invalidation côté client |

### Éviter la ruée (cache stampede)

Une clé populaire expire, 500 requêtes ratent le cache en même temps et frappent toutes la DB. Solution simple en process : **single-flight**, partager la Promise en vol.

```ts
const inflight = new Map<string, Promise<Tenant>>();

export function loadTenant(id: string): Promise<Tenant> {
  const cached = cache.get(id);
  if (cached) return Promise.resolve(cached);
  let p = inflight.get(id);
  if (!p) {
    p = db.findTenant(id)
      .then((t) => { cache.set(id, t); return t; })
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}
```

Une seule requête DB par clé, quel que soit le nombre d'appelants concurrents. Le `finally` évite de garder une Promise rejetée pour toujours.

## Cas réel

**Le pod qui redémarre toutes les 6 heures.** L'API d'un SaaS de réservation est OOM-killée régulièrement. Les graphes montrent `heapUsed` qui monte linéairement, puis chute à chaque restart.

1. Corrélation : la pente est proportionnelle au trafic, pas au temps. C'est donc **par requête**.
2. 3 heap snapshots en staging sous `autocannon` : la comparaison montre des milliers d'objets `{ tenantId, plan, features }` qui s'accumulent.
3. Retainers : un `Map` module-level dans `feature-flags.ts`, avec la clé `` `${tenantId}:${userId}` ``. Un cache « temporaire » ajouté il y a 6 mois, jamais borné, et la clé inclut l'utilisateur.
4. Fix : `lru-cache` avec `max: 10_000` et `ttl: 60_000`, et la clé ne garde que `tenantId` (les flags ne dépendent pas de l'utilisateur).
5. Vérif : même test de charge, le heap se stabilise. Ajout d'une alerte sur `heapUsed` après GC et sur le p99 d'event loop delay.

## Pièges classiques

- Optimiser sans profil, sur un micro-benchmark qui ne reflète pas la prod.
- Regarder la latence **moyenne** au lieu du p99.
- `readFileSync`, `pbkdf2Sync`, `zlib.gzipSync` dans un handler HTTP.
- Croire que `async` déplace le CPU ailleurs ; il ne fait qu'attendre plus élégamment.
- Créer un `new Worker()` par requête au lieu d'un pool.
- Cache sans borne, ou cache qui masque une requête sans index.
- `console.log` massif en prod : synchrone sur certains flux (fichiers, TTY) et coûteux à sérialiser.
- Question d'entretien : « Le CPU du serveur est à 25 % mais l'API est lente, pistes ? » → sur une machine 4 cœurs, 25 % = **un** cœur à 100 % : l'event loop est saturée. Ou le thread pool libuv est plein, ou on attend la DB (pool de connexions épuisé).

## Défis

### 1. Que se passe-t-il ?

```ts
app.get("/report", async () => {
  const rows = await db.select().from(bookings); // 2 M lignes
  return rows.map(toDto);
});
```

::: details Solution
Tout est chargé en mémoire (des centaines de Mo, risque d'OOM), puis `map` et `JSON.stringify` de 2 M objets **bloquent l'event loop** plusieurs secondes : toutes les autres requêtes attendent. Solutions : paginer (curseur), ou streamer (curseur Postgres → `pipeline` → CSV gzip), et pour un vrai rapport, un job asynchrone qui produit un fichier et notifie quand c'est prêt.
:::

### 2. Fuite ou pas fuite ?

```ts
const sessions = new WeakMap<Socket, Session>();
io.on("connection", (socket) => {
  sessions.set(socket, new Session(socket.id));
});
```

::: details Solution
Pas de fuite **due au WeakMap** : quand le socket n'est plus référencé ailleurs, l'entrée peut être collectée. Mais attention : `Session` ne doit pas référencer le socket dans un objet **global** (sinon le socket reste vivant). Et si la lib garde elle-même les sockets fermés (listeners non nettoyés), le WeakMap n'y peut rien. Avec un `Map` normal, ce serait une fuite certaine sans `delete` au `disconnect`.
:::

### 3. Diagnostique

L'API répond en 30 ms en p50, mais en 3 s en p99, uniquement aux heures de pointe. Le CPU est bas, la DB répond en 5 ms. Que vérifies-tu ?

::: details Solution
Une attente qui ne consomme pas de CPU : le **pool de connexions DB** (10 connexions, 200 requêtes concurrentes → file d'attente côté client ; mesure le temps d'acquisition), le **thread pool libuv** (hash de mots de passe, `fs`, `dns.lookup`), un **appel externe** sans timeout, ou un rate limit en aval. Instrumente chaque étape (temps d'acquisition du pool, durée des appels externes) et regarde aussi l'event loop delay pour exclure un blocage CPU ponctuel.
:::

### 4. Cache borné LRU + TTL (exécutable)

Implémente un cache qui ne peut pas fuiter : taille max avec éviction LRU, et expiration. Astuce : un `Map` conserve l'ordre d'insertion.

<Challenge :data="lru" />

## À retenir

- Mesure d'abord (p99, flame graph, event loop delay, ELU) ; la DB et le réseau sont les suspects n°1.
- Rien de synchrone et lourd dans un handler : API async, découpage, `worker_threads` en pool, ou une queue.
- Scale horizontal en réplicas ; `worker_threads` pour le CPU, pas pour les I/O.
- Fuites classiques : caches non bornés, listeners, closures, timers. Méthode des 3 heap snapshots.
- Tout cache est borné (taille + TTL) et protégé de la ruée (single-flight).
