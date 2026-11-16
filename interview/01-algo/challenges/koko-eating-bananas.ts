import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "koko-eating-bananas",
  title: "Koko Eating Bananas",
  difficulty: "moyen",
  entry: "minEatingSpeed",
  starter: `function minEatingSpeed(piles: number[], h: number): number {
  // À la vitesse k, une pile p prend ceil(p / k) heures.
  // Plus petit k entier tel que le total <= h
  // (h >= piles.length, donc une réponse existe).
  return 0;
}`,
  solution: `function minEatingSpeed(piles: number[], h: number): number {
  const hours = (k: number) => {
    let t = 0;
    for (const p of piles) t += Math.ceil(p / k);
    return t;
  };
  // on cherche la réponse dans [1, max(piles)] :
  // hours(k) <= h est faux... faux, vrai... vrai
  let lo = 1;
  let hi = Math.max(...piles);
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (hours(mid) <= h) hi = mid; // mid suffit : on tente plus petit
    else lo = mid + 1;
  }
  return lo;
}`,
  cases: [
    { args: [[3, 6, 7, 11], 8], expected: 4 },
    { args: [[30, 11, 23, 4, 20], 5], expected: 30, name: "h = nombre de piles" },
    { args: [[30, 11, 23, 4, 20], 6], expected: 23 },
    { args: [[1], 1], expected: 1, name: "1 pile" },
    { args: [[1000000000], 2], expected: 500000000, name: "grande pile" },
    { args: [[312884470], 312884469], expected: 2 },
    { args: [[1, 1, 1, 1], 4], expected: 1 },
    { args: [[2, 2], 2], expected: 2, name: "doublons" },
    { args: [[5, 5, 5], 6], expected: 3 },
    {
      args: [Array.from({ length: 1000 }, (_, i) => i + 1), 1000000],
      expected: 1,
      name: "beaucoup d'heures",
    },
  ],
  rust: `fn min_eating_speed(piles: &[u64], h: u64) -> u64 {
    // TODO : binary search sur k dans [1, max]
    // indice : u64::div_ceil
    todo!()
}

fn main() {
    println!("{}", min_eating_speed(&[3, 6, 7, 11], 8));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn basic() { assert_eq!(min_eating_speed(&[3, 6, 7, 11], 8), 4); }
    #[test] fn tight() { assert_eq!(min_eating_speed(&[30, 11, 23, 4, 20], 5), 30); }
    #[test] fn six() { assert_eq!(min_eating_speed(&[30, 11, 23, 4, 20], 6), 23); }
    #[test] fn one() { assert_eq!(min_eating_speed(&[1], 1), 1); }
    #[test] fn big() { assert_eq!(min_eating_speed(&[1_000_000_000], 2), 500_000_000); }
}
`,
});
