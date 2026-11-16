import { defineChallenge } from "../../../.vitepress/theme/challenge";

const harness = `
// --- Harnais de test (ne pas modifier) ---
// "auth!" = ce middleware répond sans appeler next()
// "twice" = ce middleware appelle next() deux fois (bug)
async function run(names: string[]) {
  const ctx: Ctx = { log: [] };
  const mws: Middleware[] = names.map((name) => async (c, next) => {
    c.log.push(">" + name);
    if (name.endsWith("!")) { c.log.push("stop"); return; }
    await next();
    if (name === "twice") await next();
    c.log.push("<" + name);
  });
  try {
    await compose(mws)(ctx);
    return ctx.log;
  } catch (e) {
    return [...ctx.log, "error: " + (e as Error).message];
  }
}`;

export default defineChallenge({
  id: "ts-compose",
  title: "compose() de middlewares (modèle oignon)",
  difficulty: "moyen",
  entry: "run",
  starter: `type Ctx = { log: string[] };
type Next = () => Promise<void>;
type Middleware = (ctx: Ctx, next: Next) => Promise<void>;

// compose([a, b, c])(ctx) exécute a, qui appelle next() -> b, etc.
// - si un middleware n'appelle pas next(), la chaîne s'arrête
// - appeler next() 2 fois dans le même middleware doit rejeter
//   avec l'erreur "next() called multiple times"
function compose(mws: Middleware[]): (ctx: Ctx) => Promise<void> {
  return async () => {};
}
` + harness,
  solution: `type Ctx = { log: string[] };
type Next = () => Promise<void>;
type Middleware = (ctx: Ctx, next: Next) => Promise<void>;

function compose(mws: Middleware[]): (ctx: Ctx) => Promise<void> {
  return (ctx) => {
    let last = -1;
    const dispatch = async (i: number): Promise<void> => {
      if (i <= last) throw new Error("next() called multiple times");
      last = i;
      const mw = mws[i];
      if (!mw) return;
      await mw(ctx, () => dispatch(i + 1));
    };
    return dispatch(0);
  };
}
` + harness,
  cases: [
    { name: "oignon", args: [["logger", "auth", "handler"]], expected: [">logger", ">auth", ">handler", "<handler", "<auth", "<logger"] },
    { name: "court-circuit", args: [["logger", "auth!", "handler"]], expected: [">logger", ">auth!", "stop", "<logger"] },
    { name: "aucun middleware", args: [[]], expected: [] },
    { name: "next() deux fois", args: [["twice", "handler"]], expected: [">twice", ">handler", "<handler", "error: next() called multiple times"] },
  ],
});
