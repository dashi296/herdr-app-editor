import { describe, expect, test } from "bun:test";
import { draftBase, paneBase, slotFiles } from "../../src/core/draft/paths";
import { fnv1a32 } from "../../src/core/store/slots";
import { SlotStore, type SlotIO } from "../../src/ports/slot-store";

class MemoryIO implements SlotIO {
  files = new Map<string, string>();
  log: string[] = [];
  failWrites = false;
  async read(rel: string) { return this.files.get(rel) ?? null; }
  async write(rel: string, text: string) {
    if (this.failWrites) throw new Error("disk full");
    this.log.push(`write ${rel}`);
    this.files.set(rel, text);
  }
  async unlink(rel: string) { this.log.push(`unlink ${rel}`); this.files.delete(rel); }
  dirs = new Set<string>();
  async removeDirIfEmpty(dir: string) {
    if (![...this.files.keys()].some((k) => k.startsWith(dir + "/"))) this.dirs.add(dir);
  }
  async list(dir: string) {
    return [...this.files.keys()].filter((k) => k.startsWith(dir + "/")).map((k) => k.slice(dir.length + 1));
  }
}

describe("paths", () => {
  test("draft folder is keyed by machine and path, file by owner", () => {
    expect(draftBase(null, "/p/a.ts", "k1")).toBe(`drafts/${fnv1a32("\0/p/a.ts")}/k1`);
    expect(draftBase("vps", "/p/a.ts", "k1")).not.toBe(draftBase(null, "/p/a.ts", "k1"));
    expect(paneBase("k1")).toBe("panes/k1");
    expect(slotFiles("panes/k1")).toEqual({ a: "panes/k1.a.json", b: "panes/k1.b.json" });
  });
  test("owner keys must be safe file names", () => {
    expect(() => draftBase(null, "/p", "../x")).toThrow();
    expect(() => paneBase("a/b")).toThrow();
  });
});

describe("SlotStore", () => {
  test("save then load", async () => {
    const s = new SlotStore(new MemoryIO());
    await s.save("panes/k1", { file: "/p/a.ts" });
    expect(await s.load("panes/k1")).toEqual({ file: "/p/a.ts" });
  });
  test("saves alternate between the two slots", async () => {
    const io = new MemoryIO();
    const s = new SlotStore(io);
    await s.save("panes/k1", { v: 1 });
    await s.save("panes/k1", { v: 2 });
    await s.save("panes/k1", { v: 3 });
    expect(io.log).toEqual(["write panes/k1.a.json", "write panes/k1.b.json", "write panes/k1.a.json"]);
    expect(await s.load("panes/k1")).toEqual({ v: 3 });
  });
  test("concurrent saves are serialized: the last one wins", async () => {
    const s = new SlotStore(new MemoryIO());
    await Promise.all([s.save("panes/k1", { v: 1 }), s.save("panes/k1", { v: 2 }), s.save("panes/k1", { v: 3 })]);
    expect(await s.load("panes/k1")).toEqual({ v: 3 });
  });
  test("a torn newer slot falls back to the older record", async () => {
    const io = new MemoryIO();
    const s = new SlotStore(io);
    await s.save("panes/k1", { v: 1 });
    await s.save("panes/k1", { v: 2 });
    io.files.set("panes/k1.b.json", '{"schema":1,"seq":2,"del');
    expect(await s.load("panes/k1")).toEqual({ v: 1 });
  });
  test("remove leaves nothing behind", async () => {
    const io = new MemoryIO();
    const s = new SlotStore(io);
    await s.save("panes/k1", { v: 1 });
    await s.save("panes/k1", { v: 2 });
    await s.remove("panes/k1");
    expect(io.files.size).toBe(0);
    expect(await s.load("panes/k1")).toBeNull();
  });
  test("removing the last record of a folder removes the folder", async () => {
    const io = new MemoryIO();
    const s = new SlotStore(io);
    await s.save("drafts/h/k1", { v: 1 });
    await s.save("drafts/h/k2", { v: 1 });
    await s.remove("drafts/h/k1");
    expect(io.dirs.has("drafts/h")).toBe(false);
    await s.remove("drafts/h/k2");
    expect(io.dirs.has("drafts/h")).toBe(true);
  });
  test("a failed write is reported and the previous record survives", async () => {
    const io = new MemoryIO();
    const s = new SlotStore(io);
    await s.save("panes/k1", { v: 1 });
    io.failWrites = true;
    await expect(s.save("panes/k1", { v: 2 })).rejects.toThrow("disk full");
    io.failWrites = false;
    expect(await s.load("panes/k1")).toEqual({ v: 1 });
  });
  test("owners lists the record names in a folder", async () => {
    const io = new MemoryIO();
    const s = new SlotStore(io);
    await s.save("drafts/h/k1", { v: 1 });
    await s.save("drafts/h/k2", { v: 1 });
    await s.save("drafts/h/k2", { v: 2 });
    expect((await s.owners("drafts/h")).sort()).toEqual(["k1", "k2"]);
  });
});
