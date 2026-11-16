import { defineChallenge } from "../../../.vitepress/theme/challenge";

const harness = `
// ---- Harnais de test (ne pas modifier) ----
// Les listeners sont identifiés par un nom ; chaque appel est
// journalisé "nom:event:payload".
class Bus {
  private em = new EventEmitter();
  private calls: string[] = [];
  private fns = new Map<string, Listener>();
  private unsubs = new Map<string, () => void>();
  private fn(name: string): Listener {
    if (!this.fns.has(name)) {
      this.fns.set(name, (p) => {
        this.calls.push(name + ":" + p);
        if (name.startsWith("selfoff")) this.em.off(this.cur, this.fn(name));
      });
    }
    return this.fns.get(name)!;
  }
  private cur = "";
  on(ev: string, name: string) { this.unsubs.set(name, this.em.on(ev, this.fn(name))); }
  once(ev: string, name: string) { this.em.once(ev, this.fn(name)); }
  off(ev: string, name: string) { this.em.off(ev, this.fn(name)); }
  unsub(name: string) { this.unsubs.get(name)?.(); }
  emit(ev: string, payload: string) { this.cur = ev; return this.em.emit(ev, payload); }
  count(ev: string) { return this.em.listenerCount(ev); }
  log() { const c = this.calls; this.calls = []; return c; }
}`;

export default defineChallenge({
  id: "prat-ts-emitter",
  title: "EventEmitter typé",
  difficulty: "moyen",
  entry: "Bus",
  mode: "class",
  starter: `type Listener = (payload: any) => void;

class EventEmitter {
  // Abonne ; renvoie une fonction de désabonnement.
  on(event: string, fn: Listener): () => void {
    return () => {};
  }
  // Comme on, mais retiré après le 1er appel.
  once(event: string, fn: Listener): void {}
  // Retire fn (si présent). off(event, fn) doit marcher
  // aussi pour un listener ajouté avec once.
  off(event: string, fn: Listener): void {}
  // Appelle les listeners dans l'ordre d'inscription.
  // Un listener qui se retire pendant l'emit ne doit pas
  // faire sauter le suivant. Renvoie true s'il y en avait.
  emit(event: string, payload: any): boolean {
    return false;
  }
  listenerCount(event: string): number {
    return 0;
  }
}
${harness}`,
  solution: `type Listener = (payload: any) => void;
type Entry = { fn: Listener; once: boolean };

class EventEmitter {
  private map = new Map<string, Entry[]>();

  on(event: string, fn: Listener): () => void {
    this.add(event, { fn, once: false });
    return () => this.off(event, fn);
  }
  once(event: string, fn: Listener): void {
    this.add(event, { fn, once: true });
  }
  off(event: string, fn: Listener): void {
    const list = this.map.get(event);
    if (!list) return;
    const i = list.findIndex((e) => e.fn === fn);
    if (i !== -1) list.splice(i, 1);
    if (list.length === 0) this.map.delete(event);
  }
  emit(event: string, payload: any): boolean {
    const list = this.map.get(event);
    if (!list || list.length === 0) return false;
    for (const e of [...list]) {   // copie : robustesse aux off()
      if (e.once) this.off(event, e.fn);
      e.fn(payload);
    }
    return true;
  }
  listenerCount(event: string): number {
    return this.map.get(event)?.length ?? 0;
  }
  private add(event: string, e: Entry) {
    const list = this.map.get(event) ?? [];
    list.push(e);
    this.map.set(event, list);
  }
}
${harness}`,
  cases: [
    {
      name: "on + emit, ordre d'inscription",
      ops: ["Bus", "on", "on", "emit", "log"],
      args: [[], ["order.paid", "mailer"], ["order.paid", "stats"], ["order.paid", "42"], []],
      expected: [null, null, null, true, ["mailer:42", "stats:42"]],
    },
    {
      name: "emit sans listener",
      ops: ["Bus", "emit", "count"],
      args: [[], ["nope", "x"], ["nope"]],
      expected: [null, false, 0],
    },
    {
      name: "once",
      ops: ["Bus", "once", "emit", "emit", "log", "count"],
      args: [[], ["e", "a"], ["e", "1"], ["e", "2"], [], ["e"]],
      expected: [null, null, true, false, ["a:1"], 0],
    },
    {
      name: "off",
      ops: ["Bus", "on", "on", "off", "emit", "log", "count"],
      args: [[], ["e", "a"], ["e", "b"], ["e", "a"], ["e", "x"], [], ["e"]],
      expected: [null, null, null, null, true, ["b:x"], 1],
    },
    {
      name: "fonction de désabonnement",
      ops: ["Bus", "on", "unsub", "emit", "log"],
      args: [[], ["e", "a"], ["a"], ["e", "x"], []],
      expected: [null, null, null, false, []],
    },
    {
      name: "off d'un listener once",
      ops: ["Bus", "once", "off", "emit", "log"],
      args: [[], ["e", "a"], ["e", "a"], ["e", "x"], []],
      expected: [null, null, null, false, []],
    },
    {
      name: "listener qui se retire pendant emit",
      ops: ["Bus", "on", "on", "emit", "emit", "log"],
      args: [[], ["e", "selfoff1"], ["e", "b"], ["e", "1"], ["e", "2"], []],
      expected: [null, null, null, true, true, ["selfoff1:1", "b:1", "b:2"]],
    },
    {
      name: "événements isolés",
      ops: ["Bus", "on", "on", "emit", "log", "count", "count"],
      args: [[], ["a", "x"], ["b", "y"], ["b", "!"], [], ["a"], ["b"]],
      expected: [null, null, null, true, ["y:!"], 1, 1],
    },
  ],
});
