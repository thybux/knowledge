import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "course-schedule",
  title: "Planning de cours",
  difficulty: "moyen",
  entry: "canFinish",
  starter: `function canFinish(n: number, prereqs: number[][]): boolean {
  // Cours numérotés 0..n-1. [a, b] = il faut b avant a.
  // Peut-on suivre tous les cours ? (= pas de cycle)
  return false;
}`,
  solution: `function canFinish(n: number, prereqs: number[][]): boolean {
  const adj: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);
  for (const [a, b] of prereqs) {
    adj[b].push(a); // arête b -> a
    indeg[a]++;
  }
  // Kahn : on part des cours sans prérequis
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
  let done = 0;
  for (let h = 0; h < queue.length; h++) {
    const u = queue[h];
    done++;
    for (const v of adj[u]) if (--indeg[v] === 0) queue.push(v);
  }
  return done === n; // sinon : des nœuds restent bloqués dans un cycle
}`,
  cases: [
    { args: [2, [[1, 0]]], expected: true },
    { args: [2, [[1, 0], [0, 1]]], expected: false, name: "cycle de 2" },
    { args: [1, []], expected: true, name: "un cours" },
    { args: [3, []], expected: true, name: "aucun prérequis" },
    { args: [1, [[0, 0]]], expected: false, name: "auto-boucle" },
    { args: [4, [[1, 0], [2, 1], [3, 2]]], expected: true, name: "chaîne" },
    { args: [4, [[1, 0], [2, 1], [3, 2], [1, 3]]], expected: false, name: "cycle en bout de chaîne" },
    { args: [4, [[1, 0], [2, 0], [3, 1], [3, 2]]], expected: true, name: "diamant" },
    { args: [5, [[1, 0], [0, 1], [3, 4]]], expected: false, name: "cycle dans une composante" },
    { args: [3, [[1, 0], [1, 0], [2, 1]]], expected: true, name: "arête en double" },
  ],
  rust: `use std::collections::VecDeque;

fn can_finish(n: usize, prereqs: &[(usize, usize)]) -> bool {
    // TODO : tri topologique (Kahn)
    todo!()
}

fn main() {
    println!("{}", can_finish(2, &[(1, 0)]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ok() { assert!(can_finish(2, &[(1, 0)])); }
    #[test]
    fn cycle() { assert!(!can_finish(2, &[(1, 0), (0, 1)])); }
    #[test]
    fn self_loop() { assert!(!can_finish(1, &[(0, 0)])); }
    #[test]
    fn diamond() {
        assert!(can_finish(4, &[(1, 0), (2, 0), (3, 1), (3, 2)]));
    }
}
`,
});
