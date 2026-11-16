import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "longest-increasing-subsequence",
  title: "Longest Increasing Subsequence",
  difficulty: "moyen",
  entry: "lengthOfLIS",
  starter: `function lengthOfLIS(nums: number[]): number {
  // Longueur de la plus longue sous-suite STRICTEMENT croissante
  // (éléments pas forcément contigus).
  return 0;
}`,
  solution: `function lengthOfLIS(nums: number[]): number {
  // tails[k] = plus petite fin possible d'une sous-suite de longueur k+1
  const tails: number[] = [];
  for (const x of nums) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = x; // remplace ou ajoute a la fin
  }
  return tails.length;
}`,
  cases: [
    { args: [[10, 9, 2, 5, 3, 7, 101, 18]], expected: 4 },
    { args: [[0, 1, 0, 3, 2, 3]], expected: 4 },
    { args: [[7, 7, 7, 7]], expected: 1, name: "strictement croissante" },
    { args: [[]], expected: 0, name: "vide" },
    { args: [[42]], expected: 1 },
    { args: [[5, 4, 3, 2, 1]], expected: 1, name: "décroissant" },
    { args: [[1, 2, 3, 4, 5]], expected: 5, name: "déjà trié" },
    { args: [[4, 10, 4, 3, 8, 9]], expected: 3 },
    { args: [[-2, -1, -5, 0, 3]], expected: 4, name: "négatifs" },
    { args: [[3, 5, 6, 2, 5, 4, 19, 5, 6, 7, 12]], expected: 6 },
    { args: [Array.from({ length: 20000 }, (_, i) => i % 1000)], expected: 1000, name: "perf : O(n²) limite" },
  ],
  rust: `fn length_of_lis(nums: &[i32]) -> usize {
    // TODO : O(n²) d'abord, puis O(n log n) avec tails + binary search
    todo!()
}

fn main() {
    println!("{}", length_of_lis(&[10, 9, 2, 5, 3, 7, 101, 18]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn basic() {
        assert_eq!(length_of_lis(&[10, 9, 2, 5, 3, 7, 101, 18]), 4);
        assert_eq!(length_of_lis(&[0, 1, 0, 3, 2, 3]), 4);
    }
    #[test] fn edge() {
        assert_eq!(length_of_lis(&[]), 0);
        assert_eq!(length_of_lis(&[7, 7, 7]), 1);
        assert_eq!(length_of_lis(&[5, 4, 3]), 1);
    }
}
`,
});
