import { defineChallenge } from "../../../.vitepress/theme/challenge";

const harness = `
// ---- Harnais de test (ne pas modifier) ----
// Construit une valeur selon \`kind\`, la clone, puis vérifie.
function checkClone(kind: string) {
  const d = new Date("2026-01-01T00:00:00Z");
  const inputs: Record<string, () => any> = {
    primitive: () => 42,
    nested: () => ({ a: { b: [1, { c: 2 }] }, s: "x", n: null }),
    date: () => ({ createdAt: d }),
    map: () => ({ m: new Map<string, any>([["k", { v: 1 }]]) }),
    set: () => ({ s: new Set([1, 2, 3]) }),
    cycle: () => { const o: any = { name: "root" }; o.self = o; return o; },
    shared: () => { const s = { x: 1 }; return { a: s, b: s }; },
  };
  const src = inputs[kind]();
  const c: any = deepClone(src);
  switch (kind) {
    case "primitive": return c === 42;
    case "nested":
      c.a.b[1].c = 99;
      return [src.a.b[1].c === 2, c.a !== src.a, JSON.stringify(c)];
    case "date":
      return [c.createdAt instanceof Date, c.createdAt !== src.createdAt,
        c.createdAt?.getTime?.() === d.getTime()];
    case "map":
      return [c.m instanceof Map, c.m !== src.m,
        c.m.get("k")?.v === 1, c.m.get("k") !== src.m.get("k")];
    case "set":
      return [c.s instanceof Set, c.s !== src.s, [...c.s].join(",")];
    case "cycle":
      return [c.self === c, c !== src, c.name];
    case "shared":
      return [c.a === c.b, c.a !== src.a];
  }
}`;

export default defineChallenge({
  id: "prat-ts-deep-clone",
  title: "deepClone (Date, Map, Set, cycles)",
  difficulty: "moyen",
  entry: "checkClone",
  starter: `// Copie profonde qui gère : objets, tableaux, Date, Map, Set,
// références partagées et cycles (un objet vu deux fois doit
// donner UNE seule copie). Interdit : structuredClone ;)
function deepClone<T>(value: T): T {
  return value;
}
${harness}`,
  solution: `function deepClone<T>(value: T, seen = new Map<any, any>()): T {
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return seen.get(value);
  const v: any = value;
  if (v instanceof Date) return new Date(v.getTime()) as any;
  if (v instanceof Map) {
    const out = new Map();
    seen.set(v, out);
    for (const [k, x] of v) out.set(deepClone(k, seen), deepClone(x, seen));
    return out as any;
  }
  if (v instanceof Set) {
    const out = new Set();
    seen.set(v, out);
    for (const x of v) out.add(deepClone(x, seen));
    return out as any;
  }
  const out: any = Array.isArray(v) ? [] : {};
  seen.set(v, out);
  for (const k of Object.keys(v)) out[k] = deepClone(v[k], seen);
  return out;
}
${harness}`,
  cases: [
    { args: ["primitive"], expected: true, name: "primitif" },
    {
      args: ["nested"],
      expected: [true, true, '{"a":{"b":[1,{"c":99}]},"s":"x","n":null}'],
      name: "objets imbriqués indépendants",
    },
    { args: ["date"], expected: [true, true, true], name: "Date" },
    { args: ["map"], expected: [true, true, true, true], name: "Map (valeurs clonées)" },
    { args: ["set"], expected: [true, true, "1,2,3"], name: "Set" },
    { args: ["cycle"], expected: [true, true, "root"], name: "cycle" },
    { args: ["shared"], expected: [true, true], name: "référence partagée" },
  ],
});
