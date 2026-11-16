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
// adaptateur appelé par les tests : aller-retour complet
function solve(tree: (number | null)[]): (number | null)[] {
  const data = serialize(buildTree(tree));
  if (typeof data !== "string") throw new Error("serialize doit renvoyer une string");
  return toArray(deserialize(data));
}`;

// arbre complet de 63 nœuds (6 niveaux)
const FULL = Array.from({ length: 63 }, (_, i) => i - 30);
// peigne de 200 nœuds : [0, null, 1, null, 2, ...] (que des fils droits)
const COMB = Array.from({ length: 399 }, (_, i) =>
  i % 2 === 0 ? i / 2 : null,
);

export default defineChallenge({
  id: "serialize-deserialize-tree",
  title: "Serialize and Deserialize Binary Tree",
  difficulty: "difficile",
  entry: "solve",
  starter: `function serialize(root: TreeNode | null): string {
  // Ton propre format ! N'utilise pas toArray/buildTree.
  return "";
}

function deserialize(data: string): TreeNode | null {
  // Doit reconstruire exactement l'arbre sérialisé.
  return null;
}

${HELPERS}`,
  solution: `// préordre, "#" pour un enfant absent : "1,2,#,#,3,#,#"
function serialize(root: TreeNode | null): string {
  const out: string[] = [];
  const go = (n: TreeNode | null) => {
    if (!n) {
      out.push("#");
      return;
    }
    out.push(String(n.val));
    go(n.left);
    go(n.right);
  };
  go(root);
  return out.join(",");
}

function deserialize(data: string): TreeNode | null {
  const tokens = data.split(",");
  let i = 0;
  // même ordre qu'à l'écriture : racine, gauche, droite
  const go = (): TreeNode | null => {
    const tok = tokens[i++];
    if (tok === "#" || tok === undefined) return null;
    const n = new TreeNode(Number(tok));
    n.left = go();
    n.right = go();
    return n;
  };
  return go();
}

${HELPERS}`,
  cases: [
    { args: [[1, 2, 3, null, null, 4, 5]], expected: [1, 2, 3, null, null, 4, 5] },
    { args: [[]], expected: [], name: "arbre vide" },
    { args: [[1]], expected: [1], name: "racine seule" },
    { args: [[-1, -2]], expected: [-1, -2], name: "négatifs" },
    { args: [[1, null, 2, null, 3]], expected: [1, null, 2, null, 3] },
    {
      args: [[5, 4, 7, 3, null, 2, null, -1, null, 9]],
      expected: [5, 4, 7, 3, null, 2, null, -1, null, 9],
    },
    { args: [[0, 0, 0]], expected: [0, 0, 0], name: "doublons / zéros" },
    { args: [[1000, -1000]], expected: [1000, -1000], name: "plusieurs chiffres" },
    { args: [[1, 12, 123]], expected: [1, 12, 123] },
    { args: [FULL], expected: FULL, name: "arbre complet de 63 nœuds" },
    { args: [COMB], expected: COMB, name: "peigne de 200 nœuds" },
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

fn serialize(root: &Tree) -> String {
    // TODO : préordre avec un marqueur pour None
    todo!()
}

fn deserialize(data: &str) -> Tree {
    // TODO : relire les jetons dans le même ordre
    todo!()
}

fn main() {
    println!("{}", serialize(&tree("[1,2,3,null,null,4,5]")));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn round_trip(s: &str) {
        let t = tree(s);
        assert_eq!(deserialize(&serialize(&t)), t, "arbre {s}");
    }
    #[test] fn basic() { round_trip("[1,2,3,null,null,4,5]"); }
    #[test] fn empty() { round_trip("[]"); }
    #[test] fn single() { round_trip("[1]"); }
    #[test] fn neg() { round_trip("[-1,-2,1000]"); }
    #[test] fn comb() { round_trip("[1,null,2,null,3]"); }
}
`,
});
