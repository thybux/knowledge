import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "next-cache-key",
  title: "Clé de cache stable depuis une query",
  difficulty: "facile",
  entry: "buildCacheKey",
  starter: `type Scalar = string | number | boolean | null;
type QueryValue = Scalar | Scalar[];

// Construit une clé de cache (et une URL canonique) stable :
// deux queries équivalentes donnent EXACTEMENT la même chaîne.
//
// - clés triées par ordre alphabétique ;
// - null et "" sont ignorés (paramètre absent) ;
// - number / boolean -> String(v) (false et 0 sont gardés) ;
// - tableau : valeurs nulles/vides retirées, doublons retirés,
//   tri en ordre de chaîne, clé répétée (tags=a&tags=b) ;
//   tableau vide = paramètre absent ;
// - clé et valeur passent par encodeURIComponent ;
// - aucun paramètre -> le chemin seul, sinon chemin + "?" + params.
function buildCacheKey(
  path: string,
  query: Record<string, QueryValue>,
): string {
  return path;
}`,
  solution: `type Scalar = string | number | boolean | null;
type QueryValue = Scalar | Scalar[];

function buildCacheKey(
  path: string,
  query: Record<string, QueryValue>,
): string {
  const parts: string[] = [];
  for (const name of Object.keys(query).sort()) {
    const raw = query[name];
    const list = Array.isArray(raw) ? raw : [raw];
    const values = list
      .filter((v) => v !== null && v !== "")
      .map((v) => String(v));
    const finalValues = Array.isArray(raw)
      ? [...new Set(values)].sort()
      : values;
    for (const v of finalValues) {
      parts.push(encodeURIComponent(name) + "=" + encodeURIComponent(v));
    }
  }
  return parts.length === 0 ? path : path + "?" + parts.join("&");
}`,
  cases: [
    {
      name: "clés triées",
      args: ["/products", { page: 2, brand: "acme" }],
      expected: "/products?brand=acme&page=2",
    },
    {
      name: "ordre d'entrée indifférent",
      args: ["/products", { brand: "acme", page: 2 }],
      expected: "/products?brand=acme&page=2",
    },
    {
      name: "null et vide ignorés",
      args: ["/products", { q: "", page: null }],
      expected: "/products",
    },
    {
      name: "tableau trié et dédoublonné",
      args: ["/parts", { tags: ["b", "a", "b", "", null] }],
      expected: "/parts?tags=a&tags=b",
    },
    {
      name: "tableau vide = absent",
      args: ["/parts", { tags: [], page: 1 }],
      expected: "/parts?page=1",
    },
    {
      name: "encodage",
      args: ["/search", { q: "kit & joint" }],
      expected: "/search?q=kit%20%26%20joint",
    },
    {
      name: "false et 0 gardés",
      args: ["/products", { inStock: false, page: 0 }],
      expected: "/products?inStock=false&page=0",
    },
  ],
});
