import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "merge-intervals",
  title: "Merge Intervals",
  difficulty: "moyen",
  entry: "merge",
  starter: `function merge(intervals: number[][]): number[][] {
  // Fusionne les intervalles qui se chevauchent ou se touchent.
  // Résultat trié par début.
  return [];
}`,
  solution: `function merge(intervals: number[][]): number[][] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: number[][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}`,
  cases: [
    { args: [[[1, 3], [2, 6], [8, 10], [15, 18]]], expected: [[1, 6], [8, 10], [15, 18]] },
    { args: [[[1, 4], [4, 5]]], expected: [[1, 5]], name: "bord à bord" },
    { args: [[]], expected: [], name: "vide" },
    { args: [[[5, 7]]], expected: [[5, 7]], name: "un seul" },
    { args: [[[1, 10], [2, 3], [4, 5]]], expected: [[1, 10]], name: "inclus" },
    { args: [[[8, 10], [1, 3], [2, 6]]], expected: [[1, 6], [8, 10]], name: "non trié" },
    { args: [[[1, 2], [3, 4], [5, 6]]], expected: [[1, 2], [3, 4], [5, 6]], name: "disjoints" },
    { args: [[[1, 4], [0, 4]]], expected: [[0, 4]] },
    { args: [[[2, 3], [4, 5], [6, 7], [1, 10]]], expected: [[1, 10]], name: "un grand avale tout" },
    { args: [[[1, 1], [1, 1]]], expected: [[1, 1]], name: "points" },
  ],
  rust: `fn merge(mut intervals: Vec<[i32; 2]>) -> Vec<[i32; 2]> {
    // TODO : ton code ici
    todo!()
}

fn main() {
    println!("{:?}", merge(vec![[1, 3], [2, 6], [8, 10]]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        let got = merge(vec![[1, 3], [2, 6], [8, 10], [15, 18]]);
        assert_eq!(got, vec![[1, 6], [8, 10], [15, 18]]);
    }
    #[test]
    fn touching() { assert_eq!(merge(vec![[1, 4], [4, 5]]), vec![[1, 5]]); }
    #[test]
    fn empty() { assert_eq!(merge(vec![]), Vec::<[i32; 2]>::new()); }
    #[test]
    fn unsorted() {
        let got = merge(vec![[8, 10], [1, 3], [2, 6]]);
        assert_eq!(got, vec![[1, 6], [8, 10]]);
    }
    #[test]
    fn swallow() {
        let got = merge(vec![[2, 3], [4, 5], [1, 10]]);
        assert_eq!(got, vec![[1, 10]]);
    }
}
`,
});
