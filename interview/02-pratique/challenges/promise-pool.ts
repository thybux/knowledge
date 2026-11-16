import { defineChallenge } from "../../../.vitepress/theme/challenge";

const harness = `
// ---- Harnais de test (ne pas modifier) ----
// durations[i] : durée (ms) de la tâche i ; négatif = la tâche échoue.
async function runPool(durations: number[], limit: number) {
  let active = 0;
  let maxActive = 0;
  const tasks = durations.map((d, i) => async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, Math.abs(d)));
    active--;
    if (d < 0) throw new Error("task " + i + " failed");
    return "r" + i;
  });
  try {
    const results = await promisePool(tasks, limit);
    return { results, maxActive };
  } catch (e: any) {
    return { error: e.message };
  }
}`;

export default defineChallenge({
  id: "prat-ts-pool",
  title: "promisePool (limite de concurrence)",
  difficulty: "moyen",
  entry: "runPool",
  starter: `// Exécute les tâches avec au plus \`limit\` en parallèle.
// - résultats dans l'ORDRE des tâches (pas l'ordre de fin)
// - une tâche libérée -> on démarre la suivante aussitôt
// - si une tâche échoue : la promesse rejette avec son erreur
async function promisePool<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  return [];
}
${harness}`,
  solution: `async function promisePool<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  const n = Math.min(limit, tasks.length);
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}
${harness}`,
  cases: [
    { args: [[], 3], expected: { results: [], maxActive: 0 }, name: "aucune tâche" },
    {
      args: [[5, 5, 5], 1],
      expected: { results: ["r0", "r1", "r2"], maxActive: 1 },
      name: "séquentiel (limit 1)",
    },
    {
      args: [[15, 2, 8, 1], 2],
      expected: { results: ["r0", "r1", "r2", "r3"], maxActive: 2 },
      name: "ordre conservé malgré les durées",
    },
    {
      args: [[3, 3, 3, 3, 3, 3], 3],
      expected: { results: ["r0", "r1", "r2", "r3", "r4", "r5"], maxActive: 3 },
      name: "limit 3",
    },
    {
      args: [[2, 2], 10],
      expected: { results: ["r0", "r1"], maxActive: 2 },
      name: "limit > nombre de tâches",
    },
    {
      args: [[20, 1, 1, 1, 1, 1], 2],
      expected: { results: ["r0", "r1", "r2", "r3", "r4", "r5"], maxActive: 2 },
      name: "une tâche lente ne bloque pas les autres",
    },
    {
      args: [[2, -3, 2], 2],
      expected: { error: "task 1 failed" },
      name: "une tâche échoue",
    },
    {
      args: [[1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 4],
      expected: {
        results: ["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"],
        maxActive: 4,
      },
      name: "10 tâches, limit 4",
    },
  ],
});
