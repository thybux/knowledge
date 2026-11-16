import { defineChallenge } from "../../../.vitepress/theme/challenge";

const HELPERS = `// --- helpers fournis (ne pas modifier) ---
class ListNode {
  constructor(
    public val: number = 0,
    public next: ListNode | null = null,
  ) {}
}
// construit la liste ; si pos >= 0, la queue pointe vers le
// maillon d'indice pos (cycle)
function fromArray(a: number[], pos: number): ListNode | null {
  const nodes = a.map((v) => new ListNode(v));
  nodes.forEach((n, i) => (n.next = nodes[i + 1] ?? null));
  if (pos >= 0 && nodes.length) nodes[nodes.length - 1].next = nodes[pos];
  return nodes[0] ?? null;
}
// adaptateur appelé par les tests
function solve(values: number[], pos: number): boolean {
  return hasCycle(fromArray(values, pos));
}`;

const N = 5000;

export default defineChallenge({
  id: "linked-list-cycle",
  title: "Linked List Cycle",
  difficulty: "facile",
  entry: "solve",
  starter: `function hasCycle(head: ListNode | null): boolean {
  // true si la liste boucle. Vise O(1) en mémoire (pas de Set).
  return false;
}

${HELPERS}`,
  solution: `function hasCycle(head: ListNode | null): boolean {
  let slow = head;
  let fast = head;
  while (fast && fast.next) {
    slow = slow!.next; // 1 pas
    fast = fast.next.next; // 2 pas
    if (slow === fast) return true; // le lièvre a rattrapé la tortue
  }
  return false; // fast a atteint la fin : pas de cycle
}

${HELPERS}`,
  cases: [
    { args: [[3, 2, 0, -4], 1], expected: true },
    { args: [[1, 2], 0], expected: true },
    { args: [[1], -1], expected: false, name: "1 maillon sans cycle" },
    { args: [[1], 0], expected: true, name: "maillon qui pointe sur lui-même" },
    { args: [[], -1], expected: false, name: "vide" },
    { args: [[1, 2, 3, 4, 5], -1], expected: false },
    { args: [[1, 2, 3, 4, 5], 4], expected: true, name: "boucle sur la queue" },
    { args: [[1, 1, 1], -1], expected: false, name: "valeurs identiques" },
    { args: [[1, 2], -1], expected: false },
    {
      args: [Array.from({ length: N }, (_, i) => i), N / 2],
      expected: true,
      name: "5000 maillons, cycle au milieu",
    },
    {
      args: [Array.from({ length: N }, () => 0), -1],
      expected: false,
      name: "5000 maillons, sans cycle",
    },
  ],
  rust: `// En Rust, Box interdit les cycles. On représente la liste
// en "arène" : next[i] = indice du maillon suivant (ou None).
fn has_cycle(next: &[Option<usize>], head: Option<usize>) -> bool {
    // TODO : Floyd (tortue / lièvre) sur les indices
    todo!()
}

// construit next[] comme dans la version TS
fn arena(len: usize, pos: Option<usize>) -> Vec<Option<usize>> {
    let mut next: Vec<Option<usize>> =
        (0..len).map(|i| Some(i + 1).filter(|&j| j < len)).collect();
    if let Some(last) = next.last_mut() {
        *last = pos;
    }
    next
}

fn main() {
    let next = arena(4, Some(1));
    println!("{}", has_cycle(&next, Some(0)));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(len: usize, pos: Option<usize>) -> bool {
        let head = if len == 0 { None } else { Some(0) };
        has_cycle(&arena(len, pos), head)
    }
    #[test] fn cycle() { assert!(run(4, Some(1))); }
    #[test] fn self_loop() { assert!(run(1, Some(0))); }
    #[test] fn single() { assert!(!run(1, None)); }
    #[test] fn empty() { assert!(!run(0, None)); }
    #[test] fn long() { assert!(!run(5, None) && run(5, Some(4))); }
}
`,
});
