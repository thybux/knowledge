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
  id: "median-data-stream",
  title: "Médiane d'un flux",
  difficulty: "difficile",
  entry: "MedianFinder",
  mode: "class",
  compare: "float",
  starter: HEAP + `
class MedianFinder {
  constructor() {}

  addNum(num: number): void {}

  findMedian(): number {
    // Nombre pair de valeurs : moyenne des deux du milieu.
    // Appelé seulement s'il y a au moins une valeur.
    return 0;
  }
}`,
  solution: HEAP + `
class MedianFinder {
  // low : max-heap de la moitié basse ; high : min-heap de la haute
  private low = new MinHeap<number>((a, b) => a > b);
  private high = new MinHeap<number>((a, b) => a < b);

  addNum(num: number): void {
    this.low.push(num);
    this.high.push(this.low.pop()!); // le max du bas passe en haut
    if (this.high.size > this.low.size) {
      this.low.push(this.high.pop()!); // low garde 0 ou 1 de plus
    }
  }

  findMedian(): number {
    if (this.low.size > this.high.size) return this.low.peek()!;
    return (this.low.peek()! + this.high.peek()!) / 2;
  }
}`,
  cases: [
    {
      ops: ["MedianFinder", "addNum", "addNum", "findMedian", "addNum", "findMedian"],
      args: [[], [1], [2], [], [3], []],
      expected: [null, null, null, 1.5, null, 2],
    },
    {
      ops: ["MedianFinder", "addNum", "findMedian"],
      args: [[], [42], []],
      expected: [null, null, 42],
      name: "une valeur",
    },
    {
      ops: ["MedianFinder", "addNum", "addNum", "findMedian"],
      args: [[], [5], [5], []],
      expected: [null, null, null, 5],
      name: "doublons",
    },
    {
      ops: ["MedianFinder", "addNum", "addNum", "addNum", "findMedian"],
      args: [[], [3], [2], [1], []],
      expected: [null, null, null, null, 2],
      name: "ordre décroissant",
    },
    {
      ops: ["MedianFinder", "addNum", "addNum", "findMedian", "addNum", "findMedian"],
      args: [[], [-1], [-2], [], [-3], []],
      expected: [null, null, null, -1.5, null, -2],
      name: "négatifs",
    },
    {
      ops: ["MedianFinder", "addNum", "findMedian", "addNum", "findMedian", "addNum", "findMedian", "addNum", "findMedian"],
      args: [[], [6], [], [10], [], [2], [], [6], []],
      expected: [null, null, 6, null, 8, null, 6, null, 6],
    },
    {
      ops: ["MedianFinder", "addNum", "addNum", "addNum", "addNum", "findMedian"],
      args: [[], [1], [100], [2], [99], []],
      expected: [null, null, null, null, null, 50.5],
    },
    {
      ops: ["MedianFinder", "addNum", "addNum", "addNum", "addNum", "addNum", "findMedian"],
      args: [[], [0], [0], [0], [1000], [-1000], []],
      expected: [null, null, null, null, null, null, 0],
    },
    {
      ops: ["MedianFinder", "addNum", "addNum", "findMedian", "addNum", "addNum", "findMedian"],
      args: [[], [1], [2], [], [3], [4], []],
      expected: [null, null, null, 1.5, null, null, 2.5],
      name: "croissant",
    },
  ],
  rust: `use std::cmp::Reverse;
use std::collections::BinaryHeap;

#[derive(Default)]
struct MedianFinder {
    low: BinaryHeap<i32>,           // max-heap
    high: BinaryHeap<Reverse<i32>>, // min-heap
}

impl MedianFinder {
    fn add_num(&mut self, num: i32) {
        todo!()
    }
    fn find_median(&self) -> f64 {
        todo!()
    }
}

fn main() {
    let mut m = MedianFinder::default();
    m.add_num(1);
    m.add_num(2);
    println!("{}", m.find_median());
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn example() {
        let mut m = MedianFinder::default();
        m.add_num(1);
        m.add_num(2);
        assert_eq!(m.find_median(), 1.5);
        m.add_num(3);
        assert_eq!(m.find_median(), 2.0);
    }
    #[test]
    fn decreasing() {
        let mut m = MedianFinder::default();
        for x in [3, 2, 1] { m.add_num(x); }
        assert_eq!(m.find_median(), 2.0);
    }
}
`,
});
