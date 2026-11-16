# Défis TypeScript

Ce que tu vas apprendre : les 12 exercices « utilitaires de vraie app » qu'on donne le plus souvent en live coding mid TypeScript, avec ce que l'intervieweur regarde vraiment.

<script setup>
import debounce from "./challenges/debounce";
import retry from "./challenges/retry";
import pool from "./challenges/promise-pool";
import deepEqual from "./challenges/deep-equal";
import deepClone from "./challenges/deep-clone";
import flatten from "./challenges/flatten";
import query from "./challenges/query-string";
import emitter from "./challenges/event-emitter";
import memo from "./challenges/memoize-ttl";
import template from "./challenges/template";
import balances from "./challenges/balances";
import form from "./challenges/form-validation";
</script>

<Progress :ids="['prat-ts-debounce', 'prat-ts-retry', 'prat-ts-pool', 'prat-ts-deep-equal', 'prat-ts-deep-clone', 'prat-ts-flatten', 'prat-ts-query', 'prat-ts-emitter', 'prat-ts-memo-ttl', 'prat-ts-template', 'prat-ts-balances', 'prat-ts-form']" />

## Comment les utiliser

Un défi = 20 à 40 min. Fais comme en entretien :

1. Lis l'énoncé et **reformule** à voix haute (ou par écrit) les cas limites.
2. Écris le cas nominal, lance les tests, puis traite les cas limites un par un.
3. Avant de regarder la solution, ouvre l'explication : elle liste ce que l'intervieweur attend comme **relances**.

::: tip Le harnais de test
Les fonctions qui prennent des callbacks (`retry`, `promisePool`, `EventEmitter`…) ne peuvent pas recevoir de fonctions via JSON. Leur `starter` contient donc un petit **harnais** (« ne pas modifier ») qui fabrique les callbacks et appelle ton code. Tu n'écris que la partie du haut.
:::

Le temps est toujours **injecté** (`now()`, `sleep`, timestamps) : c'est exactement ce que tu fais en prod pour rendre ce code testable sans `setTimeout` réels. Voir [Tests](/dev/typescript/08-tests).

## 1. Debounce simulé

**Contexte** : une barre de recherche d'un back-office appelle l'API à chaque frappe. On veut un seul appel quand l'utilisateur arrête de taper pendant `wait` ms.

Ici, pas de vrais timers : on te donne la liste des frappes avec leur instant, et tu calcules quels appels partent réellement, et quand.

```text
wait = 100
frappes : t=0 "s", t=50 "se", t=90 "sea"
appels  : t=190 "sea"

frappes : t=0 "a", t=150 "b"
appels  : t=100 "a", t=250 "b"
```

<Challenge :data="debounce" />

::: details Explication
Un seul état : l'appel **en attente** (`pending`, avec son instant de déclenchement). Pour chaque événement : si `e.t >= pending.t`, le timer a déjà sonné → on l'émet ; puis le nouvel événement remplace l'attente. À la fin, on vide le `pending`.

C'est O(n), une passe. Relances fréquentes :

- **throttle** vs debounce : throttle garantit au plus un appel par fenêtre (utile pour `scroll`), debounce attend le silence (utile pour une recherche).
- **leading edge** : déclencher au premier événement puis ignorer pendant `wait` (bouton « Payer » double-cliqué).
- Version réelle avec `setTimeout` : `clearTimeout(timer); timer = setTimeout(() => fn(...args), wait)`. Ajoute une méthode `cancel()` et `flush()`.
- Pourquoi l'horloge injectée ? Parce qu'un test qui attend 300 ms réels est lent et flaky ; avec Vitest on utiliserait `vi.useFakeTimers()`.
:::

## 2. `retry` avec backoff

**Contexte** : ton worker appelle l'API d'un PSP (Stripe, Adyen…) qui renvoie parfois des 503. On réessaie avec un délai qui double, plafonné. Une erreur 400 (requête invalide) ne doit **jamais** être réessayée.

```text
retries=3, baseMs=100
fail, fail, ok   -> ok,  délais [100, 200]
fail x4          -> erreur "fail#4", délais [100, 200, 400]
fail, fatal      -> erreur "fatal#2", délais [100]
```

<Challenge :data="retry" />

::: details Explication
Une boucle `for` avec un `try/catch` dans le corps est plus lisible que la récursion. Le délai de la n-ième re-tentative est `min(baseMs * 2^(n-1), maxMs)`.

Ce que l'intervieweur veut entendre :

- **Jitter** : en prod on ajoute de l'aléa (`delay * Math.random()`, « full jitter ») pour éviter que 1000 clients réessaient tous à la même milliseconde (thundering herd).
- **Quoi réessayer** : erreurs réseau, 429, 502/503/504. Pas les 4xx métier. Respecter l'en-tête `Retry-After` d'un 429.
- **Idempotence** : réessayer un `POST /charges` sans clé d'idempotence peut débiter deux fois. Voir [Paiements & idempotence](/interview/03-system-design/05-paiements-idempotence).
- **Annulation** : accepter un `AbortSignal` pour stopper les re-tentatives quand la requête HTTP d'origine est abandonnée.
- **Budget** : limiter le temps total, pas juste le nombre de tentatives.
:::

## 3. `promisePool`

**Contexte** : un script de migration doit appeler une API pour 10 000 utilisateurs. `Promise.all` sur tout = 10 000 requêtes simultanées = rate limit et sockets épuisés. On veut au plus `limit` requêtes en vol.

```text
durées [15, 2, 8, 1], limit 2
résultats ["r0", "r1", "r2", "r3"]  (ordre des tâches)
max en parallèle : 2
```

<Challenge :data="pool" />

::: details Explication
Le pattern le plus simple : lancer `limit` **workers** qui piochent dans un index partagé `next++`. Comme JS est mono-thread, `const i = next++` est atomique : pas de race. On écrit dans `results[i]` pour garder l'ordre.

Si une tâche rejette, le worker rejette, donc `Promise.all` rejette (fail-fast). Relances :

- **Ne pas s'arrêter au premier échec** : retourner des `{ status, value | reason }` comme `Promise.allSettled`.
- Les autres tâches **continuent** de tourner après un rejet : pour vraiment arrêter, il faut un `AbortController` partagé.
- Version itérateur / streaming pour ne pas créer 10 000 closures d'avance.
- En vrai : la lib `p-limit`, ou un `Semaphore` maison.
:::

## 4. `deepEqual`

**Contexte** : dans un formulaire d'édition, on veut savoir si l'objet a changé pour activer le bouton « Enregistrer », ou comparer un snapshot de config.

```text
{ a: 1, b: 2 } vs { b: 2, a: 1 }   -> true
[1, 2] vs [2, 1]                   -> false
{ a: null } vs { b: null }         -> false
```

<Challenge :data="deepEqual" />

::: details Explication
Ordre des tests : identité (`===`), puis « les deux sont des objets non null », puis tableau vs objet, puis comparaison récursive. Pour les objets : même nombre de clés **et** chaque clé de `a` existe dans `b` (`Object.hasOwn`) — sinon `{a: undefined}` et `{b: undefined}` seraient égaux.

Pourquoi pas `JSON.stringify(a) === JSON.stringify(b)` ? L'ordre des clés compte en JSON, et `undefined`, `Date`, `Map` sont mal gérés.

Relances : `NaN` (`Object.is`), `Date` (comparer `getTime()`), `Map`/`Set`, cycles (garder une paire de `WeakMap`). En prod, les tests utilisent `expect(x).toEqual(y)` de Vitest, et Node fournit `util.isDeepStrictEqual`.
:::

## 5. `deepClone`

**Contexte** : un éditeur de workflow avec « annuler » garde des copies de l'état. Les copies superficielles (`{ ...state }`) partagent les sous-objets, et modifier la copie casse l'historique.

```text
src = { createdAt: Date, tags: Set, self: src }
clone.self === clone       (le cycle est reproduit)
clone.createdAt !== src.createdAt
```

<Challenge :data="deepClone" />

::: details Explication
La clé est la `Map` `seen` (original → copie) : on y enregistre la copie **avant** de descendre dans les enfants. C'est ce qui gère à la fois les cycles et les références partagées.

En vrai, utilise `structuredClone(value)` (Node 17+, tous les navigateurs) : il gère `Date`, `Map`, `Set`, `ArrayBuffer`, cycles. Limites à connaître : il ne copie ni les fonctions, ni le prototype des classes (une instance de `User` devient un objet simple), ni les getters.

`JSON.parse(JSON.stringify(x))` : perd `Date` (devient string), `undefined`, `Map`, et plante sur un cycle.
:::

## 6. `flatten` / `unflatten`

**Contexte** : afficher des erreurs de validation par champ (`"address.city"`), stocker une config dans des variables d'environnement, ou envoyer un `FormData` imbriqué.

```text
flatten({ a: { b: 1 }, t: [5, 6] })
  -> { "a.b": 1, "t.0": 5, "t.1": 6 }
unflatten({ "user.addresses.0.city": "Lyon" })
  -> { user: { addresses: [{ city: "Lyon" }] } }
```

<Challenge :data="flatten" />

::: details Explication
`flatten` : DFS récursif avec le chemin courant. La seule subtilité : un objet/tableau **vide** est une feuille, sinon il disparaîtrait.

`unflatten` : pour chaque clé, on avance segment par segment en créant le conteneur manquant ; on regarde le **segment suivant** pour choisir `[]` ou `{}`.

Relances : clés qui contiennent déjà un point (il faut un échappement, ex. `a\.b`) ; conflit `{ "a": 1, "a.b": 2 }` (lever une erreur) ; **prototype pollution** : une clé `__proto__.isAdmin` venue d'un input utilisateur modifie `Object.prototype` ! Rejette `__proto__`, `constructor`, `prototype`, ou crée les objets avec `Object.create(null)`.
:::

## 7. Parser de query string

**Contexte** : un endpoint de liste `GET /orders?status=paid&status=refunded&q=...`. Les frameworks le font pour toi, mais savoir le faire montre que tu connais l'encodage URL.

```text
"?page=2&tag=a&tag=b&q=hello%20world"
  -> { page: "2", tag: ["a", "b"], q: "hello world" }
"debug&token=abc=="
  -> { debug: "", token: "abc==" }
```

<Challenge :data="query" />

::: details Explication
Découpe sur `&`, puis sur le **premier** `=` (`indexOf`, pas `split("=")`, sinon `abc==` est tronqué). Remplace `+` par un espace **avant** `decodeURIComponent` (c'est la convention `application/x-www-form-urlencoded`).

Relances : `decodeURIComponent("%E0")` lève `URIError` → il faut l'attraper et renvoyer un 400, pas un 500. Tout reste `string` : la conversion (`Number(page)`) et la validation se font ensuite avec un schéma (Zod). En vrai : `new URLSearchParams(qs)` et `params.getAll("tag")`. Voir [Erreurs & validation](/dev/typescript/05-erreurs-et-validation).
:::

## 8. `EventEmitter`

**Contexte** : un bus d'événements in-process dans une API (`order.paid` → envoyer l'email, mettre à jour les stats). Mode classe : les opérations sont appelées les unes après les autres sur une instance de `Bus`, qui enveloppe ton `EventEmitter`.

```text
on("order.paid", mailer); on("order.paid", stats)
emit("order.paid", "42") -> true
appels : mailer:42, stats:42
```

<Challenge :data="emitter" />

::: details Explication
Une `Map<string, Entry[]>` où `Entry = { fn, once }`. Le piège qui fait échouer la moitié des candidats : **itérer sur une copie** (`[...list]`) dans `emit`. Sans copie, un listener qui se retire pendant l'appel décale le tableau et le suivant est sauté.

Pour `once`, stocker un flag (et non un wrapper) permet à `off(event, fn)` de retrouver le listener d'origine.

Relances : typer les événements (`EventEmitter<{ "order.paid": { id: string } }>` avec `keyof` et des generics — voir [Generics](/dev/typescript/02-generics)) ; un listener qui **throw** (l'isoler pour ne pas casser les autres ?) ; fuites mémoire (Node avertit au-delà de 10 listeners) ; listeners async (l'emitter ne les attend pas : une erreur devient une unhandled rejection).
:::

## 9. `memoize` avec TTL

**Contexte** : la résolution du tenant d'un SaaS (`subdomain` → config) est appelée à chaque requête. On la cache 60 s en mémoire.

```text
ttl = 1000
t=0 get("a") -> miss   t=999 get("a") -> hit
t=1000 get("a") -> miss (expiré)
```

<Challenge :data="memo" />

::: details Explication
`Map<clé, { value, at }>`, et on compare `now() - at < ttlMs`. La clé `JSON.stringify(args)` suffit pour des arguments simples.

Relances importantes :

- **Mémoire** : la `Map` grandit sans fin. Il faut une taille max et une éviction (LRU). Voir [Design de structures](/interview/01-algo/13-design-structures).
- **Fonctions async** : cacher la **promesse** (et non le résultat) évite que 100 requêtes simultanées déclenchent 100 calculs (« cache stampede »). Mais il faut supprimer l'entrée si la promesse rejette, sinon on cache l'erreur.
- **Multi-instance** : un cache en mémoire n'est pas partagé entre tes 4 pods. Au-delà : Redis.
:::

## 10. Mini moteur de templates

**Contexte** : les emails transactionnels (<span v-pre>« Ta commande {{order.id}} est expédiée »</span>). Les valeurs viennent de l'utilisateur, donc il faut **échapper** le HTML.

```text
render("Salut {{ user.name }} !", { user: { name: "Ana" } })
  -> "Salut Ana !"
render("<p>{{c}}</p>", { c: "<script>" })
  -> "<p>&lt;script&gt;</p>"
```

<Challenge :data="template" />

::: details Explication
Une regex avec deux alternatives, la **triple** moustache en premier (sinon <span v-pre>`{{`</span> matche d'abord), et `String.prototype.replace` avec une fonction de remplacement. Le lookup avance dans le chemin et s'arrête sur `null`/`undefined`.

Échappe `&` **en premier**, sinon `&lt;` devient `&amp;lt;`.

Relances : boucles <span v-pre>`{{#each items}}`</span> (il faut alors un vrai tokenizer, pas une regex) ; erreur si variable manquante en mode strict (pour détecter les templates cassés en CI) ; ne **jamais** évaluer le template avec `new Function`/`eval` (injection de code).
:::

## 11. Soldes par compte

**Contexte** : un mini **ledger**. On rejoue des transactions venues de webhooks (donc avec doublons possibles) et on calcule le solde de chaque compte, sans jamais passer en négatif.

```text
deposit a 500, transfer a->b 200, transfer b->c 300
-> balances { a: 300, b: 200 }, rejected ["t3"]
t1, t1, t1 (même id) -> compté une seule fois
```

<Challenge :data="balances" />

::: details Explication
Un `Set` d'ids vus (idempotence), une `Map` de soldes, et un `switch` sur l'union discriminée `type` — TypeScript affine alors `tx.from`/`tx.to` automatiquement. Les montants sont des **entiers en centimes** : jamais de `float` pour de l'argent (`0.1 + 0.2 !== 0.3`).

Note : un id rejeté reste « vu ». C'est un choix ; en entretien, **dis-le** et demande ce que veut le métier.

Relances : en base, comment garantir l'unicité ? → contrainte `UNIQUE (id)` + `INSERT ... ON CONFLICT DO NOTHING`. Et le solde négatif sous concurrence ? → `UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1` et vérifier le nombre de lignes modifiées. Voir [Transactions & isolation](/bdd/04-transactions-isolation).
:::

## 12. Validation de formulaire

**Contexte** : le handler `POST /signup`. On renvoie un 422 avec une erreur par champ, que le front affiche sous chaque input.

```text
{ email: " Ana@Mail.COM ", password: "secret123",
  confirm: "secret123", age: "30" }
-> { ok: true, value: { email: "ana@mail.com", age: 30 } }
{}  -> { ok: false, errors: { email: "required",
         password: "required", age: "required" } }
```

<Challenge :data="form" />

::: details Explication
Accumule toutes les erreurs (une par champ) au lieu de s'arrêter à la première : l'utilisateur corrige tout d'un coup. Retourne un **résultat discriminé** (`ok: true | false`) plutôt que de lancer une exception : c'est un cas attendu, pas exceptionnel.

Pièges : `Number("")` vaut `0` (d'où le test `required` avant la conversion), `Number("17.5")` n'est pas un entier, et `Number("abc")` est `NaN` (et `Number.isInteger(NaN)` est `false`).

En prod : un schéma Zod / Valibot (`z.object({ email: z.string().trim().toLowerCase().email() ... })`) partagé entre front et back, qui donne aussi le **type** inféré. La validation côté client est du confort ; seule celle du serveur protège.
:::

## Pièges classiques

- **Coder avant de clarifier** : « l'id rejeté compte-t-il comme vu ? », « ordre des résultats ? ». Poser la question rapporte des points.
- Oublier les **cas vides** : tableau vide, chaîne vide, `limit` plus grand que le nombre de tâches.
- Muter l'entrée (trier `txs` en place, modifier l'objet reçu) sans le dire.
- Utiliser `float` pour de l'argent, `split("=")` pour des paires clé/valeur, `JSON.stringify` pour comparer.
- Dépendre de `Date.now()` / `setTimeout` réels : code non testable. Injecte l'horloge.
- Itérer sur une collection qu'on modifie (emitter, cache).
- Ne pas mentionner la version « prod » (`structuredClone`, `URLSearchParams`, `p-limit`, Zod) : l'intervieweur veut savoir que tu ne réinventerais pas tout au travail.

## Défis

1. Reprends `retry` et ajoute un `AbortSignal` : si `signal.aborted`, on arrête immédiatement avec l'erreur `AbortError`.
2. Transforme `promisePool` pour qu'il renvoie des résultats façon `allSettled` au lieu d'échouer.
3. Pourquoi ce code affiche-t-il `[]` ?

```ts
const results: number[] = [];
[1, 2, 3].forEach(async (n) => {
  results.push(await Promise.resolve(n * 2));
});
console.log(results);
```

::: details Solution
1. Avant chaque tentative et après chaque `sleep` : `if (signal?.aborted) throw signal.reason`. Le `sleep` lui-même doit écouter `signal.addEventListener("abort", ...)` pour se réveiller tout de suite.
2. Dans le worker : `try { results[i] = { status: "fulfilled", value: await t() } } catch (reason) { results[i] = { status: "rejected", reason } }`.
3. `forEach` n'attend pas les callbacks async : il lance trois promesses et retourne aussitôt. Le `console.log` s'exécute avant les micro-tâches. Utilise `await Promise.all(arr.map(async ...))` ou une boucle `for...of` avec `await`. Voir [Async & event loop](/dev/typescript/04-async-event-loop).
:::

## À retenir

- Ces défis testent des **réflexes de prod** : idempotence, échappement, concurrence bornée, horloge injectée.
- Clarifie les cas limites à voix haute avant de coder, et annonce tes choix.
- Une boucle simple et lisible bat une solution « maline ».
- Termine toujours par : complexité, ce que tu ajouterais en prod, et la lib que tu utiliserais vraiment.
- Refais chaque défi une seconde fois une semaine plus tard, en temps limité (25 min).
