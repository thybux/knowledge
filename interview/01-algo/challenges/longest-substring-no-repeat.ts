import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "longest-substring-no-repeat",
  title: "Longest Substring Without Repeating Characters",
  difficulty: "moyen",
  entry: "lengthOfLongestSubstring",
  starter: `function lengthOfLongestSubstring(s: string): number {
  // Longueur de la plus longue sous-chaîne (contiguë)
  // sans caractère répété.
  return 0;
}`,
  solution: `function lengthOfLongestSubstring(s: string): number {
  const last = new Map<string, number>(); // char -> dernier indice
  let left = 0;
  let best = 0;
  for (let right = 0; right < s.length; right++) {
    const prev = last.get(s[right]);
    // doublon DANS la fenêtre : on saute juste après l'ancien
    if (prev !== undefined && prev >= left) left = prev + 1;
    last.set(s[right], right);
    best = Math.max(best, right - left + 1);
  }
  return best;
}`,
  cases: [
    { args: ["abcabcbb"], expected: 3 },
    { args: ["bbbbb"], expected: 1, name: "un seul caractère répété" },
    { args: ["pwwkew"], expected: 3 },
    { args: [""], expected: 0, name: "vide" },
    { args: [" "], expected: 1, name: "espace" },
    { args: ["au"], expected: 2 },
    { args: ["dvdf"], expected: 3 },
    { args: ["abba"], expected: 2, name: "left ne doit pas reculer" },
    { args: ["tmmzuxt"], expected: 5 },
    { args: ["abcdefghijklmnopqrstuvwxyz"], expected: 26 },
    { args: ["ab".repeat(5000) + "cd"], expected: 4, name: "10 000 caractères" },
  ],
  rust: `fn length_of_longest_substring(s: &str) -> usize {
    // TODO : fenêtre glissante + dernière position de chaque octet
    todo!()
}

fn main() {
    println!("{}", length_of_longest_substring("abcabcbb"));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn basic() { assert_eq!(length_of_longest_substring("abcabcbb"), 3); }
    #[test] fn same() { assert_eq!(length_of_longest_substring("bbbbb"), 1); }
    #[test] fn empty() { assert_eq!(length_of_longest_substring(""), 0); }
    #[test] fn abba() { assert_eq!(length_of_longest_substring("abba"), 2); }
    #[test] fn dvdf() { assert_eq!(length_of_longest_substring("dvdf"), 3); }
    #[test] fn tm() { assert_eq!(length_of_longest_substring("tmmzuxt"), 5); }
}
`,
});
