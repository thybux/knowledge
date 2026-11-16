import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "house-robber",
  title: "House Robber",
  difficulty: "moyen",
  entry: "rob",
  starter: `function rob(nums: number[]): number {
  // Somme max sans prendre deux maisons adjacentes.
  return 0;
}`,
  solution: `function rob(nums: number[]): number {
  // best(i) = max(best(i - 1), best(i - 2) + nums[i])
  let skip = 0; // meilleur jusqu'a i - 2
  let take = 0; // meilleur jusqu'a i - 1
  for (const x of nums) {
    [skip, take] = [take, Math.max(take, skip + x)];
  }
  return take;
}`,
  cases: [
    { args: [[1, 2, 3, 1]], expected: 4 },
    { args: [[2, 7, 9, 3, 1]], expected: 12 },
    { args: [[]], expected: 0, name: "vide" },
    { args: [[5]], expected: 5, name: "une maison" },
    { args: [[2, 1]], expected: 2 },
    { args: [[2, 1, 1, 2]], expected: 4, name: "sauter deux maisons" },
    { args: [[0, 0, 0]], expected: 0 },
    { args: [[10, 1, 1, 10]], expected: 20 },
    { args: [[1, 3, 1, 3, 100]], expected: 103 },
    { args: [[4, 1, 2, 7, 5, 3, 1]], expected: 14 },
  ],
  rust: `fn rob(nums: &[u32]) -> u32 {
    // TODO
    todo!()
}

fn main() {
    println!("{}", rob(&[2, 7, 9, 3, 1]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn basic() {
        assert_eq!(rob(&[1, 2, 3, 1]), 4);
        assert_eq!(rob(&[2, 7, 9, 3, 1]), 12);
    }
    #[test] fn edge() {
        assert_eq!(rob(&[]), 0);
        assert_eq!(rob(&[5]), 5);
        assert_eq!(rob(&[2, 1, 1, 2]), 4);
    }
}
`,
});
