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
function solve(tree: (number | null)[]): number[][] {
  return levelOrder(buildTree(tree));
}`;

export default defineChallenge({
  id: "level-order-traversal",
  title: "Binary Tree Level Order Traversal",
  difficulty: "moyen",
  entry: "solve",
  starter: `function levelOrder(root: TreeNode | null): number[][] {
  // Valeurs niveau par niveau, de gauche à droite.
  return [];
}

${HELPERS}`,
  solution: `function levelOrder(root: TreeNode | null): number[][] {
  const out: number[][] = [];
  let level = root ? [root] : [];
  while (level.length) {
    out.push(level.map((n) => n.val));
    // le niveau suivant = tous les enfants du niveau courant
    const next: TreeNode[] = [];
    for (const n of level) {
      if (n.left) next.push(n.left);
      if (n.right) next.push(n.right);
    }
    level = next;
  }
  return out;
}

${HELPERS}`,
  cases: [
    { args: [[3, 9, 20, null, null, 15, 7]], expected: [[3], [9, 20], [15, 7]] },
    { args: [[1]], expected: [[1]], name: "racine seule" },
    { args: [[]], expected: [], name: "arbre vide" },
    { args: [[1, 2, 3, 4, 5, 6, 7]], expected: [[1], [2, 3], [4, 5, 6, 7]] },
    { args: [[1, null, 2, null, 3]], expected: [[1], [2], [3]], name: "peigne" },
    { args: [[1, 2, null, 3, null, 4]], expected: [[1], [2], [3], [4]] },
    { args: [[0, -1, 1]], expected: [[0], [-1, 1]], name: "négatifs" },
    { args: [[1, 2, 3, null, 4, null, 5]], expected: [[1], [2, 3], [4, 5]] },
    { args: [[7, 7, 7, 7]], expected: [[7], [7, 7], [7]], name: "doublons" },
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

use std::collections::VecDeque;

fn level_order(root: &Tree) -> Vec<Vec<i32>> {
    // TODO : VecDeque<&TreeNode>, un niveau = q.len() éléments
    todo!()
}

fn main() {
    println!("{:?}", level_order(&tree("[3,9,20,null,null,15,7]")));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn lo(s: &str) -> Vec<Vec<i32>> { level_order(&tree(s)) }
    #[test]
    fn basic() {
        let want = vec![vec![3], vec![9, 20], vec![15, 7]];
        assert_eq!(lo("[3,9,20,null,null,15,7]"), want);
    }
    #[test]
    fn empty() { assert!(lo("[]").is_empty()); }
    #[test]
    fn comb() { assert_eq!(lo("[1,null,2,null,3]"), vec![vec![1], vec![2], vec![3]]); }
    #[test]
    fn gaps() {
        assert_eq!(lo("[1,2,3,null,4,null,5]"), vec![vec![1], vec![2, 3], vec![4, 5]]);
    }
}
`,
});
