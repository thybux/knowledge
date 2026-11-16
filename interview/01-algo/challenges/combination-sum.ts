import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "combination-sum",
  title: "Combination Sum",
  difficulty: "moyen",
  entry: "combinationSum",
  compare: "unordered",
  starter: `function combinationSum(
  candidates: number[],
  target: number,
): number[][] {
  // Candidats distincts et > 0, chacun réutilisable à volonté.
  // Retourne les combinaisons uniques (ordre libre).
  return [];
}`,
  solution: `function combinationSum(
  candidates: number[],
  target: number,
): number[][] {
  const nums = [...candidates].sort((a, b) => a - b);
  const res: number[][] = [];
  const path: number[] = [];
  const dfs = (start: number, rest: number) => {
    if (rest === 0) {
      res.push([...path]);
      return;
    }
    for (let i = start; i < nums.length; i++) {
      if (nums[i] > rest) break; // trie => on peut couper
      path.push(nums[i]);
      dfs(i, rest - nums[i]); // i (pas i + 1) : reutilisable
      path.pop();
    }
  };
  dfs(0, target);
  return res;
}`,
  cases: [
    { args: [[2, 3, 6, 7], 7], expected: [[2, 2, 3], [7]] },
    { args: [[2, 3, 5], 8], expected: [[2, 2, 2, 2], [2, 3, 3], [3, 5]] },
    { args: [[2], 1], expected: [], name: "impossible" },
    { args: [[1], 1], expected: [[1]] },
    { args: [[1], 3], expected: [[1, 1, 1]] },
    { args: [[7, 3, 2], 7], expected: [[2, 2, 3], [7]], name: "non trié" },
    { args: [[5, 10], 3], expected: [], name: "tous trop grands" },
    { args: [[2, 4], 8], expected: [[2, 2, 2, 2], [2, 2, 4], [4, 4]] },
    { args: [[3, 4, 5], 12], expected: [[3, 3, 3, 3], [3, 4, 5], [4, 4, 4]] },
    { args: [[1, 2], 4], expected: [[1, 1, 1, 1], [1, 1, 2], [2, 2]] },
  ],
  rust: `fn combination_sum(candidates: &[i32], target: i32) -> Vec<Vec<i32>> {
    // TODO : backtracking, chaque candidat réutilisable
    todo!()
}

fn main() {
    println!("{:?}", combination_sum(&[2, 3, 6, 7], 7));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn norm(mut v: Vec<Vec<i32>>) -> Vec<Vec<i32>> {
        for s in v.iter_mut() { s.sort(); }
        v.sort();
        v
    }
    #[test] fn basic() {
        assert_eq!(norm(combination_sum(&[2, 3, 6, 7], 7)),
            vec![vec![2, 2, 3], vec![7]]);
    }
    #[test] fn three() {
        assert_eq!(norm(combination_sum(&[2, 3, 5], 8)),
            vec![vec![2, 2, 2, 2], vec![2, 3, 3], vec![3, 5]]);
    }
    #[test] fn none() { assert!(combination_sum(&[2], 1).is_empty()); }
}
`,
});
