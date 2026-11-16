import { defineChallenge } from "../../../.vitepress/theme/challenge";

const HELPERS = `// --- helpers fournis (ne pas modifier) ---
class ListNode {
  constructor(
    public val: number = 0,
    public next: ListNode | null = null,
  ) {}
}
function fromArray(a: number[]): ListNode | null {
  const dummy = new ListNode();
  let cur = dummy;
  for (const v of a) cur = cur.next = new ListNode(v);
  return dummy.next;
}
function toArray(head: ListNode | null): number[] {
  const out: number[] = [];
  for (let n = head; n && out.length < 1e5; n = n.next) out.push(n.val);
  return out;
}
// adaptateur appelé par les tests
function solve(values: number[], k: number): number[] {
  return toArray(reverseKGroup(fromArray(values), k));
}`;

export default defineChallenge({
  id: "reverse-nodes-k-group",
  title: "Reverse Nodes in k-Group",
  difficulty: "difficile",
  entry: "solve",
  starter: `function reverseKGroup(
  head: ListNode | null,
  k: number,
): ListNode | null {
  // Inverse les maillons par groupes de k (k >= 1). Un dernier
  // groupe incomplet reste dans l'ordre. O(1) mémoire.
  return head;
}

${HELPERS}`,
  solution: `function reverseKGroup(
  head: ListNode | null,
  k: number,
): ListNode | null {
  const dummy = new ListNode(0, head);
  let groupPrev = dummy; // maillon juste avant le groupe
  while (true) {
    // le k-ième maillon du groupe existe-t-il ?
    let kth: ListNode | null = groupPrev;
    for (let i = 0; i < k && kth; i++) kth = kth.next;
    if (!kth) break;
    const groupNext = kth.next;
    // inverse le groupe ; le 1er maillon pointera sur groupNext
    let prev: ListNode | null = groupNext;
    let cur = groupPrev.next;
    while (cur !== groupNext) {
      const next: ListNode | null = cur!.next;
      cur!.next = prev;
      prev = cur;
      cur = next;
    }
    const first = groupPrev.next!; // devient la queue du groupe
    groupPrev.next = kth;
    groupPrev = first;
  }
  return dummy.next;
}

${HELPERS}`,
  cases: [
    { args: [[1, 2, 3, 4, 5], 2], expected: [2, 1, 4, 3, 5] },
    { args: [[1, 2, 3, 4, 5], 3], expected: [3, 2, 1, 4, 5] },
    { args: [[1, 2, 3, 4, 5], 1], expected: [1, 2, 3, 4, 5], name: "k = 1" },
    { args: [[1, 2, 3, 4, 5], 5], expected: [5, 4, 3, 2, 1], name: "k = n" },
    { args: [[1], 1], expected: [1], name: "1 maillon" },
    { args: [[1, 2], 3], expected: [1, 2], name: "k > n" },
    { args: [[1, 2, 3, 4, 5, 6], 3], expected: [3, 2, 1, 6, 5, 4] },
    { args: [[1, 2, 3, 4], 4], expected: [4, 3, 2, 1] },
    { args: [[1, 2, 3, 4, 5, 6, 7], 3], expected: [3, 2, 1, 6, 5, 4, 7] },
    { args: [[], 2], expected: [], name: "vide" },
    {
      args: [Array.from({ length: 3000 }, (_, i) => i), 1000],
      expected: Array.from(
        { length: 3000 },
        (_, i) => Math.floor(i / 1000) * 1000 + 999 - (i % 1000),
      ),
      name: "3000 maillons, k = 1000",
    },
  ],
  rust: `#[derive(Debug, PartialEq)]
struct ListNode {
    val: i32,
    next: Option<Box<ListNode>>,
}
type List = Option<Box<ListNode>>;

// helpers : &[1, 2, 3] <-> liste
fn list(v: &[i32]) -> List {
    v.iter()
        .rev()
        .fold(None, |next, &val| Some(Box::new(ListNode { val, next })))
}
fn to_vec(mut l: &List) -> Vec<i32> {
    let mut out = vec![];
    while let Some(n) = l {
        out.push(n.val);
        l = &n.next;
    }
    out
}

fn reverse_k_group(head: List, k: usize) -> List {
    // TODO : compter k maillons, inverser, récursion sur le reste
    todo!()
}

fn main() {
    let l = reverse_k_group(list(&[1, 2, 3, 4, 5]), 2);
    println!("{:?}", to_vec(&l));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rk(v: &[i32], k: usize) -> Vec<i32> {
        to_vec(&reverse_k_group(list(v), k))
    }
    #[test] fn k2() { assert_eq!(rk(&[1, 2, 3, 4, 5], 2), vec![2, 1, 4, 3, 5]); }
    #[test] fn k3() { assert_eq!(rk(&[1, 2, 3, 4, 5], 3), vec![3, 2, 1, 4, 5]); }
    #[test] fn k1() { assert_eq!(rk(&[1, 2, 3], 1), vec![1, 2, 3]); }
    #[test] fn kn() { assert_eq!(rk(&[1, 2, 3], 3), vec![3, 2, 1]); }
    #[test] fn big_k() { assert_eq!(rk(&[1, 2], 3), vec![1, 2]); }
    #[test] fn empty() { assert_eq!(rk(&[], 2), vec![]); }
}
`,
});
