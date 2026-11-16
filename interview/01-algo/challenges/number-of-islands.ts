import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "number-of-islands",
  title: "Nombre d'îles",
  difficulty: "facile",
  entry: "numIslands",
  starter: `function numIslands(grid: string[]): number {
  // grid[r][c] vaut "1" (terre) ou "0" (eau)
  // Une île = cellules "1" connectées en haut/bas/gauche/droite
  return 0;
}`,
  solution: `function numIslands(grid: string[]): number {
  const R = grid.length;
  if (R === 0) return 0;
  const C = grid[0].length;
  const seen = Array.from({ length: R }, () => new Array(C).fill(false));
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let count = 0;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (grid[r][c] !== "1" || seen[r][c]) continue;
      count++;
      // DFS itératif (pile) : pas de stack overflow sur grande grille
      const stack = [[r, c]];
      seen[r][c] = true;
      while (stack.length) {
        const [cr, cc] = stack.pop()!;
        for (const [dr, dc] of dirs) {
          const nr = cr + dr, nc = cc + dc;
          if (nr < 0 || nc < 0 || nr >= R || nc >= C) continue;
          if (grid[nr][nc] !== "1" || seen[nr][nc]) continue;
          seen[nr][nc] = true;
          stack.push([nr, nc]);
        }
      }
    }
  }
  return count;
}`,
  cases: [
    { args: [["11110", "11010", "11000", "00000"]], expected: 1 },
    { args: [["11000", "11000", "00100", "00011"]], expected: 3 },
    { args: [[]], expected: 0, name: "grille vide" },
    { args: [["0"]], expected: 0, name: "1 case d'eau" },
    { args: [["1"]], expected: 1, name: "1 case de terre" },
    { args: [["101", "010", "101"]], expected: 5, name: "diagonales ≠ connexes" },
    { args: [["111", "101", "111"]], expected: 1, name: "anneau" },
    { args: [["10101"]], expected: 3, name: "une seule ligne" },
    { args: [["1", "0", "1", "1"]], expected: 2, name: "une seule colonne" },
    { args: [["0000", "0000"]], expected: 0, name: "que de l'eau" },
    { args: [["1".repeat(200)].concat(Array(199).fill("1".repeat(200)))], expected: 1, name: "200x200 plein (récursion profonde)" },
  ],
  rust: `fn num_islands(grid: &[&str]) -> usize {
    // TODO : DFS/BFS sur la grille
    todo!()
}

fn main() {
    println!("{}", num_islands(&["11000", "11000", "00100", "00011"]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn one() {
        assert_eq!(num_islands(&["11110", "11010", "11000", "00000"]), 1);
    }
    #[test]
    fn three() {
        assert_eq!(num_islands(&["11000", "11000", "00100", "00011"]), 3);
    }
    #[test]
    fn empty() { assert_eq!(num_islands(&[]), 0); }
    #[test]
    fn diag() { assert_eq!(num_islands(&["101", "010", "101"]), 5); }
}
`,
});
