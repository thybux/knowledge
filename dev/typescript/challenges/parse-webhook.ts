import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "ts-parse-webhook",
  title: "Parser un webhook de paiement (unknown → union)",
  difficulty: "moyen",
  entry: "parseWebhook",
  starter: `type PaymentEvent =
  | { type: "payment.succeeded"; id: string; amount: number;
      currency: "EUR" | "USD" }
  | { type: "payment.failed"; id: string; reason: string }
  | { type: "refund.created"; id: string; paymentId: string;
      amount: number };

// Règles :
// - input doit être un objet non null avec un "type" connu
// - "id", "reason", "paymentId" : string non vide
// - "amount" : entier > 0 (centimes)
// - "currency" : "EUR" ou "USD"
// - retourne un NOUVEL objet avec seulement les champs du type
//   (les champs en trop sont ignorés), sinon null
function parseWebhook(input: unknown): PaymentEvent | null {
  return null;
}`,
  solution: `type PaymentEvent =
  | { type: "payment.succeeded"; id: string; amount: number;
      currency: "EUR" | "USD" }
  | { type: "payment.failed"; id: string; reason: string }
  | { type: "refund.created"; id: string; paymentId: string;
      amount: number };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;
const isAmount = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

function parseWebhook(input: unknown): PaymentEvent | null {
  if (!isObj(input) || !isStr(input.id)) return null;
  const { id } = input;
  switch (input.type) {
    case "payment.succeeded": {
      const { amount, currency } = input;
      if (!isAmount(amount)) return null;
      if (currency !== "EUR" && currency !== "USD") return null;
      return { type: input.type, id, amount, currency };
    }
    case "payment.failed":
      if (!isStr(input.reason)) return null;
      return { type: input.type, id, reason: input.reason };
    case "refund.created": {
      const { paymentId, amount } = input;
      if (!isStr(paymentId) || !isAmount(amount)) return null;
      return { type: input.type, id, paymentId, amount };
    }
    default:
      return null;
  }
}`,
  cases: [
    {
      name: "succeeded valide",
      args: [{ type: "payment.succeeded", id: "evt_1", amount: 1990, currency: "EUR" }],
      expected: { type: "payment.succeeded", id: "evt_1", amount: 1990, currency: "EUR" },
    },
    {
      name: "champs en trop ignorés",
      args: [{ type: "payment.failed", id: "evt_2", reason: "card_declined", livemode: true }],
      expected: { type: "payment.failed", id: "evt_2", reason: "card_declined" },
    },
    {
      name: "refund valide",
      args: [{ type: "refund.created", id: "evt_3", paymentId: "pay_9", amount: 500 }],
      expected: { type: "refund.created", id: "evt_3", paymentId: "pay_9", amount: 500 },
    },
    { name: "null", args: [null], expected: null },
    { name: "tableau", args: [[1, 2]], expected: null },
    { name: "type inconnu", args: [{ type: "payout.paid", id: "evt_4" }], expected: null },
    {
      name: "montant décimal",
      args: [{ type: "payment.succeeded", id: "e", amount: 19.9, currency: "EUR" }],
      expected: null,
    },
    {
      name: "montant en string",
      args: [{ type: "refund.created", id: "e", paymentId: "p", amount: "500" }],
      expected: null,
    },
    {
      name: "devise inconnue",
      args: [{ type: "payment.succeeded", id: "e", amount: 100, currency: "GBP" }],
      expected: null,
    },
    { name: "id vide", args: [{ type: "payment.failed", id: "", reason: "x" }], expected: null },
  ],
});
