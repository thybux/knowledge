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
function solve(a: number[], b: number[]): number[] {
  return toArray(mergeTwoLists(fromArray(a), fromArray(b)));
}`;

export default defineChallenge({
  id: "merge-two-sorted-lists",
  title: "Merge Two Sorted Lists",
  difficulty: "facile",
  entry: "solve",
  starter: `function mergeTwoLists(
  a: ListNode | null,
  b: ListNode | null,
): ListNode | null {
  // Fusionne deux listes triées en réutilisant leurs maillons.
  return null;
}

${HELPERS}`,
  solution: `function mergeTwoLists(
  a: ListNode | null,
  b: ListNode | null,
): ListNode | null {
  const dummy = new ListNode(); // évite le cas "tête vide"
  let tail = dummy;
  while (a && b) {
    if (a.val <= b.val) {
      tail.next = a;
      a = a.next;
    } else {
      tail.next = b;
      b = b.next;
    }
    tail = tail.next;
  }
  tail.next = a ?? b; // le reste est déjà trié
  return dummy.next;
}

${HELPERS}`,
  cases: [
    { args: [[1, 2, 4], [1, 3, 4]], expected: [1, 1, 2, 3, 4, 4] },
    { args: [[], []], expected: [], name: "deux vides" },
    { args: [[], [0]], expected: [0], name: "a vide" },
    { args: [[5], []], expected: [5], name: "b vide" },
    { args: [[1, 2, 3], [4, 5, 6]], expected: [1, 2, 3, 4, 5, 6] },
    { args: [[4, 5, 6], [1, 2, 3]], expected: [1, 2, 3, 4, 5, 6] },
    { args: [[-3, -1], [-2, 0]], expected: [-3, -2, -1, 0], name: "négatifs" },
    { args: [[1, 1], [1, 1]], expected: [1, 1, 1, 1], name: "doublons" },
    { args: [[2], [1]], expected: [1, 2] },
    {
      args: [
        Array.from({ length: 3000 }, (_, i) => 2 * i),
        Array.from({ length: 3000 }, (_, i) => 2 * i + 1),
      ],
      expected: Array.from({ length: 6000 }, (_, i) => i),
      name: "6000 maillons",
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

fn merge_two_lists(a: List, b: List) -> List {
    // TODO : un dummy + un pointeur &mut sur la queue
    todo!()
}

fn main() {
    let m = merge_two_lists(list(&[1, 2, 4]), list(&[1, 3, 4]));
    println!("{:?}", to_vec(&m));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn merge(a: &[i32], b: &[i32]) -> Vec<i32> {
        to_vec(&merge_two_lists(list(a), list(b)))
    }
    #[test]
    fn basic() { assert_eq!(merge(&[1, 2, 4], &[1, 3, 4]), vec![1, 1, 2, 3, 4, 4]); }
    #[test]
    fn empty() { assert_eq!(merge(&[], &[]), vec![]); }
    #[test]
    fn one_empty() { assert_eq!(merge(&[], &[0]), vec![0]); }
    #[test]
    fn after() { assert_eq!(merge(&[4, 5], &[1, 2]), vec![1, 2, 4, 5]); }
}
`,
});
