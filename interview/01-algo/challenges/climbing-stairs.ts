import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "climbing-stairs",
  title: "Climbing Stairs",
  difficulty: "facile",
  entry: "climbStairs",
  starter: `function climbStairs(n: number): number {
  // Nombre de façons de monter n marches en faisant des pas de 1 ou 2.
  return 0;
}`,
  solution: `function climbStairs(n: number): number {
  // dp[i] = dp[i - 1] + dp[i - 2] ; on ne garde que 2 valeurs
  let prev = 1; // dp[0]
  let cur = 1; // dp[1]
  for (let i = 2; i <= n; i++) {
    [prev, cur] = [cur, prev + cur];
  }
  return cur;
}`,
  cases: [
    { args: [1], expected: 1 },
    { args: [2], expected: 2 },
    { args: [3], expected: 3 },
    { args: [4], expected: 5 },
    { args: [5], expected: 8 },
    { args: [10], expected: 89 },
    { args: [20], expected: 10946 },
    { args: [30], expected: 1346269 },
    { args: [45], expected: 1836311903, name: "perf : récursion naïve trop lente" },
    { args: [0], expected: 1, name: "0 marche : 1 façon (ne rien faire)" },
  ],
  rust: `fn climb_stairs(n: u32) -> u64 {
    // TODO
    todo!()
}

fn main() {
    println!("{}", climb_stairs(45));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn small() {
        assert_eq!(climb_stairs(1), 1);
        assert_eq!(climb_stairs(2), 2);
        assert_eq!(climb_stairs(5), 8);
    }
    #[test] fn big() { assert_eq!(climb_stairs(45), 1836311903); }
}
`,
});
