<script setup>
import retry from "./challenges/retry";
import pLimit from "./challenges/p-limit";
</script>

# Async & event loop

Ce que tu vas apprendre : comment Node exécute ton code asynchrone (event loop, microtasks), et les patterns de prod : annulation, timeouts, concurrence bornée, streams avec backpressure.

## Le modèle : un thread, une boucle

Ton JavaScript tourne sur **un seul thread**. Les I/O (réseau, disque, DNS) sont déléguées au système (epoll/kqueue) ou au thread pool de libuv (fs, crypto, zlib, dns.lookup). Quand une I/O se termine, son callback est mis en file, et la boucle l'exécute **quand la pile est vide**.

Conséquence centrale : tant que ton code synchrone tourne, **rien d'autre ne tourne**. Pas de requête HTTP servie, pas de timer déclenché. Un `JSON.parse` de 200 Mo bloque tout le serveur.

## Les phases de l'event loop

Chaque tour de boucle passe par des phases, chacune avec sa file de callbacks :

| Phase | Ce qui s'y exécute |
| --- | --- |
| timers | callbacks de `setTimeout` / `setInterval` échus |
| pending callbacks | certains callbacks système différés |
| poll | callbacks d'I/O ; attend des I/O si rien d'autre |
| check | callbacks de `setImmediate` |
| close callbacks | `socket.on("close")`, etc. |

(Plus `idle/prepare`, interne.) À retenir surtout : **timers → poll → check**, en boucle.

### Microtasks et `process.nextTick`

En plus des phases, deux files prioritaires sont vidées **après chaque callback** (pas seulement entre les phases) :

1. la file `process.nextTick` ;
2. la file des **microtasks** : callbacks de Promises (`.then`, suite d'un `await`) et `queueMicrotask`.

Node vide toute la file nextTick, puis toutes les microtasks (y compris celles ajoutées pendant le vidage), et recommence tant qu'il reste des nextTick.

```ts
console.log("1");
setTimeout(() => console.log("2"), 0);
setImmediate(() => console.log("3"));
Promise.resolve().then(() => console.log("4"));
process.nextTick(() => console.log("5"));
queueMicrotask(() => console.log("6"));
console.log("7");
```

En CommonJS : `1 7 5 4 6`, puis `2 3` **ou** `3 2`.

- `1`, `7` : synchrone.
- `5` : nextTick passe avant les microtasks.
- `4`, `6` : microtasks dans l'ordre d'enregistrement.
- `2`/`3` : depuis le module principal, l'ordre `setTimeout(0)` vs `setImmediate` **n'est pas déterministe** (dépend du temps écoulé avant l'entrée dans la boucle).

::: warning ESM change l'ordre nextTick / Promise
Dans un module ESM (`.mjs` ou `"type": "module"`), le code du module s'exécute lui-même **dans** une microtask. Résultat : les `.then` passent avant `process.nextTick` → `1 7 4 6 5`. Ne construis jamais de logique sur cet ordre ; si tu as besoin de « juste après », utilise `queueMicrotask`.
:::

Dans un callback d'I/O, en revanche, l'ordre est garanti : on est dans la phase poll, la suivante est check.

```ts
import { readFile } from "node:fs";

readFile(import.meta.filename, () => {
  setTimeout(() => console.log("timeout"), 0);
  setImmediate(() => console.log("immediate"));
  process.nextTick(() => console.log("tick"));
});
// tick, immediate, timeout
```

::: danger Starvation
Une microtask qui en planifie une autre en boucle (ou un `nextTick` récursif) **bloque la boucle** comme une boucle `while(true)` : les I/O ne sont jamais traitées. `setImmediate` laisse passer les I/O entre deux itérations.
:::

## Promises et async/await

`async` fait retourner une Promise ; `await` suspend la fonction et programme la suite comme microtask quand la Promise est réglée.

```ts
async function a() {
  console.log("a1");
  await b();
  console.log("a2");
}
async function b() { console.log("b"); }

console.log("start");
a();
Promise.resolve()
  .then(() => console.log("p1"))
  .then(() => console.log("p2"));
console.log("end");
// start a1 b end a2 p1 p2
```

Le corps d'une fonction `async` est **synchrone jusqu'au premier `await`** (`a1` et `b` s'affichent avant `end`).

### Séquentiel vs parallèle

```ts
// ❌ séquentiel sans raison : 3 allers-retours DB l'un après l'autre
const tenant = await tenantRepo.find(id);
const slots = await slotRepo.listFor(id);
const stats = await statsRepo.monthly(id);

// ✅ indépendants -> en parallèle
const [tenant2, slots2, stats2] = await Promise.all([
  tenantRepo.find(id), slotRepo.listFor(id), statsRepo.monthly(id),
]);
```

Et l'inverse : `await` dans un `for` est **voulu** quand chaque étape dépend de la précédente ou quand tu veux limiter la charge.

### Les combinateurs

| Fonction | Résout quand | Rejette quand |
| --- | --- | --- |
| `Promise.all` | toutes OK | la 1re rejette |
| `Promise.allSettled` | toutes terminées | jamais |
| `Promise.race` | la 1re se règle | la 1re se règle en erreur |
| `Promise.any` | la 1re OK | toutes rejettent (`AggregateError`) |

```ts
// Envoyer des rappels : un échec ne doit pas bloquer les autres
const results = await Promise.allSettled(
  bookings.map((b) => mailer.sendReminder(b)),
);
const failed = results.filter((r) => r.status === "rejected");
logger.warn({ failed: failed.length }, "reminders failed");
```

`Promise.all` ne **stoppe pas** les autres promesses quand une rejette : elles continuent en arrière-plan. Pour vraiment les arrêter, il faut un `AbortSignal`.

### `Promise.withResolvers` (Node 22)

```ts
const { promise, resolve, reject } = Promise.withResolvers<void>();
socket.once("ready", () => resolve());
socket.once("error", reject);
await promise;
```

### Rejets non gérés

Depuis Node 15, une Promise rejetée sans handler **fait crasher le process** (`unhandledRejection` → exit). Le coupable classique est la « floating promise » :

```ts
app.post("/bookings", async (req) => {
  const booking = await service.create(req.body);
  analytics.track("booking_created", booking); // Promise ignorée !
  return booking;
});
```

Si `track` rejette, c'est un crash. Soit `await`, soit `void analytics.track(...).catch(logError)` explicitement. La règle ESLint `@typescript-eslint/no-floating-promises` détecte ces cas ; active-la.

## Annulation : `AbortController`

Le standard pour annuler du travail async (fetch, timers, streams, `child_process`, beaucoup de libs).

```ts
const ac = new AbortController();
const res = fetch("https://api.example.com/slow", {
  signal: ac.signal,
});
setTimeout(() => ac.abort(), 1000);
// res rejette avec une DOMException "AbortError"
```

Raccourcis modernes :

```ts
// Timeout pur
await fetch(url, { signal: AbortSignal.timeout(2000) });

// Combiner : timeout OU client qui se déconnecte
const signal = AbortSignal.any([
  AbortSignal.timeout(5000),
  requestSignal,
]);
```

Rendre **ta** fonction annulable :

```ts
import { setTimeout as sleep } from "node:timers/promises";

async function pollJob(id: string, signal: AbortSignal) {
  while (true) {
    signal.throwIfAborted();
    const job = await jobs.get(id);
    if (job.status !== "running") return job;
    await sleep(500, undefined, { signal }); // rejette si abort
  }
}
```

### Timeouts : le piège de `Promise.race`

```ts
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout])
    .finally(() => clearTimeout(timer));
}
```

Deux défauts que tu dois savoir expliquer :

1. Sans `clearTimeout`, le timer garde le process en vie et accumule des timers.
2. `race` **n'annule pas** `p` : la requête continue, consomme une connexion DB, et son résultat est jeté. La vraie solution passe un `signal` jusqu'à l'opération.

## Concurrence bornée

`Promise.all(items.map(f))` sur 10 000 items lance 10 000 requêtes d'un coup : pool de connexions DB saturé, rate limit de l'API tierce, mémoire qui explose. Il faut **borner**.

```ts
// Par lots : simple mais sous-optimal (attend le plus lent du lot)
for (let i = 0; i < ids.length; i += 20) {
  await Promise.all(ids.slice(i, i + 20).map(syncTenant));
}
```

Mieux : un pool où une place libérée est reprise immédiatement. C'est `p-limit` (npm), que tu vas réimplémenter dans le défi. Alternative sans lib pour un itérable :

```ts
async function mapPool<T, R>(
  items: readonly T[], n: number, fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++; // pas de race : JS est mono-thread
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}
```

`next++` sans verrou est sûr : entre deux `await`, aucun autre code ne s'intercale.

## Streams et backpressure

Pour des données plus grosses que la RAM (export CSV, import de fichiers, proxy), on traite par morceaux. La **backpressure** est le mécanisme qui ralentit le producteur quand le consommateur ne suit pas.

```ts
// ❌ ignore la backpressure : write() retourne false, on s'en fiche
for (const row of rows) out.write(toCsv(row));
```

Si `write()` retourne `false`, le buffer interne a dépassé `highWaterMark` : il faut attendre `"drain"`. Plutôt que de le gérer à la main, utilise `pipeline` :

```ts
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { createWriteStream } from "node:fs";

await pipeline(
  db.streamBookings(tenantId),        // Readable (objectMode)
  async function* (rows) {            // transform en générateur
    yield "id,date,customer\n";
    for await (const r of rows) {
      yield `${r.id},${r.startsAt.toISOString()},${r.email}\n`;
    }
  },
  createGzip(),
  createWriteStream("/tmp/export.csv.gz"),
);
```

`pipeline` propage la backpressure, les erreurs, et **détruit tous les streams** si l'un échoue (pas de fuite de descripteurs). Le `for await` sur un Readable respecte aussi la backpressure : on ne lit la suite que quand on a fini le chunk.

::: tip `pipeline` vs `.pipe()`
`.pipe()` ne propage pas les erreurs : un stream source en erreur laisse la destination ouverte. En 2026, utilise `pipeline` de `node:stream/promises`, avec un `signal` en option pour annuler.
:::

## Cas réel

**Worker d'envoi de rappels SMS.** Chaque nuit, un job doit envoyer un rappel pour les ~50 000 réservations du lendemain via une API SMS limitée à 20 requêtes simultanées, qui renvoie parfois des 503. Le job doit pouvoir être arrêté proprement au redéploiement (SIGTERM).

```ts
const ac = new AbortController();
process.once("SIGTERM", () => ac.abort());

const limit = pLimit(20);
let sent = 0;

for await (const batch of bookings.streamTomorrow({ size: 500 })) {
  if (ac.signal.aborted) break;
  await Promise.allSettled(batch.map((b) => limit(() =>
    retry(() => sms.send(b.phone, reminderText(b), {
      signal: ac.signal,
    }), {
      retries: 3, baseMs: 200, maxMs: 5000,
      shouldRetry: (e) => e instanceof HttpError && e.status >= 500,
    }).then(() => { sent++; }),
  )));
}
logger.info({ sent }, "reminders done");
```

Les ingrédients :

- lecture **par lots** depuis la DB (pas 50 000 lignes en mémoire) ;
- `pLimit(20)` : jamais plus de 20 appels en vol ;
- `retry` avec backoff exponentiel, **seulement** sur les erreurs transitoires (un 400 ne se retente pas) ;
- un `AbortSignal` propagé jusqu'au `fetch` pour couper vite au SIGTERM ;
- `allSettled` : un SMS en échec n'arrête pas le lot.

En prod, ajoute du **jitter** au backoff (`delay * (0.5 + Math.random())`) pour éviter que tous les workers ne retentent au même instant (thundering herd), et rends l'envoi **idempotent** (une table `reminders_sent`) pour qu'un redémarrage ne double pas les SMS.

## Pièges classiques

- `array.forEach(async (x) => ...)` : `forEach` n'attend pas. Les erreurs deviennent des rejets non gérés. Utilise `for...of` + `await`, ou `Promise.all(array.map(...))`.
- `await` dans une boucle par réflexe alors que les appels sont indépendants.
- `Promise.all` sur une liste non bornée (10 000 requêtes simultanées).
- Penser que `async` rend du code CPU non bloquant : `async function hash() { /* boucle CPU */ }` bloque toujours la boucle.
- `return promise` vs `return await promise` dans un `try` : sans `await`, le `catch` ne voit pas le rejet.
- `setTimeout(fn, 0)` ne veut pas dire « tout de suite » : minimum ~1 ms, et après les microtasks et les I/O prêtes.
- Question d'entretien : « différence entre `process.nextTick` et `setImmediate` ? » → nextTick passe avant toute autre chose dès que le callback courant finit ; setImmediate attend la phase check du tour de boucle (les noms sont trompeurs).

## Défis

### 1. Dans quel ordre ça s'affiche ? (CommonJS)

```ts
Promise.resolve()
  .then(() => {
    console.log("p1");
    process.nextTick(() => console.log("tick in p1"));
  })
  .then(() => console.log("p2"));

process.nextTick(() => {
  console.log("tick1");
  Promise.resolve().then(() => console.log("p in tick"));
});
```

::: details Solution
`tick1`, `p1`, `p in tick`, `p2`, `tick in p1`.

1. Fin du script : Node vide la file nextTick → `tick1` (qui ajoute une microtask).
2. Vidage **complet** des microtasks, y compris celles ajoutées en route : `p1` (ajoute un nextTick et débloque `p2`), `p in tick`, `p2`.
3. Il reste un nextTick → `tick in p1`.
:::

### 2. Trouve le bug

```ts
async function chargeAll(invoices: Invoice[]) {
  try {
    invoices.forEach(async (inv) => {
      await stripe.charge(inv);
    });
  } catch (e) {
    logger.error(e, "charge failed");
  }
  return "done";
}
```

::: details Solution
`forEach` ignore les Promises retournées : `chargeAll` retourne `"done"` **avant** que les paiements soient faits, et une erreur de `charge` n'est jamais attrapée par le `try` → `unhandledRejection` → crash du process. Correction :

```ts
for (const inv of invoices) await stripe.charge(inv);
// ou, borné : await Promise.all(invoices.map(i => limit(() => charge(i))))
```
Pour un paiement, le séquentiel (ou une concurrence faible) est souvent voulu.
:::

### 3. Ce timeout est-il correct ?

```ts
const user = await Promise.race([
  db.query("SELECT ..."),
  new Promise((_, rej) => setTimeout(() => rej("timeout"), 1000)),
]);
```

::: details Solution
Trois problèmes : le timer n'est jamais nettoyé (le process ne peut pas s'arrêter avant 1 s, et un timer par requête traîne) ; la requête n'est pas annulée (la connexion reste occupée) ; on rejette une string au lieu d'une `Error` (pas de stack). Côté Postgres, préfère `statement_timeout` (au niveau de la session ou de la transaction) qui annule **vraiment** la requête côté serveur.
:::

### 4. `retry` avec backoff (exécutable)

<Challenge :data="retry" />

### 5. `pLimit` (exécutable)

<Challenge :data="pLimit" />

## À retenir

- Un seul thread : du code synchrone long bloque **tout**. Async ≠ parallèle.
- Ordre : code synchrone → nextTick → microtasks (Promises) → phases (timers, poll, check…). Ne dépends pas de l'ordre timeout/immediate.
- Pas de floating promise : `await`, ou `.catch` explicite ; active `no-floating-promises`.
- Annulation = `AbortSignal` propagé jusqu'à l'I/O ; `Promise.race` n'annule rien.
- Borne la concurrence (pool), retente seulement le transitoire avec backoff + jitter, et utilise `pipeline` pour les streams.
