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
function solve(tree: (number | null)[]): (number | null)[] {
  return toArray(invertTree(buildTree(tree)));
}`;

export default defineChallenge({
  id: "invert-binary-tree",
  title: "Invert Binary Tree",
  difficulty: "facile",
  entry: "solve",
  starter: `function invertTree(root: TreeNode | null): TreeNode | null {
  // Miroir : échange gauche et droite à tous les niveaux.
  return root;
}

${HELPERS}`,
  solution: `function invertTree(root: TreeNode | null): TreeNode | null {
  if (!root) return null;
  const left = root.left;
  root.left = invertTree(root.right);
  root.right = invertTree(left);
  return root;
}

${HELPERS}`,
  cases: [
    { args: [[4, 2, 7, 1, 3, 6, 9]], expected: [4, 7, 2, 9, 6, 3, 1] },
    { args: [[2, 1, 3]], expected: [2, 3, 1] },
    { args: [[]], expected: [], name: "arbre vide" },
    { args: [[1]], expected: [1], name: "racine seule" },
    { args: [[1, 2]], expected: [1, null, 2], name: "un enfant gauche" },
    { args: [[1, null, 2]], expected: [1, 2], name: "un enfant droit" },
    { args: [[1, 2, 3, 4]], expected: [1, 3, 2, null, null, null, 4] },
    { args: [[5, 5, 5]], expected: [5, 5, 5], name: "doublons" },
    { args: [[-1, -2, -3, -4, -5]], expected: [-1, -3, -2, null, null, -5, -4] },
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

fn invert_tree(root: Tree) -> Tree {
    // TODO : root.map(|mut n| ...) + take() sur les enfants
    todo!()
}

fn main() {
    println!("{}", show(&invert_tree(tree("[4,2,7,1,3,6,9]"))));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn inv(s: &str) -> String { show(&invert_tree(tree(s))) }
    #[test] fn basic() { assert_eq!(inv("[4,2,7,1,3,6,9]"), "[4,7,2,9,6,3,1]"); }
    #[test] fn empty() { assert_eq!(inv("[]"), "[]"); }
    #[test] fn left() { assert_eq!(inv("[1,2]"), "[1,null,2]"); }
    #[test] fn uneven() { assert_eq!(inv("[1,2,3,4]"), "[1,3,2,null,null,null,4]"); }
}
`,
});
