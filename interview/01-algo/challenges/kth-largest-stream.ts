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
  id: "kth-largest-stream",
  title: "K-ième plus grand d'un flux",
  difficulty: "moyen",
  entry: "KthLargest",
  mode: "class",
  starter: HEAP + `
class KthLargest {
  constructor(k: number, nums: number[]) {
    // nums = valeurs initiales (peut en contenir moins que k)
  }

  add(val: number): number {
    // Ajoute val, retourne le k-ième plus grand du flux.
    // Garanti : il y a au moins k valeurs après cet ajout.
    return 0;
  }
}`,
  solution: HEAP + `
class KthLargest {
  private heap = new MinHeap<number>((a, b) => a < b);
  constructor(private k: number, nums: number[]) {
    for (const x of nums) this.add(x);
  }

  add(val: number): number {
    this.heap.push(val);
    if (this.heap.size > this.k) this.heap.pop();
    return this.heap.peek()!; // racine = k-ième plus grand
  }
}`,
  cases: [
    {
      ops: ["KthLargest", "add", "add", "add", "add", "add"],
      args: [[3, [4, 5, 8, 2]], [3], [5], [10], [9], [4]],
      expected: [null, 4, 5, 5, 8, 8],
    },
    {
      ops: ["KthLargest", "add", "add", "add"],
      args: [[1, []], [-3], [-2], [-4]],
      expected: [null, -3, -2, -2],
      name: "k = 1, départ vide",
    },
    {
      ops: ["KthLargest", "add", "add"],
      args: [[2, [0]], [-1], [1]],
      expected: [null, -1, 0],
      name: "moins de k au départ",
    },
    {
      ops: ["KthLargest", "add", "add", "add"],
      args: [[2, [5, 5]], [5], [1], [6]],
      expected: [null, 5, 5, 5],
      name: "doublons",
    },
    {
      ops: ["KthLargest", "add", "add", "add", "add"],
      args: [[3, [1, 2, 3]], [0], [4], [5], [6]],
      expected: [null, 1, 2, 3, 4],
      name: "valeurs qui montent",
    },
    {
      ops: ["KthLargest", "add"],
      args: [[1, [10, 20]], [5]],
      expected: [null, 20],
      name: "k = 1 = maximum",
    },
    {
      ops: ["KthLargest", "add", "add"],
      args: [[4, [7, 7, 7]], [7], [8]],
      expected: [null, 7, 7],
    },
    {
      ops: ["KthLargest", "add", "add", "add"],
      args: [[2, [100, 50]], [75], [60], [200]],
      expected: [null, 75, 75, 100],
    },
  ],
  rust: `use std::cmp::Reverse;
use std::collections::BinaryHeap;

struct KthLargest {
    k: usize,
    heap: BinaryHeap<Reverse<i32>>,
}

impl KthLargest {
    fn new(k: usize, nums: &[i32]) -> Self {
        todo!()
    }
    fn add(&mut self, val: i32) -> i32 {
        todo!()
    }
}

fn main() {
    let mut s = KthLargest::new(3, &[4, 5, 8, 2]);
    println!("{}", s.add(3));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn leetcode_example() {
        let mut s = KthLargest::new(3, &[4, 5, 8, 2]);
        let got: Vec<i32> = [3, 5, 10, 9, 4].iter().map(|&v| s.add(v)).collect();
        assert_eq!(got, [4, 5, 5, 8, 8]);
    }
    #[test]
    fn starts_empty() {
        let mut s = KthLargest::new(1, &[]);
        assert_eq!(s.add(-3), -3);
        assert_eq!(s.add(-2), -2);
    }
}
`,
});
