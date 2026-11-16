import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "redundant-connection",
  title: "Connexion redondante",
  difficulty: "moyen",
  entry: "findRedundantConnection",
  starter: `function findRedundantConnection(edges: number[][]): number[] {
  // n nœuds (1..n), n arêtes non orientées : un arbre + 1 arête
  // en trop. Retourne l'arête à retirer (la dernière de la liste
  // si plusieurs conviennent).
  return [];
}`,
  solution: `function findRedundantConnection(edges: number[][]): number[] {
  const parent = Array.from({ length: edges.length + 1 }, (_, i) => i);
  const rank = new Array(edges.length + 1).fill(0);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path halving
      x = parent[x];
    }
    return x;
  };
  for (const [a, b] of edges) {
    let ra = find(a), rb = find(b);
    if (ra === rb) return [a, b]; // déjà connectés : cycle
    if (rank[ra] < rank[rb]) [ra, rb] = [rb, ra];
    parent[rb] = ra;
    if (rank[ra] === rank[rb]) rank[ra]++;
  }
  return [];
}`,
  cases: [
    { args: [[[1, 2], [1, 3], [2, 3]]], expected: [2, 3] },
    { args: [[[1, 2], [2, 3], [3, 4], [1, 4], [1, 5]]], expected: [1, 4] },
    { args: [[[1, 2], [1, 2]]], expected: [1, 2], name: "arête en double" },
    { args: [[[1, 2], [2, 3], [3, 1]]], expected: [3, 1], name: "triangle" },
    { args: [[[3, 4], [1, 2], [2, 4], [3, 5], [2, 5]]], expected: [2, 5] },
    { args: [[[1, 4], [3, 4], [1, 3], [1, 2], [4, 5]]], expected: [1, 3] },
    { args: [[[2, 1], [3, 1], [4, 2], [1, 4]]], expected: [1, 4], name: "ordre inversé" },
    { args: [[[1, 5], [3, 4], [3, 5], [4, 5], [2, 4]]], expected: [4, 5] },
    {
      args: [[[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 1]]],
      expected: [6, 1],
      name: "grand cycle",
    },
  ],
  rust: `struct Dsu {
    parent: Vec<usize>,
    rank: Vec<u8>,
}

impl Dsu {
    fn new(n: usize) -> Self {
        Dsu { parent: (0..n).collect(), rank: vec![0; n] }
    }
    fn find(&mut self, x: usize) -> usize {
        todo!()
    }
    /// Retourne false si a et b étaient déjà connectés.
    fn union(&mut self, a: usize, b: usize) -> bool {
        todo!()
    }
}

fn find_redundant_connection(edges: &[(usize, usize)]) -> (usize, usize) {
    todo!()
}

fn main() {
    println!("{:?}", find_redundant_connection(&[(1, 2), (1, 3), (2, 3)]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn triangle() {
        let e = [(1, 2), (1, 3), (2, 3)];
        assert_eq!(find_redundant_connection(&e), (2, 3));
    }
    #[test]
    fn square() {
        let e = [(1, 2), (2, 3), (3, 4), (1, 4), (1, 5)];
        assert_eq!(find_redundant_connection(&e), (1, 4));
    }
    #[test]
    fn dup() {
        assert_eq!(find_redundant_connection(&[(1, 2), (1, 2)]), (1, 2));
    }
}
`,
});
