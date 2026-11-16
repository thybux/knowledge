import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "partition-equal-subset-sum",
  title: "Partition Equal Subset Sum",
  difficulty: "moyen",
  entry: "canPartition",
  starter: `function canPartition(nums: number[]): boolean {
  // Peut-on couper nums (entiers > 0) en deux groupes de même somme ?
  return false;
}`,
  solution: `function canPartition(nums: number[]): boolean {
  const total = nums.reduce((a, b) => a + b, 0);
  if (total % 2 !== 0) return false;
  const target = total / 2;
  // dp[s] = true si une sous-partie atteint la somme s
  const dp = new Array(target + 1).fill(false);
  dp[0] = true;
  for (const x of nums) {
    // a l'envers : chaque objet n'est pris qu'une fois (0/1)
    for (let s = target; s >= x; s--) {
      if (dp[s - x]) dp[s] = true;
    }
  }
  return dp[target];
}`,
  cases: [
    { args: [[1, 5, 11, 5]], expected: true },
    { args: [[1, 2, 3, 5]], expected: false },
    { args: [[1, 1]], expected: true },
    { args: [[1]], expected: false, name: "un seul élément" },
    { args: [[2, 2, 3, 5]], expected: false, name: "somme paire mais impossible" },
    { args: [[3, 3, 3, 4, 5]], expected: true },
    { args: [[100]], expected: false },
    { args: [[1, 2, 5]], expected: false },
    { args: [[2, 2, 1, 1]], expected: true },
    { args: [[1, 2, 3, 4, 5, 6, 7]], expected: true },
    { args: [Array.from({ length: 200 }, (_, i) => (i % 50) + 1)], expected: true, name: "perf" },
  ],
  rust: `fn can_partition(nums: &[usize]) -> bool {
    // TODO : knapsack 0/1 sur la somme cible total / 2
    todo!()
}

fn main() {
    println!("{}", can_partition(&[1, 5, 11, 5]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn yes() {
        assert!(can_partition(&[1, 5, 11, 5]));
        assert!(can_partition(&[3, 3, 3, 4, 5]));
    }
    #[test] fn no() {
        assert!(!can_partition(&[1, 2, 3, 5]));
        assert!(!can_partition(&[2, 2, 3, 5]));
        assert!(!can_partition(&[1]));
    }
}
`,
});
