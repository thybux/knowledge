import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "edit-distance",
  title: "Edit Distance",
  difficulty: "difficile",
  entry: "minDistance",
  starter: `function minDistance(a: string, b: string): number {
  // Nombre minimal d'insertions / suppressions / remplacements
  // (1 caractère chacun) pour transformer a en b.
  return 0;
}`,
  solution: `function minDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // prev[j] = distance(a[0..i-1], b[0..j]) ; une ligne suffit
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) cur[j] = prev[j - 1];
      else cur[j] = 1 + Math.min(
        prev[j], // supprimer a[i-1]
        cur[j - 1], // inserer b[j-1]
        prev[j - 1], // remplacer
      );
    }
    prev = cur;
  }
  return prev[n];
}`,
  cases: [
    { args: ["horse", "ros"], expected: 3 },
    { args: ["intention", "execution"], expected: 5 },
    { args: ["", ""], expected: 0, name: "deux vides" },
    { args: ["", "abc"], expected: 3, name: "que des insertions" },
    { args: ["abc", ""], expected: 3, name: "que des suppressions" },
    { args: ["same", "same"], expected: 0 },
    { args: ["kitten", "sitting"], expected: 3 },
    { args: ["a", "b"], expected: 1 },
    { args: ["ab", "ba"], expected: 2, name: "pas de transposition" },
    { args: ["flaw", "lawn"], expected: 2 },
    { args: ["a".repeat(400), "b".repeat(400)], expected: 400, name: "perf" },
  ],
  rust: `fn min_distance(a: &str, b: &str) -> usize {
    // TODO : dp[i][j] sur les préfixes (travaille sur a.as_bytes())
    todo!()
}

fn main() {
    println!("{}", min_distance("horse", "ros"));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn basic() {
        assert_eq!(min_distance("horse", "ros"), 3);
        assert_eq!(min_distance("intention", "execution"), 5);
    }
    #[test] fn empty() {
        assert_eq!(min_distance("", "abc"), 3);
        assert_eq!(min_distance("abc", ""), 3);
        assert_eq!(min_distance("", ""), 0);
    }
}
`,
});
