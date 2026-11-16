import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "sliding-window-maximum",
  title: "Sliding Window Maximum",
  difficulty: "difficile",
  entry: "maxSlidingWindow",
  starter: `function maxSlidingWindow(nums: number[], k: number): number[] {
  // Max de chaque fenêtre de taille k (1 <= k <= nums.length).
  // Vise O(n), pas O(n * k).
  return [];
}`,
  solution: `function maxSlidingWindow(nums: number[], k: number): number[] {
  // deque d'indices ; valeurs décroissantes de head à la fin.
  // On simule une deque avec un tableau + un indice de tête
  // (shift() est O(n) sur un Array JS).
  const dq: number[] = [];
  let head = 0;
  const out: number[] = [];
  for (let i = 0; i < nums.length; i++) {
    if (head < dq.length && dq[head] <= i - k) head++; // sorti
    while (dq.length > head && nums[dq[dq.length - 1]] <= nums[i]) {
      dq.pop(); // ne sera plus jamais le max
    }
    dq.push(i);
    if (i >= k - 1) out.push(nums[dq[head]]);
  }
  return out;
}`,
  cases: [
    { args: [[1, 3, -1, -3, 5, 3, 6, 7], 3], expected: [3, 3, 5, 5, 6, 7] },
    { args: [[1], 1], expected: [1], name: "1 élément" },
    { args: [[1, -1], 1], expected: [1, -1], name: "k = 1" },
    { args: [[9, 11], 2], expected: [11] },
    { args: [[4, -2], 2], expected: [4] },
    { args: [[7, 2, 4], 2], expected: [7, 4] },
    { args: [[1, 3, 1, 2, 0, 5], 3], expected: [3, 3, 2, 5] },
    { args: [[5, 5, 5, 5], 2], expected: [5, 5, 5], name: "doublons" },
    { args: [[-7, -8, 7, 5, 7, 1, 6, 0], 4], expected: [7, 7, 7, 7, 7] },
    { args: [[1, 2, 3, 4, 5], 5], expected: [5], name: "k = n" },
    {
      args: [Array.from({ length: 20000 }, (_, i) => 20000 - i), 1000],
      expected: Array.from({ length: 19001 }, (_, i) => 20000 - i),
      name: "20 000 éléments, k = 1000",
    },
  ],
  rust: `use std::collections::VecDeque;

fn max_sliding_window(nums: &[i32], k: usize) -> Vec<i32> {
    // TODO : VecDeque d'indices, valeurs décroissantes
    todo!()
}

fn main() {
    println!("{:?}", max_sliding_window(&[1, 3, -1, -3, 5, 3, 6, 7], 3));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        let got = max_sliding_window(&[1, 3, -1, -3, 5, 3, 6, 7], 3);
        assert_eq!(got, vec![3, 3, 5, 5, 6, 7]);
    }
    #[test]
    fn k1() { assert_eq!(max_sliding_window(&[1, -1], 1), vec![1, -1]); }
    #[test]
    fn kn() { assert_eq!(max_sliding_window(&[1, 2, 3, 4, 5], 5), vec![5]); }
    #[test]
    fn dups() { assert_eq!(max_sliding_window(&[5, 5, 5], 2), vec![5, 5]); }
    #[test]
    fn neg() {
        let got = max_sliding_window(&[-7, -8, 7, 5, 7, 1, 6, 0], 4);
        assert_eq!(got, vec![7; 5]);
    }
}
`,
});
