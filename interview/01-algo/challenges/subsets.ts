import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "subsets",
  title: "Subsets",
  difficulty: "moyen",
  entry: "subsets",
  compare: "unordered",
  starter: `function subsets(nums: number[]): number[][] {
  // Retourne tous les sous-ensembles (ordre libre).
  // nums contient des valeurs distinctes.
  const res: number[][] = [];
  return res;
}`,
  solution: `function subsets(nums: number[]): number[][] {
  const res: number[][] = [];
  const path: number[] = [];
  const dfs = (start: number) => {
    res.push([...path]); // chaque noeud est une reponse
    for (let i = start; i < nums.length; i++) {
      path.push(nums[i]);
      dfs(i + 1);
      path.pop();
    }
  };
  dfs(0);
  return res;
}`,
  cases: [
    { args: [[1, 2, 3]], expected: [[], [1], [2], [3], [1, 2], [1, 3], [2, 3], [1, 2, 3]] },
    { args: [[0]], expected: [[], [0]] },
    { args: [[]], expected: [[]], name: "tableau vide" },
    { args: [[5, 9]], expected: [[], [5], [9], [5, 9]] },
    { args: [[-1, 1]], expected: [[], [-1], [1], [-1, 1]], name: "négatifs" },
    { args: [[3, 1, 2]], expected: [[], [1], [2], [3], [1, 2], [1, 3], [2, 3], [1, 2, 3]], name: "non trié" },
    { args: [[10, 20, 30, 40]], expected: [[], [10], [20], [30], [40], [10, 20], [10, 30], [10, 40], [20, 30], [20, 40], [30, 40], [10, 20, 30], [10, 20, 40], [10, 30, 40], [20, 30, 40], [10, 20, 30, 40]] },
    { args: [[7]], expected: [[], [7]] },
    { args: [[1, 2]], expected: [[], [1], [2], [1, 2]] },
    { args: [[4, 0, -4]], expected: [[], [4], [0], [-4], [4, 0], [4, -4], [0, -4], [4, 0, -4]] },
  ],
  rust: `fn subsets(nums: &[i32]) -> Vec<Vec<i32>> {
    // TODO : backtracking (ordre libre)
    todo!()
}

fn main() {
    println!("{:?}", subsets(&[1, 2, 3]));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn norm(mut v: Vec<Vec<i32>>) -> Vec<Vec<i32>> {
        for s in v.iter_mut() { s.sort(); }
        v.sort();
        v
    }
    #[test] fn three() {
        let want = vec![vec![], vec![1], vec![2], vec![3], vec![1, 2],
            vec![1, 3], vec![2, 3], vec![1, 2, 3]];
        assert_eq!(norm(subsets(&[1, 2, 3])), norm(want));
    }
    #[test] fn empty() { assert_eq!(subsets(&[]), vec![vec![]]); }
    #[test] fn count() { assert_eq!(subsets(&[1, 2, 3, 4, 5]).len(), 32); }
}
`,
});
