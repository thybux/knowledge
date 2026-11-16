import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "rotting-oranges",
  title: "Oranges pourries",
  difficulty: "moyen",
  entry: "orangesRotting",
  starter: `function orangesRotting(grid: number[][]): number {
  // 0 = vide, 1 = orange fraîche, 2 = orange pourrie
  // Chaque minute, une pourrie contamine ses 4 voisines fraîches.
  // Retourne le nombre de minutes pour tout pourrir, ou -1.
  return -1;
}`,
  solution: `function orangesRotting(grid: number[][]): number {
  const R = grid.length, C = R ? grid[0].length : 0;
  let queue: number[][] = [];
  let fresh = 0;
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      if (grid[r][c] === 2) queue.push([r, c]);
      else if (grid[r][c] === 1) fresh++;
    }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let minutes = 0;
  // BFS multi-source, niveau par niveau (1 niveau = 1 minute)
  while (queue.length && fresh > 0) {
    const next: number[][] = [];
    for (const [r, c] of queue)
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= R || nc >= C) continue;
        if (grid[nr][nc] !== 1) continue;
        grid[nr][nc] = 2;
        fresh--;
        next.push([nr, nc]);
      }
    queue = next;
    minutes++;
  }
  return fresh === 0 ? minutes : -1;
}`,
  cases: [
    { args: [[[2, 1, 1], [1, 1, 0], [0, 1, 1]]], expected: 4 },
    { args: [[[2, 1, 1], [0, 1, 1], [1, 0, 1]]], expected: -1, name: "orange isolée" },
    { args: [[[0, 2]]], expected: 0, name: "aucune fraîche" },
    { args: [[[0]]], expected: 0, name: "que du vide" },
    { args: [[[1]]], expected: -1, name: "fraîche sans source" },
    { args: [[[2]]], expected: 0 },
    { args: [[[2, 1, 1, 1, 1]]], expected: 4, name: "ligne" },
    { args: [[[2, 1, 1, 1, 2]]], expected: 2, name: "deux sources" },
    { args: [[[1, 1, 1], [1, 2, 1], [1, 1, 1]]], expected: 2, name: "source au centre" },
    { args: [[[2, 0, 1]]], expected: -1, name: "bloquée par du vide" },
  ],
  rust: `use std::collections::VecDeque;

fn oranges_rotting(mut grid: Vec<Vec<u8>>) -> i32 {
    // TODO : BFS multi-source
    todo!()
}

fn main() {
    let g = vec![vec![2, 1, 1], vec![1, 1, 0], vec![0, 1, 1]];
    println!("{}", oranges_rotting(g));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn four() {
        let g = vec![vec![2, 1, 1], vec![1, 1, 0], vec![0, 1, 1]];
        assert_eq!(oranges_rotting(g), 4);
    }
    #[test]
    fn impossible() {
        let g = vec![vec![2, 1, 1], vec![0, 1, 1], vec![1, 0, 1]];
        assert_eq!(oranges_rotting(g), -1);
    }
    #[test]
    fn none_fresh() { assert_eq!(oranges_rotting(vec![vec![0, 2]]), 0); }
    #[test]
    fn two_sources() {
        assert_eq!(oranges_rotting(vec![vec![2, 1, 1, 1, 2]]), 2);
    }
}
`,
});
