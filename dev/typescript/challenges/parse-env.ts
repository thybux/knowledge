import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "ts-parse-env",
  title: "Parser les variables d'environnement",
  difficulty: "moyen",
  entry: "parseEnv",
  starter: `type Config = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  logLevel: "debug" | "info" | "warn" | "error";
  featureFlags: string[];
  enableCron: boolean;
};

type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// Règles (une valeur "" compte comme absente) :
// NODE_ENV     : development|test|production, défaut development
// PORT         : entier 1..65535, défaut 3000
// DATABASE_URL : OBLIGATOIRE, commence par postgres:// ou postgresql://
// LOG_LEVEL    : debug|info|warn|error, défaut info
// FEATURE_FLAGS: liste "a, b,c" -> ["a","b","c"] (trim, vides retirés),
//                défaut []
// ENABLE_CRON  : "true"/"1" -> true, "false"/"0" -> false, défaut false
//
// En cas d'erreur : { ok: false, error: [noms des variables invalides] }
// dans l'ordre ci-dessus. On veut TOUTES les erreurs, pas la 1re.
function parseEnv(
  env: Record<string, string | undefined>,
): Result<Config, string[]> {
  return { ok: false, error: ["TODO"] };
}`,
  solution: `type Config = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  logLevel: "debug" | "info" | "warn" | "error";
  featureFlags: string[];
  enableCron: boolean;
};

type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function oneOf<const T extends readonly string[]>(
  v: string | undefined, allowed: T, fallback: T[number],
): T[number] | null {
  if (v === undefined) return fallback;
  return (allowed as readonly string[]).includes(v)
    ? (v as T[number]) : null;
}

function parseEnv(
  env: Record<string, string | undefined>,
): Result<Config, string[]> {
  const get = (k: string) => (env[k] === "" ? undefined : env[k]);
  const errors: string[] = [];

  const nodeEnv = oneOf(get("NODE_ENV"),
    ["development", "test", "production"], "development");
  if (nodeEnv === null) errors.push("NODE_ENV");

  const rawPort = get("PORT");
  const port = rawPort === undefined ? 3000 : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push("PORT");
  }

  const databaseUrl = get("DATABASE_URL") ?? "";
  if (!/^postgres(ql)?:\\/\\//.test(databaseUrl)) {
    errors.push("DATABASE_URL");
  }

  const logLevel = oneOf(get("LOG_LEVEL"),
    ["debug", "info", "warn", "error"], "info");
  if (logLevel === null) errors.push("LOG_LEVEL");

  const featureFlags = (get("FEATURE_FLAGS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  const cron = get("ENABLE_CRON");
  const enableCron = cron === undefined ? false
    : cron === "true" || cron === "1" ? true
    : cron === "false" || cron === "0" ? false
    : null;
  if (enableCron === null) errors.push("ENABLE_CRON");

  if (errors.length > 0 || nodeEnv === null || logLevel === null
      || enableCron === null) {
    return { ok: false, error: errors };
  }
  return {
    ok: true,
    value: { nodeEnv, port, databaseUrl, logLevel,
             featureFlags, enableCron },
  };
}`,
  cases: [
    {
      name: "minimal avec défauts",
      args: [{ DATABASE_URL: "postgres://u:p@db:5432/app" }],
      expected: {
        ok: true,
        value: {
          nodeEnv: "development", port: 3000,
          databaseUrl: "postgres://u:p@db:5432/app",
          logLevel: "info", featureFlags: [], enableCron: false,
        },
      },
    },
    {
      name: "tout renseigné",
      args: [{
        NODE_ENV: "production", PORT: "8080",
        DATABASE_URL: "postgresql://db/app", LOG_LEVEL: "warn",
        FEATURE_FLAGS: " billing, ,new-ui ,", ENABLE_CRON: "1",
      }],
      expected: {
        ok: true,
        value: {
          nodeEnv: "production", port: 8080,
          databaseUrl: "postgresql://db/app", logLevel: "warn",
          featureFlags: ["billing", "new-ui"], enableCron: true,
        },
      },
    },
    { name: "DATABASE_URL manquante", args: [{}], expected: { ok: false, error: ["DATABASE_URL"] } },
    {
      name: "toutes les erreurs",
      args: [{
        NODE_ENV: "staging", PORT: "80.5", DATABASE_URL: "mysql://x",
        LOG_LEVEL: "verbose", ENABLE_CRON: "yes",
      }],
      expected: {
        ok: false,
        error: ["NODE_ENV", "PORT", "DATABASE_URL", "LOG_LEVEL", "ENABLE_CRON"],
      },
    },
    { name: "PORT hors bornes", args: [{ PORT: "70000", DATABASE_URL: "postgres://d" }], expected: { ok: false, error: ["PORT"] } },
    { name: "PORT texte", args: [{ PORT: "abc", DATABASE_URL: "postgres://d" }], expected: { ok: false, error: ["PORT"] } },
    {
      name: "chaîne vide = absente",
      args: [{ PORT: "", LOG_LEVEL: "", DATABASE_URL: "postgres://d" }],
      expected: {
        ok: true,
        value: {
          nodeEnv: "development", port: 3000, databaseUrl: "postgres://d",
          logLevel: "info", featureFlags: [], enableCron: false,
        },
      },
    },
  ],
});
