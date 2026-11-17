import { describe, expect, test } from "bun:test";
import { paneBase, slotFiles } from "../../src/core/draft/paths";
import { PANE_STATE_MAX_AGE_MS, sweepDecision, type PaneState } from "../../src/core/pane-state/pane-state";
import { sweepPaneStates } from "../../src/ports/pane-states";
import { SlotStore, type SlotIO } from "../../src/ports/slot-store";

class MemoryIO implements SlotIO {
  files = new Map<string, string>();
  failReads = new Set<string>();
  failList = false;
  writes: string[] = [];
  /** Holds the next read of this file open until released. */
  gate: { file: string; release: Promise<void> } | null = null;
  async read(rel: string) {
    const g = this.gate;
    if (g && g.file === rel) {
      this.gate = null;
      await g.release;
    }
    if (this.failReads.has(rel)) throw new Error("EIO");
    return this.files.get(rel) ?? null;
  }
  async write(rel: string, text: string) {
    this.writes.push(rel);
    this.files.set(rel, text);
  }
  async unlink(rel: string) {
    this.files.delete(rel);
  }
  async list(dir: string) {
    if (this.failList) throw new Error("EACCES");
    return [...this.files.keys()].filter((k) => k.startsWith(dir + "/")).map((k) => k.slice(dir.length + 1));
  }
}

const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const state = (seenAt?: number): PaneState => ({ file: "/a", on: null, ...(seenAt === undefined ? {} : { seenAt }) });

describe("sweepDecision", () => {
  test("a record seen within the limit is kept", () => {
    expect(sweepDecision(state(NOW - PANE_STATE_MAX_AGE_MS), NOW)).toEqual({ op: "keep" });
    expect(sweepDecision(state(NOW + DAY), NOW)).toEqual({ op: "keep" });
  });

  test("a record not seen for longer than the limit, or a missing one, is removed", () => {
    expect(sweepDecision(state(NOW - PANE_STATE_MAX_AGE_MS - 1), NOW)).toEqual({ op: "remove" });
    expect(sweepDecision(null, NOW)).toEqual({ op: "remove" });
  });

  test("a record without seenAt gets seenAt = now instead of being removed", () => {
    expect(sweepDecision(state(), NOW)).toEqual({ op: "write", payload: state(NOW) });
    expect(sweepDecision({ ...state(), seenAt: "x" } as never, NOW)).toEqual({ op: "write", payload: state(NOW) });
  });

  test("the limit is 90 days", () => {
    expect(PANE_STATE_MAX_AGE_MS).toBe(90 * DAY);
  });
});

describe("sweepPaneStates", () => {
  async function setup() {
    const io = new MemoryIO();
    const store = new SlotStore(io);
    await store.save(paneBase("fresh"), state(NOW - DAY));
    await store.save(paneBase("old"), state(NOW - 100 * DAY));
    await store.save(paneBase("legacy"), state());
    await store.save(paneBase("self"), state(NOW - 100 * DAY));
    io.writes = [];
    return { io, store };
  }

  test("removes old records, stamps legacy ones, keeps fresh ones and its own", async () => {
    const { io, store } = await setup();
    expect(await sweepPaneStates(store, "self", NOW)).toEqual({ removed: ["old"], stamped: ["legacy"] });
    expect((await store.owners("panes")).sort()).toEqual(["fresh", "legacy", "self"]);
    expect(await store.load(paneBase("legacy"))).toEqual(state(NOW));
    expect(io.writes.some((w) => w.startsWith("panes/fresh") || w.startsWith("panes/self"))).toBe(false);
  });

  test("a stamped legacy record is removed once it is older than the limit", async () => {
    const { store } = await setup();
    await sweepPaneStates(store, "self", NOW);
    const later = NOW + PANE_STATE_MAX_AGE_MS + 1;
    expect((await sweepPaneStates(store, "self", later)).removed).toContain("legacy");
  });

  test("a pane that saves its record while the sweep reads it keeps the new record", async () => {
    const { io, store } = await setup();
    let release!: () => void;
    io.gate = { file: slotFiles(paneBase("old")).a, release: new Promise<void>((r) => (release = r)) };
    const sweeping = sweepPaneStates(store, "self", NOW);
    await new Promise((r) => setTimeout(r, 0));
    // The pane "old" is alive and opens a file now, while the sweep holds its stale record.
    const saving = store.save(paneBase("old"), { file: "/new", on: null, seenAt: NOW });
    release();
    await Promise.all([sweeping, saving]);
    expect(await store.load(paneBase("old"))).toEqual({ file: "/new", on: null, seenAt: NOW });
  });

  test("a record that cannot be read is left alone and the sweep goes on", async () => {
    const { io, store } = await setup();
    io.failReads.add(slotFiles(paneBase("old")).a);
    expect(await sweepPaneStates(store, "self", NOW)).toEqual({ removed: [], stamped: ["legacy"] });
    expect((await store.owners("panes")).sort()).toEqual(["fresh", "legacy", "old", "self"]);
  });

  test("an empty folder changes nothing; an unlistable one throws", async () => {
    const io = new MemoryIO();
    expect(await sweepPaneStates(new SlotStore(io), "self", NOW)).toEqual({ removed: [], stamped: [] });
    io.failList = true;
    await expect(sweepPaneStates(new SlotStore(io), "self", NOW)).rejects.toThrow("EACCES");
  });
});
