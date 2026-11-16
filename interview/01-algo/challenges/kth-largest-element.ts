import { defineChallenge } from "../../../.vitepress/theme/challenge";

const HEAP = `// MinHeap minimaliste (TS n'a pas de heap natif)
class MinHeap<T> {
  private a: T[] = [];
  constructor(private less: (x: T, y: T) => boolean) {}
  get size() { return this.a.length; }
  peek(): T | undefined { return this.a[0]; }
  push(v: T) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0], last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
`;

export default defineChallenge({
  id: "kth-largest-element",
  title: "K-ième plus grand élément",
  difficulty: "moyen",
  entry: "findKthLargest",
  starter: HEAP + `
function findKthLargest(nums: number[], k: number): number {
  // k-ième plus grand en position triée (doublons comptés),
  // 1 <= k <= nums.length. Vise mieux que O(n log n).
  return 0;
}`,
  solution: HEAP + `
function findKthLargest(nums: number[], k: number): number {
  // min-heap de taille k : la racine est le k-ième plus grand
  const heap = new MinHeap<number>((a, b) => a < b);
  for (const x of nums) {
    heap.push(x);
    if (heap.size > k) heap.pop(); // on jette le plus petit
  }
  return heap.pop()!;
}`,
  cases: [
    { args: [[3, 2, 1, 5, 6, 4], 2], expected: 5 },
    { args: [[3, 2, 3, 1, 2, 4, 5, 5, 6], 4], expected: 4, name: "doublons" },
    { args: [[1], 1], expected: 1, name: "un élément" },
    { args: [[7, 7, 7], 2], expected: 7, name: "tous égaux" },
    { args: [[5, 1, 9], 1], expected: 9, name: "k = 1 (max)" },
    { args: [[5, 1, 9], 3], expected: 1, name: "k = n (min)" },
    { args: [[-1, -5, -3], 2], expected: -3, name: "négatifs" },
    { args: [[2, 1], 2], expected: 1 },
    {
      args: [Array.from({ length: 20000 }, (_, i) => (i * 7919) % 20000), 100],
      expected: 19900,
      name: "20 000 éléments",
    },
  ],
  rust: `use std::cmp::Reverse;
use std::collections::BinaryHeap;

fn find_kth_largest(nums: &[i32], k: usize) -> i32 {
    // TODO : min-heap de taille k (BinaryHeap<Reverse<i32>>)
    todo!()
}

fn main() {
    println!("{}", find_kth_largest(&[3, 2, 1, 5, 6, 4], 2));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() { assert_eq!(find_kth_largest(&[3, 2, 1, 5, 6, 4], 2), 5); }
    #[test]
    fn dups() {
        assert_eq!(find_kth_largest(&[3, 2, 3, 1, 2, 4, 5, 5, 6], 4), 4);
    }
    #[test]
    fn single() { assert_eq!(find_kth_largest(&[1], 1), 1); }
    #[test]
    fn negatives() { assert_eq!(find_kth_largest(&[-1, -5, -3], 2), -3); }
}
`,
});
