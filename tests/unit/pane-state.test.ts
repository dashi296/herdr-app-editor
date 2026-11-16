import { describe, expect, test } from "bun:test";
import { paneBase, slotFiles } from "../../src/core/draft/paths";
import { isStalePaneState, PANE_STATE_MAX_AGE_MS } from "../../src/core/pane-state/pane-state";
import { sweepPaneStates } from "../../src/ports/pane-states";
import { SlotStore, type SlotIO } from "../../src/ports/slot-store";

class MemoryIO implements SlotIO {
  files = new Map<string, string>();
  failReads = new Set<string>();
  async read(rel: string) {
    if (this.failReads.has(rel)) throw new Error("EIO");
    return this.files.get(rel) ?? null;
  }
  async write(rel: string, text: string) {
    this.files.set(rel, text);
  }
  async unlink(rel: string) {
    this.files.delete(rel);
  }
  async list(dir: string) {
    return [...this.files.keys()].filter((k) => k.startsWith(dir + "/")).map((k) => k.slice(dir.length + 1));
  }
}

const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("isStalePaneState", () => {
  test("a record seen within the limit is kept", () => {
    expect(isStalePaneState({ file: "/a", on: null, seenAt: NOW - PANE_STATE_MAX_AGE_MS }, NOW)).toBe(false);
    expect(isStalePaneState({ file: "/a", on: null, seenAt: NOW + DAY }, NOW)).toBe(false);
  });

  test("a record not seen for longer than the limit is stale", () => {
    expect(isStalePaneState({ file: "/a", on: null, seenAt: NOW - PANE_STATE_MAX_AGE_MS - 1 }, NOW)).toBe(true);
  });

  test("a record without seenAt (written before it existed) or a missing record is stale", () => {
    expect(isStalePaneState({ file: "/a", on: null }, NOW)).toBe(true);
    expect(isStalePaneState({ file: "/a", on: null, seenAt: "x" } as never, NOW)).toBe(true);
    expect(isStalePaneState(null, NOW)).toBe(true);
  });

  test("the limit is 90 days", () => {
    expect(PANE_STATE_MAX_AGE_MS).toBe(90 * DAY);
  });
});

describe("sweepPaneStates", () => {
  async function setup() {
    const io = new MemoryIO();
    const store = new SlotStore(io);
    await store.save(paneBase("fresh"), { file: "/a", on: null, seenAt: NOW - DAY });
    await store.save(paneBase("old"), { file: "/b", on: null, seenAt: NOW - 100 * DAY });
    await store.save(paneBase("legacy"), { file: "/c", on: null });
    await store.save(paneBase("self"), { file: "/d", on: null });
    return { io, store };
  }

  test("removes stale records of other panes and keeps fresh ones and its own", async () => {
    const { io, store } = await setup();
    const removed = await sweepPaneStates(store, "self", NOW);
    expect(removed.sort()).toEqual(["legacy", "old"]);
    expect((await store.owners("panes")).sort()).toEqual(["fresh", "self"]);
    expect([...io.files.keys()].some((k) => k.startsWith("panes/old"))).toBe(false);
  });

  test("a record that cannot be read is left alone and the sweep goes on", async () => {
    const { io, store } = await setup();
    io.failReads.add(slotFiles(paneBase("old")).a);
    const removed = await sweepPaneStates(store, "self", NOW);
    expect(removed).toEqual(["legacy"]);
    expect((await store.owners("panes")).sort()).toEqual(["fresh", "old", "self"]);
  });

  test("an empty or missing folder removes nothing", async () => {
    expect(await sweepPaneStates(new SlotStore(new MemoryIO()), "self", NOW)).toEqual([]);
  });
});
