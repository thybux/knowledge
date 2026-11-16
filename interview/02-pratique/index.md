# Entretien pratique

Ce que tu vas apprendre : à quoi ressemblent les entretiens « pratiques » (live coding réaliste, take-home, revue de code) pour un poste mid TypeScript/Rust, ce qu'on y évalue, et comment t'y préparer en parallèle du LeetCode.

## Pourquoi ce n'est pas du LeetCode

L'algo (voir [Méthode & Big O](/interview/01-algo/01-methode-big-o)) vérifie que tu sais raisonner sur une structure de données. L'entretien pratique vérifie autre chose : **est-ce qu'on peut te confier un ticket lundi matin ?**

| Algo | Pratique |
| --- | --- |
| Optimalité, complexité | Lisibilité, cas limites |
| Énoncé fermé | Énoncé flou, à clarifier |
| Une fonction | Un petit module, une API |
| Peu d'I/O | Async, erreurs, temps, données sales |

Beaucoup d'entreprises (scale-ups, SaaS, fintech) ont remplacé tout ou partie du LeetCode par ce format, parce qu'il prédit mieux le travail réel.

## Les formats que tu vas croiser

### 1. Live coding « utilitaire » (45–60 min)

Écrire un `retry`, un `debounce`, un `promisePool`, un parser, un petit cache. L'intervieweur ajoute des contraintes au fil de l'eau (« et si la fonction est async ? », « et si on a plusieurs instances ? »).

C'est l'objet de [Défis TypeScript](/interview/02-pratique/01-defis-typescript) et [Défis Rust](/interview/02-pratique/02-defis-rust).

### 2. Live coding « feature » (60–90 min)

Un mini-repo existant (souvent une API Express/Fastify ou Axum, avec une BDD SQLite ou en mémoire) et un ticket : « ajoute un endpoint de remboursement partiel », « corrige ce bug de pagination ». On t'évalue sur :

- ta capacité à **lire** du code existant avant d'écrire ;
- les tests que tu ajoutes ;
- la gestion d'erreurs (codes HTTP, validation) ;
- ta communication (tu annonces ce que tu fais et pourquoi).

```ts
// Ticket typique : "POST /orders/:id/refund ne doit pas
// permettre de rembourser plus que le montant payé"
if (amount <= 0 || amount > order.paid - order.refunded) {
  return reply.code(422).send({ error: "invalid_amount" });
}
```

Le piège : se jeter dans le code. Commence par lancer les tests existants et par lire le handler voisin.

### 3. Take-home (3–8 h annoncées)

Un projet à rendre en quelques jours : « une API de gestion de tâches avec auth », « une CLI qui agrège des logs ». Il est ensuite discuté en entretien.

Ce qui fait la différence, plus que les features :

- un `README` court : comment lancer, choix faits, ce que tu ferais avec plus de temps ;
- des **tests** sur la logique métier (pas forcément 100 % de couverture) ;
- une structure claire (routes → services → accès données) ;
- une validation des entrées et des erreurs propres ;
- `docker compose up` qui marche du premier coup ;
- un historique git lisible (commits atomiques, messages clairs).

::: warning Respecte le temps annoncé
Rendre 20 h de travail pour un exercice de 4 h n'impressionne pas forcément : ça peut être lu comme un manque de priorisation. Fais le cœur proprement, et **liste** dans le README ce que tu aurais ajouté.
:::

### 4. Revue de code (30–45 min)

On te donne une PR avec des problèmes plantés. Classe tes remarques par gravité :

1. **Bugs / sécurité** : injection SQL, IDOR (pas de filtre par `tenant_id`), race condition, `await` manquant.
2. **Robustesse** : erreurs avalées (`catch {}`), absence de timeout, pas de transaction.
3. **Lisibilité** : nommage, fonction de 200 lignes, duplication.
4. **Style** : le reste (et dis que le linter devrait s'en charger).

```ts
// PR à relire : que vois-tu ?
app.get("/invoices/:id", async (req, res) => {
  const inv = await db.query(
    `SELECT * FROM invoices WHERE id = ${req.params.id}`,
  );
  res.json(inv.rows[0]);
});
```

Réponse attendue : injection SQL (paramétrer avec `$1`), pas de contrôle d'appartenance (IDOR : filtrer par l'utilisateur ou le tenant), pas de 404 si absent, `SELECT *` expose peut-être des colonnes internes.

### 5. System design (45–60 min)

Pour un mid, une version allégée : concevoir un raccourcisseur d'URL, un système de notifications. Voir [System design](/interview/03-system-design/).

### 6. Questions techniques et comportementales

Une discussion rapide sur tes connaissances (« différence entre `Arc` et `Rc` ? ») et ton expérience (« parle-moi d'un bug difficile »). Voir [Questions d'entretien](/interview/02-pratique/03-questions-entretien).

## Ce que l'intervieweur note vraiment

Une grille typique (simplifiée) :

- **Compréhension du problème** : as-tu posé des questions ? identifié les cas limites ?
- **Qualité du code** : nommage, découpage, pas de duplication inutile.
- **Correction** : ça marche, y compris sur les cas vides ou invalides.
- **Tests** : tu sais vérifier ton propre code.
- **Communication** : on comprend ce que tu fais sans lire dans tes pensées.
- **Pragmatisme** : tu ne sur-ingénieries pas, et tu sais citer la lib standard qui fait le travail en prod.

Un candidat qui livre 80 % proprement en expliquant ses choix bat souvent un candidat qui livre 100 % en silence, avec du code illisible.

## Le déroulé à suivre en live coding

1. **Reformuler** l'énoncé (30 s). « Si je comprends bien, on veut… »
2. **Clarifier** : entrées invalides ? ordre des résultats ? taille des données ? concurrence ?
3. **Exemples** : écrire 2–3 cas, dont un cas limite.
4. **Plan** en 3 lignes de commentaires, validé avec l'intervieweur.
5. **Coder** le cas nominal, en parlant.
6. **Tester** : dérouler un exemple à la main, puis lancer les tests.
7. **Améliorer** : cas limites, puis « en prod j'ajouterais… ».

```ts
// Étape 4 : le plan, écrit avant le code
// 1. découper la query string sur "&"
// 2. pour chaque paire : séparer sur le 1er "=", décoder
// 3. clé déjà vue -> transformer en tableau
```

## Se préparer en 8 semaines (en parallèle du LeetCode)

| Semaines | Focus |
| --- | --- |
| 1–2 | Défis TS 1 à 6, chrono 30 min |
| 3–4 | Défis TS 7 à 12 + Défis Rust 1 à 4 |
| 5–6 | Défis Rust 5 à 9, un take-home blanc |
| 7–8 | System design + questions, entretiens blancs |

Conseils :

- **Refais** les défis : la deuxième fois, vise la moitié du temps.
- Code dans un éditeur **sans** autocomplétion IA pour l'entraînement : beaucoup d'entretiens live l'interdisent.
- Fais un take-home blanc de 4 h sur un sujet réel (ex. une API de réservation avec Fastify + Postgres, ou Axum + SQLx — voir [API réelle](/dev/typescript/07-api-reelle) et [API Axum + SQLx](/dev/rust/10-api-axum-sqlx)), puis relis-le une semaine plus tard comme un reviewer.
- Entraîne-toi à **parler en codant**. C'est un muscle : enregistre-toi.

## Le jour J : checklist

- Environnement prêt : Node LTS, `cargo`, un projet vide avec Vitest / `cargo test` configuré.
- Partage d'écran testé, notifications coupées.
- Une phrase pour te présenter (30 s : ce que tu fais, ta stack, ce que tu cherches).
- 3 questions à poser à la fin.

## Pièges classiques

- Coder pendant 10 minutes sans rien dire.
- Ignorer un indice de l'intervieweur (« tu es sûr pour le cas vide ? » est **toujours** un indice).
- Ne pas exécuter son code avant de dire « c'est fini ».
- Sur-architecturer un exercice de 45 min (interfaces, factories, DI) : simple d'abord.
- Avaler les erreurs (`catch (e) {}`) ou les `unwrap()` partout en Rust.
- Dans un take-home : pas de README, pas de tests, ou un projet qui ne démarre pas.

## Défis

1. Relis la PR « invoices » plus haut et réécris le handler corrigé.
2. Pour l'énoncé « écris une fonction qui envoie un email de bienvenue après l'inscription », liste 5 questions de clarification.
3. Un take-home annoncé à 4 h : comment répartis-tu ton temps ?

::: details Solution
1. Une version corrigée :

```ts
app.get("/invoices/:id", async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, number, amount_cents, status
       FROM invoices WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.user.tenantId],
  );
  if (!rows[0]) return res.status(404).json({ error: "not_found" });
  res.json(rows[0]);
});
```

(On renvoie 404 et non 403 pour une facture d'un autre tenant : on ne révèle pas qu'elle existe.)

2. Synchrone ou en arrière-plan ? Que se passe-t-il si le fournisseur d'email est en panne (retry, l'inscription doit-elle échouer) ? Faut-il éviter un double envoi si l'utilisateur se réinscrit ? Langue / template ? Faut-il tracer l'envoi (pour le support, le RGPD) ?
3. Par exemple : 20 min de lecture et de plan, 2 h 30 de cœur métier + tests, 45 min de robustesse (validation, erreurs, Docker), 25 min de README et relecture du diff.
:::

## À retenir

- L'entretien pratique mesure si tu es **opérationnel**, pas si tu connais l'algo optimal.
- Clarifie, planifie, code en parlant, teste, puis parle de la prod.
- En revue de code : sécurité et bugs d'abord, style en dernier.
- Un take-home se juge sur le README, les tests et la clarté autant que sur les features.
- Entraîne-toi en conditions réelles : chrono, sans IA, à voix haute.
