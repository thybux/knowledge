import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "next-action-result",
  title: "ActionResult depuis la réponse du backend",
  difficulty: "facile",
  entry: "toActionResult",
  starter: `type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; message: string };

// Réponse du backend telle que la rend le client HTTP (qui ne lève
// jamais) : statusCode absent = erreur réseau ou timeout.
type Envelope = {
  success: boolean;
  data?: unknown;
  message?: string;
  statusCode?: number;
};

const ok = <T,>(data: T): ActionResult<T> =>
  ({ success: true, data });
const fail = (message: string): ActionResult<never> =>
  ({ success: false, message });

// Règles :
// - success          -> ok(data), data absente -> null
// - 401              -> fail("Session expirée : reconnecte-toi.")
// - 429              -> fail("Trop de tentatives, réessaie plus tard.")
// - autre 4xx AVEC message -> fail(message) (message métier lisible)
// - tout le reste (5xx, réseau, 4xx sans message)
//                    -> fail("Service indisponible, réessaie plus tard.")
// Un message de 5xx n'est JAMAIS montré (il peut être technique).
function toActionResult(res: Envelope): ActionResult<unknown> {
  return fail("TODO");
}`,
  solution: `type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; message: string };

type Envelope = {
  success: boolean;
  data?: unknown;
  message?: string;
  statusCode?: number;
};

const ok = <T,>(data: T): ActionResult<T> =>
  ({ success: true, data });
const fail = (message: string): ActionResult<never> =>
  ({ success: false, message });

const UNAVAILABLE = "Service indisponible, réessaie plus tard.";

const FIXED: Record<number, string> = {
  401: "Session expirée : reconnecte-toi.",
  429: "Trop de tentatives, réessaie plus tard.",
};

function toActionResult(res: Envelope): ActionResult<unknown> {
  if (res.success) return ok(res.data ?? null);
  const status = res.statusCode;
  if (status === undefined) return fail(UNAVAILABLE);
  const fixed = FIXED[status];
  if (fixed) return fail(fixed);
  const isClientError = status >= 400 && status < 500;
  if (isClientError && res.message) return fail(res.message);
  return fail(UNAVAILABLE);
}`,
  cases: [
    {
      name: "succès",
      args: [{ success: true, data: { id: 12 }, statusCode: 200 }],
      expected: { success: true, data: { id: 12 } },
    },
    {
      name: "succès sans data",
      args: [{ success: true, statusCode: 204 }],
      expected: { success: true, data: null },
    },
    {
      name: "409 métier",
      args: [{ success: false, statusCode: 409, message: "Stock insuffisant" }],
      expected: { success: false, message: "Stock insuffisant" },
    },
    {
      name: "401",
      args: [{ success: false, statusCode: 401, message: "Unauthorized" }],
      expected: { success: false, message: "Session expirée : reconnecte-toi." },
    },
    {
      name: "429",
      args: [{ success: false, statusCode: 429 }],
      expected: { success: false, message: "Trop de tentatives, réessaie plus tard." },
    },
    {
      name: "500 : message technique masqué",
      args: [{ success: false, statusCode: 500, message: "TypeError: x is undefined" }],
      expected: { success: false, message: "Service indisponible, réessaie plus tard." },
    },
    {
      name: "réseau (pas de statusCode)",
      args: [{ success: false }],
      expected: { success: false, message: "Service indisponible, réessaie plus tard." },
    },
    {
      name: "4xx sans message",
      args: [{ success: false, statusCode: 400 }],
      expected: { success: false, message: "Service indisponible, réessaie plus tard." },
    },
  ],
});
