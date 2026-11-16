import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "word-ladder",
  title: "Échelle de mots",
  difficulty: "difficile",
  entry: "ladderLength",
  starter: `function ladderLength(
  begin: string, end: string, words: string[],
): number {
  // Une étape = changer 1 lettre, chaque mot intermédiaire doit
  // être dans words. Retourne le nombre de mots de la plus courte
  // séquence begin -> end (begin et end inclus), ou 0.
  return 0;
}`,
  solution: `function ladderLength(
  begin: string, end: string, words: string[],
): number {
  const dict = new Set(words);
  if (!dict.has(end)) return 0;
  const abc = "abcdefghijklmnopqrstuvwxyz";
  let frontier = [begin];
  const seen = new Set([begin]);
  let depth = 1;
  while (frontier.length) {
    const next: string[] = [];
    for (const w of frontier) {
      if (w === end) return depth;
      // voisins générés : L * 26 candidats au lieu de comparer à tous
      for (let i = 0; i < w.length; i++) {
        for (const ch of abc) {
          const cand = w.slice(0, i) + ch + w.slice(i + 1);
          if (dict.has(cand) && !seen.has(cand)) {
            seen.add(cand);
            next.push(cand);
          }
        }
      }
    }
    frontier = next;
    depth++;
  }
  return 0;
}`,
  cases: [
    { args: ["hit", "cog", ["hot", "dot", "dog", "lot", "log", "cog"]], expected: 5 },
    { args: ["hit", "cog", ["hot", "dot", "dog", "lot", "log"]], expected: 0, name: "end absent" },
    { args: ["a", "c", ["a", "b", "c"]], expected: 2, name: "1 lettre" },
    { args: ["hot", "dog", ["hot", "dog"]], expected: 0, name: "pas de pont" },
    { args: ["hot", "dot", ["dot"]], expected: 2, name: "voisin direct" },
    { args: ["abc", "abc", ["abc"]], expected: 1, name: "begin = end" },
    { args: ["hit", "cog", []], expected: 0, name: "dictionnaire vide" },
    {
      args: ["red", "tax", ["ted", "tex", "red", "tax", "tad", "den", "rex", "pee"]],
      expected: 4,
    },
    {
      args: ["lost", "cost", ["most", "fist", "lost", "cost", "fish"]],
      expected: 2,
    },
    {
      args: ["cold", "warm", ["cord", "card", "ward", "warm", "word", "wore", "core", "worm"]],
      expected: 5,
      name: "cold -> cord -> word -> worm -> warm",
    },
  ],
  rust: `use std::collections::{HashSet, VecDeque};

fn ladder_length(begin: &str, end: &str, words: &[&str]) -> usize {
    // TODO : BFS, voisins générés lettre par lettre
    todo!()
}

fn main() {
    let w = ["hot", "dot", "dog", "lot", "log", "cog"];
    println!("{}", ladder_length("hit", "cog", &w));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        let w = ["hot", "dot", "dog", "lot", "log", "cog"];
        assert_eq!(ladder_length("hit", "cog", &w), 5);
    }
    #[test]
    fn missing_end() {
        let w = ["hot", "dot", "dog", "lot", "log"];
        assert_eq!(ladder_length("hit", "cog", &w), 0);
    }
    #[test]
    fn one_letter() {
        assert_eq!(ladder_length("a", "c", &["a", "b", "c"]), 2);
    }
}
`,
});
