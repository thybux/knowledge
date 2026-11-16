import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "subarray-sum-k",
  title: "Subarray Sum Equals K",
  difficulty: "moyen",
  entry: "subarraySum",
  starter: `function subarraySum(nums: number[], k: number): number {
  // Nombre de sous-tableaux CONTIGUS dont la somme vaut k.
  // Attention : nums peut contenir des négatifs.
  return 0;
}`,
  solution: `function subarraySum(nums: number[], k: number): number {
  // seen[p] = nombre de préfixes déjà vus dont la somme vaut p
  const seen = new Map<number, number>([[0, 1]]);
  let prefix = 0;
  let count = 0;
  for (const x of nums) {
    prefix += x;
    // un sous-tableau (j, i] somme à k <=> prefix_j = prefix_i - k
    count += seen.get(prefix - k) ?? 0;
    seen.set(prefix, (seen.get(prefix) ?? 0) + 1);
  }
  return count;
}`,
  cases: [
    { args: [[1, 1, 1], 2], expected: 2 },
    { args: [[1, 2, 3], 3], expected: 2 },
    { args: [[], 0], expected: 0, name: "vide" },
    { args: [[1], 1], expected: 1, name: "1 élément" },
    { args: [[1], 0], expected: 0 },
    { args: [[1, -1, 0], 0], expected: 3, name: "négatifs et zéro" },
    { args: [[0, 0, 0], 0], expected: 6, name: "que des zéros" },
    { args: [[3, 4, 7, 2, -3, 1, 4, 2], 7], expected: 4 },
    { args: [[-1, -1, 1], 0], expected: 1 },
    { args: [[1, 2, 1, 2, 1], 3], expected: 4 },
    {
      args: [Array.from({ length: 3000 }, () => 0), 0],
      expected: (3000 * 3001) / 2,
      name: "3000 zéros (O(n²) passe, O(n³) non)",
    },
  ],
  rust: `use std::collections::HashMap;

fn subarray_sum(nums: &[i32], k: i32) -> usize {
    // TODO : sommes de préfixes + HashMap
    todo!()
}

fn main() {
    println!("{}", subarray_sum(&[1, 1, 1], 2));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn basic() { assert_eq!(subarray_sum(&[1, 1, 1], 2), 2); }
    #[test] fn empty() { assert_eq!(subarray_sum(&[], 0), 0); }
    #[test] fn neg() { assert_eq!(subarray_sum(&[1, -1, 0], 0), 3); }
    #[test] fn zeros() { assert_eq!(subarray_sum(&[0, 0, 0], 0), 6); }
    #[test]
    fn mixed() {
        assert_eq!(subarray_sum(&[3, 4, 7, 2, -3, 1, 4, 2], 7), 4);
    }
}
`,
});
