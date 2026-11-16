import { defineChallenge } from "../../../.vitepress/theme/challenge";

const ROWS = [
  { id: "a", createdAt: "2026-03-02T10:00:00Z" },
  { id: "b", createdAt: "2026-03-02T10:00:00Z" },
  { id: "c", createdAt: "2026-03-03T08:00:00Z" },
  { id: "d", createdAt: "2026-03-01T09:00:00Z" },
  { id: "e", createdAt: "2026-02-28T12:00:00Z" },
];

export default defineChallenge({
  id: "ts-cursor-pagination",
  title: "Pagination par curseur (keyset)",
  difficulty: "moyen",
  entry: "paginate",
  starter: `type Row = { id: string; createdAt: string }; // ISO 8601 UTC
type Page =
  | { items: string[]; nextCursor: string | null }
  | { error: "invalid_cursor" };

// Tri : createdAt DESC puis id DESC (départage des égalités).
// Curseur opaque = btoa(\`\${createdAt}|\${id}\`) du DERNIER élément
// de la page. nextCursor = null s'il n'y a plus rien après.
// items = les ids de la page. Curseur illisible -> invalid_cursor.
// (Les rows reçues ne sont pas triées. Ne pas faire d'offset.)
function paginate(
  rows: Row[], limit: number, cursor: string | null,
): Page {
  return { items: [], nextCursor: null };
}`,
  solution: `type Row = { id: string; createdAt: string };
type Page =
  | { items: string[]; nextCursor: string | null }
  | { error: "invalid_cursor" };

function decodeCursor(c: string): [string, string] | null {
  try {
    const [createdAt, id, ...rest] = atob(c).split("|");
    if (!createdAt || !id || rest.length > 0) return null;
    if (Number.isNaN(Date.parse(createdAt))) return null;
    return [createdAt, id];
  } catch {
    return null;
  }
}

// a "avant" b dans l'ordre DESC ?
const before = (a: Row, b: Row) =>
  a.createdAt !== b.createdAt
    ? a.createdAt > b.createdAt
    : a.id > b.id;

function paginate(
  rows: Row[], limit: number, cursor: string | null,
): Page {
  let after: Row | null = null;
  if (cursor !== null) {
    const d = decodeCursor(cursor);
    if (!d) return { error: "invalid_cursor" };
    after = { createdAt: d[0], id: d[1] };
  }
  const sorted = [...rows].sort((a, b) => (before(a, b) ? -1 : 1));
  // WHERE (created_at, id) < ($1, $2) ... LIMIT limit + 1
  const rest = after ? sorted.filter((r) => before(after, r)) : sorted;
  const page = rest.slice(0, limit + 1);
  const hasMore = page.length > limit;
  const items = page.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map((r) => r.id),
    nextCursor: hasMore && last
      ? btoa(\`\${last.createdAt}|\${last.id}\`) : null,
  };
}`,
  cases: [
    { name: "1re page", args: [ROWS, 2, null], expected: { items: ["c", "b"], nextCursor: "MjAyNi0wMy0wMlQxMDowMDowMFp8Yg==" } },
    { name: "2e page (égalité départagée par id)", args: [ROWS, 2, "MjAyNi0wMy0wMlQxMDowMDowMFp8Yg=="], expected: { items: ["a", "d"], nextCursor: "MjAyNi0wMy0wMVQwOTowMDowMFp8ZA==" } },
    { name: "dernière page", args: [ROWS, 2, "MjAyNi0wMy0wMVQwOTowMDowMFp8ZA=="], expected: { items: ["e"], nextCursor: null } },
    { name: "page pile pleine", args: [ROWS, 5, null], expected: { items: ["c", "b", "a", "d", "e"], nextCursor: null } },
    { name: "curseur invalide", args: [ROWS, 2, "!!!"], expected: { error: "invalid_cursor" } },
    { name: "curseur sans séparateur", args: [ROWS, 2, "aGVsbG8="], expected: { error: "invalid_cursor" } },
    { name: "table vide", args: [[], 10, null], expected: { items: [], nextCursor: null } },
  ],
});
