import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "coin-change",
  title: "Coin Change",
  difficulty: "moyen",
  entry: "coinChange",
  starter: `function coinChange(coins: number[], amount: number): number {
  // Nombre minimal de pièces pour faire amount (pièces illimitées).
  // -1 si impossible.
  return -1;
}`,
  solution: `function coinChange(coins: number[], amount: number): number {
  // dp[a] = min pieces pour faire a
  const dp = new Array(amount + 1).fill(Infinity);
  dp[0] = 0;
  for (let a = 1; a <= amount; a++) {
    for (const c of coins) {
      if (c <= a && dp[a - c] + 1 < dp[a]) dp[a] = dp[a - c] + 1;
    }
  }
  return dp[amount] === Infinity ? -1 : dp[amount];
}`,
  cases: [
    { args: [[1, 2, 5], 11], expected: 3 },
    { args: [[2], 3], expected: -1, name: "impossible" },
    { args: [[1], 0], expected: 0, name: "montant 0" },
    { args: [[1], 2], expected: 2 },
    { args: [[1, 3, 4], 6], expected: 2, name: "le glouton se trompe (4+1+1)" },
    { args: [[2, 5, 10, 1], 27], expected: 4 },
    { args: [[186, 419, 83, 408], 6249], expected: 20 },
    { args: [[5, 10], 3], expected: -1 },
    { args: [[3, 7], 11], expected: -1 },
    { args: [[1, 2147483647], 2], expected: 2, name: "grosse pièce" },
    { args: [[1, 5, 10, 25], 10000], expected: 400, name: "perf" },
  ],
  rust: `fn coin_change(coins: &[usize], amount: usize) -> i32 {
    // TODO : dp bottom-up sur les montants
    todo!()
}

fn main() {
    println!("{}", coin_change(&[1, 2, 5], 11));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn basic() { assert_eq!(coin_change(&[1, 2, 5], 11), 3); }
    #[test] fn impossible() { assert_eq!(coin_change(&[2], 3), -1); }
    #[test] fn zero() { assert_eq!(coin_change(&[1], 0), 0); }
    #[test] fn greedy_fails() { assert_eq!(coin_change(&[1, 3, 4], 6), 2); }
}
`,
});
