import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "non-overlapping-intervals",
  title: "Non-overlapping Intervals",
  difficulty: "moyen",
  entry: "eraseOverlapIntervals",
  starter: `function eraseOverlapIntervals(intervals: number[][]): number {
  // Nombre minimal d'intervalles à supprimer pour qu'il ne reste
  // aucun chevauchement ([1,2] et [2,3] ne se chevauchent pas).
  return 0;
}`,
  solution: `function eraseOverlapIntervals(intervals: number[][]): number {
  const sorted = [...intervals].sort((a, b) => a[1] - b[1]);
  let kept = 0;
  let end = -Infinity;
  for (const [s, e] of sorted) {
    if (s >= end) {
      kept++;
      end = e;
    }
  }
  return intervals.length - kept;
}`,
  cases: [
    { args: [[[1, 2], [2, 3], [3, 4], [1, 3]]], expected: 1 },
    { args: [[[1, 2], [1, 2], [1, 2]]], expected: 2 },
    { args: [[[1, 2], [2, 3]]], expected: 0, name: "bord à bord" },
    { args: [[]], expected: 0, name: "vide" },
    { args: [[[5, 6]]], expected: 0, name: "un seul" },
    { args: [[[1, 100], [11, 22], [1, 11], [2, 12]]], expected: 2 },
    { args: [[[1, 10], [2, 3], [4, 5], [6, 7]]], expected: 1, name: "le long saute" },
    { args: [[[0, 2], [1, 3], [2, 4], [3, 5], [4, 6]]], expected: 2 },
    { args: [[[-5, -1], [-3, 0], [0, 2]]], expected: 1, name: "négatifs" },
    { args: [[[1, 3], [3, 5], [5, 7], [7, 9]]], expected: 0, name: "chaîne" },
  ],
  rust: `fn erase_overlap_intervals(mut intervals: Vec<[i32; 2]>) -> usize {
    // TODO : ton code ici
    todo!()
}

fn main() {
    let v = vec![[1, 2], [2, 3], [3, 4], [1, 3]];
    println!("{}", erase_overlap_intervals(v));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        let v = vec![[1, 2], [2, 3], [3, 4], [1, 3]];
        assert_eq!(erase_overlap_intervals(v), 1);
    }
    #[test]
    fn same() {
        assert_eq!(erase_overlap_intervals(vec![[1, 2], [1, 2], [1, 2]]), 2);
    }
    #[test]
    fn empty() { assert_eq!(erase_overlap_intervals(vec![]), 0); }
    #[test]
    fn long_one() {
        let v = vec![[1, 10], [2, 3], [4, 5], [6, 7]];
        assert_eq!(erase_overlap_intervals(v), 1);
    }
}
`,
});
