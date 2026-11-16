import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "group-anagrams",
  title: "Group Anagrams",
  difficulty: "moyen",
  entry: "groupAnagrams",
  starter: `function groupAnagrams(strs: string[]): string[][] {
  // Regroupe les mots qui sont anagrammes entre eux.
  // L'ordre des groupes et dans les groupes est libre.
  return [];
}`,
  compare: "unordered",
  solution: `function groupAnagrams(strs: string[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const s of strs) {
    // signature : 26 compteurs -> "1#0#0#...". O(L) au lieu de O(L log L)
    const count = new Array(26).fill(0);
    for (let i = 0; i < s.length; i++) count[s.charCodeAt(i) - 97]++;
    const key = count.join("#");
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  return [...groups.values()];
}`,
  cases: [
    {
      args: [["eat", "tea", "tan", "ate", "nat", "bat"]],
      expected: [["bat"], ["nat", "tan"], ["ate", "eat", "tea"]],
    },
    { args: [[""]], expected: [[""]], name: "mot vide" },
    { args: [["a"]], expected: [["a"]], name: "1 mot" },
    { args: [[]], expected: [], name: "liste vide" },
    { args: [["", ""]], expected: [["", ""]] },
    { args: [["a", "a", "b"]], expected: [["a", "a"], ["b"]], name: "doublons" },
    {
      args: [["abc", "bca", "cab", "xyz"]],
      expected: [["abc", "bca", "cab"], ["xyz"]],
    },
    { args: [["ab", "ba", "abc"]], expected: [["ab", "ba"], ["abc"]] },
    {
      args: [["ddddddddddg", "dgggggggggg"]],
      expected: [["ddddddddddg"], ["dgggggggggg"]],
      name: "mêmes lettres, comptes différents",
    },
    {
      args: [["bdddddddddd", "bbbbbbbbbbc"]],
      expected: [["bdddddddddd"], ["bbbbbbbbbbc"]],
      name: "piège de la clé ambiguë",
    },
  ],
  rust: `use std::collections::HashMap;

fn group_anagrams(strs: &[&str]) -> Vec<Vec<String>> {
    // TODO : HashMap<clé, Vec<String>>
    todo!()
}

fn main() {
    println!("{:?}", group_anagrams(&["eat", "tea", "tan", "bat"]));
}

#[cfg(test)]
mod tests {
    use super::*;
    // trie les groupes pour comparer sans dépendre de l'ordre
    fn norm(mut g: Vec<Vec<String>>) -> Vec<Vec<String>> {
        for v in &mut g { v.sort(); }
        g.sort();
        g
    }
    fn s(v: &[&[&str]]) -> Vec<Vec<String>> {
        v.iter()
            .map(|g| g.iter().map(|x| x.to_string()).collect())
            .collect()
    }
    #[test]
    fn basic() {
        let got = group_anagrams(&["eat", "tea", "tan", "ate", "nat", "bat"]);
        let want = s(&[&["bat"], &["nat", "tan"], &["ate", "eat", "tea"]]);
        assert_eq!(norm(got), norm(want));
    }
    #[test]
    fn empty() { assert!(group_anagrams(&[]).is_empty()); }
    #[test]
    fn empty_word() {
        assert_eq!(norm(group_anagrams(&["", ""])), s(&[&["", ""]]));
    }
    #[test]
    fn counts() {
        let got = group_anagrams(&["ddddddddddg", "dgggggggggg"]);
        assert_eq!(got.len(), 2);
    }
}
`,
});
