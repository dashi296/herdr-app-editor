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
}

export class SlotStore {
  private queues = new Map<string, Promise<unknown>>();

  constructor(private io: SlotIO) {}

  private serial<T>(base: string, op: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(base) ?? Promise.resolve();
    const next = prev.then(op, op);
    this.queues.set(base, next.catch(() => {}));
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
      for (const step of planDelete(a, b)) {
        if (step.op === "write") await this.io.write(f[step.slot], JSON.stringify(step.record));
        else await this.io.unlink(f[step.slot]);
      }
    });
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
