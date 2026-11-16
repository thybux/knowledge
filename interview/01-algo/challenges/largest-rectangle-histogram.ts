import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "largest-rectangle-histogram",
  title: "Largest Rectangle in Histogram",
  difficulty: "difficile",
  entry: "largestRectangleArea",
  starter: `function largestRectangleArea(heights: number[]): number {
  // Barres de largeur 1. Aire du plus grand rectangle
  // entièrement contenu dans l'histogramme. Vise O(n).
  return 0;
}`,
  solution: `function largestRectangleArea(heights: number[]): number {
  const stack: number[] = []; // indices, hauteurs croissantes
  let best = 0;
  for (let i = 0; i <= heights.length; i++) {
    // sentinelle : une barre de hauteur 0 à la fin vide la pile
    const cur = i < heights.length ? heights[i] : 0;
    while (stack.length && heights[stack[stack.length - 1]] >= cur) {
      const h = heights[stack.pop()!];
      // la barre h s'étend du nouveau sommet (exclu) à i (exclu)
      const left = stack.length ? stack[stack.length - 1] + 1 : 0;
      best = Math.max(best, h * (i - left));
    }
    stack.push(i);
  }
  return best;
}`,
  cases: [
    { args: [[2, 1, 5, 6, 2, 3]], expected: 10 },
    { args: [[2, 4]], expected: 4 },
    { args: [[]], expected: 0, name: "vide" },
    { args: [[5]], expected: 5, name: "1 barre" },
    { args: [[0]], expected: 0 },
    { args: [[1, 1, 1, 1]], expected: 4, name: "hauteurs égales" },
    { args: [[2, 1, 2]], expected: 3 },
    { args: [[6, 2, 5, 4, 5, 1, 6]], expected: 12 },
    { args: [[1, 2, 3, 4, 5]], expected: 9, name: "croissant" },
    { args: [[5, 4, 3, 2, 1]], expected: 9, name: "décroissant" },
    { args: [[0, 9]], expected: 9 },
    {
      args: [Array.from({ length: 10000 }, () => 3)],
      expected: 30000,
      name: "10 000 barres égales",
    },
  ],
  rust: `fn largest_rectangle_area(h: &[i32]) -> i32 {
    // TODO : pile monotone croissante + sentinelle 0 à la fin
    todo!()
}

fn main() {
    println!("{}", largest_rectangle_area(&[2, 1, 5, 6, 2, 3]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn basic() { assert_eq!(largest_rectangle_area(&[2, 1, 5, 6, 2, 3]), 10); }
    #[test] fn empty() { assert_eq!(largest_rectangle_area(&[]), 0); }
    #[test] fn equal() { assert_eq!(largest_rectangle_area(&[1, 1, 1, 1]), 4); }
    #[test] fn inc() { assert_eq!(largest_rectangle_area(&[1, 2, 3, 4, 5]), 9); }
    #[test] fn dec() { assert_eq!(largest_rectangle_area(&[5, 4, 3, 2, 1]), 9); }
    #[test] fn valley() { assert_eq!(largest_rectangle_area(&[6, 2, 5, 4, 5, 1, 6]), 12); }
}
`,
});
