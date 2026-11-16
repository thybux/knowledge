import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "search-rotated",
  title: "Search in Rotated Sorted Array",
  difficulty: "moyen",
  entry: "searchRotated",
  starter: `function searchRotated(nums: number[], target: number): number {
  // nums : tableau trié SANS doublon puis "tourné"
  // ex. [4,5,6,7,0,1,2]. Indice de target ou -1, en O(log n).
  return -1;
}`,
  solution: `function searchRotated(nums: number[], target: number): number {
  let lo = 0;
  let hi = nums.length - 1;
  while (lo <= hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (nums[mid] === target) return mid;
    if (nums[lo] <= nums[mid]) {
      // la moitié gauche [lo, mid] est triée
      if (nums[lo] <= target && target < nums[mid]) hi = mid - 1;
      else lo = mid + 1;
    } else {
      // sinon c'est la moitié droite [mid, hi]
      if (nums[mid] < target && target <= nums[hi]) lo = mid + 1;
      else hi = mid - 1;
    }
  }
  return -1;
}`,
  cases: [
    { args: [[4, 5, 6, 7, 0, 1, 2], 0], expected: 4 },
    { args: [[4, 5, 6, 7, 0, 1, 2], 3], expected: -1, name: "absent" },
    { args: [[1], 0], expected: -1 },
    { args: [[1], 1], expected: 0, name: "1 élément" },
    { args: [[], 5], expected: -1, name: "vide" },
    { args: [[3, 1], 1], expected: 1 },
    { args: [[1, 3], 3], expected: 1, name: "pas tourné" },
    { args: [[5, 1, 3], 5], expected: 0 },
    { args: [[4, 5, 6, 7, 8, 1, 2, 3], 8], expected: 4 },
    { args: [[6, 7, 1, 2, 3, 4, 5], 6], expected: 0 },
    { args: [[2, 3, 4, 5, 6, 7, 1], 1], expected: 6, name: "pivot à la fin" },
    {
      args: [Array.from({ length: 10000 }, (_, i) => (i + 3000) % 10000), 2999],
      expected: 9999,
      name: "10 000 éléments",
    },
  ],
  rust: `fn search_rotated(nums: &[i32], target: i32) -> Option<usize> {
    // TODO : à chaque étape, une des deux moitiés est triée
    todo!()
}

fn main() {
    println!("{:?}", search_rotated(&[4, 5, 6, 7, 0, 1, 2], 0));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() { assert_eq!(search_rotated(&[4, 5, 6, 7, 0, 1, 2], 0), Some(4)); }
    #[test]
    fn absent() { assert_eq!(search_rotated(&[4, 5, 6, 7, 0, 1, 2], 3), None); }
    #[test]
    fn empty() { assert_eq!(search_rotated(&[], 1), None); }
    #[test]
    fn two() { assert_eq!(search_rotated(&[3, 1], 1), Some(1)); }
    #[test]
    fn end() { assert_eq!(search_rotated(&[2, 3, 4, 5, 6, 7, 1], 1), Some(6)); }
}
`,
});
