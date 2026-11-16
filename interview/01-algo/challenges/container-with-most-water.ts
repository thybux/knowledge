import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "container-with-most-water",
  title: "Container With Most Water",
  difficulty: "moyen",
  entry: "maxArea",
  starter: `function maxArea(height: number[]): number {
  // Aire max = min(h[i], h[j]) * (j - i) pour i < j. Vise O(n).
  return 0;
}`,
  solution: `function maxArea(height: number[]): number {
  let i = 0;
  let j = height.length - 1;
  let best = 0;
  while (i < j) {
    const area = Math.min(height[i], height[j]) * (j - i);
    best = Math.max(best, area);
    // le plus petit côté limite l'aire : c'est lui qu'on bouge
    if (height[i] < height[j]) i++;
    else j--;
  }
  return best;
}`,
  cases: [
    { args: [[1, 8, 6, 2, 5, 4, 8, 3, 7]], expected: 49 },
    { args: [[1, 1]], expected: 1, name: "2 barres" },
    { args: [[4, 3, 2, 1, 4]], expected: 16 },
    { args: [[1, 2, 1]], expected: 2 },
    { args: [[0, 0]], expected: 0, name: "hauteurs nulles" },
    { args: [[2, 3, 4, 5, 18, 17, 6]], expected: 17 },
    { args: [[1, 2, 4, 3]], expected: 4 },
    { args: [[10, 9, 8, 7, 6, 5, 4, 3, 2, 1]], expected: 25, name: "décroissant" },
    { args: [[]], expected: 0, name: "vide" },
    {
      args: [Array.from({ length: 3000 }, (_, i) => (i * 37) % 101)],
      expected: 292941,
      name: "3000 barres",
    },
  ],
  rust: `fn max_area(h: &[i32]) -> i32 {
    // TODO : deux pointeurs aux extrémités
    todo!()
}

fn main() {
    println!("{}", max_area(&[1, 8, 6, 2, 5, 4, 8, 3, 7]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() { assert_eq!(max_area(&[1, 8, 6, 2, 5, 4, 8, 3, 7]), 49); }
    #[test]
    fn two() { assert_eq!(max_area(&[1, 1]), 1); }
    #[test]
    fn edges() { assert_eq!(max_area(&[4, 3, 2, 1, 4]), 16); }
    #[test]
    fn empty() { assert_eq!(max_area(&[]), 0); }
    #[test]
    fn big() {
        let v: Vec<i32> = (0..3000).map(|i| (i * 37) % 101).collect();
        assert_eq!(max_area(&v), 292941);
    }
}
`,
});
