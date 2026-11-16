import { defineChallenge } from "../../../.vitepress/theme/challenge";

const harness = `
// --- Harnais de test (ne pas modifier) ---
async function run(
  failures: number,
  retries: number,
  maxMs: number,
  fatal: boolean,
) {
  let attempts = 0;
  const delays: number[] = [];
  const fn = async () => {
    attempts++;
    if (attempts <= failures) {
      throw new Error(fatal ? "fatal" : "transient");
    }
    return "ok";
  };
  try {
    const value = await retry(fn, {
      retries,
      baseMs: 10,
      maxMs,
      shouldRetry: (e) => (e as Error).message !== "fatal",
      sleep: async (ms) => { delays.push(ms); },
    });
    return { value, attempts, delays };
  } catch (e) {
    return { error: (e as Error).message, attempts, delays };
  }
}`;

export default defineChallenge({
  id: "ts-retry",
  title: "retry async avec backoff exponentiel",
  difficulty: "moyen",
  entry: "run",
  starter: `type RetryOptions = {
  retries: number;   // nb de NOUVELLES tentatives après la 1re
  baseMs: number;    // délai avant la 1re nouvelle tentative
  maxMs: number;     // plafond du délai
  shouldRetry?: (err: unknown) => boolean; // défaut : toujours
  sleep?: (ms: number) => Promise<void>;   // injecté pour tester
};

// Délai avant la tentative n° k (k = 1, 2, ...) :
//   min(baseMs * 2 ** (k - 1), maxMs)   (pas de jitter ici)
// Si toutes les tentatives échouent : relance la DERNIÈRE erreur.
async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  throw new Error("TODO");
}
` + harness,
  solution: `type RetryOptions = {
  retries: number;
  baseMs: number;
  maxMs: number;
  shouldRetry?: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const shouldRetry = opts.shouldRetry ?? (() => true);
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= opts.retries || !shouldRetry(err)) throw err;
      const delay = Math.min(opts.baseMs * 2 ** attempt, opts.maxMs);
      await sleep(delay);
    }
  }
}
` + harness,
  cases: [
    { name: "succès direct", args: [0, 3, 1000, false], expected: { value: "ok", attempts: 1, delays: [] } },
    { name: "2 échecs puis ok", args: [2, 3, 1000, false], expected: { value: "ok", attempts: 3, delays: [10, 20] } },
    { name: "épuise les retries", args: [10, 3, 1000, false], expected: { error: "transient", attempts: 4, delays: [10, 20, 40] } },
    { name: "plafond maxMs", args: [4, 5, 25, false], expected: { value: "ok", attempts: 5, delays: [10, 20, 25, 25] } },
    { name: "erreur non retryable", args: [1, 3, 1000, true], expected: { error: "fatal", attempts: 1, delays: [] } },
    { name: "retries = 0", args: [1, 0, 1000, false], expected: { error: "transient", attempts: 1, delays: [] } },
  ],
});
