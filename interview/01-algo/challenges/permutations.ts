import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "permutations",
  title: "Permutations",
  difficulty: "moyen",
  entry: "permute",
  starter: `// Tri lexicographique (fourni) : les tests comparent l'ordre exact.
const lexCmp = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
};

function permute(nums: number[]): number[][] {
  // nums contient des valeurs distinctes.
  const res: number[][] = [];
  // TODO : remplis res avec toutes les permutations
  return res.sort(lexCmp);
}`,
  solution: `const lexCmp = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
};

function permute(nums: number[]): number[][] {
  const res: number[][] = [];
  const path: number[] = [];
  const used = new Array(nums.length).fill(false);
  const dfs = () => {
    if (path.length === nums.length) {
      res.push([...path]);
      return;
    }
    for (let i = 0; i < nums.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      path.push(nums[i]);
      dfs();
      path.pop();
      used[i] = false;
    }
  };
  dfs();
  return res.sort(lexCmp);
}`,
  cases: [
    { args: [[1, 2, 3]], expected: [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]] },
    { args: [[0, 1]], expected: [[0, 1], [1, 0]] },
    { args: [[1]], expected: [[1]], name: "un seul élément" },
    { args: [[]], expected: [[]], name: "vide : une permutation vide" },
    { args: [[3, 1, 2]], expected: [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]], name: "non trié" },
    { args: [[-1, 5]], expected: [[-1, 5], [5, -1]], name: "négatif" },
    { args: [[9, 8]], expected: [[8, 9], [9, 8]] },
    { args: [[1, 2, 3, 4]], expected: [[1,2,3,4],[1,2,4,3],[1,3,2,4],[1,3,4,2],[1,4,2,3],[1,4,3,2],[2,1,3,4],[2,1,4,3],[2,3,1,4],[2,3,4,1],[2,4,1,3],[2,4,3,1],[3,1,2,4],[3,1,4,2],[3,2,1,4],[3,2,4,1],[3,4,1,2],[3,4,2,1],[4,1,2,3],[4,1,3,2],[4,2,1,3],[4,2,3,1],[4,3,1,2],[4,3,2,1]] },
    { args: [[0, -1, 1]], expected: [[-1, 0, 1], [-1, 1, 0], [0, -1, 1], [0, 1, -1], [1, -1, 0], [1, 0, -1]] },
    { args: [[10, 20]], expected: [[10, 20], [20, 10]] },
  ],
  rust: `fn permute(nums: &[i32]) -> Vec<Vec<i32>> {
    // TODO : backtracking, puis res.sort() (ordre lexicographique)
    todo!()
}

fn main() {
    println!("{:?}", permute(&[1, 2, 3]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn three() {
        assert_eq!(permute(&[1, 2, 3]), vec![vec![1, 2, 3], vec![1, 3, 2],
            vec![2, 1, 3], vec![2, 3, 1], vec![3, 1, 2], vec![3, 2, 1]]);
    }
    #[test] fn one() { assert_eq!(permute(&[1]), vec![vec![1]]); }
    #[test] fn count() { assert_eq!(permute(&[1, 2, 3, 4, 5]).len(), 120); }
}
`,
});
