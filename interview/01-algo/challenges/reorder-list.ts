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
function solve(values: number[]): number[] {
  const head = fromArray(values);
  reorderList(head);
  return toArray(head);
}`;

export default defineChallenge({
  id: "reorder-list",
  title: "Reorder List",
  difficulty: "moyen",
  entry: "solve",
  starter: `function reorderList(head: ListNode | null): void {
  // L0 -> L1 -> ... -> Ln  devient  L0 -> Ln -> L1 -> Ln-1 -> ...
  // En place, sans tableau auxiliaire (O(1) mémoire).
}

${HELPERS}`,
  solution: `function reorderList(head: ListNode | null): void {
  if (!head || !head.next) return;
  // 1. milieu (slow) avec slow/fast
  let slow: ListNode = head;
  let fast: ListNode | null = head;
  while (fast && fast.next && fast.next.next) {
    slow = slow.next!;
    fast = fast.next.next;
  }
  // 2. on coupe et on inverse la seconde moitié
  let second = slow.next;
  slow.next = null;
  let prev: ListNode | null = null;
  while (second) {
    const next: ListNode | null = second.next;
    second.next = prev;
    prev = second;
    second = next;
  }
  // 3. on entrelace : head, prev, head.next, prev.next...
  let a: ListNode | null = head;
  let b = prev;
  while (a && b) {
    const an: ListNode | null = a.next;
    const bn: ListNode | null = b.next;
    a.next = b;
    b.next = an;
    a = an;
    b = bn;
  }
}

${HELPERS}`,
  cases: [
    { args: [[1, 2, 3, 4]], expected: [1, 4, 2, 3] },
    { args: [[1, 2, 3, 4, 5]], expected: [1, 5, 2, 4, 3], name: "longueur impaire" },
    { args: [[]], expected: [], name: "vide" },
    { args: [[1]], expected: [1], name: "1 maillon" },
    { args: [[1, 2]], expected: [1, 2] },
    { args: [[1, 2, 3]], expected: [1, 3, 2] },
    { args: [[1, 1, 2, 2]], expected: [1, 2, 1, 2], name: "doublons" },
    { args: [[1, 2, 3, 4, 5, 6]], expected: [1, 6, 2, 5, 3, 4] },
    { args: [[-1, 0, 1]], expected: [-1, 1, 0], name: "négatifs" },
    {
      args: [Array.from({ length: 4000 }, (_, i) => i)],
      expected: Array.from({ length: 4000 }, (_, i) =>
        i % 2 === 0 ? i / 2 : 3999 - (i - 1) / 2,
      ),
      name: "4000 maillons",
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

fn reorder_list(head: &mut List) {
    // TODO : couper au milieu, inverser la 2e moitié, entrelacer
    todo!()
}

fn main() {
    let mut l = list(&[1, 2, 3, 4, 5]);
    reorder_list(&mut l);
    println!("{:?}", to_vec(&l));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn re(v: &[i32]) -> Vec<i32> {
        let mut l = list(v);
        reorder_list(&mut l);
        to_vec(&l)
    }
    #[test] fn even() { assert_eq!(re(&[1, 2, 3, 4]), vec![1, 4, 2, 3]); }
    #[test] fn odd() { assert_eq!(re(&[1, 2, 3, 4, 5]), vec![1, 5, 2, 4, 3]); }
    #[test] fn empty() { assert_eq!(re(&[]), vec![]); }
    #[test] fn small() { assert_eq!(re(&[1, 2]), vec![1, 2]); }
    #[test] fn three() { assert_eq!(re(&[1, 2, 3]), vec![1, 3, 2]); }
}
`,
});
