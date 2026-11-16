import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "product-except-self",
  title: "Product of Array Except Self",
  difficulty: "moyen",
  entry: "productExceptSelf",
  starter: `function productExceptSelf(nums: number[]): number[] {
  // out[i] = produit de tous les éléments sauf nums[i]
  // Contraintes : O(n), et SANS division.
  return [];
}`,
  solution: `function productExceptSelf(nums: number[]): number[] {
  const n = nums.length;
  const out = new Array<number>(n).fill(1);
  // passe 1 : out[i] = produit des éléments à gauche de i
  for (let i = 1; i < n; i++) out[i] = out[i - 1] * nums[i - 1];
  // passe 2 : on multiplie par le produit des éléments à droite
  let right = 1;
  for (let i = n - 1; i >= 0; i--) {
    out[i] *= right;
    right *= nums[i];
  }
  return out;
}`,
  cases: [
    { args: [[1, 2, 3, 4]], expected: [24, 12, 8, 6] },
    { args: [[-1, 1, 0, -3, 3]], expected: [0, 0, 9, 0, 0], name: "un zéro" },
    { args: [[2, 3]], expected: [3, 2], name: "2 éléments" },
    { args: [[0, 0]], expected: [0, 0], name: "deux zéros" },
    { args: [[5, 0]], expected: [0, 5] },
    { args: [[1, 1, 1, 1]], expected: [1, 1, 1, 1] },
    { args: [[-2, -3, 4]], expected: [-12, -8, 6], name: "négatifs" },
    { args: [[2, 2, 2, 2, 2]], expected: [16, 16, 16, 16, 16] },
    { args: [[3, 0, 2, 0]], expected: [0, 0, 0, 0] },
    { args: [[10, -1, 2]], expected: [-2, 20, -10] },
  ],
  rust: `fn product_except_self(nums: &[i32]) -> Vec<i32> {
    // TODO : deux passes, gauche puis droite, sans division
    todo!()
}

fn main() {
    println!("{:?}", product_except_self(&[1, 2, 3, 4]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        assert_eq!(product_except_self(&[1, 2, 3, 4]), vec![24, 12, 8, 6]);
    }
    #[test]
    fn one_zero() {
        let got = product_except_self(&[-1, 1, 0, -3, 3]);
        assert_eq!(got, vec![0, 0, 9, 0, 0]);
    }
    #[test]
    fn two_zeros() { assert_eq!(product_except_self(&[0, 0]), vec![0, 0]); }
    #[test]
    fn neg() {
        assert_eq!(product_except_self(&[-2, -3, 4]), vec![-12, -8, 6]);
    }
}
`,
});
