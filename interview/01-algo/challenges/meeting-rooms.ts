import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "meeting-rooms",
  title: "Meeting Rooms",
  difficulty: "facile",
  entry: "canAttendMeetings",
  starter: `function canAttendMeetings(intervals: number[][]): boolean {
  // intervals[i] = [debut, fin) ; une réunion qui finit à 10
  // et une autre qui commence à 10 ne se chevauchent PAS.
  return false;
}`,
  solution: `function canAttendMeetings(intervals: number[][]): boolean {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][0] < sorted[i - 1][1]) return false;
  }
  return true;
}`,
  cases: [
    { args: [[[0, 30], [5, 10], [15, 20]]], expected: false },
    { args: [[[7, 10], [2, 4]]], expected: true },
    { args: [[]], expected: true, name: "aucune réunion" },
    { args: [[[1, 5]]], expected: true, name: "une seule" },
    { args: [[[1, 2], [2, 3]]], expected: true, name: "bord à bord" },
    { args: [[[1, 3], [2, 4]]], expected: false },
    { args: [[[5, 8], [1, 3], [3, 5]]], expected: true, name: "non trié" },
    { args: [[[1, 10], [2, 3], [11, 12]]], expected: false, name: "inclus" },
    { args: [[[1, 4], [1, 4]]], expected: false, name: "identiques" },
    { args: [[[9, 10], [4, 9], [4, 5]]], expected: false },
  ],
  rust: `fn can_attend_meetings(intervals: &[[i32; 2]]) -> bool {
    // TODO : ton code ici
    todo!()
}

fn main() {
    println!("{}", can_attend_meetings(&[[7, 10], [2, 4]]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn overlap() {
        assert!(!can_attend_meetings(&[[0, 30], [5, 10], [15, 20]]));
    }
    #[test]
    fn ok() { assert!(can_attend_meetings(&[[7, 10], [2, 4]])); }
    #[test]
    fn empty() { assert!(can_attend_meetings(&[])); }
    #[test]
    fn touching() { assert!(can_attend_meetings(&[[1, 2], [2, 3]])); }
    #[test]
    fn nested() {
        assert!(!can_attend_meetings(&[[1, 10], [2, 3], [11, 12]]));
    }
}
`,
});
