import { defineChallenge } from "../../../.vitepress/theme/challenge";

const HELPERS = `// --- helpers fournis (ne pas modifier) ---
class TreeNode {
  constructor(
    public val: number = 0,
    public left: TreeNode | null = null,
    public right: TreeNode | null = null,
  ) {}
}
// [3, 9, 20, null, null, 15, 7] (level order LeetCode) -> arbre
function buildTree(a: (number | null)[]): TreeNode | null {
  if (!a.length || a[0] === null) return null;
  const root = new TreeNode(a[0]);
  const queue = [root];
  let i = 1;
  for (let h = 0; h < queue.length && i < a.length; h++) {
    const node = queue[h];
    const l = a[i++];
    if (l != null) queue.push((node.left = new TreeNode(l)));
    const r = a[i++];
    if (r != null) queue.push((node.right = new TreeNode(r)));
  }
  return root;
}
// arbre -> tableau level order (sans les null de fin)
function toArray(root: TreeNode | null): (number | null)[] {
  const out: (number | null)[] = [];
  const queue = [root];
  for (let h = 0; h < queue.length; h++) {
    const n = queue[h];
    out.push(n ? n.val : null);
    if (n) queue.push(n.left, n.right);
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}
// adaptateur appelé par les tests
function solve(tree: (number | null)[]): boolean {
  return isValidBST(buildTree(tree));
}`;

export default defineChallenge({
  id: "validate-bst",
  title: "Validate Binary Search Tree",
  difficulty: "moyen",
  entry: "solve",
  starter: `function isValidBST(root: TreeNode | null): boolean {
  // BST strict : tout le sous-arbre gauche < nœud < tout le
  // sous-arbre droit (pas seulement les enfants directs !).
  return false;
}

${HELPERS}`,
  solution: `function isValidBST(root: TreeNode | null): boolean {
  // chaque nœud doit tenir dans l'intervalle ouvert (lo, hi)
  const go = (n: TreeNode | null, lo: number, hi: number): boolean => {
    if (!n) return true;
    if (n.val <= lo || n.val >= hi) return false;
    return go(n.left, lo, n.val) && go(n.right, n.val, hi);
  };
  return go(root, -Infinity, Infinity);
}

${HELPERS}`,
  cases: [
    { args: [[2, 1, 3]], expected: true },
    { args: [[5, 1, 4, null, null, 3, 6]], expected: false },
    { args: [[]], expected: true, name: "arbre vide" },
    { args: [[1]], expected: true, name: "racine seule" },
    { args: [[1, 1]], expected: false, name: "doublon (strict)" },
    { args: [[1, null, 1]], expected: false, name: "doublon à droite" },
    {
      args: [[5, 4, 6, null, null, 3, 7]],
      expected: false,
      name: "piège : 3 < 5 dans le sous-arbre droit",
    },
    { args: [[10, 5, 15, null, null, 6, 20]], expected: false },
    { args: [[3, 1, 5, 0, 2, 4, 6]], expected: true },
    { args: [[-2147483648]], expected: true, name: "valeur min int32" },
    { args: [[2147483647, 2147483647]], expected: false },
    { args: [[0, -1]], expected: true, name: "négatifs" },
  ],
  rust: `#[derive(Debug, PartialEq)]
struct TreeNode {
    val: i32,
    left: Tree,
    right: Tree,
}
type Tree = Option<Box<TreeNode>>;

// helpers : "[3,9,20,null,null,15,7]" (format LeetCode) <-> arbre
fn tree(s: &str) -> Tree {
    let v: Vec<Option<i32>> = s
        .trim_matches(|c| c == '[' || c == ']')
        .split(',')
        .map(str::trim)
        .filter(|x| !x.is_empty())
        .map(|x| x.parse().ok())
        .collect();
    // kids[i] = indices (dans v) des enfants de v[i]
    let mut kids = vec![(None, None); v.len()];
    let mut next = 1;
    for i in 0..v.len() {
        if v[i].is_some() {
            kids[i] = (Some(next), Some(next + 1));
            next += 2;
        }
    }
    type Kids = [(Option<usize>, Option<usize>)];
    fn go(i: Option<usize>, v: &[Option<i32>], k: &Kids) -> Tree {
        let i = i?;
        let val = (*v.get(i)?)?;
        let (left, right) = (go(k[i].0, v, k), go(k[i].1, v, k));
        Some(Box::new(TreeNode { val, left, right }))
    }
    go(Some(0), &v, &kids)
}
fn show(t: &Tree) -> String {
    let mut out: Vec<String> = vec![];
    let mut q = std::collections::VecDeque::from([t.as_deref()]);
    while let Some(n) = q.pop_front() {
        match n {
            None => out.push("null".into()),
            Some(n) => {
                out.push(n.val.to_string());
                q.push_back(n.left.as_deref());
                q.push_back(n.right.as_deref());
            }
        }
    }
    while out.last().is_some_and(|s| s == "null") {
        out.pop();
    }
    format!("[{}]", out.join(","))
}

fn is_valid_bst(root: &Tree) -> bool {
    // TODO : DFS avec bornes Option<i32> (lo, hi)
    todo!()
}

fn main() {
    println!("{}", is_valid_bst(&tree("[2,1,3]")));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn v(s: &str) -> bool { is_valid_bst(&tree(s)) }
    #[test] fn ok() { assert!(v("[2,1,3]") && v("[]") && v("[1]")); }
    #[test] fn bad() { assert!(!v("[5,1,4,null,null,3,6]")); }
    #[test] fn dup() { assert!(!v("[1,1]")); }
    #[test] fn deep() { assert!(!v("[5,4,6,null,null,3,7]")); }
    #[test] fn min() { assert!(v("[-2147483648,null,2147483647]")); }
}
`,
});
