import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "search-range",
  title: "First and Last Position",
  difficulty: "moyen",
  entry: "searchRange",
  starter: `function searchRange(nums: number[], target: number): number[] {
  // nums trié (doublons possibles). Retourne [premier, dernier]
  // indice de target, ou [-1, -1]. O(log n) même si tout est égal.
  return [-1, -1];
}`,
  solution: `function searchRange(nums: number[], target: number): number[] {
  // premier indice i tel que nums[i] >= x (lower bound)
  const lowerBound = (x: number) => {
    let lo = 0;
    let hi = nums.length; // [lo, hi)
    while (lo < hi) {
      const mid = lo + ((hi - lo) >> 1);
      if (nums[mid] >= x) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  const a = lowerBound(target);
  if (a === nums.length || nums[a] !== target) return [-1, -1];
  return [a, lowerBound(target + 1) - 1];
}`,
  cases: [
    { args: [[5, 7, 7, 8, 8, 10], 8], expected: [3, 4] },
    { args: [[5, 7, 7, 8, 8, 10], 6], expected: [-1, -1], name: "absent" },
    { args: [[], 0], expected: [-1, -1], name: "vide" },
    { args: [[1], 1], expected: [0, 0], name: "1 élément" },
    { args: [[2, 2], 2], expected: [0, 1] },
    { args: [[1, 2, 3], 3], expected: [2, 2], name: "dernier" },
    { args: [[1, 1, 1, 1, 1], 1], expected: [0, 4], name: "tout égal" },
    { args: [[1, 2, 2, 2, 3], 2], expected: [1, 3] },
    { args: [[1, 3], 2], expected: [-1, -1] },
    { args: [[-3, -3, -1], -3], expected: [0, 1], name: "négatifs" },
    {
      args: [Array.from({ length: 20000 }, (_, i) => (i < 5000 ? 0 : 1)), 1],
      expected: [5000, 19999],
      name: "20 000 éléments",
    },
  ],
  rust: `fn search_range(nums: &[i32], target: i32) -> Option<(usize, usize)> {
    // TODO : deux recherches "premier indice où ... devient vrai"
    todo!()
}

fn main() {
    println!("{:?}", search_range(&[5, 7, 7, 8, 8, 10], 8));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() { assert_eq!(search_range(&[5, 7, 7, 8, 8, 10], 8), Some((3, 4))); }
    #[test]
    fn absent() { assert_eq!(search_range(&[5, 7, 7, 8, 8, 10], 6), None); }
    #[test]
    fn empty() { assert_eq!(search_range(&[], 0), None); }
    #[test]
    fn all() { assert_eq!(search_range(&[1, 1, 1], 1), Some((0, 2))); }
    #[test]
    fn last() { assert_eq!(search_range(&[1, 2, 3], 3), Some((2, 2))); }
}
`,
});
