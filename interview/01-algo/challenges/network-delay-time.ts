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
  id: "network-delay-time",
  title: "Délai de propagation réseau",
  difficulty: "moyen",
  entry: "networkDelayTime",
  starter: HEAP + `
function networkDelayTime(
  times: number[][], n: number, k: number,
): number {
  // times[i] = [u, v, w] : u -> v en w ms (nœuds 1..n)
  // Temps pour que le signal parti de k atteigne tout le monde,
  // ou -1 si un nœud est inatteignable.
  return -1;
}`,
  solution: HEAP + `
function networkDelayTime(
  times: number[][], n: number, k: number,
): number {
  const adj: [number, number][][] =
    Array.from({ length: n + 1 }, () => []);
  for (const [u, v, w] of times) adj[u].push([v, w]);
  const dist = new Array(n + 1).fill(Infinity);
  dist[k] = 0;
  const pq = new MinHeap<[number, number]>((x, y) => x[0] < y[0]);
  pq.push([0, k]);
  while (pq.size) {
    const [d, u] = pq.pop()!;
    if (d > dist[u]) continue; // entrée périmée
    for (const [v, w] of adj[u]) {
      if (d + w < dist[v]) {
        dist[v] = d + w;
        pq.push([dist[v], v]);
      }
    }
  }
  let max = 0;
  for (let i = 1; i <= n; i++) max = Math.max(max, dist[i]);
  return max === Infinity ? -1 : max;
}`,
  cases: [
    { args: [[[2, 1, 1], [2, 3, 1], [3, 4, 1]], 4, 2], expected: 2 },
    { args: [[[1, 2, 1]], 2, 1], expected: 1 },
    { args: [[[1, 2, 1]], 2, 2], expected: -1, name: "arête dans le mauvais sens" },
    { args: [[], 1, 1], expected: 0, name: "un seul nœud" },
    { args: [[[1, 2, 1]], 3, 1], expected: -1, name: "nœud isolé" },
    { args: [[[1, 2, 10], [1, 3, 1], [3, 2, 1]], 3, 1], expected: 2, name: "détour plus court" },
    { args: [[[1, 2, 0], [2, 3, 0]], 3, 1], expected: 0, name: "poids nuls" },
    { args: [[[1, 2, 5], [1, 2, 2]], 2, 1], expected: 2, name: "arêtes parallèles" },
    { args: [[[1, 2, 1], [2, 1, 1], [2, 3, 4]], 3, 1], expected: 5, name: "cycle" },
    {
      args: [[[1, 2, 4], [1, 3, 1], [3, 2, 2], [2, 4, 1], [3, 4, 5]], 4, 1],
      expected: 4,
      name: "plusieurs chemins",
    },
  ],
  rust: `use std::cmp::Reverse;
use std::collections::BinaryHeap;

fn network_delay_time(
    times: &[(usize, usize, u32)], n: usize, k: usize,
) -> Option<u32> {
    // TODO : Dijkstra avec BinaryHeap<Reverse<(u32, usize)>>
    todo!()
}

fn main() {
    let t = [(2, 1, 1), (2, 3, 1), (3, 4, 1)];
    println!("{:?}", network_delay_time(&t, 4, 2));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        let t = [(2, 1, 1), (2, 3, 1), (3, 4, 1)];
        assert_eq!(network_delay_time(&t, 4, 2), Some(2));
    }
    #[test]
    fn unreachable() {
        assert_eq!(network_delay_time(&[(1, 2, 1)], 2, 2), None);
    }
    #[test]
    fn detour() {
        let t = [(1, 2, 10), (1, 3, 1), (3, 2, 1)];
        assert_eq!(network_delay_time(&t, 3, 1), Some(2));
    }
}
`,
});
