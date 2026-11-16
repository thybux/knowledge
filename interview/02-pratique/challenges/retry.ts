import { defineChallenge } from "../../../.vitepress/theme/challenge";

const harness = `
// ---- Harnais de test (ne pas modifier) ----
// script : ce que renvoie chaque tentative, dans l'ordre.
//   "ok"    -> succès
//   "fail"  -> erreur retryable (ex: 503)
//   "fatal" -> erreur non retryable (ex: 400), err.retryable = false
async function runRetry(script: string[], opts: { retries: number; baseMs: number; maxMs: number }) {
  let attempts = 0;
  const delays: number[] = [];
  const fn = async () => {
    const step = script[attempts++] ?? "ok";
    if (step === "ok") return "data#" + attempts;
    const err: any = new Error(step + "#" + attempts);
    if (step === "fatal") err.retryable = false;
    throw err;
  };
  const sleep = (ms: number) => {
    delays.push(ms);
    return new Promise<void>((r) => setTimeout(r, 1));
  };
  try {
    const value = await retry(fn, { ...opts, sleep });
    return { ok: true, value, attempts, delays };
  } catch (e: any) {
    return { ok: false, error: e.message, attempts, delays };
  }
}`;

export default defineChallenge({
  id: "prat-ts-retry",
  title: "retry avec backoff exponentiel",
  difficulty: "moyen",
  entry: "runRetry",
  starter: `type RetryOpts = {
  retries: number; // nombre de RE-tentatives max (0 = un seul essai)
  baseMs: number;  // délai avant la 1re re-tentative
  maxMs: number;   // plafond du délai
  sleep: (ms: number) => Promise<void>; // horloge injectée
};

// Appelle fn ; en cas d'erreur, attend baseMs * 2^(n-1)
// (plafonné à maxMs) avant la n-ième re-tentative.
// Si err.retryable === false : on relance l'erreur tout de suite.
// Après épuisement : relance la DERNIÈRE erreur.
async function retry<T>(fn: () => Promise<T>, opts: RetryOpts): Promise<T> {
  return fn();
}
${harness}`,
  solution: `type RetryOpts = {
  retries: number;
  baseMs: number;
  maxMs: number;
  sleep: (ms: number) => Promise<void>;
};

async function retry<T>(fn: () => Promise<T>, opts: RetryOpts): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.retryable === false || attempt >= opts.retries) throw err;
      const delay = Math.min(opts.baseMs * 2 ** attempt, opts.maxMs);
      await opts.sleep(delay);
    }
  }
}
${harness}`,
  cases: [
    {
      args: [["ok"], { retries: 3, baseMs: 100, maxMs: 1000 }],
      expected: { ok: true, value: "data#1", attempts: 1, delays: [] },
      name: "succès direct",
    },
    {
      args: [["fail", "fail", "ok"], { retries: 3, baseMs: 100, maxMs: 1000 }],
      expected: { ok: true, value: "data#3", attempts: 3, delays: [100, 200] },
      name: "deux échecs puis succès",
    },
    {
      args: [["fail", "fail", "fail", "fail"], { retries: 3, baseMs: 100, maxMs: 1000 }],
      expected: { ok: false, error: "fail#4", attempts: 4, delays: [100, 200, 400] },
      name: "épuisement : dernière erreur",
    },
    {
      args: [["fail", "fatal", "ok"], { retries: 5, baseMs: 50, maxMs: 1000 }],
      expected: { ok: false, error: "fatal#2", attempts: 2, delays: [50] },
      name: "erreur non retryable",
    },
    {
      args: [["fatal"], { retries: 5, baseMs: 50, maxMs: 1000 }],
      expected: { ok: false, error: "fatal#1", attempts: 1, delays: [] },
      name: "fatal dès le 1er essai",
    },
    {
      args: [["fail", "fail", "fail", "fail", "fail", "ok"], { retries: 6, baseMs: 100, maxMs: 500 }],
      expected: { ok: true, value: "data#6", attempts: 6, delays: [100, 200, 400, 500, 500] },
      name: "plafond maxMs",
    },
    {
      args: [["fail", "ok"], { retries: 0, baseMs: 100, maxMs: 1000 }],
      expected: { ok: false, error: "fail#1", attempts: 1, delays: [] },
      name: "retries = 0",
    },
    {
      args: [["fail", "ok"], { retries: 1, baseMs: 10, maxMs: 1000 }],
      expected: { ok: true, value: "data#2", attempts: 2, delays: [10] },
      name: "une seule re-tentative suffit",
    },
  ],
});
