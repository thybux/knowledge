import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "valid-anagram",
  title: "Valid Anagram",
  difficulty: "facile",
  entry: "isAnagram",
  starter: `function isAnagram(s: string, t: string): boolean {
  // true si t est une permutation des lettres de s
  return false;
}`,
  solution: `function isAnagram(s: string, t: string): boolean {
  if (s.length !== t.length) return false;
  const count = new Map<string, number>();
  for (const c of s) count.set(c, (count.get(c) ?? 0) + 1);
  for (const c of t) {
    const n = count.get(c) ?? 0;
    if (n === 0) return false; // t a un caractère en trop
    count.set(c, n - 1);
  }
  return true;
}`,
  cases: [
    { args: ["anagram", "nagaram"], expected: true },
    { args: ["rat", "car"], expected: false },
    { args: ["", ""], expected: true, name: "chaînes vides" },
    { args: ["a", "a"], expected: true, name: "1 caractère" },
    { args: ["a", "b"], expected: false },
    { args: ["ab", "a"], expected: false, name: "longueurs différentes" },
    { args: ["aacc", "ccac"], expected: false, name: "doublons" },
    { args: ["listen", "silent"], expected: true },
    { args: ["aabbcc", "abcabc"], expected: true },
    {
      args: ["ab".repeat(500), "ba".repeat(499) + "aa"],
      expected: false,
      name: "grande chaîne",
    },
  ],
  rust: `fn is_anagram(s: &str, t: &str) -> bool {
    // TODO : compte les octets (on suppose de l'ASCII)
    todo!()
}

fn main() {
    println!("{}", is_anagram("anagram", "nagaram"));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn yes() { assert!(is_anagram("anagram", "nagaram")); }
    #[test] fn no() { assert!(!is_anagram("rat", "car")); }
    #[test] fn empty() { assert!(is_anagram("", "")); }
    #[test] fn len() { assert!(!is_anagram("ab", "a")); }
    #[test] fn dups() { assert!(!is_anagram("aacc", "ccac")); }
}
`,
});
