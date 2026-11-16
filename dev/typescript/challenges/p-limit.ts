import { defineChallenge } from "../../../.vitepress/theme/challenge";

const harness = `
// --- Harnais de test (ne pas modifier) ---
// durations[i] = durée de la tâche i en ms (négatif = la tâche échoue)
async function run(concurrency: number, durations: number[]) {
  const limit = pLimit(concurrency);
  let active = 0;
  let maxActive = 0;
  const task = (i: number, d: number) => async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, Math.abs(d)));
    active--;
    if (d < 0) throw new Error("boom " + i);
    return i * 10;
  };
  const settled = await Promise.allSettled(
    durations.map((d, i) => limit(task(i, d))),
  );
  const results = settled.map((s) =>
    s.status === "fulfilled" ? s.value : "err",
  );
  return { results, maxActive };
}`;

export default defineChallenge({
  id: "ts-p-limit",
  title: "pLimit : limiter la concurrence",
  difficulty: "moyen",
  entry: "run",
  starter: `// pLimit(n) retourne une fonction limit(fn) :
// - au plus n fn() en cours en même temps
// - limit(fn) retourne une Promise du résultat de fn
// - une tâche qui échoue libère quand même sa place
// - les tâches démarrent dans l'ordre d'appel (FIFO)
function pLimit(concurrency: number) {
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  };
}
` + harness,
  solution: `function pLimit(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  const next = () => {
    if (active >= concurrency) return;
    const start = queue.shift();
    if (start) start();
  };

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
` + harness,
  cases: [
    { name: "limite à 2", args: [2, [30, 10, 20, 10, 5]], expected: { results: [0, 10, 20, 30, 40], maxActive: 2 } },
    { name: "limite à 1 (séquentiel)", args: [1, [5, 5, 5]], expected: { results: [0, 10, 20], maxActive: 1 } },
    { name: "limite > nb tâches", args: [10, [5, 5, 5]], expected: { results: [0, 10, 20], maxActive: 3 } },
    { name: "une tâche échoue", args: [2, [10, -5, 10, 10]], expected: { results: [0, "err", 20, 30], maxActive: 2 } },
    { name: "aucune tâche", args: [3, []], expected: { results: [], maxActive: 0 } },
  ],
});
