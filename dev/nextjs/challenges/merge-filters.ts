import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "next-merge-filters",
  title: "Fusionner un périmètre de filtres par défaut",
  difficulty: "moyen",
  entry: "mergeFilters",
  starter: `type FilterValue = string | number | boolean | number[];
type Filters = Record<string, FilterValue>;

// Une boutique a des filtres par défaut (catégories racines, tri...).
// Le visiteur en choisit d'autres via l'URL. Règles :
// - on part des defaults ;
// - une clé présente dans explicit gagne, même false, 0 ou [] ;
// - explicit[k] === null : le visiteur a RETIRÉ ce filtre -> clé absente ;
// - une clé de locked garde TOUJOURS la valeur des defaults (le
//   visiteur ne sort pas du périmètre de la boutique) ; si elle n'est
//   pas dans defaults, elle est simplement retirée ;
// - le résultat a ses clés triées (il sert de clé de cache) ;
// - ne modifie ni defaults ni explicit.
// (La vraie borne de sécurité reste au backend : ici c'est l'UX.)
function mergeFilters(
  defaults: Filters,
  explicit: Record<string, FilterValue | null>,
  locked: string[],
): Filters {
  return defaults;
}`,
  solution: `type FilterValue = string | number | boolean | number[];
type Filters = Record<string, FilterValue>;

function mergeFilters(
  defaults: Filters,
  explicit: Record<string, FilterValue | null>,
  locked: string[],
): Filters {
  const merged: Record<string, FilterValue> = { ...defaults };
  for (const [name, value] of Object.entries(explicit)) {
    if (locked.includes(name)) continue;
    if (value === null) delete merged[name];
    else merged[name] = value;
  }
  const sorted: Filters = {};
  for (const name of Object.keys(merged).sort()) {
    sorted[name] = merged[name];
  }
  return sorted;
}`,
  cases: [
    {
      name: "explicite gagne, défauts gardés",
      args: [{ sort: "popular", inStock: true }, { sort: "price_asc" }, []],
      expected: { inStock: true, sort: "price_asc" },
    },
    {
      name: "false et [] sont des valeurs",
      args: [{ inStock: true, brandIds: [1, 2] }, { inStock: false, brandIds: [] }, []],
      expected: { brandIds: [], inStock: false },
    },
    {
      name: "null retire le filtre",
      args: [{ sort: "popular", inStock: true }, { inStock: null }, []],
      expected: { sort: "popular" },
    },
    {
      name: "clé verrouillée",
      args: [
        { rootCategoryIds: [10, 11], sort: "popular" },
        { rootCategoryIds: [99], sort: "new" },
        ["rootCategoryIds"],
      ],
      expected: { rootCategoryIds: [10, 11], sort: "new" },
    },
    {
      name: "verrouillée sans défaut : retirée",
      args: [{ sort: "popular" }, { shopId: 3 }, ["shopId"]],
      expected: { sort: "popular" },
    },
    {
      name: "null sur verrouillée : ignoré",
      args: [{ rootCategoryIds: [10] }, { rootCategoryIds: null }, ["rootCategoryIds"]],
      expected: { rootCategoryIds: [10] },
    },
    {
      name: "clés triées",
      args: [{ z: 1, a: 2 }, { m: 3 }, []],
      expected: { a: 2, m: 3, z: 1 },
    },
  ],
});
