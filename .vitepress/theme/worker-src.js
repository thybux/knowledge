// Code du Web Worker qui execute les tests (partage avec scripts/check-challenges.mjs).
export const WORKER_SRC = `
const show = (v) => {
  try { return JSON.stringify(v, (_, x) => x === undefined ? "undefined" : x); } catch { return String(v); }
};
const norm = (v, mode) => {
  if (mode === "unordered" && Array.isArray(v)) {
    return v.map((x) => norm(x, mode)).map((x) => JSON.stringify(x)).sort();
  }
  return v;
};
const equal = (a, b, mode) => {
  if (mode === "float" && typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-6;
  if (mode === "float" && Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => equal(x, b[i], mode));
  return JSON.stringify(norm(a, mode)) === JSON.stringify(norm(b, mode));
};
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

self.onmessage = async (e) => {
  const { code, entry, mode, compare, cases } = e.data;
  let target;
  try {
    target = new Function(code + "\\n;return typeof " + entry + " !== 'undefined' ? " + entry + " : undefined;")();
  } catch (err) {
    self.postMessage({ fatal: "Erreur à l'exécution du code : " + err.message });
    return;
  }
  if (typeof target !== "function") {
    self.postMessage({ fatal: "« " + entry + " » n'est pas défini (vérifie le nom de ta fonction/classe)." });
    return;
  }
  const results = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    results.push(await (async () => {
    const t0 = performance.now();
    const label = c.name || "Cas " + (i + 1);
    try {
      let got;
      if (mode === "class") {
        let inst = null;
        got = c.ops.map((op, j) => {
          const a = clone(c.args[j] || []);
          if (j === 0) { inst = new target(...a); return null; }
          const r = inst[op](...a);
          if (r && typeof r.then === "function") throw new Error("méthode async non supportée en mode class");
          return r === undefined ? null : r;
        });
      } else {
        got = await target(...clone(c.args)); // les fonctions async sont supportées
        if (got === undefined) got = null;
      }
      return { ok: equal(got, c.expected, compare), label, expected: show(c.expected), got: show(got), ms: performance.now() - t0 };
    } catch (err) {
      return { ok: false, label, expected: show(c.expected), got: "—", error: String(err && err.message || err), ms: performance.now() - t0 };
    }
    })());
  }
  self.postMessage({ results });
};
`;
