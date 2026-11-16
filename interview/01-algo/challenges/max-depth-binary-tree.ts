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
function solve(tree: (number | null)[]): number {
  return maxDepth(buildTree(tree));
}`;

// arbre "peigne" de 500 nœuds : [1, null, 2, null, 3, ...]
const CHAIN = Array.from({ length: 999 }, (_, i) =>
  i % 2 === 0 ? i / 2 + 1 : null,
);

export default defineChallenge({
  id: "max-depth-binary-tree",
  title: "Maximum Depth of Binary Tree",
  difficulty: "facile",
  entry: "solve",
  starter: `function maxDepth(root: TreeNode | null): number {
  // Nombre de nœuds sur le plus long chemin racine -> feuille.
  return 0;
}

${HELPERS}`,
  solution: `function maxDepth(root: TreeNode | null): number {
  if (!root) return 0;
  return 1 + Math.max(maxDepth(root.left), maxDepth(root.right));
}

${HELPERS}`,
  cases: [
    { args: [[3, 9, 20, null, null, 15, 7]], expected: 3 },
    { args: [[1, null, 2]], expected: 2 },
    { args: [[]], expected: 0, name: "arbre vide" },
    { args: [[0]], expected: 1, name: "racine seule" },
    { args: [[1, 2, 3, 4, 5]], expected: 3 },
    { args: [[1, 2, null, 3, null, 4, null, 5]], expected: 5, name: "penché à gauche" },
    { args: [[1, 2, 3]], expected: 2 },
    { args: [[-1, -2, -3, null, -4]], expected: 3, name: "négatifs" },
    { args: [[1, 1, 1, 1, 1, 1, 1]], expected: 3, name: "doublons" },
    { args: [CHAIN], expected: 500, name: "peigne de 500 nœuds" },
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

fn max_depth(root: &Tree) -> usize {
    // TODO : récursion, match sur None / Some(n)
    todo!()
}

fn main() {
    println!("{}", max_depth(&tree("[3,9,20,null,null,15,7]")));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn d(s: &str) -> usize { max_depth(&tree(s)) }
    #[test] fn basic() { assert_eq!(d("[3,9,20,null,null,15,7]"), 3); }
    #[test] fn right() { assert_eq!(d("[1,null,2]"), 2); }
    #[test] fn empty() { assert_eq!(d("[]"), 0); }
    #[test] fn root() { assert_eq!(d("[0]"), 1); }
    #[test] fn left() { assert_eq!(d("[1,2,null,3,null,4,null,5]"), 5); }
}
`,
});
