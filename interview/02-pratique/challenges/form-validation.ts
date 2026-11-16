import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "prat-ts-form",
  title: "Validation d'un formulaire d'inscription",
  difficulty: "facile",
  entry: "validateSignup",
  starter: `type Input = {
  email?: string; password?: string; confirm?: string;
  age?: string | number; // un <input> envoie souvent une string
};
type Output =
  | { ok: true; value: { email: string; age: number } }
  | { ok: false; errors: Record<string, string> };

// Une seule erreur par champ (la 1re), champs dans l'ordre
// email, password, confirm, age. Codes d'erreur :
// email    : "required" | "invalid"   (après trim ; forme x@y.z)
// password : "required" | "too_short" (< 8) | "weak" (pas de
//            lettre ET de chiffre)
// confirm  : "mismatch" (≠ password, testé seulement si password ok)
// age      : "required" | "not_integer" | "too_young" (< 18)
// Si ok : email trim + minuscules, age converti en number.
function validateSignup(input: Input): Output {
  return { ok: false, errors: {} };
}`,
  solution: `type Input = {
  email?: string; password?: string; confirm?: string;
  age?: string | number;
};
type Output =
  | { ok: true; value: { email: string; age: number } }
  | { ok: false; errors: Record<string, string> };

function validateSignup(input: Input): Output {
  const errors: Record<string, string> = {};

  const email = (input.email ?? "").trim().toLowerCase();
  if (!email) errors.email = "required";
  else if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) errors.email = "invalid";

  const pw = input.password ?? "";
  if (!pw) errors.password = "required";
  else if (pw.length < 8) errors.password = "too_short";
  else if (!/[a-z]/i.test(pw) || !/\\d/.test(pw)) errors.password = "weak";

  if (!errors.password && input.confirm !== pw) errors.confirm = "mismatch";

  const rawAge = typeof input.age === "string" ? input.age.trim() : input.age;
  const age = Number(rawAge);
  if (rawAge === undefined || rawAge === "") errors.age = "required";
  else if (!Number.isInteger(age)) errors.age = "not_integer";
  else if (age < 18) errors.age = "too_young";

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { email, age } };
}`,
  cases: [
    {
      args: [{ email: " Ana@Mail.COM ", password: "secret123", confirm: "secret123", age: "30" }],
      expected: { ok: true, value: { email: "ana@mail.com", age: 30 } },
      name: "valide (normalisation)",
    },
    {
      args: [{}],
      expected: { ok: false, errors: { email: "required", password: "required", age: "required" } },
      name: "tout vide",
    },
    {
      args: [{ email: "ana@mail", password: "secret123", confirm: "secret123", age: 30 }],
      expected: { ok: false, errors: { email: "invalid" } },
      name: "email sans TLD",
    },
    {
      args: [{ email: "a@b.co", password: "abc1", confirm: "abc1", age: 20 }],
      expected: { ok: false, errors: { password: "too_short" } },
      name: "mot de passe court",
    },
    {
      args: [{ email: "a@b.co", password: "abcdefghij", confirm: "abcdefghij", age: 20 }],
      expected: { ok: false, errors: { password: "weak" } },
      name: "mot de passe sans chiffre",
    },
    {
      args: [{ email: "a@b.co", password: "secret123", confirm: "secret124", age: 20 }],
      expected: { ok: false, errors: { confirm: "mismatch" } },
      name: "confirmation différente",
    },
    {
      args: [{ email: "a@b.co", password: "secret123", confirm: "secret123", age: "17.5" }],
      expected: { ok: false, errors: { age: "not_integer" } },
      name: "âge décimal",
    },
    {
      args: [{ email: "a@b.co", password: "secret123", confirm: "secret123", age: "abc" }],
      expected: { ok: false, errors: { age: "not_integer" } },
      name: "âge non numérique",
    },
    {
      args: [{ email: "a@b.co", password: "secret123", confirm: "secret123", age: 16 }],
      expected: { ok: false, errors: { age: "too_young" } },
      name: "mineur",
    },
  ],
});
