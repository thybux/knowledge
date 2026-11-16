import { defineChallenge } from "../../../.vitepress/theme/challenge";

const EVENS = Array.from({ length: 10000 }, (_, i) => i * 2);

export default defineChallenge({
  id: "binary-search",
  title: "Binary Search",
  difficulty: "facile",
  entry: "search",
  starter: `function search(nums: number[], target: number): number {
  // nums est trié (croissant, sans doublon).
  // Retourne l'indice de target, ou -1. O(log n).
  return -1;
}`,
  solution: `function search(nums: number[], target: number): number {
  let lo = 0;
  let hi = nums.length - 1; // intervalle fermé [lo, hi]
  while (lo <= hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (nums[mid] === target) return mid;
    if (nums[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}`,
  cases: [
    { args: [[-1, 0, 3, 5, 9, 12], 9], expected: 4 },
    { args: [[-1, 0, 3, 5, 9, 12], 2], expected: -1, name: "absent" },
    { args: [[], 3], expected: -1, name: "vide" },
    { args: [[5], 5], expected: 0, name: "1 élément trouvé" },
    { args: [[5], -5], expected: -1, name: "1 élément absent" },
    { args: [[1, 3], 3], expected: 1 },
    { args: [[1, 3], 1], expected: 0 },
    { args: [[1, 3], 2], expected: -1 },
    { args: [[-9, -5, -2], -9], expected: 0, name: "négatifs, bord gauche" },
    { args: [[1, 2, 3], 4], expected: -1, name: "après la fin" },
    { args: [EVENS, 7778], expected: 3889, name: "10 000 éléments" },
    { args: [EVENS, 7777], expected: -1, name: "10 000 éléments, absent" },
  ],
  rust: `fn search(nums: &[i32], target: i32) -> Option<usize> {
    // TODO : intervalle semi-ouvert [lo, hi) pour éviter
    // les underflows de usize
    todo!()
}

fn main() {
    println!("{:?}", search(&[-1, 0, 3, 5, 9, 12], 9));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn found() { assert_eq!(search(&[-1, 0, 3, 5, 9, 12], 9), Some(4)); }
    #[test] fn absent() { assert_eq!(search(&[-1, 0, 3, 5, 9, 12], 2), None); }
    #[test] fn empty() { assert_eq!(search(&[], 3), None); }
    #[test] fn first() { assert_eq!(search(&[1, 3], 1), Some(0)); }
    #[test] fn below() { assert_eq!(search(&[1, 3], 0), None); }
}
`,
});
