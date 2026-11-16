import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "lru-cache",
  title: "LRU Cache",
  difficulty: "moyen",
  entry: "LRUCache",
  mode: "class",
  starter: `class LRUCache {
  // get(key) : valeur ou -1. put(key, value) : insère/met à jour,
  // et évince la clé la moins récemment utilisée si on dépasse
  // la capacité. get ET put comptent comme une utilisation.
  // Objectif : O(1) pour les deux.
  constructor(capacity: number) {}

  get(key: number): number {
    return -1;
  }

  put(key: number, value: number): void {}
}`,
  solution: `class LRUCache {
  // Une Map JS garde l'ordre d'insertion : la 1re clé est la
  // plus ancienne. delete + set = "déplacer en fin".
  private map = new Map<number, number>();
  constructor(private capacity: number) {}

  get(key: number): number {
    const v = this.map.get(key);
    if (v === undefined) return -1;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  put(key: number, value: number): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value!;
      this.map.delete(oldest);
    }
  }
}`,
  cases: [
    {
      name: "exemple LeetCode",
      ops: ["LRUCache", "put", "put", "get", "put", "get", "put", "get", "get", "get"],
      args: [[2], [1, 1], [2, 2], [1], [3, 3], [2], [4, 4], [1], [3], [4]],
      expected: [null, null, null, 1, null, -1, null, -1, 3, 4],
    },
    {
      name: "capacité 1",
      ops: ["LRUCache", "put", "get", "put", "get", "get"],
      args: [[1], [1, 1], [1], [2, 2], [1], [2]],
      expected: [null, null, 1, null, -1, 2],
    },
    {
      name: "get sur cache vide",
      ops: ["LRUCache", "get"],
      args: [[2], [42]],
      expected: [null, -1],
    },
    {
      name: "mise à jour d'une clé = utilisation",
      ops: ["LRUCache", "put", "put", "put", "put", "get", "get", "get"],
      args: [[2], [1, 1], [2, 2], [1, 10], [3, 3], [1], [2], [3]],
      expected: [null, null, null, null, null, 10, -1, 3],
    },
    {
      name: "mise à jour sans éviction",
      ops: ["LRUCache", "put", "put", "get"],
      args: [[2], [2, 1], [2, 2], [2]],
      expected: [null, null, null, 2],
    },
    {
      name: "get rafraîchit",
      ops: ["LRUCache", "put", "put", "get", "put", "get", "get"],
      args: [[2], [1, 1], [2, 2], [1], [3, 3], [1], [2]],
      expected: [null, null, null, 1, null, 1, -1],
    },
    {
      name: "valeur 0",
      ops: ["LRUCache", "put", "get"],
      args: [[1], [5, 0], [5]],
      expected: [null, null, 0],
    },
    {
      name: "LeetCode piège",
      ops: ["LRUCache", "put", "put", "put", "put", "get", "get"],
      args: [[2], [2, 1], [1, 1], [2, 3], [4, 1], [1], [2]],
      expected: [null, null, null, null, null, -1, 3],
    },
    {
      name: "capacité 3, rotation",
      ops: ["LRUCache", "put", "put", "put", "get", "put", "get", "get", "get", "get"],
      args: [[3], [1, 1], [2, 2], [3, 3], [1], [4, 4], [2], [3], [1], [4]],
      expected: [null, null, null, null, 1, null, -1, 3, 1, 4],
    },
  ],
  rust: `use std::collections::HashMap;

struct LRUCache {
    // TODO : tes champs (vise O(1) pour get et put)
}

impl LRUCache {
    fn new(capacity: usize) -> Self {
        todo!()
    }
    fn get(&mut self, key: i32) -> i32 {
        todo!()
    }
    fn put(&mut self, key: i32, value: i32) {
        todo!()
    }
}

fn main() {
    let mut c = LRUCache::new(2);
    c.put(1, 1);
    println!("{}", c.get(1));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn leetcode() {
        let mut c = LRUCache::new(2);
        c.put(1, 1);
        c.put(2, 2);
        assert_eq!(c.get(1), 1);
        c.put(3, 3);
        assert_eq!(c.get(2), -1);
        c.put(4, 4);
        assert_eq!(c.get(1), -1);
        assert_eq!(c.get(3), 3);
        assert_eq!(c.get(4), 4);
    }
    #[test]
    fn capacity_one() {
        let mut c = LRUCache::new(1);
        c.put(1, 1);
        c.put(2, 2);
        assert_eq!(c.get(1), -1);
        assert_eq!(c.get(2), 2);
    }
    #[test]
    fn update_counts_as_use() {
        let mut c = LRUCache::new(2);
        c.put(1, 1);
        c.put(2, 2);
        c.put(1, 10);
        c.put(3, 3);
        assert_eq!(c.get(1), 10);
        assert_eq!(c.get(2), -1);
    }
}
`,
});
