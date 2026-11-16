import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "prat-ts-query",
  title: "Parser de query string",
  difficulty: "facile",
  entry: "parseQuery",
  starter: `// parseQuery("?page=2&tag=a&tag=b&q=hello%20world")
//   -> { page: "2", tag: ["a", "b"], q: "hello world" }
// Règles :
// - le "?" initial est optionnel ; les paires vides ("&&") sont ignorées
// - "+" vaut un espace, puis décodage %XX (clé ET valeur)
// - "flag" sans "=" -> ""
// - clé répétée -> tableau dans l'ordre d'apparition
// - seul le 1er "=" sépare clé et valeur ("a=b=c" -> a: "b=c")
// Interdit : URLSearchParams ;)
function parseQuery(qs: string): Record<string, string | string[]> {
  return {};
}`,
  solution: `function parseQuery(qs: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const decode = (s: string) => decodeURIComponent(s.replace(/\\+/g, " "));
  const body = qs.startsWith("?") ? qs.slice(1) : qs;
  for (const pair of body.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = decode(eq === -1 ? pair : pair.slice(0, eq));
    const val = eq === -1 ? "" : decode(pair.slice(eq + 1));
    const prev = out[key];
    if (prev === undefined) out[key] = val;
    else if (Array.isArray(prev)) prev.push(val);
    else out[key] = [prev, val];
  }
  return out;
}`,
  cases: [
    { args: [""], expected: {}, name: "vide" },
    { args: ["?"], expected: {}, name: "juste ?" },
    { args: ["?page=2&limit=20"], expected: { page: "2", limit: "20" }, name: "simple" },
    { args: ["tag=a&tag=b&tag=c"], expected: { tag: ["a", "b", "c"] }, name: "clé répétée" },
    {
      args: ["q=hello%20world&city=Saint+%C3%89tienne"],
      expected: { q: "hello world", city: "Saint Étienne" },
      name: "décodage + et %XX",
    },
    { args: ["debug&verbose="], expected: { debug: "", verbose: "" }, name: "flags" },
    { args: ["a=1&&b=2&"], expected: { a: "1", b: "2" }, name: "paires vides" },
    { args: ["token=abc=="], expected: { token: "abc==" }, name: "= dans la valeur" },
    {
      args: ["filter%5Bstatus%5D=paid"],
      expected: { "filter[status]": "paid" },
      name: "clé encodée",
    },
  ],
});
