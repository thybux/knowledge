import { defineChallenge } from "../../../.vitepress/theme/challenge";

const harness = `
// --- Harnais de test (ne pas modifier) ---
function run(actions: Action[]): State {
  return actions.reduce(reducer, initialState);
}`;

const types = `type Values = { name: string; email: string; guests: number };
type Errors = Partial<Record<keyof Values, string>>;

// Des états impossibles sont... impossibles :
type State =
  | { status: "editing"; values: Values; errors: Errors }
  | { status: "submitting"; values: Values }
  | { status: "success"; bookingId: string }
  | { status: "error"; values: Values; message: string };

type Action =
  | { type: "change"; field: "name" | "email"; value: string }
  | { type: "change"; field: "guests"; value: number }
  | { type: "submit" }
  | { type: "succeeded"; bookingId: string }
  | { type: "failed"; message: string }
  | { type: "reset" };

const initialState: State = {
  status: "editing",
  values: { name: "", email: "", guests: 1 },
  errors: {},
};
`;

export default defineChallenge({
  id: "ts-booking-reducer",
  title: "Reducer de formulaire de réservation",
  difficulty: "moyen",
  entry: "run",
  starter: types + `
// Règles :
// - change : seulement en "editing" ou "error" -> repasse en
//   "editing" avec errors: {} (sinon action ignorée)
// - submit (depuis editing/error) : valide
//     name : non vide après trim  -> "required"
//     email : contient "@"        -> "invalid"
//     guests : entier 1..8        -> "out_of_range"
//   erreurs -> "editing" avec errors ; sinon -> "submitting"
// - succeeded / failed : seulement depuis "submitting"
// - reset : toujours -> initialState
// Toute action non applicable retourne l'état INCHANGÉ.
function reducer(state: State, action: Action): State {
  return state;
}
` + harness,
  solution: types + `
function validate(v: Values): Errors {
  const e: Errors = {};
  if (v.name.trim() === "") e.name = "required";
  if (!v.email.includes("@")) e.email = "invalid";
  if (!Number.isInteger(v.guests) || v.guests < 1 || v.guests > 8) {
    e.guests = "out_of_range";
  }
  return e;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "change": {
      if (state.status !== "editing" && state.status !== "error") {
        return state;
      }
      const values = { ...state.values, [action.field]: action.value };
      return { status: "editing", values, errors: {} };
    }
    case "submit": {
      if (state.status !== "editing" && state.status !== "error") {
        return state;
      }
      const errors = validate(state.values);
      return Object.keys(errors).length > 0
        ? { status: "editing", values: state.values, errors }
        : { status: "submitting", values: state.values };
    }
    case "succeeded":
      return state.status === "submitting"
        ? { status: "success", bookingId: action.bookingId }
        : state;
    case "failed":
      return state.status === "submitting"
        ? { status: "error", values: state.values,
            message: action.message }
        : state;
    case "reset":
      return initialState;
    default: {
      const _exhaustive: never = action;
      return state;
    }
  }
}
` + harness,
  cases: [
    {
      name: "parcours nominal",
      args: [[
        { type: "change", field: "name", value: "Ada" },
        { type: "change", field: "email", value: "ada@ex.com" },
        { type: "change", field: "guests", value: 2 },
        { type: "submit" },
        { type: "succeeded", bookingId: "bk_42" },
      ]],
      expected: { status: "success", bookingId: "bk_42" },
    },
    {
      name: "validation",
      args: [[
        { type: "change", field: "name", value: "   " },
        { type: "change", field: "guests", value: 12 },
        { type: "submit" },
      ]],
      expected: {
        status: "editing",
        values: { name: "   ", email: "", guests: 12 },
        errors: { name: "required", email: "invalid", guests: "out_of_range" },
      },
    },
    {
      name: "échec serveur puis correction",
      args: [[
        { type: "change", field: "name", value: "Ada" },
        { type: "change", field: "email", value: "a@b" },
        { type: "submit" },
        { type: "failed", message: "slot_taken" },
        { type: "change", field: "guests", value: 3 },
      ]],
      expected: {
        status: "editing",
        values: { name: "Ada", email: "a@b", guests: 3 },
        errors: {},
      },
    },
    {
      name: "actions ignorées hors contexte",
      args: [[
        { type: "succeeded", bookingId: "nope" },
        { type: "change", field: "name", value: "Bob" },
        { type: "change", field: "email", value: "b@c" },
        { type: "submit" },
        { type: "change", field: "name", value: "hack" },
        { type: "submit" },
      ]],
      expected: {
        status: "submitting",
        values: { name: "Bob", email: "b@c", guests: 1 },
      },
    },
    {
      name: "reset",
      args: [[
        { type: "change", field: "name", value: "Ada" },
        { type: "reset" },
      ]],
      expected: { status: "editing", values: { name: "", email: "", guests: 1 }, errors: {} },
    },
  ],
});
