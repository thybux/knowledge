// Execute le code de l'utilisateur dans un Web Worker (isole + coupe si boucle infinie).
import type { ChallengeDef } from "./challenge";
// @ts-ignore
import { WORKER_SRC } from "./worker-src.js";

export type CaseResult = {
  ok: boolean;
  label: string;
  expected: string;
  got: string;
  error?: string;
  ms: number;
};


export async function runChallenge(
  def: ChallengeDef,
  source: string,
  timeoutMs = 4000,
): Promise<{ fatal?: string; results?: CaseResult[] }> {
  let code: string;
  try {
    const { transform } = await import("sucrase");
    code = transform(source, { transforms: ["typescript"], disableESTransforms: true }).code;
  } catch (err: any) {
    return { fatal: "Erreur de syntaxe : " + err.message };
  }

  const blob = new Blob([WORKER_SRC], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  try {
    return await new Promise((resolve) => {
      const timer = setTimeout(
        () => resolve({ fatal: `Temps dépassé (${timeoutMs / 1000}s) : boucle infinie ou algo trop lent ?` }),
        timeoutMs,
      );
      worker.onmessage = (e) => {
        clearTimeout(timer);
        resolve(e.data);
      };
      worker.onerror = (e) => {
        clearTimeout(timer);
        resolve({ fatal: e.message });
      };
      worker.postMessage({
        code,
        entry: def.entry,
        mode: def.mode ?? "function",
        compare: def.compare ?? "exact",
        cases: JSON.parse(JSON.stringify(def.cases)),
      });
    });
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}
