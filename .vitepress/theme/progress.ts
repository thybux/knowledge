// Suivi local (navigateur) des defis reussis.
const KEY = "challenge:solved";

function read(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export const isSolved = (id: string) => id in read();

export function markSolved(id: string) {
  try {
    const all = read();
    all[id] ??= Date.now();
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

export const solvedIds = () => Object.keys(read());
