import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "ts-group-by",
  title: "groupBy générique typé",
  difficulty: "facile",
  entry: "groupBy",
  starter: `// Groupe les éléments par la valeur de la propriété \`key\`.
// Contraintes de typage (vérifie-les dans ton IDE) :
// - key doit être une clé de T
// - T[K] doit être utilisable comme clé d'objet (PropertyKey)
// - le résultat est Partial<Record<T[K], T[]>>
// Sans utiliser Object.groupBy, l'ordre des éléments est conservé.
function groupBy<T, K extends keyof T>(
  items: readonly T[],
  key: K,
): Partial<Record<T[K] & PropertyKey, T[]>> {
  return {};
}`,
  solution: `function groupBy<T, K extends keyof T>(
  items: readonly T[],
  key: K,
): Partial<Record<T[K] & PropertyKey, T[]>> {
  const out: Partial<Record<T[K] & PropertyKey, T[]>> = {};
  for (const item of items) {
    const k = item[key] as T[K] & PropertyKey;
    (out[k] ??= []).push(item);
  }
  return out;
}`,
  cases: [
    {
      name: "commandes par statut",
      args: [
        [
          { id: 1, status: "paid" },
          { id: 2, status: "pending" },
          { id: 3, status: "paid" },
        ],
        "status",
      ],
      expected: {
        paid: [{ id: 1, status: "paid" }, { id: 3, status: "paid" }],
        pending: [{ id: 2, status: "pending" }],
      },
    },
    { name: "liste vide", args: [[], "status"], expected: {} },
    {
      name: "clé numérique",
      args: [[{ n: "a", tenant: 1 }, { n: "b", tenant: 2 }, { n: "c", tenant: 1 }], "tenant"],
      expected: { "1": [{ n: "a", tenant: 1 }, { n: "c", tenant: 1 }], "2": [{ n: "b", tenant: 2 }] },
    },
  ],
});
