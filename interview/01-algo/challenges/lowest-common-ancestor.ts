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
function findNode(n: TreeNode | null, v: number): TreeNode | null {
  if (!n || n.val === v) return n;
  return findNode(n.left, v) ?? findNode(n.right, v);
}
// adaptateur appelé par les tests (renvoie la valeur du LCA)
function solve(tree: (number | null)[], p: number, q: number): number {
  const root = buildTree(tree);
  const a = findNode(root, p)!;
  const b = findNode(root, q)!;
  return lowestCommonAncestor(root, a, b)!.val;
}`;

const T = [3, 5, 1, 6, 2, 0, 8, null, null, 7, 4];

export default defineChallenge({
  id: "lowest-common-ancestor",
  title: "Lowest Common Ancestor",
  difficulty: "moyen",
  entry: "solve",
  starter: `function lowestCommonAncestor(
  root: TreeNode | null,
  p: TreeNode,
  q: TreeNode,
): TreeNode | null {
  // Arbre binaire quelconque (PAS un BST), valeurs uniques,
  // p et q existent. Un nœud est son propre ancêtre.
  return null;
}

${HELPERS}`,
  solution: `function lowestCommonAncestor(
  root: TreeNode | null,
  p: TreeNode,
  q: TreeNode,
): TreeNode | null {
  if (!root || root === p || root === q) return root;
  const left = lowestCommonAncestor(root.left, p, q);
  const right = lowestCommonAncestor(root.right, p, q);
  if (left && right) return root; // p et q de part et d'autre
  return left ?? right; // tout est du même côté
}

${HELPERS}`,
  cases: [
    { args: [T, 5, 1], expected: 3 },
    { args: [T, 5, 4], expected: 5, name: "p est ancêtre de q" },
    { args: [T, 6, 4], expected: 5 },
    { args: [T, 7, 8], expected: 3 },
    { args: [T, 7, 4], expected: 2 },
    { args: [[1, 2], 1, 2], expected: 1 },
    { args: [[1, 2], 2, 1], expected: 1, name: "ordre inversé" },
    { args: [[1], 1, 1], expected: 1, name: "p = q = racine" },
    { args: [[1, 2, 3, 4, 5, 6, 7], 4, 7], expected: 1 },
    { args: [[1, 2, 3, 4, 5, 6, 7], 6, 7], expected: 3 },
    { args: [[-1, 0, 3, -2, 4, null, null, 8], 8, 4], expected: 0, name: "négatifs" },
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

// renvoie la valeur du LCA (valeurs uniques, p et q présents)
fn lca(root: &Tree, p: i32, q: i32) -> Option<i32> {
    // TODO : récursion post-ordre
    todo!()
}

fn main() {
    println!("{:?}", lca(&tree("[3,5,1,6,2,0,8,null,null,7,4]"), 5, 1));
}

#[cfg(test)]
mod tests {
    use super::*;
    const T: &str = "[3,5,1,6,2,0,8,null,null,7,4]";
    #[test] fn split() { assert_eq!(lca(&tree(T), 5, 1), Some(3)); }
    #[test] fn ancestor() { assert_eq!(lca(&tree(T), 5, 4), Some(5)); }
    #[test] fn deep() { assert_eq!(lca(&tree(T), 7, 4), Some(2)); }
    #[test] fn far() { assert_eq!(lca(&tree(T), 7, 8), Some(3)); }
    #[test] fn root() { assert_eq!(lca(&tree("[1]"), 1, 1), Some(1)); }
}
`,
});
