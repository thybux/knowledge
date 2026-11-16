import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "prat-ts-balances",
  title: "Soldes par compte (ledger)",
  difficulty: "moyen",
  entry: "computeBalances",
  starter: `type Tx =
  | { id: string; type: "deposit"; account: string; amount: number }
  | { id: string; type: "withdraw"; account: string; amount: number }
  | { id: string; type: "transfer"; from: string; to: string; amount: number };

type Result = {
  balances: Record<string, number>; // clés triées par ordre alpha
  rejected: string[];               // ids rejetés, dans l'ordre
};

// Montants en centimes (entiers). On traite dans l'ordre :
// - id déjà vu -> ignoré (doublon de webhook), PAS rejeté
// - amount <= 0 ou non entier -> rejeté
// - withdraw/transfer qui rendrait le solde < 0 -> rejeté
// - un compte apparaît dans balances dès qu'une tx valide le touche
function computeBalances(txs: Tx[]): Result {
  return { balances: {}, rejected: [] };
}`,
  solution: `type Tx =
  | { id: string; type: "deposit"; account: string; amount: number }
  | { id: string; type: "withdraw"; account: string; amount: number }
  | { id: string; type: "transfer"; from: string; to: string; amount: number };

type Result = { balances: Record<string, number>; rejected: string[] };

function computeBalances(txs: Tx[]): Result {
  const bal = new Map<string, number>();
  const seen = new Set<string>();
  const rejected: string[] = [];
  const get = (a: string) => bal.get(a) ?? 0;

  for (const tx of txs) {
    if (seen.has(tx.id)) continue;
    seen.add(tx.id);
    if (!Number.isInteger(tx.amount) || tx.amount <= 0) {
      rejected.push(tx.id);
      continue;
    }
    switch (tx.type) {
      case "deposit":
        bal.set(tx.account, get(tx.account) + tx.amount);
        break;
      case "withdraw":
        if (get(tx.account) < tx.amount) { rejected.push(tx.id); break; }
        bal.set(tx.account, get(tx.account) - tx.amount);
        break;
      case "transfer":
        if (get(tx.from) < tx.amount) { rejected.push(tx.id); break; }
        bal.set(tx.from, get(tx.from) - tx.amount);
        bal.set(tx.to, get(tx.to) + tx.amount);
        break;
    }
  }
  const balances: Record<string, number> = {};
  for (const k of [...bal.keys()].sort()) balances[k] = bal.get(k)!;
  return { balances, rejected };
}`,
  cases: [
    { args: [[]], expected: { balances: {}, rejected: [] }, name: "vide" },
    {
      args: [[
        { id: "t1", type: "deposit", account: "bob", amount: 1000 },
        { id: "t2", type: "deposit", account: "alice", amount: 500 },
      ]],
      expected: { balances: { alice: 500, bob: 1000 }, rejected: [] },
      name: "dépôts, clés triées",
    },
    {
      args: [[
        { id: "t1", type: "deposit", account: "a", amount: 1000 },
        { id: "t2", type: "withdraw", account: "a", amount: 300 },
      ]],
      expected: { balances: { a: 700 }, rejected: [] },
      name: "retrait",
    },
    {
      args: [[
        { id: "t1", type: "deposit", account: "a", amount: 100 },
        { id: "t2", type: "withdraw", account: "a", amount: 101 },
      ]],
      expected: { balances: { a: 100 }, rejected: ["t2"] },
      name: "découvert refusé",
    },
    {
      args: [[
        { id: "t1", type: "deposit", account: "a", amount: 100 },
        { id: "t1", type: "deposit", account: "a", amount: 100 },
        { id: "t1", type: "deposit", account: "a", amount: 100 },
      ]],
      expected: { balances: { a: 100 }, rejected: [] },
      name: "doublons ignorés (idempotence)",
    },
    {
      args: [[
        { id: "t1", type: "deposit", account: "a", amount: 500 },
        { id: "t2", type: "transfer", from: "a", to: "b", amount: 200 },
        { id: "t3", type: "transfer", from: "b", to: "c", amount: 300 },
      ]],
      expected: { balances: { a: 300, b: 200 }, rejected: ["t3"] },
      name: "virements",
    },
    {
      args: [[
        { id: "t1", type: "deposit", account: "a", amount: 0 },
        { id: "t2", type: "deposit", account: "a", amount: 10.5 },
        { id: "t3", type: "deposit", account: "a", amount: -5 },
      ]],
      expected: { balances: {}, rejected: ["t1", "t2", "t3"] },
      name: "montants invalides",
    },
    {
      args: [[
        { id: "t1", type: "withdraw", account: "a", amount: 10 },
        { id: "t2", type: "deposit", account: "a", amount: 10 },
        { id: "t1", type: "withdraw", account: "a", amount: 10 },
      ]],
      expected: { balances: { a: 10 }, rejected: ["t1"] },
      name: "un id rejeté reste « vu »",
    },
  ],
});
