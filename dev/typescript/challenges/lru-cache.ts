import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "ts-lru-ttl",
  title: "Cache borné LRU + TTL",
  difficulty: "moyen",
  mode: "class",
  entry: "LruTtlCache",
  starter: `// Cache en mémoire BORNÉ (sinon : fuite mémoire en prod).
// - capacity : nb max d'entrées ; au-delà, on évince la moins
//   récemment UTILISÉE (get ou set la rafraîchit)
// - ttlMs : une entrée expire à (instant du set + ttlMs) ;
//   expirée => get retourne null et la supprime
// - now est passé explicitement (testable, pas de Date.now())
// - size(now) : nb d'entrées NON expirées
class LruTtlCache<V> {
  constructor(capacity: number, ttlMs: number) {}
  get(key: string, now: number): V | null { return null; }
  set(key: string, value: V, now: number): void {}
  size(now: number): number { return 0; }
}`,
  solution: `class LruTtlCache<V> {
  // Une Map garde l'ordre d'insertion : 1re clé = la plus ancienne
  #map = new Map<string, { value: V; expiresAt: number }>();
  constructor(
    private readonly capacity: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string, now: number): V | null {
    const e = this.#map.get(key);
    if (!e) return null;
    this.#map.delete(key);
    if (e.expiresAt <= now) return null;
    this.#map.set(key, e); // remet en fin = plus récent
    return e.value;
  }

  set(key: string, value: V, now: number): void {
    this.#map.delete(key);
    this.#map.set(key, { value, expiresAt: now + this.ttlMs });
    while (this.#map.size > this.capacity) {
      const oldest = this.#map.keys().next().value!;
      this.#map.delete(oldest);
    }
  }

  size(now: number): number {
    for (const [k, e] of this.#map) {
      if (e.expiresAt <= now) this.#map.delete(k);
    }
    return this.#map.size;
  }
}`,
  cases: [
    {
      name: "éviction LRU",
      ops: ["LruTtlCache", "set", "set", "get", "set", "get", "get", "get"],
      args: [[2, 1000], ["a", 1, 0], ["b", 2, 0], ["a", 1], ["c", 3, 2], ["b", 3], ["a", 3], ["c", 3]],
      expected: [null, null, null, 1, null, null, 1, 3],
    },
    {
      name: "expiration",
      ops: ["LruTtlCache", "set", "get", "get", "size"],
      args: [[10, 100], ["tok", "x", 0], ["tok", 99], ["tok", 100], [100]],
      expected: [null, null, "x", null, 0],
    },
    {
      name: "set rafraîchit TTL et récence",
      ops: ["LruTtlCache", "set", "set", "set", "set", "get", "get"],
      args: [[2, 100], ["a", 1, 0], ["b", 2, 0], ["a", 10, 50], ["c", 3, 60], ["a", 120], ["b", 60]],
      expected: [null, null, null, null, null, 10, null],
    },
    {
      name: "size ignore les expirées",
      ops: ["LruTtlCache", "set", "set", "size", "size"],
      args: [[5, 100], ["a", 1, 0], ["b", 2, 50], [120], [200]],
      expected: [null, null, null, 1, 0],
    },
  ],
});
