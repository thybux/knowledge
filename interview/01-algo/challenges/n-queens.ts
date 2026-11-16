import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "n-queens",
  title: "N-Queens (compter)",
  difficulty: "difficile",
  entry: "totalNQueens",
  starter: `function totalNQueens(n: number): number {
  // Nombre de façons de placer n reines sur un échiquier n x n
  // sans qu'aucune ne s'attaque.
  return 0;
}`,
  solution: `function totalNQueens(n: number): number {
  const cols = new Set<number>();
  const diag = new Set<number>(); // r - c constant
  const anti = new Set<number>(); // r + c constant
  let count = 0;
  const place = (r: number) => {
    if (r === n) {
      count++;
      return;
    }
    for (let c = 0; c < n; c++) {
      if (cols.has(c) || diag.has(r - c) || anti.has(r + c)) continue;
      cols.add(c); diag.add(r - c); anti.add(r + c);
      place(r + 1);
      cols.delete(c); diag.delete(r - c); anti.delete(r + c);
    }
  };
  place(0);
  return count;
}`,
  cases: [
    { args: [1], expected: 1 },
    { args: [2], expected: 0, name: "impossible" },
    { args: [3], expected: 0, name: "impossible" },
    { args: [4], expected: 2 },
    { args: [5], expected: 10 },
    { args: [6], expected: 4 },
    { args: [7], expected: 40 },
    { args: [8], expected: 92 },
    { args: [9], expected: 352 },
    { args: [10], expected: 724, name: "perf" },
  ],
  rust: `fn total_n_queens(n: usize) -> u32 {
    // TODO : une reine par ligne, colonnes + diagonales occupées
    todo!()
}

fn main() {
    println!("{}", total_n_queens(8));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn small() {
        assert_eq!(total_n_queens(1), 1);
        assert_eq!(total_n_queens(2), 0);
        assert_eq!(total_n_queens(4), 2);
    }
    #[test] fn eight() { assert_eq!(total_n_queens(8), 92); }
}
`,
});
