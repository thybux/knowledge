import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "valid-parentheses",
  title: "Valid Parentheses",
  difficulty: "facile",
  entry: "isValid",
  starter: `function isValid(s: string): boolean {
  // s ne contient que ()[]{} : chaque ouvrante doit être fermée
  // par le bon type, dans le bon ordre.
  return false;
}`,
  solution: `function isValid(s: string): boolean {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = []; // fermantes attendues
  for (const c of s) {
    if (c in pairs) stack.push(pairs[c]);
    else if (stack.pop() !== c) return false;
  }
  return stack.length === 0;
}`,
  cases: [
    { args: ["()"], expected: true },
    { args: ["()[]{}"], expected: true },
    { args: ["(]"], expected: false, name: "mauvais type" },
    { args: ["([)]"], expected: false, name: "mauvais ordre" },
    { args: ["{[]}"], expected: true, name: "imbriqué" },
    { args: [""], expected: true, name: "vide" },
    { args: ["("], expected: false, name: "ouvrante seule" },
    { args: [")"], expected: false, name: "fermante seule (pile vide)" },
    { args: ["(("], expected: false },
    { args: ["((()))[{}]"], expected: true },
    { args: ["]["], expected: false },
    { args: ["(".repeat(5000) + ")".repeat(5000)], expected: true, name: "profond" },
  ],
  rust: `fn is_valid(s: &str) -> bool {
    // TODO : Vec<char> comme pile
    todo!()
}

fn main() {
    println!("{}", is_valid("{[]}"));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn ok() { assert!(is_valid("()[]{}") && is_valid("{[]}")); }
    #[test] fn wrong_type() { assert!(!is_valid("(]")); }
    #[test] fn wrong_order() { assert!(!is_valid("([)]")); }
    #[test] fn empty() { assert!(is_valid("")); }
    #[test] fn lonely() { assert!(!is_valid("(") && !is_valid(")")); }
}
`,
});
