import { defineChallenge } from "../../../.vitepress/theme/challenge";

const harness = `
// ---- Harnais de test (ne pas modifier) ----
function run(op: "flatten" | "unflatten", input: any) {
  return op === "flatten" ? flatten(input) : unflatten(input);
}`;

export default defineChallenge({
  id: "prat-ts-flatten",
  title: "flatten / unflatten en clés pointées",
  difficulty: "moyen",
  entry: "run",
  starter: `type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

// flatten({ a: { b: 1 }, t: [5, 6] })
//   -> { "a.b": 1, "t.0": 5, "t.1": 6 }
// Un objet ou tableau VIDE est une feuille : { a: {} } -> { a: {} }
function flatten(obj: { [k: string]: Json }): Record<string, Json> {
  return {};
}

// Inverse. Un segment composé uniquement de chiffres crée un
// tableau : { "t.0": 5 } -> { t: [5] }
function unflatten(flat: Record<string, Json>): { [k: string]: Json } {
  return {};
}
${harness}`,
  solution: `type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function flatten(obj: { [k: string]: Json }): Record<string, Json> {
  const out: Record<string, Json> = {};
  const walk = (v: Json, path: string) => {
    const isObj = typeof v === "object" && v !== null;
    if (isObj && Object.keys(v).length > 0) {
      for (const [k, x] of Object.entries(v)) {
        walk(x, path ? path + "." + k : k);
      }
    } else {
      out[path] = v;
    }
  };
  for (const [k, v] of Object.entries(obj)) walk(v, k);
  return out;
}

function unflatten(flat: Record<string, Json>): { [k: string]: Json } {
  const root: any = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    let cur = root;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) {
        cur[p] = value;
        return;
      }
      if (cur[p] === undefined) {
        cur[p] = /^\\d+$/.test(parts[i + 1]) ? [] : {};
      }
      cur = cur[p];
    });
  }
  return root;
}
${harness}`,
  cases: [
    { args: ["flatten", {}], expected: {}, name: "flatten vide" },
    {
      args: ["flatten", { a: { b: 1, c: { d: "x" } }, e: true }],
      expected: { "a.b": 1, "a.c.d": "x", e: true },
      name: "flatten imbriqué",
    },
    {
      args: ["flatten", { t: [5, { k: 6 }] }],
      expected: { "t.0": 5, "t.1.k": 6 },
      name: "flatten tableaux",
    },
    {
      args: ["flatten", { a: {}, b: [], c: null }],
      expected: { a: {}, b: [], c: null },
      name: "flatten feuilles vides et null",
    },
    {
      args: ["unflatten", { "a.b": 1, "a.c.d": "x", e: true }],
      expected: { a: { b: 1, c: { d: "x" } }, e: true },
      name: "unflatten imbriqué",
    },
    {
      args: ["unflatten", { "t.0": 5, "t.1.k": 6 }],
      expected: { t: [5, { k: 6 }] },
      name: "unflatten tableaux",
    },
    {
      args: ["unflatten", { "user.addresses.0.city": "Lyon", "user.name": "Ana" }],
      expected: { user: { addresses: [{ city: "Lyon" }], name: "Ana" } },
      name: "unflatten formulaire",
    },
    {
      args: ["unflatten", { a: {}, "b.c": [] }],
      expected: { a: {}, b: { c: [] } },
      name: "unflatten feuilles vides",
    },
  ],
});
