// Verifie que chaque defi (**/challenges/*.ts) est bien forme et que sa `solution` passe tous ses tests.
// Usage : pnpm check
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { transform } from "sucrase";
import { WORKER_SRC } from "../.vitepress/theme/worker-src.js";

const ROOT = join(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".git", ".vitepress"]);

function* challengeFiles(dir) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* challengeFiles(p);
    else if (n.endsWith(".ts") && dir.endsWith("/challenges")) yield p;
  }
}

function load(file) {
  const { code } = transform(readFileSync(file, "utf8"), { transforms: ["typescript", "imports"] });
  const module = { exports: {} };
  const req = (id) => {
    if (id.endsWith("theme/challenge")) return { defineChallenge: (c) => c };
    throw new Error(`import non supporte dans un defi : ${id}`);
  };
  new Function("require", "module", "exports", code)(req, module, module.exports);
  return module.exports.default;
}

function run(def, source) {
  const js = transform(source, { transforms: ["typescript"], disableESTransforms: true }).code;
  return new Promise((resolve) => {
    const self = { postMessage: resolve };
    new Function("self", WORKER_SRC)(self);
    self.onmessage({
      data: {
        code: js,
        entry: def.entry,
        mode: def.mode ?? "function",
        compare: def.compare ?? "exact",
        cases: JSON.parse(JSON.stringify(def.cases)),
      },
    });
  });
}

const ids = new Map();
let failures = 0;
const fail = (file, msg) => {
  failures++;
  console.error(`✗ ${relative(ROOT, file)} : ${msg}`);
};

for (const file of challengeFiles(ROOT)) {
  let def;
  try {
    def = load(file);
  } catch (e) {
    fail(file, `chargement impossible (${e.message})`);
    continue;
  }
  for (const k of ["id", "title", "difficulty", "entry", "starter", "cases"]) {
    if (!def?.[k]) fail(file, `champ manquant : ${k}`);
  }
  if (!def?.id) continue;
  if (ids.has(def.id)) fail(file, `id duplique "${def.id}" (deja dans ${ids.get(def.id)})`);
  ids.set(def.id, relative(ROOT, file));
  if (!def.solution) {
    fail(file, "pas de `solution` de reference");
    continue;
  }
  const out = await run(def, def.solution);
  if (out.fatal) fail(file, out.fatal);
  for (const r of out.results ?? []) {
    if (!r.ok) fail(file, `${r.label} : attendu ${r.expected}, obtenu ${r.got}${r.error ? ` (${r.error})` : ""}`);
  }
  if (!out.fatal && out.results?.every((r) => r.ok)) console.log(`✓ ${def.id} (${out.results.length} tests)`);
}

console.log(`\n${ids.size} defis, ${failures} erreur(s)`);
process.exit(failures ? 1 : 0);
