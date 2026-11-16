import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "min-window-substring",
  title: "Minimum Window Substring",
  difficulty: "difficile",
  entry: "minWindow",
  starter: `function minWindow(s: string, t: string): string {
  // Plus petite sous-chaîne de s contenant tous les caractères
  // de t (doublons compris). "" si impossible.
  return "";
}`,
  solution: `function minWindow(s: string, t: string): string {
  const need = new Map<string, number>();
  for (const c of t) need.set(c, (need.get(c) ?? 0) + 1);
  let missing = t.length; // caractères de t pas encore couverts
  let left = 0;
  let bestStart = 0;
  let bestLen = Infinity;
  for (let right = 0; right < s.length; right++) {
    const c = s[right];
    const n = need.get(c);
    if (n !== undefined) {
      if (n > 0) missing--;
      need.set(c, n - 1); // peut devenir négatif = en surplus
    }
    while (missing === 0) {
      if (right - left + 1 < bestLen) {
        bestLen = right - left + 1;
        bestStart = left;
      }
      const l = s[left];
      const m = need.get(l);
      if (m !== undefined) {
        need.set(l, m + 1);
        if (m + 1 > 0) missing++; // on vient de perdre un requis
      }
      left++;
    }
  }
  return bestLen === Infinity ? "" : s.slice(bestStart, bestStart + bestLen);
}`,
  cases: [
    { args: ["ADOBECODEBANC", "ABC"], expected: "BANC" },
    { args: ["a", "a"], expected: "a", name: "1 caractère" },
    { args: ["a", "aa"], expected: "", name: "doublon impossible" },
    { args: ["", "a"], expected: "", name: "s vide" },
    { args: ["ab", "b"], expected: "b" },
    { args: ["aa", "aa"], expected: "aa" },
    { args: ["bba", "ab"], expected: "ba" },
    { args: ["abc", "d"], expected: "", name: "caractère absent" },
    { args: ["cabwefgewcwaefgcf", "cae"], expected: "cwae" },
    { args: ["ADOBECODEBANC", "AABC"], expected: "ADOBECODEBA", name: "doublons dans t" },
    { args: ["aaflslflsldkalskaaa", "aaa"], expected: "aaa" },
    {
      args: ["x".repeat(5000) + "abc" + "y".repeat(5000), "cba"],
      expected: "abc",
      name: "10 000 caractères",
    },
  ],
  rust: `fn min_window(s: &str, t: &str) -> String {
    // TODO : compteurs need[128] + nombre de caractères manquants
    todo!()
}

fn main() {
    println!("{}", min_window("ADOBECODEBANC", "ABC"));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() { assert_eq!(min_window("ADOBECODEBANC", "ABC"), "BANC"); }
    #[test]
    fn single() { assert_eq!(min_window("a", "a"), "a"); }
    #[test]
    fn impossible() { assert_eq!(min_window("a", "aa"), ""); }
    #[test]
    fn dup_t() {
        assert_eq!(min_window("ADOBECODEBANC", "AABC"), "ADOBECODEBA");
    }
    #[test]
    fn order() { assert_eq!(min_window("bba", "ab"), "ba"); }
}
`,
});
