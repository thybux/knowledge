import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "split-array-largest-sum",
  title: "Split Array Largest Sum",
  difficulty: "difficile",
  entry: "splitArray",
  starter: `function splitArray(nums: number[], k: number): number {
  // Découpe nums (entiers >= 0) en k sous-tableaux contigus
  // non vides. Minimise la plus grande des k sommes.
  return 0;
}`,
  solution: `function splitArray(nums: number[], k: number): number {
  // peut-on découper en <= k morceaux de somme <= cap ?
  const fits = (cap: number) => {
    let parts = 1;
    let cur = 0;
    for (const x of nums) {
      if (cur + x > cap) {
        parts++;
        cur = 0;
      }
      cur += x;
    }
    return parts <= k;
  };
  let lo = Math.max(...nums); // un morceau contient au moins le max
  let hi = nums.reduce((a, b) => a + b, 0); // un seul morceau
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (fits(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}`,
  cases: [
    { args: [[7, 2, 5, 10, 8], 2], expected: 18 },
    { args: [[1, 2, 3, 4, 5], 2], expected: 9 },
    { args: [[1, 4, 4], 3], expected: 4, name: "k = n" },
    { args: [[1], 1], expected: 1, name: "1 élément" },
    { args: [[0, 0, 0], 2], expected: 0, name: "zéros" },
    {
      args: [[10, 5, 13, 4, 8, 4, 5, 11, 14, 9, 16, 10, 20, 8], 8],
      expected: 25,
    },
    { args: [[2, 3, 1, 2, 4, 3], 5], expected: 4 },
    { args: [[1, 2, 3, 4, 5], 1], expected: 15, name: "k = 1" },
    { args: [[1, 2, 3, 4, 5], 5], expected: 5 },
    {
      args: [Array.from({ length: 1000 }, () => 1000000), 10],
      expected: 100000000,
      name: "1000 grands nombres",
    },
  ],
  rust: `fn split_array(nums: &[i64], k: usize) -> i64 {
    // TODO : binary search sur la réponse + test glouton
    todo!()
}

fn main() {
    println!("{}", split_array(&[7, 2, 5, 10, 8], 2));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn basic() { assert_eq!(split_array(&[7, 2, 5, 10, 8], 2), 18); }
    #[test] fn five() { assert_eq!(split_array(&[1, 2, 3, 4, 5], 2), 9); }
    #[test] fn k_eq_n() { assert_eq!(split_array(&[1, 4, 4], 3), 4); }
    #[test] fn zeros() { assert_eq!(split_array(&[0, 0, 0], 2), 0); }
    #[test] fn k1() { assert_eq!(split_array(&[1, 2, 3, 4, 5], 1), 15); }
}
`,
});
