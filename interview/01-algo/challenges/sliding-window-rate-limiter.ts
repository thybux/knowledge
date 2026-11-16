import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "sliding-window-rate-limiter",
  title: "Rate limiter (fenêtre glissante)",
  difficulty: "moyen",
  entry: "RateLimiter",
  mode: "class",
  starter: `class RateLimiter {
  // Au plus "limit" requêtes acceptées par client sur toute
  // fenêtre de "windowMs". Une requête à t voit les requêtes
  // ACCEPTÉES dans ]t - windowMs, t]. Les refus ne comptent pas.
  // Les timestamps d'un même client sont croissants (ou égaux).
  constructor(limit: number, windowMs: number) {}

  allow(clientId: string, timestampMs: number): boolean {
    return false;
  }
}`,
  solution: `class RateLimiter {
  // clientId -> timestamps acceptés, du plus ancien au plus récent
  private logs = new Map<string, number[]>();
  constructor(private limit: number, private windowMs: number) {}

  allow(clientId: string, timestampMs: number): boolean {
    let log = this.logs.get(clientId);
    if (!log) {
      log = [];
      this.logs.set(clientId, log);
    }
    // purge ce qui est sorti de la fenêtre ]t - w, t]
    let drop = 0;
    while (drop < log.length && log[drop] <= timestampMs - this.windowMs) {
      drop++;
    }
    if (drop) log.splice(0, drop);
    if (log.length >= this.limit) return false;
    log.push(timestampMs);
    return true;
  }
}`,
  cases: [
    {
      name: "3 req / 1000 ms",
      ops: ["RateLimiter", "allow", "allow", "allow", "allow"],
      args: [[3, 1000], ["a", 0], ["a", 100], ["a", 200], ["a", 300]],
      expected: [null, true, true, true, false],
    },
    {
      name: "borne exclue : t - windowMs sort de la fenêtre",
      ops: ["RateLimiter", "allow", "allow", "allow"],
      args: [[1, 1000], ["a", 0], ["a", 999], ["a", 1000]],
      expected: [null, true, false, true],
    },
    {
      name: "clients indépendants",
      ops: ["RateLimiter", "allow", "allow", "allow", "allow"],
      args: [[1, 1000], ["a", 0], ["b", 0], ["a", 10], ["b", 10]],
      expected: [null, true, true, false, false],
    },
    {
      name: "les refus ne consomment pas de quota",
      ops: ["RateLimiter", "allow", "allow", "allow", "allow", "allow"],
      args: [[2, 100], ["a", 0], ["a", 50], ["a", 60], ["a", 99], ["a", 100]],
      expected: [null, true, true, false, false, true],
    },
    {
      name: "vraiment glissante (pas fixe)",
      ops: ["RateLimiter", "allow", "allow", "allow", "allow", "allow"],
      args: [[2, 1000], ["a", 900], ["a", 950], ["a", 1001], ["a", 1900], ["a", 1950]],
      expected: [null, true, true, false, true, true],
    },
    {
      name: "même timestamp",
      ops: ["RateLimiter", "allow", "allow", "allow"],
      args: [[2, 10], ["a", 5], ["a", 5], ["a", 5]],
      expected: [null, true, true, false],
    },
    {
      name: "limite 0",
      ops: ["RateLimiter", "allow", "allow"],
      args: [[0, 1000], ["a", 0], ["a", 5000]],
      expected: [null, false, false],
    },
    {
      name: "longue pause",
      ops: ["RateLimiter", "allow", "allow", "allow", "allow", "allow"],
      args: [[2, 1000], ["a", 0], ["a", 1], ["a", 2], ["a", 100000], ["a", 100001]],
      expected: [null, true, true, false, true, true],
    },
    {
      name: "purge partielle",
      ops: ["RateLimiter", "allow", "allow", "allow", "allow", "allow"],
      args: [[3, 100], ["a", 0], ["a", 50], ["a", 90], ["a", 100], ["a", 120]],
      expected: [null, true, true, true, true, false],
    },
  ],
  rust: `use std::collections::{HashMap, VecDeque};

struct RateLimiter {
    // TODO : tes champs
}

impl RateLimiter {
    fn new(limit: usize, window_ms: u64) -> Self {
        todo!()
    }
    fn allow(&mut self, client_id: &str, timestamp_ms: u64) -> bool {
        todo!()
    }
}

fn main() {
    let mut rl = RateLimiter::new(3, 1000);
    println!("{}", rl.allow("a", 0));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basic() {
        let mut rl = RateLimiter::new(3, 1000);
        assert!(rl.allow("a", 0));
        assert!(rl.allow("a", 100));
        assert!(rl.allow("a", 200));
        assert!(!rl.allow("a", 300));
    }
    #[test]
    fn boundary_excluded() {
        let mut rl = RateLimiter::new(1, 1000);
        assert!(rl.allow("a", 0));
        assert!(!rl.allow("a", 999));
        assert!(rl.allow("a", 1000));
    }
    #[test]
    fn per_client() {
        let mut rl = RateLimiter::new(1, 1000);
        assert!(rl.allow("a", 0));
        assert!(rl.allow("b", 0));
        assert!(!rl.allow("a", 10));
    }
    #[test]
    fn rejected_not_counted() {
        let mut rl = RateLimiter::new(2, 100);
        assert!(rl.allow("a", 0));
        assert!(rl.allow("a", 50));
        assert!(!rl.allow("a", 60));
        assert!(!rl.allow("a", 99));
        assert!(rl.allow("a", 100));
    }
}
`,
});
