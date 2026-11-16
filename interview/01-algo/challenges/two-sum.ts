import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "two-sum",
  title: "Two Sum",
  difficulty: "facile",
  entry: "twoSum",
  starter: `function twoSum(nums: number[], target: number): number[] {
  // Retourne les indices [i, j] (i < j) tels que nums[i] + nums[j] === target
  return [];
}`,
  solution: `function twoSum(nums: number[], target: number): number[] {
  const seen = new Map<number, number>(); // valeur -> indice
  for (let i = 0; i < nums.length; i++) {
    const j = seen.get(target - nums[i]);
    if (j !== undefined) return [j, i];
    seen.set(nums[i], i);
  }
  return [];
}`,
  cases: [
    { args: [[2, 7, 11, 15], 9], expected: [0, 1] },
    { args: [[3, 2, 4], 6], expected: [1, 2] },
    { args: [[3, 3], 6], expected: [0, 1] },
    { args: [[-1, -2, -3, -4, -5], -8], expected: [2, 4], name: "négatifs" },
    { args: [[0, 4, 3, 0], 0], expected: [0, 3], name: "zéros" },
    { args: [[1, 2], 3], expected: [0, 1], name: "2 éléments" },
    { args: [[1, 5, 3, 7], 12], expected: [1, 3] },
    { args: [[5, 75, 25], 100], expected: [1, 2] },
    { args: [[-3, 4, 3, 90], 0], expected: [0, 2], name: "somme nulle" },
    {
      args: [[...Array.from({ length: 2000 }, (_, i) => i), 5000], 6999],
      expected: [1999, 2000],
      name: "grand tableau",
    },
  ],
  rust: `use std::collections::HashMap;

fn two_sum(nums: &[i32], target: i32) -> (usize, usize) {
    // TODO : ton code ici
    todo!()
}

fn main() {
    println!("{:?}", two_sum(&[2, 7, 11, 15], 9));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn basic() { assert_eq!(two_sum(&[2, 7, 11, 15], 9), (0, 1)); }
    #[test] fn middle() { assert_eq!(two_sum(&[3, 2, 4], 6), (1, 2)); }
    #[test] fn dup() { assert_eq!(two_sum(&[3, 3], 6), (0, 1)); }
}
`,
});
