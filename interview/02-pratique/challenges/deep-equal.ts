import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "prat-ts-deep-equal",
  title: "deepEqual",
  difficulty: "facile",
  entry: "deepEqual",
  starter: `// Égalité structurelle de deux valeurs JSON
// (null, number, string, boolean, tableaux, objets).
// - l'ordre des clés d'un objet ne compte pas
// - l'ordre des éléments d'un tableau compte
// - un tableau n'est jamais égal à un objet
function deepEqual(a: unknown, b: unknown): boolean {
  throw new Error("à implémenter");
}`,
  solution: `function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.hasOwn(b as object, k) &&
      deepEqual((a as any)[k], (b as any)[k]),
  );
}`,
  cases: [
    { args: [1, 1], expected: true, name: "primitifs égaux" },
    { args: [1, "1"], expected: false, name: "types différents" },
    { args: [null, {}], expected: false, name: "null vs objet" },
    { args: [{ a: 1, b: 2 }, { b: 2, a: 1 }], expected: true, name: "ordre des clés" },
    { args: [[1, 2], [2, 1]], expected: false, name: "ordre des tableaux" },
    { args: [[], {}], expected: false, name: "tableau vs objet" },
    { args: [{ a: 1 }, { a: 1, b: null }], expected: false, name: "clé en plus" },
    { args: [{ a: null }, { b: null }], expected: false, name: "mêmes valeurs, clés différentes" },
    {
      args: [
        { user: { id: 1, tags: ["a", { x: [1, 2] }] }, ok: true },
        { ok: true, user: { tags: ["a", { x: [1, 2] }], id: 1 } },
      ],
      expected: true,
      name: "imbriqué",
    },
    {
      args: [
        { user: { id: 1, tags: ["a", { x: [1, 2] }] } },
        { user: { id: 1, tags: ["a", { x: [1, 3] }] } },
      ],
      expected: false,
      name: "différence profonde",
    },
  ],
});
