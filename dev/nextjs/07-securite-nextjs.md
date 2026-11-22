<script setup>
import safeReturnTo from "./challenges/safe-return-to";
</script>

# Sécurité Next.js

Ce que tu vas apprendre : ce qui part réellement au navigateur (variables `NEXT_PUBLIC_*`, props, payload), comment poser des cookies de session sûrs, se protéger du CSRF sur une Server Action et sur un route handler, éviter le XSS malgré React, mettre une CSP avec nonce et connaître son coût, lire l'IP du client derrière un proxy sans se faire berner, et pourquoi le front n'est **jamais** une frontière de sécurité.

## Le modèle de menace d'un front Next

Un front Next public, c'est trois surfaces :

| Surface | Exposée à | Risque |
| --- | --- | --- |
| Le HTML, le JS et le payload RSC | tout le monde | fuite de secrets ou de données internes |
| Les Server Actions et route handlers | quiconque envoie un POST | appel forgé, CSRF, abus |
| Le proxy et les en-têtes | le réseau | IP usurpée, open redirect, injection |

La règle qui chapeaute tout : **le navigateur est hostile**. Ce qu'il envoie (params, body, cookies non signés, en-têtes) est une entrée à valider ; ce qu'il reçoit est public.

## `NEXT_PUBLIC_*` : public par définition

Toute variable préfixée `NEXT_PUBLIC_` est **inlinée au build** dans le JS client : `process.env.NEXT_PUBLIC_X` est remplacé par sa valeur littérale. Elle est lisible par n'importe qui dans les sources de la page.

```ts
// Inliné dans le bundle : visible par tous
const cdn = process.env.NEXT_PUBLIC_IMAGES_HOST;

// Sans préfixe : undefined côté client, lisible côté serveur
const secret = process.env.PAYMENT_API_SECRET;
```

Conséquences :

- **Jamais** de clé d'API privée, de secret JWT, de DSN avec mot de passe en `NEXT_PUBLIC_`. Seulement de l'inoffensif : URL publique, id d'analytics, drapeau de feature.
- La valeur est **figée au build** : la changer au runtime ne sert à rien, il faut rebuilder. Une même image Docker pour préprod et prod ne peut pas avoir deux valeurs.
- Revue simple : `grep -R "NEXT_PUBLIC_" app/ components/` et justifie chaque ligne.

Une clé « publique » de service tiers (carte, captcha) doit être **restreinte côté fournisseur** (référent HTTP, domaines autorisés) : elle sera copiée.

## `server-only` et ce que tu passes au client

[Chapitre 1](/dev/nextjs/01-server-et-client-components) : les modules qui touchent un secret ou la session importent `server-only` (erreur de build si un composant client les importe), et les props d'un Client Component sont dans le HTML. Deux réflexes de plus :

- une **couche d'accès aux données** (Data Access Layer) unique côté serveur, qui renvoie des DTO réduits, plutôt que des `fetch` éparpillés qui passent l'objet brut ;
- une erreur levée côté serveur n'envoie pas son message au client en production (seulement un `digest`). Ne compte pas sur ça pour un secret : ne mets pas de secret dans un message d'erreur.

React propose aussi des API de « taint » (`experimental_taintObjectReference`, option `experimental.taint` de Next) qui font échouer le rendu si un objet marqué atteint un Client Component. Elles sont **expérimentales** : un filet, pas un plan.

## Cookies de session

Les jetons vivent dans des cookies posés **par le serveur**, jamais dans `localStorage` (lisible par tout script de la page, donc par un XSS).

```ts
import { cookies } from "next/headers";

export async function writeSession(access: string, refresh: string) {
  const jar = await cookies();
  const base = {
    httpOnly: true,                 // illisible en JS
    secure: isHttps(),              // HTTPS seulement
    sameSite: "lax" as const,       // pas envoyé sur POST cross-site
    path: "/",
  };
  jar.set("fo_access_token", access, { ...base, maxAge: 15 * 60 });
  jar.set("fo_refresh_token", refresh,
    { ...base, maxAge: 7 * 24 * 3600 });
}
```

| Attribut | Protège contre | Note |
| --- | --- | --- |
| `httpOnly` | vol du jeton par XSS | le XSS peut encore agir dans la page, pas exfiltrer le jeton |
| `Secure` | interception en clair | dérive-le de l'URL publique (`https://`), pas de `NODE_ENV` |
| `SameSite=Lax` | la plupart des CSRF | envoyé sur navigation GET top-level, pas sur POST cross-site |
| `SameSite=Strict` | CSRF, plus strict | le cookie manque quand on arrive depuis un lien externe |
| préfixe `__Host-` | écrasement par un sous-domaine | impose `Secure`, `Path=/`, pas de `Domain` |

::: warning `Secure` et la préprod en HTTP
`secure: process.env.NODE_ENV === "production"` casse une préprod servie en HTTP (Next force `NODE_ENV=production` au build) : le navigateur refuse le cookie et la session disparaît. Dérive `Secure` du protocole de l'URL publique du site.
:::

## CSRF

Le CSRF (Cross-Site Request Forgery) : un site malveillant fait envoyer par le navigateur de la victime une requête vers ton site, **avec ses cookies**.

### Server Actions

Next intègre deux protections :

- une action ne s'invoque qu'en `POST` ;
- Next compare l'en-tête `Origin` à `Host` (ou `X-Forwarded-Host`) et **refuse** si les deux diffèrent.

Combiné à `SameSite=Lax`, c'est solide. Derrière un reverse proxy qui change l'hôte, déclare les origines légitimes dans `experimental.serverActions.allowedOrigins` au lieu de désactiver le contrôle.

### Route handlers : à toi de le faire

Un `route.ts` qui mute avec un cookie d'auth n'a **pas** ce contrôle automatique.

```ts
// app/api/auth/logout/route.ts
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return new Response("Forbidden", { status: 403 });
  }
  await AuthService.forRequest().logout();
  return Response.redirect(new URL("/", siteUrl()), 303);
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(siteUrl()).origin;
}
```

- Compare `Origin` à **ton** origine configurée, pas à `Host` qu'un attaquant peut influencer derrière certains proxies.
- `Origin` absent sur un POST : refuse (les navigateurs modernes l'envoient sur les POST cross-origin et la plupart des same-origin).
- Une route `GET` ne mute **jamais** : un `<img src="/api/logout">` la déclencherait.

## XSS

React **échappe** tout ce que tu rends entre accolades. Une description scrapée contenant `<script>` s'affiche comme du texte. Le XSS revient par les portes que tu ouvres toi-même :

```tsx
// 1. HTML brut
<div dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} />

// 2. URL contrôlée par l'utilisateur
<a href={review.website}>Site</a>  // "javascript:alert(1)"

// 3. JSON-LD non échappé (chapitre 5)
<script type="application/ld+json"
  dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
```

- `dangerouslySetInnerHTML` : réservé au JSON-LD **échappé** (`<` → `<`). Pour du contenu riche, rends-le côté serveur avec une lib qui ignore le HTML (Markdown sans HTML), ou passe par un sanitizer (DOMPurify) justifié en revue.
- URL : valide le protocole (`https:` ou `http:` seulement) avant de la rendre. Ne compte pas sur le framework pour filtrer.
- `target="_blank"` : ajoute `rel="noopener noreferrer"`.

```ts
export function safeExternalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString() : null;
  } catch {
    return null;
  }
}
```

## CSP avec nonce

Une **Content-Security-Policy** dit au navigateur quels scripts il a le droit d'exécuter. Même si un attaquant injecte un `<script>`, la CSP l'empêche de tourner. Le problème : l'App Router injecte lui-même des scripts **inline** (le payload RSC). Pour les autoriser sans `'unsafe-inline'`, il faut un **nonce** : une valeur aléatoire par requête, mise dans l'en-tête CSP et sur chaque `<script>` légitime.

```ts
// proxy.ts
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}
```

Next lit le nonce dans l'en-tête CSP de la requête et l'applique à ses propres scripts ; tes `<Script>` le reçoivent via `(await headers()).get("x-nonce")`.

::: danger Le coût : plus de statique
Un nonce doit être **unique par requête**, donc la page doit être rendue à chaque requête. Une page statique ou ISR est calculée une fois pour tout le monde : impossible d'y mettre un nonce. CSP à nonce et catalogue en ISR sont **incompatibles**.
:::

Le compromis courant, à écrire noir sur blanc :

| App | Choix | Raison |
| --- | --- | --- |
| Back-office (tout dynamique, authentifié) | CSP à nonce stricte | pas d'ISR à perdre |
| Boutique publique (ISR) | `script-src 'self' 'unsafe-inline'` + hôtes listés, le reste strict | garder l'ISR, compenser par `frame-ancestors`, `object-src 'none'`, `base-uri`, `form-action`, et l'absence de `dangerouslySetInnerHTML` |

Les autres en-têtes, dans `next.config.ts` (`headers()`) : `Strict-Transport-Security` (prod seulement), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictive.

## L'IP du client derrière un proxy

Derrière nginx, un load balancer ou un CDN, la connexion TCP vient du proxy, pas du visiteur. L'IP d'origine voyage dans `X-Forwarded-For` (XFF) :

```
X-Forwarded-For: <ce que le client a envoyé>, <ajouté par proxy 1>
```

Chaque proxy **ajoute** à droite l'adresse qu'il a vue. Mais le client peut envoyer son propre XFF, avec n'importe quoi dedans : ton proxy l'**étend** sans le nettoyer.

```
Client forge   : X-Forwarded-For: 1.2.3.4
nginx ajoute   : X-Forwarded-For: 1.2.3.4, 203.0.113.7
```

Seules les entrées ajoutées par **tes** proxies sont fiables : avec un seul proxy de confiance, c'est **la dernière**. La première est celle que l'attaquant choisit.

```ts
export function clientIp(xff: string | null, trustedHops: number)
  : string | null {
  if (!xff) return null;
  const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - trustedHops] ?? null;
}
// clientIp("1.2.3.4, 203.0.113.7", 1) -> "203.0.113.7"
```

Utiliser `parts[0]` pour un rate limit ou un blocage, c'est laisser n'importe qui choisir son IP (et en faire bloquer une autre). Quand le front relaie au backend, transmets la chaîne **intacte** et laisse le backend appliquer la même règle (`trust proxy` avec le nombre de sauts). Et pas d'IP en clair dans les logs : c'est une donnée personnelle, masque-la.

## Open redirect

`/connexion?suite=/compte/commandes` renvoie le visiteur où il allait. Sans contrôle, `?suite=https://evil.example` fait de ton domaine un tremplin de phishing crédible. La règle : n'accepter qu'un **chemin interne**, en se méfiant des formes que le navigateur réinterprète (`//evil`, `/\evil`, caractères de contrôle). C'est le défi de ce chapitre.

## Le front n'est pas une frontière

Tout contrôle côté front est de l'**UX** :

- masquer un bouton « Admin » ne protège pas la route ;
- la garde de `proxy.ts` sur `/compte` vérifie la **présence** d'un cookie, pas sa validité ;
- une validation zod dans un formulaire client se contourne avec `curl` ;
- un filtre « boutique » ajouté par le front se retire dans l'URL.

L'autorisation vit dans le **backend** (qui vérifie le jeton, le rôle, l'appartenance de la ressource) ; le serveur Next revalide les entrées de ses actions ; le navigateur n'est qu'un client parmi d'autres.

## Cas réel

**Le front public d'une boutique, aucun secret dans le bundle.**

- Clés du prestataire de paiement, identifiants du transporteur : variables serveur, lues dans un module `server-only`. Le paiement se fait sur la page hébergée du prestataire : le front ne voit jamais une carte.
- Cookies `fo_access_token` (15 min) et `fo_refresh_token` (7 j) en `httpOnly`, `SameSite=Lax`, `Secure` déduit de l'URL publique. Préfixe `fo_` pour ne pas entrer en collision avec le back-office sur `localhost`.
- Le proxy fait tourner le jeton d'accès en silence avant expiration et redirige `/compte*` vers la connexion si le cookie est absent ; la page relit l'utilisateur via `/users/me`.
- Le retour après connexion passe par `safeReturnTo` ; la déconnexion est un `POST` sur un route handler qui vérifie `Origin`.
- CSP : nonce sur le back-office ; `'unsafe-inline'` assumé et documenté sur la boutique pour garder l'ISR, tout le reste strict.
- L'IP du visiteur : la chaîne XFF de nginx relayée intacte au backend sur les appels de session, jamais sur une lecture en cache (une entrée de cache par visiteur sinon).

## Pièges classiques

- Un secret en `NEXT_PUBLIC_` « parce que ça ne marchait pas côté client ».
- Changer une `NEXT_PUBLIC_*` au runtime et s'étonner que rien ne change : elle est inlinée au build.
- Jetons dans `localStorage`.
- `Secure` calé sur `NODE_ENV` : session perdue en préprod HTTP.
- Route handler `POST` qui mute sans vérifier `Origin` ; route `GET` qui mute.
- `dangerouslySetInnerHTML` sur une description scrapée.
- `href` construit depuis une saisie utilisateur sans vérifier le protocole.
- Vouloir une CSP à nonce sur des pages ISR.
- Prendre la **première** IP de `X-Forwarded-For`.
- Redirection vers `?next=` sans liste blanche.
- Question d'entretien : « Une variable d'environnement côté client peut-elle être secrète ? » : non, `NEXT_PUBLIC_*` est inlinée dans le JS servi à tous.
- Question d'entretien : « Comment Next protège les Server Actions du CSRF ? » : POST uniquement et comparaison `Origin`/`Host`, plus `SameSite` sur les cookies ; un route handler n'a pas ce contrôle.
- Question d'entretien : « Pourquoi une CSP à nonce empêche le statique ? » : le nonce doit changer à chaque requête, une page statique est la même pour tous.

## Défis

### 1. Anti open redirect (exécutable)

<Challenge :data="safeReturnTo" />

### 2. Quelle IP ?

Deux proxies de confiance (CDN puis nginx). Le serveur reçoit `X-Forwarded-For: 10.0.0.1, 198.51.100.4, 203.0.113.9`. Quelle est l'IP du client ?

::: details Solution
Avec deux sauts de confiance, nginx a ajouté `203.0.113.9` (l'adresse du CDN qu'il a vue) et le CDN a ajouté `198.51.100.4` (le client qu'il a vu). L'IP du client est donc l'avant-dernière : `198.51.100.4`. `10.0.0.1` a été envoyée par le client lui-même : non fiable. `clientIp(xff, 2)`.
:::

### 3. Trouve les fuites

```tsx
"use client";
export function Checkout() {
  const key = process.env.NEXT_PUBLIC_PAYMENT_SECRET;
  const token = localStorage.getItem("access_token");
  // ...
}
```

::: details Solution
Le secret de paiement est inliné dans le bundle : à révoquer immédiatement (il est dans les sources de chaque visiteur et dans l'historique des builds), puis à déplacer côté serveur sans préfixe, derrière une Server Action. Le jeton en `localStorage` est lisible par tout script : cookie `httpOnly` posé par le serveur, le client n'y touche jamais.
:::

### 4. Durcir ce route handler

```ts
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  await api.deleteAddress(Number(id));
  return Response.json({ ok: true });
}
```

::: details Solution
`GET` qui mute : déclenchable par une simple image. Passe en `POST`, vérifie `Origin` contre ton origine, valide `id` (entier positif), relis la session côté serveur, laisse le backend vérifier que l'adresse appartient au client (404 sinon). Mieux : une Server Action, qui a le contrôle d'origine intégré.
:::

## À retenir

- `NEXT_PUBLIC_*` = inliné au build, public ; les secrets restent serveur, derrière `server-only`.
- Cookies de session `httpOnly`, `Secure` (dérivé du protocole), `SameSite=Lax` ; jamais `localStorage`.
- Server Actions : POST + contrôle `Origin`/`Host` intégré ; route handlers : contrôle d'`Origin` à faire toi-même ; un `GET` ne mute pas.
- XSS : React échappe, sauf `dangerouslySetInnerHTML`, les URLs `javascript:` et le JSON-LD non échappé.
- CSP à nonce = rendu dynamique ; sur un site ISR, un compromis documenté.
- XFF : seule l'entrée ajoutée par ton proxy est fiable ; le front n'est jamais une frontière de sécurité.
