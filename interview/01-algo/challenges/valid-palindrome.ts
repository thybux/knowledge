import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "valid-palindrome",
  title: "Valid Palindrome",
  difficulty: "facile",
  entry: "isPalindrome",
  starter: `function isPalindrome(s: string): boolean {
  // Ignore tout ce qui n'est pas lettre/chiffre (ASCII) et la casse.
  // Vise O(1) en espace : pas de chaîne nettoyée intermédiaire.
  return false;
}`,
  solution: `function isPalindrome(s: string): boolean {
  const ok = (c: string) => /[a-z0-9]/i.test(c);
  let i = 0;
  let j = s.length - 1;
  while (i < j) {
    if (!ok(s[i])) i++;
    else if (!ok(s[j])) j--;
    else if (s[i].toLowerCase() !== s[j].toLowerCase()) return false;
    else {
      i++;
      j--;
    }
  }
  return true;
}`,
  cases: [
    { args: ["A man, a plan, a canal: Panama"], expected: true },
    { args: ["race a car"], expected: false },
    { args: [" "], expected: true, name: "que des espaces" },
    { args: [""], expected: true, name: "vide" },
    { args: ["a"], expected: true, name: "1 caractère" },
    { args: ["ab"], expected: false },
    { args: ["0P"], expected: false, name: "chiffre vs lettre" },
    { args: ["Was it a car or a cat I saw?"], expected: true },
    { args: ["No 'x' in Nixon"], expected: true },
    { args: [".,,"], expected: true, name: "que de la ponctuation" },
    { args: ["ab".repeat(2000) + "ba".repeat(2000)], expected: true },
  ],
  rust: `fn is_palindrome(s: &str) -> bool {
    // TODO : deux pointeurs sur s.as_bytes()
    // indices : u8::is_ascii_alphanumeric, eq_ignore_ascii_case
    todo!()
}

fn main() {
    println!("{}", is_palindrome("A man, a plan, a canal: Panama"));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn panama() { assert!(is_palindrome("A man, a plan, a canal: Panama")); }
    #[test]
    fn car() { assert!(!is_palindrome("race a car")); }
    #[test]
    fn empty() { assert!(is_palindrome("") && is_palindrome(" ")); }
    #[test]
    fn digit() { assert!(!is_palindrome("0P")); }
    #[test]
    fn punct() { assert!(is_palindrome(".,,")); }
}
`,
});
