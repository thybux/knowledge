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
function solve(values: number[], n: number): number[] {
  return toArray(removeNthFromEnd(fromArray(values), n));
}`;

export default defineChallenge({
  id: "remove-nth-from-end",
  title: "Remove Nth Node From End",
  difficulty: "moyen",
  entry: "solve",
  starter: `function removeNthFromEnd(
  head: ListNode | null,
  n: number,
): ListNode | null {
  // Supprime le n-ième maillon en partant de la fin
  // (1 <= n <= longueur). Une seule passe si possible.
  return head;
}

${HELPERS}`,
  solution: `function removeNthFromEnd(
  head: ListNode | null,
  n: number,
): ListNode | null {
  const dummy = new ListNode(0, head); // gère "supprimer la tête"
  let fast: ListNode | null = dummy;
  let slow: ListNode = dummy;
  // fast prend n + 1 pas d'avance
  for (let i = 0; i <= n; i++) fast = fast!.next;
  // quand fast sort de la liste, slow est juste AVANT la cible
  while (fast) {
    fast = fast.next;
    slow = slow.next!;
  }
  slow.next = slow.next!.next;
  return dummy.next;
}

${HELPERS}`,
  cases: [
    { args: [[1, 2, 3, 4, 5], 2], expected: [1, 2, 3, 5] },
    { args: [[1], 1], expected: [], name: "seul maillon" },
    { args: [[1, 2], 1], expected: [1], name: "la queue" },
    { args: [[1, 2], 2], expected: [2], name: "la tête" },
    { args: [[1, 2, 3], 3], expected: [2, 3] },
    { args: [[1, 2, 3], 1], expected: [1, 2] },
    { args: [[5, 5, 5, 5], 2], expected: [5, 5, 5], name: "doublons" },
    { args: [[10, 20, 30, 40], 4], expected: [20, 30, 40] },
    { args: [[-1, -2, -3], 2], expected: [-1, -3], name: "négatifs" },
    {
      args: [Array.from({ length: 5000 }, (_, i) => i), 5000],
      expected: Array.from({ length: 4999 }, (_, i) => i + 1),
      name: "5000 maillons, retire la tête",
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

fn remove_nth_from_end(head: List, n: usize) -> List {
    // TODO : en Rust, le plus simple = compter puis avancer
    // depuis un dummy (deux &mut en même temps sont interdits)
    todo!()
}

fn main() {
    let l = remove_nth_from_end(list(&[1, 2, 3, 4, 5]), 2);
    println!("{:?}", to_vec(&l));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rm(v: &[i32], n: usize) -> Vec<i32> {
        to_vec(&remove_nth_from_end(list(v), n))
    }
    #[test] fn basic() { assert_eq!(rm(&[1, 2, 3, 4, 5], 2), vec![1, 2, 3, 5]); }
    #[test] fn only() { assert_eq!(rm(&[1], 1), vec![]); }
    #[test] fn tail() { assert_eq!(rm(&[1, 2], 1), vec![1]); }
    #[test] fn head() { assert_eq!(rm(&[1, 2], 2), vec![2]); }
}
`,
});
