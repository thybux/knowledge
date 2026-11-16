import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "trie",
  title: "Implement Trie",
  difficulty: "moyen",
  entry: "Trie",
  mode: "class",
  starter: `class Trie {
  // insert(word), search(word) : le mot exact a-t-il été inséré ?
  // startsWith(prefix) : un mot inséré commence-t-il par prefix ?
  // Mots en minuscules a-z.
  constructor() {}

  insert(word: string): void {}

  search(word: string): boolean {
    return false;
  }

  startsWith(prefix: string): boolean {
    return false;
  }
}`,
  solution: `type TrieNode = { children: Map<string, TrieNode>; end: boolean };

class Trie {
  private root: TrieNode = { children: new Map(), end: false };

  insert(word: string): void {
    let node = this.root;
    for (const ch of word) {
      let next = node.children.get(ch);
      if (!next) {
        next = { children: new Map(), end: false };
        node.children.set(ch, next);
      }
      node = next;
    }
    node.end = true;
  }

  private walk(s: string): TrieNode | null {
    let node: TrieNode | undefined = this.root;
    for (const ch of s) {
      node = node.children.get(ch);
      if (!node) return null;
    }
    return node;
  }

  search(word: string): boolean {
    return this.walk(word)?.end ?? false;
  }

  startsWith(prefix: string): boolean {
    return this.walk(prefix) !== null;
  }
}`,
  cases: [
    {
      name: "exemple LeetCode",
      ops: ["Trie", "insert", "search", "search", "startsWith", "insert", "search"],
      args: [[], ["apple"], ["apple"], ["app"], ["app"], ["app"], ["app"]],
      expected: [null, null, true, false, true, null, true],
    },
    {
      name: "trie vide",
      ops: ["Trie", "search", "startsWith"],
      args: [[], ["a"], ["a"]],
      expected: [null, false, false],
    },
    {
      name: "préfixe vide",
      ops: ["Trie", "insert", "startsWith"],
      args: [[], ["abc"], [""]],
      expected: [null, null, true],
    },
    {
      name: "mot plus long que l'inséré",
      ops: ["Trie", "insert", "search", "startsWith"],
      args: [[], ["car"], ["cart"], ["cart"]],
      expected: [null, null, false, false],
    },
    {
      name: "branches",
      ops: ["Trie", "insert", "insert", "search", "search", "search", "startsWith"],
      args: [[], ["card"], ["care"], ["card"], ["care"], ["car"], ["car"]],
      expected: [null, null, null, true, true, false, true],
    },
    {
      name: "insertion en double",
      ops: ["Trie", "insert", "insert", "search"],
      args: [[], ["go"], ["go"], ["go"]],
      expected: [null, null, null, true],
    },
    {
      name: "une lettre",
      ops: ["Trie", "insert", "search", "search", "startsWith"],
      args: [[], ["a"], ["a"], ["b"], ["a"]],
      expected: [null, null, true, false, true],
    },
    {
      name: "préfixe = mot",
      ops: ["Trie", "insert", "startsWith", "search"],
      args: [[], ["hello"], ["hello"], ["hell"]],
      expected: [null, null, true, false],
    },
    {
      name: "mots disjoints",
      ops: ["Trie", "insert", "insert", "startsWith", "startsWith", "search"],
      args: [[], ["dog"], ["cat"], ["do"], ["ca"], ["cow"]],
      expected: [null, null, null, true, true, false],
    },
  ],
  rust: `use std::collections::HashMap;

struct Trie {
    // TODO : tes champs
}

impl Trie {
    fn new() -> Self {
        todo!()
    }
    fn insert(&mut self, word: &str) {
        todo!()
    }
    fn search(&self, word: &str) -> bool {
        todo!()
    }
    fn starts_with(&self, prefix: &str) -> bool {
        todo!()
    }
}

fn main() {
    let mut t = Trie::new();
    t.insert("apple");
    println!("{}", t.starts_with("app"));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn leetcode() {
        let mut t = Trie::new();
        t.insert("apple");
        assert!(t.search("apple"));
        assert!(!t.search("app"));
        assert!(t.starts_with("app"));
        t.insert("app");
        assert!(t.search("app"));
    }
    #[test]
    fn empty() {
        let t = Trie::new();
        assert!(!t.search("a"));
        assert!(!t.starts_with("a"));
    }
    #[test]
    fn longer_than_inserted() {
        let mut t = Trie::new();
        t.insert("car");
        assert!(!t.search("cart"));
        assert!(!t.starts_with("cart"));
    }
}
`,
});
