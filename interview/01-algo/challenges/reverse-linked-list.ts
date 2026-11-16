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
// adaptateur appelé par les tests : tableau -> liste -> tableau
function solve(values: number[]): number[] {
  return toArray(reverseList(fromArray(values)));
}`;

export default defineChallenge({
  id: "reverse-linked-list",
  title: "Reverse Linked List",
  difficulty: "facile",
  entry: "solve",
  starter: `function reverseList(head: ListNode | null): ListNode | null {
  // Inverse la liste en place et retourne la nouvelle tête.
  return head;
}

${HELPERS}`,
  solution: `function reverseList(head: ListNode | null): ListNode | null {
  let prev: ListNode | null = null;
  let cur = head;
  while (cur) {
    const next = cur.next; // 1. sauvegarder la suite
    cur.next = prev; // 2. retourner le maillon
    prev = cur; // 3. avancer les deux pointeurs
    cur = next;
  }
  return prev;
}

${HELPERS}`,
  cases: [
    { args: [[1, 2, 3, 4, 5]], expected: [5, 4, 3, 2, 1] },
    { args: [[1, 2]], expected: [2, 1] },
    { args: [[]], expected: [], name: "liste vide" },
    { args: [[1]], expected: [1], name: "1 maillon" },
    { args: [[1, 1, 2]], expected: [2, 1, 1], name: "doublons" },
    { args: [[-1, 0, 1]], expected: [1, 0, -1], name: "négatifs" },
    { args: [[7, 7, 7]], expected: [7, 7, 7] },
    { args: [[3, 1, 2]], expected: [2, 1, 3] },
    {
      args: [Array.from({ length: 5000 }, (_, i) => i)],
      expected: Array.from({ length: 5000 }, (_, i) => 4999 - i),
      name: "5000 maillons",
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

fn reverse_list(head: List) -> List {
    // TODO : prev / head, avec node.next.take()
    todo!()
}

fn main() {
    println!("{:?}", to_vec(&reverse_list(list(&[1, 2, 3]))));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rev(v: &[i32]) -> Vec<i32> { to_vec(&reverse_list(list(v))) }
    #[test] fn basic() { assert_eq!(rev(&[1, 2, 3, 4, 5]), vec![5, 4, 3, 2, 1]); }
    #[test] fn empty() { assert_eq!(rev(&[]), vec![]); }
    #[test] fn one() { assert_eq!(rev(&[1]), vec![1]); }
    #[test] fn two() { assert_eq!(rev(&[1, 2]), vec![2, 1]); }
}
`,
});
