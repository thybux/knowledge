import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "insert-interval",
  title: "Insert Interval",
  difficulty: "moyen",
  entry: "insert",
  starter: `function insert(intervals: number[][], newInterval: number[]): number[][] {
  // intervals est déjà trié par début et sans chevauchement.
  // Insère newInterval, fusionne si besoin, garde le tri.
  return [];
}`,
  solution: `function insert(intervals: number[][], newInterval: number[]): number[][] {
  const out: number[][] = [];
  let [s, e] = newInterval;
  let i = 0;
  const n = intervals.length;
  // 1. tout ce qui finit avant le début du nouveau
  while (i < n && intervals[i][1] < s) out.push(intervals[i++]);
  // 2. tout ce qui chevauche : on élargit [s, e]
  while (i < n && intervals[i][0] <= e) {
    s = Math.min(s, intervals[i][0]);
    e = Math.max(e, intervals[i][1]);
    i++;
  }
  out.push([s, e]);
  // 3. le reste
  while (i < n) out.push(intervals[i++]);
  return out;
}`,
  cases: [
    { args: [[[1, 3], [6, 9]], [2, 5]], expected: [[1, 5], [6, 9]] },
    {
      args: [[[1, 2], [3, 5], [6, 7], [8, 10], [12, 16]], [4, 8]],
      expected: [[1, 2], [3, 10], [12, 16]],
    },
    { args: [[], [5, 7]], expected: [[5, 7]], name: "liste vide" },
    { args: [[[1, 5]], [2, 3]], expected: [[1, 5]], name: "déjà couvert" },
    { args: [[[3, 5]], [1, 2]], expected: [[1, 2], [3, 5]], name: "avant tout" },
    { args: [[[1, 2]], [5, 6]], expected: [[1, 2], [5, 6]], name: "après tout" },
    { args: [[[1, 2], [5, 6]], [3, 4]], expected: [[1, 2], [3, 4], [5, 6]], name: "au milieu" },
    { args: [[[1, 2], [5, 6]], [2, 5]], expected: [[1, 6]], name: "pont bord à bord" },
    { args: [[[2, 3], [4, 5]], [0, 10]], expected: [[0, 10]], name: "avale tout" },
    { args: [[[1, 5]], [5, 7]], expected: [[1, 7]] },
  ],
  rust: `fn insert(intervals: Vec<[i32; 2]>, new: [i32; 2]) -> Vec<[i32; 2]> {
    // TODO : ton code ici
    todo!()
}

fn main() {
    println!("{:?}", insert(vec![[1, 3], [6, 9]], [2, 5]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        assert_eq!(insert(vec![[1, 3], [6, 9]], [2, 5]), vec![[1, 5], [6, 9]]);
    }
    #[test]
    fn many() {
        let v = vec![[1, 2], [3, 5], [6, 7], [8, 10], [12, 16]];
        assert_eq!(insert(v, [4, 8]), vec![[1, 2], [3, 10], [12, 16]]);
    }
    #[test]
    fn empty() { assert_eq!(insert(vec![], [5, 7]), vec![[5, 7]]); }
    #[test]
    fn before() {
        assert_eq!(insert(vec![[3, 5]], [1, 2]), vec![[1, 2], [3, 5]]);
    }
    #[test]
    fn bridge() {
        assert_eq!(insert(vec![[1, 2], [5, 6]], [2, 5]), vec![[1, 6]]);
    }
}
`,
});
