import { defineChallenge } from "../../../.vitepress/theme/challenge";

const N = 5000;

export default defineChallenge({
  id: "daily-temperatures",
  title: "Daily Temperatures",
  difficulty: "moyen",
  entry: "dailyTemperatures",
  starter: `function dailyTemperatures(t: number[]): number[] {
  // out[i] = nombre de jours à attendre une température
  // strictement plus chaude que t[i] (0 si jamais).
  return [];
}`,
  solution: `function dailyTemperatures(t: number[]): number[] {
  const out = new Array<number>(t.length).fill(0);
  const stack: number[] = []; // indices, températures décroissantes
  for (let i = 0; i < t.length; i++) {
    while (stack.length && t[stack[stack.length - 1]] < t[i]) {
      const j = stack.pop()!;
      out[j] = i - j; // i = premier jour plus chaud que j
    }
    stack.push(i);
  }
  return out;
}`,
  cases: [
    {
      args: [[73, 74, 75, 71, 69, 72, 76, 73]],
      expected: [1, 1, 4, 2, 1, 1, 0, 0],
    },
    { args: [[30, 40, 50, 60]], expected: [1, 1, 1, 0], name: "croissant" },
    { args: [[30, 60, 90]], expected: [1, 1, 0] },
    { args: [[]], expected: [], name: "vide" },
    { args: [[50]], expected: [0], name: "1 jour" },
    { args: [[50, 50, 50]], expected: [0, 0, 0], name: "égalités (strict)" },
    { args: [[90, 80, 70]], expected: [0, 0, 0], name: "décroissant" },
    { args: [[70, 80, 70, 80]], expected: [1, 0, 1, 0] },
    { args: [[-5, -10, 0]], expected: [2, 1, 0], name: "négatifs" },
    {
      args: [[...Array.from({ length: N }, (_, i) => N - i), N + 1]],
      expected: [...Array.from({ length: N }, (_, i) => N - i), 0],
      name: "5000 jours décroissants puis un pic",
    },
  ],
  rust: `fn daily_temperatures(t: &[i32]) -> Vec<usize> {
    // TODO : pile monotone d'indices
    todo!()
}

fn main() {
    println!("{:?}", daily_temperatures(&[73, 74, 75, 71, 69, 72, 76, 73]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        let got = daily_temperatures(&[73, 74, 75, 71, 69, 72, 76, 73]);
        assert_eq!(got, vec![1, 1, 4, 2, 1, 1, 0, 0]);
    }
    #[test]
    fn empty() { assert!(daily_temperatures(&[]).is_empty()); }
    #[test]
    fn equal() { assert_eq!(daily_temperatures(&[50, 50]), vec![0, 0]); }
    #[test]
    fn alt() {
        assert_eq!(daily_temperatures(&[70, 80, 70, 80]), vec![1, 0, 1, 0]);
    }
}
`,
});
