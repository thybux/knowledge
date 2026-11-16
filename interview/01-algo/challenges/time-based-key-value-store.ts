import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "time-based-key-value-store",
  title: "Time Based Key-Value Store",
  difficulty: "moyen",
  entry: "TimeMap",
  mode: "class",
  starter: `class TimeMap {
  // set(key, value, timestamp) : timestamps strictement croissants
  // pour une même clé. get(key, timestamp) : la valeur dont le
  // timestamp est le plus grand <= timestamp, sinon "".
  constructor() {}

  set(key: string, value: string, timestamp: number): void {}

  get(key: string, timestamp: number): string {
    return "";
  }
}`,
  solution: `class TimeMap {
  private store = new Map<string, [number, string][]>();

  set(key: string, value: string, timestamp: number): void {
    let list = this.store.get(key);
    if (!list) {
      list = [];
      this.store.set(key, list);
    }
    list.push([timestamp, value]); // reste trié : ts croissants
  }

  get(key: string, timestamp: number): string {
    const list = this.store.get(key);
    if (!list) return "";
    // dernier indice dont ts <= timestamp (binary search)
    let lo = 0;
    let hi = list.length - 1;
    let ans = "";
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid][0] <= timestamp) {
        ans = list[mid][1];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }
}`,
  cases: [
    {
      name: "exemple LeetCode",
      ops: ["TimeMap", "set", "get", "get", "set", "get", "get"],
      args: [[], ["foo", "bar", 1], ["foo", 1], ["foo", 3], ["foo", "bar2", 4], ["foo", 4], ["foo", 5]],
      expected: [null, null, "bar", "bar", null, "bar2", "bar2"],
    },
    {
      name: "clé inconnue",
      ops: ["TimeMap", "get"],
      args: [[], ["x", 10]],
      expected: [null, ""],
    },
    {
      name: "avant le premier set",
      ops: ["TimeMap", "set", "get"],
      args: [[], ["k", "v", 5], ["k", 4]],
      expected: [null, null, ""],
    },
    {
      name: "timestamp exact",
      ops: ["TimeMap", "set", "set", "get"],
      args: [[], ["k", "a", 1], ["k", "b", 2], ["k", 2]],
      expected: [null, null, null, "b"],
    },
    {
      name: "entre deux versions",
      ops: ["TimeMap", "set", "set", "set", "get", "get"],
      args: [[], ["k", "a", 10], ["k", "b", 20], ["k", "c", 30], ["k", 25], ["k", 15]],
      expected: [null, null, null, null, "b", "a"],
    },
    {
      name: "plusieurs clés",
      ops: ["TimeMap", "set", "set", "get", "get"],
      args: [[], ["a", "1", 1], ["b", "2", 2], ["a", 5], ["b", 1]],
      expected: [null, null, null, "1", ""],
    },
    {
      name: "très loin dans le futur",
      ops: ["TimeMap", "set", "set", "get"],
      args: [[], ["k", "a", 1], ["k", "b", 3], ["k", 1000000]],
      expected: [null, null, null, "b"],
    },
    {
      name: "valeur vide",
      ops: ["TimeMap", "set", "set", "get", "get"],
      args: [[], ["k", "x", 1], ["k", "", 2], ["k", 2], ["k", 1]],
      expected: [null, null, null, "", "x"],
    },
    {
      name: "LeetCode 2",
      ops: ["TimeMap", "set", "set", "get", "get", "get", "get", "get"],
      args: [
        [], ["love", "high", 10], ["love", "low", 20],
        ["love", 5], ["love", 10], ["love", 15], ["love", 20], ["love", 25],
      ],
      expected: [null, null, null, "", "high", "high", "low", "low"],
    },
  ],
  rust: `use std::collections::HashMap;

struct TimeMap {
    // TODO : tes champs
}

impl TimeMap {
    fn new() -> Self {
        todo!()
    }
    fn set(&mut self, key: &str, value: &str, timestamp: u64) {
        todo!()
    }
    fn get(&self, key: &str, timestamp: u64) -> String {
        todo!()
    }
}

fn main() {
    let mut tm = TimeMap::new();
    tm.set("foo", "bar", 1);
    println!("{}", tm.get("foo", 3));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn leetcode() {
        let mut tm = TimeMap::new();
        tm.set("foo", "bar", 1);
        assert_eq!(tm.get("foo", 1), "bar");
        assert_eq!(tm.get("foo", 3), "bar");
        tm.set("foo", "bar2", 4);
        assert_eq!(tm.get("foo", 4), "bar2");
        assert_eq!(tm.get("foo", 5), "bar2");
    }
    #[test]
    fn missing() {
        let mut tm = TimeMap::new();
        assert_eq!(tm.get("x", 10), "");
        tm.set("k", "v", 5);
        assert_eq!(tm.get("k", 4), "");
    }
    #[test]
    fn between() {
        let mut tm = TimeMap::new();
        tm.set("k", "a", 10);
        tm.set("k", "b", 20);
        tm.set("k", "c", 30);
        assert_eq!(tm.get("k", 25), "b");
        assert_eq!(tm.get("k", 15), "a");
    }
}
`,
});
