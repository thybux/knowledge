import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "eval-rpn",
  title: "Evaluate Reverse Polish Notation",
  difficulty: "moyen",
  entry: "evalRPN",
  starter: `function evalRPN(tokens: string[]): number {
  // Opérateurs : + - * /. La division tronque vers zéro.
  // L'expression est toujours valide.
  return 0;
}`,
  solution: `function evalRPN(tokens: string[]): number {
  const st: number[] = [];
  for (const tok of tokens) {
    const isOp = tok.length === 1 && "+-*/".includes(tok);
    if (!isOp) {
      st.push(Number(tok)); // nombre (y compris "-11")
      continue;
    }
    const b = st.pop()!; // b est au sommet : l'ordre compte
    const a = st.pop()!;
    if (tok === "+") st.push(a + b);
    else if (tok === "-") st.push(a - b);
    else if (tok === "*") st.push(a * b);
    else st.push(Math.trunc(a / b)); // pas Math.floor !
  }
  return st[0];
}`,
  cases: [
    { args: [["2", "1", "+", "3", "*"]], expected: 9 },
    { args: [["4", "13", "5", "/", "+"]], expected: 6 },
    {
      args: [["10", "6", "9", "3", "+", "-11", "*", "/", "*", "17", "+", "5", "+"]],
      expected: 22,
    },
    { args: [["42"]], expected: 42, name: "un seul nombre" },
    { args: [["-7"]], expected: -7, name: "nombre négatif" },
    { args: [["7", "-2", "/"]], expected: -3, name: "troncature vers 0" },
    { args: [["-6", "4", "/"]], expected: -1, name: "floor donnerait -2" },
    { args: [["3", "4", "-"]], expected: -1, name: "ordre des opérandes" },
    { args: [["0", "3", "/"]], expected: 0 },
    { args: [["2", "3", "4", "*", "+", "5", "-"]], expected: 9 },
  ],
  rust: `fn eval_rpn(tokens: &[&str]) -> i64 {
    // TODO : pile de i64 ; tok.parse::<i64>() pour les nombres
    todo!()
}

fn main() {
    println!("{}", eval_rpn(&["2", "1", "+", "3", "*"]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn basic() { assert_eq!(eval_rpn(&["2", "1", "+", "3", "*"]), 9); }
    #[test] fn div() { assert_eq!(eval_rpn(&["4", "13", "5", "/", "+"]), 6); }
    #[test] fn single() { assert_eq!(eval_rpn(&["-7"]), -7); }
    #[test] fn trunc() { assert_eq!(eval_rpn(&["-6", "4", "/"]), -1); }
    #[test] fn order() { assert_eq!(eval_rpn(&["3", "4", "-"]), -1); }
}
`,
});
