import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "meeting-rooms-ii",
  title: "Meeting Rooms II",
  difficulty: "moyen",
  entry: "minMeetingRooms",
  starter: `function minMeetingRooms(intervals: number[][]): number {
  // Nombre minimal de salles pour tenir toutes les réunions
  // [debut, fin). Une salle libérée à 10 resert à 10.
  return 0;
}`,
  solution: `function minMeetingRooms(intervals: number[][]): number {
  const starts = intervals.map((x) => x[0]).sort((a, b) => a - b);
  const ends = intervals.map((x) => x[1]).sort((a, b) => a - b);
  let rooms = 0;
  let best = 0;
  let j = 0;
  for (let i = 0; i < starts.length; i++) {
    // libère d'abord les salles dont la réunion est finie
    while (ends[j] <= starts[i]) {
      rooms--;
      j++;
    }
    rooms++;
    best = Math.max(best, rooms);
  }
  return best;
}`,
  cases: [
    { args: [[[0, 30], [5, 10], [15, 20]]], expected: 2 },
    { args: [[[7, 10], [2, 4]]], expected: 1 },
    { args: [[]], expected: 0, name: "vide" },
    { args: [[[1, 5]]], expected: 1, name: "une seule" },
    { args: [[[1, 2], [2, 3], [3, 4]]], expected: 1, name: "bord à bord" },
    { args: [[[1, 4], [1, 4], [1, 4]]], expected: 3, name: "identiques" },
    { args: [[[1, 10], [2, 7], [3, 19], [8, 12], [10, 20], [11, 30]]], expected: 4 },
    { args: [[[9, 10], [4, 9], [4, 17]]], expected: 2 },
    { args: [[[2, 11], [6, 16], [11, 16]]], expected: 2 },
    { args: [[[1, 3], [2, 4], [3, 5], [4, 6]]], expected: 2 },
  ],
  rust: `fn min_meeting_rooms(intervals: &[[i32; 2]]) -> usize {
    // TODO : ton code ici
    todo!()
}

fn main() {
    println!("{}", min_meeting_rooms(&[[0, 30], [5, 10], [15, 20]]));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        assert_eq!(min_meeting_rooms(&[[0, 30], [5, 10], [15, 20]]), 2);
    }
    #[test]
    fn empty() { assert_eq!(min_meeting_rooms(&[]), 0); }
    #[test]
    fn touching() {
        assert_eq!(min_meeting_rooms(&[[1, 2], [2, 3], [3, 4]]), 1);
    }
    #[test]
    fn same() {
        assert_eq!(min_meeting_rooms(&[[1, 4], [1, 4], [1, 4]]), 3);
    }
    #[test]
    fn mixed() {
        let v = [[1, 10], [2, 7], [3, 19], [8, 12], [10, 20], [11, 30]];
        assert_eq!(min_meeting_rooms(&v), 4);
    }
}
`,
});
