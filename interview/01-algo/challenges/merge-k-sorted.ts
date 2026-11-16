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
  id: "merge-k-sorted",
  title: "Fusionner K listes triées",
  difficulty: "difficile",
  entry: "mergeKSorted",
  starter: HEAP + `
function mergeKSorted(lists: number[][]): number[] {
  // Chaque lists[i] est trié croissant. Retourne la fusion triée.
  // Vise O(N log k) avec N = total d'éléments, k = nb de listes.
  return [];
}`,
  solution: HEAP + `
function mergeKSorted(lists: number[][]): number[] {
  // [valeur, indice de liste, indice dans la liste]
  type Item = [number, number, number];
  const heap = new MinHeap<Item>((a, b) => a[0] < b[0]);
  lists.forEach((l, i) => { if (l.length) heap.push([l[0], i, 0]); });
  const out: number[] = [];
  while (heap.size) {
    const [v, i, j] = heap.pop()!;
    out.push(v);
    if (j + 1 < lists[i].length) heap.push([lists[i][j + 1], i, j + 1]);
  }
  return out;
}`,
  cases: [
    { args: [[[1, 4, 5], [1, 3, 4], [2, 6]]], expected: [1, 1, 2, 3, 4, 4, 5, 6] },
    { args: [[]], expected: [], name: "aucune liste" },
    { args: [[[]]], expected: [], name: "une liste vide" },
    { args: [[[], [1], []]], expected: [1], name: "listes vides mélangées" },
    { args: [[[1, 2, 3]]], expected: [1, 2, 3], name: "une seule liste" },
    { args: [[[5], [1], [3]]], expected: [1, 3, 5] },
    { args: [[[-3, 0], [-5, 10], [-4]]], expected: [-5, -4, -3, 0, 10], name: "négatifs" },
    { args: [[[2, 2], [2], [2, 2]]], expected: [2, 2, 2, 2, 2], name: "doublons" },
    { args: [[[1, 2], [3, 4], [5, 6]]], expected: [1, 2, 3, 4, 5, 6], name: "déjà dans l'ordre" },
    {
      args: [Array.from({ length: 500 }, (_, i) => Array.from({ length: 40 }, (_, j) => j * 500 + i))],
      expected: Array.from({ length: 20000 }, (_, i) => i),
      name: "500 listes x 40",
    },
  ],
  rust: `use std::cmp::Reverse;
use std::collections::BinaryHeap;

fn merge_k_sorted(lists: &[Vec<i32>]) -> Vec<i32> {
    // TODO : BinaryHeap<Reverse<(valeur, liste, indice)>>
    todo!()
}

fn main() {
    let l = vec![vec![1, 4, 5], vec![1, 3, 4], vec![2, 6]];
    println!("{:?}", merge_k_sorted(&l));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        let l = vec![vec![1, 4, 5], vec![1, 3, 4], vec![2, 6]];
        assert_eq!(merge_k_sorted(&l), [1, 1, 2, 3, 4, 4, 5, 6]);
    }
    #[test]
    fn empty() {
        assert!(merge_k_sorted(&[]).is_empty());
        assert!(merge_k_sorted(&[vec![]]).is_empty());
    }
    #[test]
    fn negatives() {
        let l = vec![vec![-3, 0], vec![-5, 10], vec![-4]];
        assert_eq!(merge_k_sorted(&l), [-5, -4, -3, 0, 10]);
    }
}
`,
});
