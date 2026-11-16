import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "jump-game",
  title: "Jump Game",
  difficulty: "moyen",
  entry: "canJump",
  starter: `function canJump(nums: number[]): boolean {
  // nums[i] = saut maximal depuis i. Départ en 0.
  // Peut-on atteindre le dernier indice ?
  return false;
}`,
  solution: `function canJump(nums: number[]): boolean {
  let reach = 0; // indice le plus loin atteignable
  for (let i = 0; i < nums.length; i++) {
    if (i > reach) return false;
    reach = Math.max(reach, i + nums[i]);
  }
  return true;
}`,
  cases: [
    { args: [[2, 3, 1, 1, 4]], expected: true },
    { args: [[3, 2, 1, 0, 4]], expected: false },
    { args: [[0]], expected: true, name: "déjà arrivé" },
    { args: [[0, 1]], expected: false, name: "bloqué au départ" },
    { args: [[1, 0]], expected: true },
    { args: [[2, 0, 0]], expected: true },
    { args: [[1, 1, 0, 1]], expected: false },
    { args: [[5, 0, 0, 0, 0, 0]], expected: true, name: "un grand saut" },
    { args: [[1, 2, 0, 1, 0, 2, 0]], expected: false },
    { args: [Array.from({ length: 10000 }, () => 1)], expected: true, name: "grand tableau" },
  ],
  rust: `fn can_jump(nums: &[usize]) -> bool {
    // TODO : ton code ici
    todo!()
}

fn main() {
    println!("{}", can_jump(&[2, 3, 1, 1, 4]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn yes() { assert!(can_jump(&[2, 3, 1, 1, 4])); }
    #[test]
    fn no() { assert!(!can_jump(&[3, 2, 1, 0, 4])); }
    #[test]
    fn single() { assert!(can_jump(&[0])); }
    #[test]
    fn stuck() { assert!(!can_jump(&[0, 1])); }
    #[test]
    fn big_jump() { assert!(can_jump(&[5, 0, 0, 0, 0, 0])); }
}
`,
});
