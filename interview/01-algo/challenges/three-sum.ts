import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "three-sum",
  title: "3Sum",
  difficulty: "moyen",
  entry: "threeSum",
  starter: `function threeSum(nums: number[]): number[][] {
  // Tous les triplets [a, b, c] UNIQUES tels que a + b + c = 0.
  // L'ordre des triplets (et dans un triplet) est libre.
  return [];
}`,
  compare: "unordered",
  solution: `function threeSum(nums: number[]): number[][] {
  const a = [...nums].sort((x, y) => x - y);
  const out: number[][] = [];
  for (let i = 0; i < a.length - 2; i++) {
    if (a[i] > 0) break; // plus rien ne peut sommer à 0
    if (i > 0 && a[i] === a[i - 1]) continue; // doublon
    let lo = i + 1;
    let hi = a.length - 1;
    while (lo < hi) {
      const s = a[i] + a[lo] + a[hi];
      if (s < 0) lo++;
      else if (s > 0) hi--;
      else {
        out.push([a[i], a[lo], a[hi]]);
        lo++;
        hi--;
        while (lo < hi && a[lo] === a[lo - 1]) lo++;
      }
    }
  }
  return out;
}`,
  cases: [
    { args: [[-1, 0, 1, 2, -1, -4]], expected: [[-1, -1, 2], [-1, 0, 1]] },
    { args: [[0, 1, 1]], expected: [], name: "aucun triplet" },
    { args: [[0, 0, 0]], expected: [[0, 0, 0]] },
    { args: [[]], expected: [], name: "vide" },
    { args: [[0, 0, 0, 0]], expected: [[0, 0, 0]], name: "doublons de zéros" },
    { args: [[-2, 0, 1, 1, 2]], expected: [[-2, 0, 2], [-2, 1, 1]] },
    { args: [[1, 2, -2, -1]], expected: [] },
    { args: [[-1, 0, 1, 0]], expected: [[-1, 0, 1]] },
    { args: [[3, -2, 1, 0]], expected: [] },
    {
      args: [[-4, -2, -2, -2, 0, 1, 2, 2, 2, 3, 3, 4, 4, 6, 6]],
      expected: [
        [-4, -2, 6], [-4, 0, 4], [-4, 1, 3],
        [-4, 2, 2], [-2, -2, 4], [-2, 0, 2],
      ],
      name: "beaucoup de doublons",
    },
  ],
  rust: `fn three_sum(nums: Vec<i32>) -> Vec<Vec<i32>> {
    // TODO : trier, fixer i, deux pointeurs sur le reste
    todo!()
}

fn main() {
    println!("{:?}", three_sum(vec![-1, 0, 1, 2, -1, -4]));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn norm(mut v: Vec<Vec<i32>>) -> Vec<Vec<i32>> {
        for t in &mut v { t.sort(); }
        v.sort();
        v
    }
    #[test]
    fn basic() {
        let got = norm(three_sum(vec![-1, 0, 1, 2, -1, -4]));
        assert_eq!(got, vec![vec![-1, -1, 2], vec![-1, 0, 1]]);
    }
    #[test]
    fn none() { assert!(three_sum(vec![0, 1, 1]).is_empty()); }
    #[test]
    fn empty() { assert!(three_sum(vec![]).is_empty()); }
    #[test]
    fn zeros() { assert_eq!(three_sum(vec![0, 0, 0, 0]), vec![vec![0, 0, 0]]); }
    #[test]
    fn dups() {
        let got = norm(three_sum(vec![-2, 0, 1, 1, 2]));
        assert_eq!(got, vec![vec![-2, 0, 2], vec![-2, 1, 1]]);
    }
}
`,
});
