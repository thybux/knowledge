import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "min-stack",
  title: "Min Stack",
  difficulty: "facile",
  entry: "MinStack",
  mode: "class",
  starter: `class MinStack {
  // push, pop, top et getMin en O(1).
  // pop/top/getMin ne sont jamais appelés sur une pile vide.
  constructor() {}

  push(val: number): void {}

  pop(): void {}

  top(): number {
    return 0;
  }

  getMin(): number {
    return 0;
  }
}`,
  solution: `class MinStack {
  // chaque entrée garde le min de la pile jusqu'à elle
  private items: [number, number][] = [];

  push(val: number): void {
    const n = this.items.length;
    const min = n ? Math.min(val, this.items[n - 1][1]) : val;
    this.items.push([val, min]);
  }

  pop(): void {
    this.items.pop();
  }

  top(): number {
    return this.items[this.items.length - 1][0];
  }

  getMin(): number {
    return this.items[this.items.length - 1][1];
  }
}`,
  cases: [
    {
      name: "exemple LeetCode",
      ops: ["MinStack", "push", "push", "push", "getMin", "pop", "top", "getMin"],
      args: [[], [-2], [0], [-3], [], [], [], []],
      expected: [null, null, null, null, -3, null, 0, -2],
    },
    {
      name: "un seul élément",
      ops: ["MinStack", "push", "top", "getMin"],
      args: [[], [5], [], []],
      expected: [null, null, 5, 5],
    },
    {
      name: "doublons du minimum",
      ops: ["MinStack", "push", "push", "push", "pop", "getMin", "pop", "getMin"],
      args: [[], [1], [1], [2], [], [], [], []],
      expected: [null, null, null, null, null, 1, null, 1],
    },
    {
      name: "valeurs croissantes",
      ops: ["MinStack", "push", "push", "push", "getMin", "top"],
      args: [[], [1], [2], [3], [], []],
      expected: [null, null, null, null, 1, 3],
    },
    {
      name: "valeurs décroissantes puis pops",
      ops: ["MinStack", "push", "push", "push", "getMin", "pop", "getMin", "pop", "getMin"],
      args: [[], [3], [2], [1], [], [], [], [], []],
      expected: [null, null, null, null, 1, null, 2, null, 3],
    },
    {
      name: "vider puis réutiliser",
      ops: ["MinStack", "push", "pop", "push", "getMin"],
      args: [[], [-1], [], [7], []],
      expected: [null, null, null, null, 7],
    },
    {
      name: "négatifs",
      ops: ["MinStack", "push", "push", "getMin", "push", "getMin", "pop", "getMin"],
      args: [[], [-5], [-10], [], [-1], [], [], []],
      expected: [null, null, null, -10, null, -10, null, -10],
    },
    {
      name: "min qui remonte",
      ops: ["MinStack", "push", "push", "push", "push", "pop", "pop", "getMin", "top"],
      args: [[], [4], [0], [6], [-2], [], [], [], []],
      expected: [null, null, null, null, null, null, null, 0, 0],
    },
  ],
  rust: `struct MinStack {
    // TODO : tes champs
}

impl MinStack {
    fn new() -> Self {
        todo!()
    }
    fn push(&mut self, val: i32) {
        todo!()
    }
    fn pop(&mut self) {
        todo!()
    }
    fn top(&self) -> i32 {
        todo!()
    }
    fn get_min(&self) -> i32 {
        todo!()
    }
}

fn main() {
    let mut s = MinStack::new();
    s.push(-2);
    s.push(0);
    println!("{}", s.get_min());
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn leetcode() {
        let mut s = MinStack::new();
        s.push(-2);
        s.push(0);
        s.push(-3);
        assert_eq!(s.get_min(), -3);
        s.pop();
        assert_eq!(s.top(), 0);
        assert_eq!(s.get_min(), -2);
    }
    #[test]
    fn duplicates() {
        let mut s = MinStack::new();
        s.push(1);
        s.push(1);
        s.pop();
        assert_eq!(s.get_min(), 1);
    }
}
`,
});
