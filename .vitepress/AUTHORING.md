# Guide de rédaction (conventions du book)

Ce fichier n'est pas publié. Il décrit comment écrire une page pour que tout reste cohérent.

## Arborescence & navigation

- Un dossier à la racine = une section dans la barre du haut (`dev/`, `infra/`, `bdd/`, `interview/`, …).
- Un sous-dossier = un groupe dans la sidebar. Son `index.md` (si présent) donne le nom du groupe via son `# Titre`.
- Préfixer les fichiers par un numéro pour l'ordre : `01-ownership.md`, `02-lifetimes.md`. Le préfixe n'apparaît pas dans le menu, le titre affiché est le premier `# Titre` du fichier.
- Les fichiers/dossiers commençant par `_` ou `.` sont ignorés par la sidebar (ex. `challenges/` est un dossier de données → il ne contient pas de `.md`, donc il n'apparaît pas).

## Ton & format (lecture sur téléphone, le soir)

- **Français**, tutoiement, ton direct, pas de remplissage. Termes techniques en anglais quand c'est l'usage (`borrow checker`, `event loop`, `index`).
- Paragraphes courts. Blocs de code **courts** (≤ ~30 lignes) et lisibles sur un écran étroit : lignes ≤ ~70 caractères si possible.
- Chaque chapitre suit ce squelette :
  1. `# Titre` puis une phrase « Ce que tu vas apprendre ».
  2. Sections `##` de théorie, chacune avec au moins un exemple de code concret.
  3. `## Cas réel` : un scénario tiré d'une vraie app (API de paiement, SaaS multi-tenant, worker de jobs, CLI interne, etc.).
  4. `## Pièges classiques` : liste des erreurs de juniors / questions d'entretien.
  5. `## Défis` : 3 à 5 exercices. Réponses cachées dans `::: details Solution` … `:::`.
  6. `## À retenir` : 4–6 bullets.
- Encadrés VitePress : `::: tip`, `::: warning`, `::: danger`, `::: info`, `::: details Titre`.

## Code exécutable

- Bloc ```` ```rust play ```` → ajoute un bouton « Ouvrir dans Rust Playground » (le code doit compiler seul : `fn main` ou `#[cfg(test)]`).
- Bloc ```` ```ts play ```` → bouton « Ouvrir dans TS Playground ».
- Ne mets `play` que si le snippet est autonome.

## Défis testés dans le navigateur (`<Challenge>`)

Les défis de code sont des fichiers TS dans un dossier `challenges/` à côté de la page :

```ts
// interview/challenges/two-sum.ts
import { defineChallenge } from "../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "two-sum",              // unique dans tout le site
  title: "Two Sum",
  difficulty: "facile",       // "facile" | "moyen" | "difficile"
  entry: "twoSum",            // nom de la fonction (ou classe) attendue
  starter: `function twoSum(nums: number[], target: number): number[] {
  return [];
}`,
  compare: "exact",           // ou "unordered" (ordre ignoré) / "float"
  cases: [
    { args: [[2, 7, 11, 15], 9], expected: [0, 1] },
  ],
  solution: `function twoSum(...) { ... }`, // OBLIGATOIRE : vérifiée par `pnpm check` (et en CI)
  rust: `...code Rust avec #[cfg(test)] mod tests...`, // optionnel → bouton Rust Playground
});
```

Mode classe (style LeetCode « design ») : `mode: "class"` et chaque cas est
`{ ops: ["LRUCache", "put", "get"], args: [[2], [1, 1], [1]], expected: [null, null, 1] }`.

Dans la page :

```md
<script setup>
import twoSum from "./challenges/two-sum";
</script>

<Challenge :data="twoSum" />
```

**Toujours lancer `pnpm check`** après avoir écrit/modifié un défi : il exécute la `solution` contre tous les `cases` et échoue si un seul cas est faux. Le build CI échoue aussi.

Le code tourne dans un Web Worker (timeout 4 s), il est sauvegardé dans le navigateur, et un défi réussi est marqué ✓.
Les `args`/`expected` doivent être sérialisables en JSON (pas de `Map`, `Set`, `undefined` → utilise `null`).

Barre de progression : `<Progress :ids="['two-sum', 'valid-parentheses']" />`.

Notes runner :
- Les fonctions `async` sont supportées en mode `function` (le résultat est `await`). Pratique pour des défis du type `retry`, `promisePool`, `withTimeout` (garde des délais courts, < 200 ms au total, le timeout global est de 4 s).
- `undefined` retourné est converti en `null`.
- Les problèmes « in-place » doivent **retourner** le résultat (ex. `return nums`).
- Arbres binaires : représentation LeetCode en tableau level-order (`[3, 9, 20, null, null, 15, 7]`) ; le `starter` fournit les helpers (`class TreeNode`, `buildTree`, `toArray`) pour que l'utilisateur n'ait que l'algo à écrire. Même idée pour les listes chaînées (tableau ↔ liste).
