import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "ts-fake-clock",
  title: "Une horloge factice pour les tests",
  difficulty: "moyen",
  mode: "class",
  entry: "FakeClock",
  starter: `// Ce que fait vi.useFakeTimers(), en version simplifiée.
// - now() : temps courant en ms (démarre à 0)
// - schedule(id, delayMs) : programme un timer
// - cancel(id) : annule (sans effet si inconnu / déjà parti)
// - tick(ms) : avance le temps et retourne les ids déclenchés,
//   triés par échéance puis ordre de programmation.
//   Un timer d'échéance <= now + ms se déclenche.
class FakeClock {
  now(): number { return 0; }
  schedule(id: string, delayMs: number): void {}
  cancel(id: string): void {}
  tick(ms: number): string[] { return []; }
}`,
  solution: `type Timer = { id: string; due: number; seq: number };

class FakeClock {
  #now = 0;
  #seq = 0;
  #timers = new Map<string, Timer>();

  now(): number { return this.#now; }

  schedule(id: string, delayMs: number): void {
    const due = this.#now + Math.max(0, delayMs);
    this.#timers.set(id, { id, due, seq: this.#seq++ });
  }

  cancel(id: string): void { this.#timers.delete(id); }

  tick(ms: number): string[] {
    this.#now += ms;
    const fired = [...this.#timers.values()]
      .filter((t) => t.due <= this.#now)
      .sort((a, b) => a.due - b.due || a.seq - b.seq);
    for (const t of fired) this.#timers.delete(t.id);
    return fired.map((t) => t.id);
  }
}`,
  cases: [
    {
      name: "ordre par échéance",
      ops: ["FakeClock", "schedule", "schedule", "schedule", "tick", "now", "tick"],
      args: [[], ["retry", 300], ["flush", 100], ["ping", 1000], [500], [], [500]],
      expected: [null, null, null, null, ["flush", "retry"], 500, ["ping"]],
    },
    {
      name: "annulation",
      ops: ["FakeClock", "schedule", "schedule", "cancel", "tick", "cancel"],
      args: [[], ["a", 10], ["b", 10], ["a"], [10], ["zzz"]],
      expected: [null, null, null, null, ["b"], null],
    },
    {
      name: "même échéance = ordre de programmation",
      ops: ["FakeClock", "schedule", "schedule", "tick", "tick"],
      args: [[], ["second", 50], ["first", 50], [49], [1]],
      expected: [null, null, null, [], ["second", "first"]],
    },
    {
      name: "programmé après avance du temps",
      ops: ["FakeClock", "tick", "schedule", "tick", "tick"],
      args: [[], [1000], ["x", 100], [99], [1]],
      expected: [null, [], null, [], ["x"]],
    },
  ],
});
