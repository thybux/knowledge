import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "longest-consecutive",
  title: "Longest Consecutive Sequence",
  difficulty: "difficile",
  entry: "longestConsecutive",
  starter: `function longestConsecutive(nums: number[]): number {
  // Longueur de la plus longue suite d'entiers consécutifs
  // (x, x+1, x+2...) présents dans nums, dans n'importe quel ordre.
  // Vise O(n) : pas de tri.
  return 0;
}`,
  solution: `function longestConsecutive(nums: number[]): number {
  const set = new Set(nums);
  let best = 0;
  for (const x of set) {
    if (set.has(x - 1)) continue; // pas un début de séquence
    let len = 1;
    while (set.has(x + len)) len++;
    best = Math.max(best, len);
  }
  return best;
}`,
  cases: [
    { args: [[100, 4, 200, 1, 3, 2]], expected: 4 },
    { args: [[0, 3, 7, 2, 5, 8, 4, 6, 0, 1]], expected: 9 },
    { args: [[]], expected: 0, name: "vide" },
    { args: [[1]], expected: 1, name: "1 élément" },
    { args: [[1, 2, 0, 1]], expected: 3, name: "doublons" },
    { args: [[-1, -2, -3, 10]], expected: 3, name: "négatifs" },
    { args: [[5, 5, 5]], expected: 1 },
    { args: [[9, 1, 4, 7, 3, -1, 0, 5, 8, -1, 6]], expected: 7 },
    { args: [[10, 30, 20]], expected: 1, name: "aucune suite" },
    {
      // permutation de 0..4999 (7919 est premier avec 5000)
      args: [Array.from({ length: 5000 }, (_, i) => (i * 7919) % 5000)],
      expected: 5000,
      name: "5000 éléments mélangés",
    },
  ],
  rust: `use std::collections::HashSet;

fn longest_consecutive(nums: &[i32]) -> usize {
    // TODO : HashSet + ne démarrer que sur les débuts de séquence
    todo!()
}

fn main() {
    println!("{}", longest_consecutive(&[100, 4, 200, 1, 3, 2]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() { assert_eq!(longest_consecutive(&[100, 4, 200, 1, 3, 2]), 4); }
    #[test]
    fn dups() {
        let v = [0, 3, 7, 2, 5, 8, 4, 6, 0, 1];
        assert_eq!(longest_consecutive(&v), 9);
    }
    #[test]
    fn empty() { assert_eq!(longest_consecutive(&[]), 0); }
    #[test]
    fn neg() { assert_eq!(longest_consecutive(&[-1, -2, -3, 10]), 3); }
    #[test]
    fn big() {
        let v: Vec<i32> = (0..5000).map(|i| (i * 7919) % 5000).collect();
        assert_eq!(longest_consecutive(&v), 5000);
    }
}
`,
});
