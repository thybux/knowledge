import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "word-search",
  title: "Word Search",
  difficulty: "moyen",
  entry: "exist",
  starter: `function exist(board: string[][], word: string): boolean {
  // Le mot se forme avec des cases adjacentes (haut/bas/gauche/droite),
  // chaque case utilisée au plus une fois.
  return false;
}`,
  solution: `function exist(board: string[][], word: string): boolean {
  const R = board.length;
  const C = R ? board[0].length : 0;
  const dfs = (r: number, c: number, i: number): boolean => {
    if (i === word.length) return true;
    if (r < 0 || c < 0 || r >= R || c >= C) return false;
    if (board[r][c] !== word[i]) return false;
    const saved = board[r][c];
    board[r][c] = "#"; // marque "visite" sur le chemin courant
    const found =
      dfs(r + 1, c, i + 1) || dfs(r - 1, c, i + 1) ||
      dfs(r, c + 1, i + 1) || dfs(r, c - 1, i + 1);
    board[r][c] = saved; // backtrack
    return found;
  };
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (dfs(r, c, 0)) return true;
    }
  }
  return false;
}`,
  cases: [
    { args: [[["A","B","C","E"],["S","F","C","S"],["A","D","E","E"]], "ABCCED"], expected: true },
    { args: [[["A","B","C","E"],["S","F","C","S"],["A","D","E","E"]], "SEE"], expected: true },
    { args: [[["A","B","C","E"],["S","F","C","S"],["A","D","E","E"]], "ABCB"], expected: false, name: "case réutilisée interdite" },
    { args: [[["A"]], "A"], expected: true, name: "1x1" },
    { args: [[["A"]], "B"], expected: false },
    { args: [[["A","B"]], "ABA"], expected: false, name: "mot plus long que possible" },
    { args: [[["A","B"],["C","D"]], "ABDC"], expected: true, name: "tour en U" },
    { args: [[["A","B"],["C","D"]], "AD"], expected: false, name: "pas de diagonale" },
    { args: [[["C","A","A"],["A","A","A"],["B","C","D"]], "AAB"], expected: true },
    { args: [[["A","A","A","A"],["A","A","A","A"],["A","A","A","A"]], "AAAAAAAAAAAAB"], expected: false, name: "pire cas" },
  ],
  rust: `fn exist(board: &mut Vec<Vec<u8>>, word: &str) -> bool {
    // TODO : DFS depuis chaque case + marquage temporaire
    todo!()
}

fn grid(rows: &[&str]) -> Vec<Vec<u8>> {
    rows.iter().map(|r| r.bytes().collect()).collect()
}

fn main() {
    let mut b = grid(&["ABCE", "SFCS", "ADEE"]);
    println!("{}", exist(&mut b, "ABCCED"));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn found() {
        assert!(exist(&mut grid(&["ABCE", "SFCS", "ADEE"]), "ABCCED"));
        assert!(exist(&mut grid(&["ABCE", "SFCS", "ADEE"]), "SEE"));
    }
    #[test] fn reuse() {
        assert!(!exist(&mut grid(&["ABCE", "SFCS", "ADEE"]), "ABCB"));
    }
    #[test] fn diag() { assert!(!exist(&mut grid(&["AB", "CD"]), "AD")); }
}
`,
});
