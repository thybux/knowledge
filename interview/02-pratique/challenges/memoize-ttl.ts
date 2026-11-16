import { defineChallenge } from "../../../.vitepress/theme/challenge";

const harness = `
// ---- Harnais de test (ne pas modifier) ----
// calls : [instant (ms), argument]. Renvoie, pour chaque appel,
// "valeur/hit" ou "valeur/miss" (miss = la vraie fn a tourné).
function runMemo(ttlMs: number, calls: [number, string][]) {
  let clock = 0;
  let computed = 0;
  const slowFetch = (id: string) => { computed++; return id.toUpperCase() + computed; };
  const cached = memoize(slowFetch, { ttlMs, now: () => clock });
  return calls.map(([t, arg]) => {
    clock = t;
    const before = computed;
    const v = cached(arg);
    return v + "/" + (computed === before ? "hit" : "miss");
  });
}`;

export default defineChallenge({
  id: "prat-ts-memo-ttl",
  title: "memoize avec TTL",
  difficulty: "moyen",
  entry: "runMemo",
  starter: `type Opts = { ttlMs: number; now: () => number };

// Met en cache le résultat par arguments (clé = JSON.stringify(args)).
// Une entrée créée à t est valide tant que now() - t < ttlMs.
// Après expiration : on recalcule et on repart pour ttlMs.
function memoize<A extends unknown[], R>(
  fn: (...args: A) => R,
  opts: Opts,
): (...args: A) => R {
  return fn;
}
${harness}`,
  solution: `type Opts = { ttlMs: number; now: () => number };

function memoize<A extends unknown[], R>(
  fn: (...args: A) => R,
  opts: Opts,
): (...args: A) => R {
  const cache = new Map<string, { value: R; at: number }>();
  return (...args: A) => {
    const key = JSON.stringify(args);
    const hit = cache.get(key);
    const t = opts.now();
    if (hit && t - hit.at < opts.ttlMs) return hit.value;
    const value = fn(...args);
    cache.set(key, { value, at: t });
    return value;
  };
}
${harness}`,
  cases: [
    { args: [1000, [[0, "a"]]], expected: ["A1/miss"], name: "premier appel" },
    {
      args: [1000, [[0, "a"], [10, "a"], [999, "a"]]],
      expected: ["A1/miss", "A1/hit", "A1/hit"],
      name: "hits dans le TTL",
    },
    {
      args: [1000, [[0, "a"], [1000, "a"]]],
      expected: ["A1/miss", "A2/miss"],
      name: "expiration pile au TTL",
    },
    {
      args: [1000, [[0, "a"], [5, "b"], [6, "a"], [7, "b"]]],
      expected: ["A1/miss", "B2/miss", "A1/hit", "B2/hit"],
      name: "clés séparées",
    },
    {
      args: [100, [[0, "a"], [150, "a"], [200, "a"], [250, "a"]]],
      expected: ["A1/miss", "A2/miss", "A2/hit", "A3/miss"],
      name: "le TTL repart après recalcul",
    },
    {
      args: [0, [[0, "a"], [0, "a"]]],
      expected: ["A1/miss", "A2/miss"],
      name: "TTL 0 = pas de cache",
    },
    {
      args: [500, [[0, "a"], [100, "b"], [550, "a"], [560, "b"]]],
      expected: ["A1/miss", "B2/miss", "A3/miss", "B2/hit"],
      name: "expirations indépendantes",
    },
  ],
});
