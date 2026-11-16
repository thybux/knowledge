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
  id: "top-k-frequent",
  title: "Les K éléments les plus fréquents",
  difficulty: "moyen",
  entry: "topKFrequent",
  starter: HEAP + `
function topKFrequent(nums: number[], k: number): number[] {
  // Retourne les k valeurs les plus fréquentes, dans n'importe
  // quel ordre. La réponse est garantie unique.
  return [];
}`,
  solution: HEAP + `
function topKFrequent(nums: number[], k: number): number[] {
  const freq = new Map<number, number>();
  for (const x of nums) freq.set(x, (freq.get(x) ?? 0) + 1);
  // min-heap sur la fréquence, taille <= k
  const heap = new MinHeap<[number, number]>((a, b) => a[1] < b[1]);
  for (const entry of freq) {
    heap.push(entry);
    if (heap.size > k) heap.pop();
  }
  const out: number[] = [];
  while (heap.size) out.push(heap.pop()![0]);
  return out;
}`,
  compare: "unordered",
  cases: [
    { args: [[1, 1, 1, 2, 2, 3], 2], expected: [1, 2] },
    { args: [[1], 1], expected: [1], name: "un élément" },
    { args: [[4, 4, 4, 5], 1], expected: [4] },
    { args: [[1, 2, 3], 3], expected: [1, 2, 3], name: "k = nb de valeurs distinctes" },
    { args: [[-1, -1, 2], 1], expected: [-1], name: "négatifs" },
    { args: [[5, 3, 5, 3, 5, 7], 2], expected: [5, 3] },
    { args: [[0, 0, 0, 1, 1, 2, 2, 2, 2], 2], expected: [2, 0] },
    { args: [[9, 8, 9, 8, 9, 8, 1], 2], expected: [9, 8], name: "égalité dans le top" },
    { args: [[3, 0, 1, 0], 1], expected: [0] },
    {
      args: [Array.from({ length: 30000 }, (_, i) => i % 3000).concat([42, 42, 7]), 1],
      expected: [42],
      name: "30 000 éléments",
    },
  ],
  rust: `use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};

fn top_k_frequent(nums: &[i32], k: usize) -> Vec<i32> {
    // TODO : HashMap de fréquences + min-heap de taille k
    todo!()
}

fn main() {
    println!("{:?}", top_k_frequent(&[1, 1, 1, 2, 2, 3], 2));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sorted(mut v: Vec<i32>) -> Vec<i32> { v.sort(); v }
    #[test]
    fn basic() {
        assert_eq!(sorted(top_k_frequent(&[1, 1, 1, 2, 2, 3], 2)), [1, 2]);
    }
    #[test]
    fn single() { assert_eq!(top_k_frequent(&[1], 1), [1]); }
    #[test]
    fn negatives() { assert_eq!(top_k_frequent(&[-1, -1, 2], 1), [-1]); }
}
`,
});
