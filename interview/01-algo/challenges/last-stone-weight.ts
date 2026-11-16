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
  id: "last-stone-weight",
  title: "Poids de la dernière pierre",
  difficulty: "facile",
  entry: "lastStoneWeight",
  starter: HEAP + `
function lastStoneWeight(stones: number[]): number {
  // À chaque tour : on écrase les 2 plus lourdes x <= y.
  // x === y : les deux disparaissent ; sinon il reste y - x.
  // Retourne le poids de la pierre restante (0 s'il n'y en a plus).
  return 0;
}`,
  solution: HEAP + `
function lastStoneWeight(stones: number[]): number {
  const heap = new MinHeap<number>((a, b) => a > b); // max-heap
  for (const s of stones) heap.push(s);
  while (heap.size > 1) {
    const y = heap.pop()!, x = heap.pop()!;
    if (y !== x) heap.push(y - x);
  }
  return heap.pop() ?? 0;
}`,
  cases: [
    { args: [[2, 7, 4, 1, 8, 1]], expected: 1 },
    { args: [[1]], expected: 1, name: "une pierre" },
    { args: [[]], expected: 0, name: "aucune pierre" },
    { args: [[3, 3]], expected: 0, name: "deux égales" },
    { args: [[10, 4]], expected: 6 },
    { args: [[2, 2, 2]], expected: 2 },
    { args: [[1, 1, 1, 1]], expected: 0 },
    { args: [[9, 3, 2, 10]], expected: 0 },
    { args: [[31, 26, 33, 21, 40]], expected: 9 },
    { args: [[1000, 1, 1, 1]], expected: 997, name: "une très lourde" },
  ],
  rust: `use std::collections::BinaryHeap;

fn last_stone_weight(stones: &[u32]) -> u32 {
    // TODO : BinaryHeap est déjà un max-heap
    todo!()
}

fn main() {
    println!("{}", last_stone_weight(&[2, 7, 4, 1, 8, 1]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() { assert_eq!(last_stone_weight(&[2, 7, 4, 1, 8, 1]), 1); }
    #[test]
    fn empty() { assert_eq!(last_stone_weight(&[]), 0); }
    #[test]
    fn equal() { assert_eq!(last_stone_weight(&[3, 3]), 0); }
    #[test]
    fn heavy() { assert_eq!(last_stone_weight(&[1000, 1, 1, 1]), 997); }
}
`,
});
