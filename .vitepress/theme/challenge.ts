// Format d'un defi executable dans le navigateur (composant <Challenge>).
//
// Deux modes :
//  - "function" (defaut) : on appelle `fn(...args)` et on compare a `expected`.
//  - "class" : style LeetCode "design" -> ops = ["LRUCache", "put", "get"], args = [[2], [1, 1], [1]],
//              expected = [null, null, 1]. La 1re op est le constructeur.

export type FunctionCase = {
  args: unknown[];
  expected: unknown;
  /** Libelle affiche en cas d'echec (optionnel). */
  name?: string;
};

export type ClassCase = {
  ops: string[];
  args: unknown[][];
  expected: unknown[];
  name?: string;
};

export type ChallengeDef = {
  /** Identifiant unique (sert a la sauvegarde locale). */
  id: string;
  title: string;
  difficulty: "facile" | "moyen" | "difficile";
  /** Nom de la fonction (ou de la classe) que le code doit definir. */
  entry: string;
  mode?: "function" | "class";
  /** Code de depart TypeScript affiche dans l'editeur. */
  starter: string;
  /** Comparaison : "exact" (deep equal, defaut), "unordered" (tableaux tries avant comparaison), "float" (1e-6). */
  compare?: "exact" | "unordered" | "float";
  cases: (FunctionCase | ClassCase)[];
  /** Solution de reference en TypeScript (verifiee en CI, affichable dans la page). */
  solution?: string;
  /** Code Rust de depart, avec ses tests `#[cfg(test)]`. Affiche un bouton vers le Rust Playground. */
  rust?: string;
};

export const defineChallenge = (c: ChallengeDef) => c;
