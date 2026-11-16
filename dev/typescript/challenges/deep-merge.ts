import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "ts-deep-merge",
  title: "deepMerge de config (DeepPartial)",
  difficulty: "moyen",
  entry: "deepMerge",
  starter: `type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

// Fusionne override dans base, SANS muter les entrées :
// - objets "simples" : fusion récursive
// - tableaux : remplacés (pas concaténés)
// - valeur undefined dans override : ignorée
// - null dans override : écrase
// - ignore les clés "__proto__", "constructor", "prototype"
function deepMerge<T extends object>(
  base: T,
  override: DeepPartial<T>,
): T {
  return base;
}`,
  solution: `type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function deepMerge<T extends object>(
  base: T,
  override: DeepPartial<T>,
): T {
  const out: Record<string, unknown> = {
    ...(base as Record<string, unknown>),
  };
  for (const [k, v] of Object.entries(override)) {
    if (FORBIDDEN.has(k) || v === undefined) continue;
    const cur = out[k];
    out[k] = isPlainObject(cur) && isPlainObject(v)
      ? deepMerge(cur, v)
      : v;
  }
  return out as T;
}`,
  cases: [
    {
      name: "fusion imbriquée",
      args: [
        { db: { host: "localhost", port: 5432 }, log: { level: "info" } },
        { db: { host: "db.prod" } },
      ],
      expected: { db: { host: "db.prod", port: 5432 }, log: { level: "info" } },
    },
    {
      name: "tableaux remplacés",
      args: [{ cors: { origins: ["a", "b"] } }, { cors: { origins: ["c"] } }],
      expected: { cors: { origins: ["c"] } },
    },
    {
      name: "null écrase",
      args: [{ cache: { ttl: 60 }, proxy: "http://p" }, { proxy: null }],
      expected: { cache: { ttl: 60 }, proxy: null },
    },
    {
      name: "objet remplace un scalaire",
      args: [{ a: 1 }, { a: { b: 2 } }],
      expected: { a: { b: 2 } },
    },
    {
      name: "3 niveaux",
      args: [{ a: { b: { c: 1, d: 2 } } }, { a: { b: { d: 3 } } }],
      expected: { a: { b: { c: 1, d: 3 } } },
    },
    { name: "override vide", args: [{ a: 1 }, {}], expected: { a: 1 } },
  ],
});
