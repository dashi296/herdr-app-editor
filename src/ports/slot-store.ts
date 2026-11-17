// Durable small records on top of a plain file API, using the A/B slots of core/store.
// All operations on one record run one at a time (spike S5: concurrent writeFile calls corrupt files).
import { slotFiles } from "../core/draft/paths";
import { pickCurrent, planDelete, planWrite } from "../core/store/slots";

/** Files under the store root. `read` returns null for a missing file; `unlink` ignores one. */
export interface SlotIO {
  read(rel: string): Promise<string | null>;
  write(rel: string, text: string): Promise<void>;
  unlink(rel: string): Promise<void>;
  /** Names of the files in a folder; empty when the folder is missing. */
  list(relDir: string): Promise<string[]>;
  /** Removes a folder only if it is empty; never throws. */
  removeDirIfEmpty?(relDir: string): Promise<void>;
}

export type UpdateDecision<T> = { op: "keep" } | { op: "remove" } | { op: "write"; payload: T };

/**
 * One queue per record for the whole module, shared by every SlotStore and so by every mod copy
 * running this build (module scope is shared by copies: defaults/AGENTS.md). Review B6.
 */
const queues = new Map<string, Promise<unknown>>();

export class SlotStore {
  constructor(private io: SlotIO) {}

  private serial<T>(base: string, op: () => Promise<T>): Promise<T> {
    const prev = queues.get(base) ?? Promise.resolve();
    const next = prev.then(op, op);
    const tail = next.catch(() => {});
    queues.set(base, tail);
    void tail.then(() => {
      if (queues.get(base) === tail) queues.delete(base);
    });
    return next;
  }

  private async both(base: string) {
    const f = slotFiles(base);
    const [a, b] = await Promise.all([this.io.read(f.a), this.io.read(f.b)]);
    return { f, a, b };
  }

  load<T>(base: string): Promise<T | null> {
    return this.serial(base, async () => {
      const { a, b } = await this.both(base);
      return pickCurrent<T>(a, b).payload;
    });
  }

  save<T>(base: string, payload: T): Promise<void> {
    return this.serial(base, async () => {
      const { f, a, b } = await this.both(base);
      const { target, record } = planWrite(a, b, payload);
      await this.io.write(f[target], JSON.stringify(record));
    });
  }

  /** Tombstone first, then the live slot, then the tombstone: a crash never resurrects the record. */
  remove(base: string): Promise<void> {
    return this.serial(base, async () => {
      const { f, a, b } = await this.both(base);
      await this.deleteSlots(base, f, a, b);
    });
  }

  /**
   * Reads the record, lets `decide` look at it and then writes or removes it, all as one queued
   * operation: no save or remove of the same record can run in between. Returns the decision.
   */
  update<T>(base: string, decide: (current: T | null) => UpdateDecision<T>): Promise<UpdateDecision<T>> {
    return this.serial(base, async () => {
      const { f, a, b } = await this.both(base);
      const decision = decide(pickCurrent<T>(a, b).payload);
      if (decision.op === "write") {
        const { target, record } = planWrite(a, b, decision.payload);
        await this.io.write(f[target], JSON.stringify(record));
      } else if (decision.op === "remove") await this.deleteSlots(base, f, a, b);
      return decision;
    });
  }

  private async deleteSlots(base: string, f: { a: string; b: string }, a: string | null, b: string | null) {
    for (const step of planDelete(a, b)) {
      if (step.op === "write") await this.io.write(f[step.slot], JSON.stringify(step.record));
      else await this.io.unlink(f[step.slot]);
    }
    const dir = base.slice(0, base.lastIndexOf("/"));
    if (dir) await this.io.removeDirIfEmpty?.(dir);
  }

  /** Record names in a folder (each stored as `<name>.a.json` / `<name>.b.json`). */
  async owners(relDir: string): Promise<string[]> {
    const names = new Set<string>();
    for (const file of await this.io.list(relDir)) {
      const m = /^(.+)\.[ab]\.json$/.exec(file);
      if (m) names.add(m[1]!);
    }
    return [...names];
  }
}
