import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "letter-combinations",
  title: "Letter Combinations of a Phone Number",
  difficulty: "moyen",
  entry: "letterCombinations",
  compare: "unordered",
  starter: `const KEYS: Record<string, string> = {
  "2": "abc", "3": "def", "4": "ghi", "5": "jkl",
  "6": "mno", "7": "pqrs", "8": "tuv", "9": "wxyz",
};

function letterCombinations(digits: string): string[] {
  // Chiffres 2-9 uniquement. Chaîne vide -> [] (ordre libre).
  return [];
}`,
  solution: `const KEYS: Record<string, string> = {
  "2": "abc", "3": "def", "4": "ghi", "5": "jkl",
  "6": "mno", "7": "pqrs", "8": "tuv", "9": "wxyz",
};

function letterCombinations(digits: string): string[] {
  if (digits.length === 0) return [];
  const res: string[] = [];
  const path: string[] = [];
  const dfs = (i: number) => {
    if (i === digits.length) {
      res.push(path.join(""));
      return;
    }
    for (const ch of KEYS[digits[i]]) {
      path.push(ch);
      dfs(i + 1);
      path.pop();
    }
  };
  dfs(0);
  return res;
}`,
  cases: [
    { args: ["23"], expected: ["ad","ae","af","bd","be","bf","cd","ce","cf"] },
    { args: [""], expected: [], name: "vide" },
    { args: ["2"], expected: ["a","b","c"] },
    { args: ["9"], expected: ["w","x","y","z"] },
    { args: ["79"], expected: ["pw","px","py","pz","qw","qx","qy","qz","rw","rx","ry","rz","sw","sx","sy","sz"] },
    { args: ["22"], expected: ["aa","ab","ac","ba","bb","bc","ca","cb","cc"] },
    { args: ["234"], expected: ["adg","adh","adi","aeg","aeh","aei","afg","afh","afi","bdg","bdh","bdi","beg","beh","bei","bfg","bfh","bfi","cdg","cdh","cdi","ceg","ceh","cei","cfg","cfh","cfi"] },
    { args: ["7"], expected: ["p","q","r","s"] },
    { args: ["47"], expected: ["gp","gq","gr","gs","hp","hq","hr","hs","ip","iq","ir","is"] },
    { args: ["58"], expected: ["jt","ju","jv","kt","ku","kv","lt","lu","lv"] },
  ],
  rust: `const KEYS: [&str; 10] = [
    "", "", "abc", "def", "ghi", "jkl", "mno", "pqrs", "tuv", "wxyz",
];

fn letter_combinations(digits: &str) -> Vec<String> {
    // TODO : backtracking, un niveau par chiffre
    todo!()
}

fn main() {
    println!("{:?}", letter_combinations("23"));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn two_digits() {
        let mut v = letter_combinations("23");
        v.sort();
        assert_eq!(v, vec!["ad", "ae", "af", "bd", "be", "bf",
            "cd", "ce", "cf"]);
    }
    #[test] fn empty() { assert!(letter_combinations("").is_empty()); }
    #[test] fn count() { assert_eq!(letter_combinations("79").len(), 16); }
}
`,
});
