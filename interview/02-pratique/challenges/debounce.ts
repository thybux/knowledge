import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "prat-ts-debounce",
  title: "Debounce simulé (timestamps)",
  difficulty: "facile",
  entry: "debounceEvents",
  starter: `type Ev = { t: number; value: string };

// events : triés par t croissant (ms).
// Retourne les appels réellement déclenchés : { t: instant du
// déclenchement, value: dernière valeur reçue }.
// Règle : un événement à t programme un appel à t + wait ;
// un nouvel événement à t2 < t + wait annule l'appel en attente.
// Si t2 >= t + wait, l'appel en attente a déjà eu lieu.
function debounceEvents(events: Ev[], wait: number): Ev[] {
  return [];
}`,
  solution: `type Ev = { t: number; value: string };

function debounceEvents(events: Ev[], wait: number): Ev[] {
  const fired: Ev[] = [];
  let pending: Ev | null = null;
  for (const e of events) {
    if (pending && e.t >= pending.t) fired.push(pending);
    pending = { t: e.t + wait, value: e.value };
  }
  if (pending) fired.push(pending);
  return fired;
}`,
  cases: [
    { args: [[], 100], expected: [], name: "aucun événement" },
    {
      args: [[{ t: 0, value: "a" }], 100],
      expected: [{ t: 100, value: "a" }],
      name: "un seul événement",
    },
    {
      args: [[{ t: 0, value: "s" }, { t: 50, value: "se" }, { t: 90, value: "sea" }], 100],
      expected: [{ t: 190, value: "sea" }],
      name: "frappe rapide : un seul appel",
    },
    {
      args: [[{ t: 0, value: "a" }, { t: 150, value: "b" }], 100],
      expected: [{ t: 100, value: "a" }, { t: 250, value: "b" }],
      name: "deux rafales séparées",
    },
    {
      args: [[{ t: 0, value: "a" }, { t: 100, value: "b" }], 100],
      expected: [{ t: 100, value: "a" }, { t: 200, value: "b" }],
      name: "pile à t + wait : déjà déclenché",
    },
    {
      args: [[{ t: 0, value: "a" }, { t: 99, value: "b" }], 100],
      expected: [{ t: 199, value: "b" }],
      name: "1 ms avant : annulé",
    },
    {
      args: [
        [
          { t: 0, value: "1" }, { t: 30, value: "2" }, { t: 200, value: "3" },
          { t: 210, value: "4" }, { t: 220, value: "5" }, { t: 500, value: "6" },
        ],
        50,
      ],
      expected: [
        { t: 80, value: "2" }, { t: 270, value: "5" }, { t: 550, value: "6" },
      ],
      name: "trois rafales",
    },
    {
      args: [[{ t: 10, value: "x" }, { t: 10, value: "y" }], 0],
      expected: [{ t: 10, value: "x" }, { t: 10, value: "y" }],
      name: "wait = 0",
    },
  ],
});
