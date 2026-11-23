// EditorView with fake host modules: opening, saving and polling, including the races handled in
// src/ui/editor-view.ts (an edit or another file arriving while an await is pending).
import { beforeEach, describe, expect, test } from "bun:test";
import { draftBase, paneBase } from "../../src/core/draft/paths";
import type { Doc } from "../../src/core/document/document";
import { createRegistry } from "../../src/core/extensions/registry";
import { MOD_EDITOR, MOD_OPEN, SHARED_KEY } from "../../src/core/names";
import type { FileStore, FolderWatch } from "../../src/ports/file-store";
import type { ImageStore } from "../../src/ports/image-store";
import { SlotStore, type SlotIO } from "../../src/ports/slot-store";
import {
  deferred,
  FakeEditorState,
  host,
  install,
  makeCx,
  reset,
  settle,
  until,
  type Deferred,
  type FakeCx,
} from "./host";

install();
const { EditorView } = await import("../../src/ui/editor-view");
type Extension = Parameters<typeof createRegistry>[0][number];

class MemoryIO implements SlotIO {
  files = new Map<string, string>();
  /** Holds the next draft write open until released. */
  draftGate: Deferred<void> | null = null;
  async read(rel: string) {
    return this.files.get(rel) ?? null;
  }
  async write(rel: string, text: string) {
    const gate = this.draftGate;
    if (gate && rel.startsWith("drafts/")) {
      this.draftGate = null;
      await gate.promise;
    }
    this.files.set(rel, text);
  }
  /** Holds the next unlink open until released. */
  unlinkGate: Deferred<void> | null = null;
  async unlink(rel: string) {
    const gate = this.unlinkGate;
    if (gate) {
      this.unlinkGate = null;
      await gate.promise;
    }
    this.files.delete(rel);
  }
  async list(dir: string) {
    return [...this.files.keys()].filter((k) => k.startsWith(dir + "/")).map((k) => k.slice(dir.length + 1));
  }
}

/** Files in memory. A test can hold any call open with a gate and release it later. */
class FakeFiles implements FileStore {
  disk = new Map<string, string>();
  writable: boolean | null = true;
  writes: { path: string; text: string; expected: string | null }[] = [];
  failWrite: Error | null = null;
  gates: { read?: Deferred<void>; write?: Deferred<void>; canWrite?: Deferred<void> } = {};
  readError: Error | null = null;
  async read(path: string) {
    const gate = this.gates.read;
    if (gate) {
      delete this.gates.read;
      await gate.promise;
    }
    if (this.readError) throw this.readError;
    return this.disk.get(path) ?? null;
  }
  async write(path: string, text: string, expected: string | null) {
    const gate = this.gates.write;
    if (gate) {
      delete this.gates.write;
      await gate.promise;
    }
    if (this.failWrite) throw this.failWrite;
    this.writes.push({ path, text, expected });
    this.disk.set(path, text);
  }
  watch(): FolderWatch {
    return { changes: new Promise(() => {}), cancel() {} };
  }
  async canWrite() {
    const gate = this.gates.canWrite;
    if (gate) {
      delete this.gates.canWrite;
      await gate.promise;
    }
    return this.writable;
  }
}

/** Exposes every file in `present` under images/<key>/<n>, a new name each time. */
class FakeImages implements ImageStore {
  present = new Set<string>();
  exposed: { path: string; key: string }[] = [];
  released: string[] = [];
  gate: Deferred<void> | null = null;
  async expose(path: string, key: string) {
    const gate = this.gate;
    if (gate) {
      this.gate = null;
      await gate.promise;
    }
    if (!this.present.has(path)) throw new Error("the file is missing or unreadable");
    this.exposed.push({ path, key });
    return `images/${key}/${this.exposed.length}`;
  }
  async release(key: string) {
    this.released.push(key);
  }
}

/** The private members the tests drive and inspect. */
interface Internals {
  doc: Doc | null;
  screen: { kind: string; text?: string; path?: string; src?: string };
  readonlyReason: string | null;
  extensionNotes: string[];
  draftOffer: { text: string } | null;
  routing: { pending: unknown };
  init(props: unknown, cx: FakeCx): void;
  openFile(path: string, on: string | null, cx: FakeCx): Promise<void>;
  save(cx: FakeCx): Promise<boolean>;
  act(a: string, cx: FakeCx): Promise<void>;
  maybePoll(cx: FakeCx): void;
  onCommand(command: string, cx: FakeCx): Promise<void>;
  render(cx: FakeCx): unknown;
  close(cx: FakeCx): Promise<void>;
}

let files: FakeFiles, images: FakeImages, io: MemoryIO, cx: FakeCx, extensions: Extension[];

function makeView(): Internals {
  const deps = { files, images, store: new SlotStore(io), extensions: createRegistry(extensions) };
  class TestEditor extends EditorView {
    protected makeDeps() {
      return deps;
    }
  }
  return new TestEditor() as unknown as Internals;
}

/** A view with `path` open and ready. */
async function opened(path = "/p/a.txt", text = "hello\n"): Promise<Internals> {
  files.disk.set(path, text);
  host.props = { key: "k1", file: path };
  const v = makeView();
  v.init(undefined, cx);
  await settle();
  expect(v.screen.kind).toBe("ready");
  return v;
}

const code = () => FakeEditorState.created.at(-1)!;
const draftKeys = () => [...io.files.keys()].filter((k) => k.startsWith("drafts/"));
const hasDraft = (path: string) => [...io.files.keys()].some((k) => k.startsWith(draftBase(null, path, "k1")));

beforeEach(() => {
  reset();
  files = new FakeFiles();
  images = new FakeImages();
  io = new MemoryIO();
  cx = makeCx();
  extensions = [];
});

describe("init", () => {
  test("herdr-app check renders only: no key, no store", async () => {
    host.checking = true;
    host.props = { file: "/p/a.txt" };
    files.disk.set("/p/a.txt", "a");
    const v = makeView();
    v.init(undefined, cx);
    await settle();
    expect(v.screen.kind).not.toBe("ready");
    expect(io.files.size).toBe(0);
    expect(() => v.render(cx)).not.toThrow();
  });

  test("opens props.file without props.key", async () => {
    files.disk.set("/p/a.txt", "hello\n");
    host.props = { file: "/p/a.txt" };
    const v = makeView();
    v.init(undefined, cx);
    await settle();
    expect(v.screen.kind).toBe("ready");
    expect(v.doc?.text).toBe("hello\n");
  });

  test("without a key, drafts are written under a generated key", async () => {
    files.disk.set("/p/a.txt", "hello\n");
    host.props = { file: "/p/a.txt" };
    const v = makeView();
    v.init(undefined, cx);
    await settle();
    code().type("edited\n", cx);
    await settle();
    const owners = draftKeys().map((k) => k.split("/")[2]!.split(".")[0]);
    expect(owners.length).toBeGreaterThan(0);
    expect(owners.every((o) => /^m[0-9a-z]+$/.test(o!))).toBe(true);
  });

  test("a pane split by quick open registers the one new editor pane in its tab, focused or not", async () => {
    host.panes = [
      { pane: "e0", tab: "t1", mod: MOD_EDITOR },
      { pane: "e9", tab: "t1", mod: MOD_EDITOR },
    ];
    host.focused = { pane: "p-elsewhere" };
    files.disk.set("/p/a.txt", "a");
    host.props = { key: "k1", file: "/p/a.txt", tab: "t1", before: ["e0"] };
    const v = makeView();
    v.init(undefined, cx);
    await settle();
    const reg = (host.shared.get(SHARED_KEY) as { registry: Record<string, { pane: string }> }).registry;
    expect(reg).toEqual({ k1: expect.objectContaining({ pane: "e9", tab: "t1" }) });
  });

  test("it uses the props it got at init: on the device props() is empty by the time the first load ends", async () => {
    host.panes = [{ pane: "e9", tab: "t1", mod: MOD_EDITOR }];
    files.disk.set("/p/a.txt", "a");
    host.props = { key: "k1", file: "/p/a.txt", tab: "t1", before: [] };
    const v = makeView();
    v.init(undefined, cx);
    host.props = {};
    await settle();
    const reg = (host.shared.get(SHARED_KEY) as { registry?: Record<string, { pane: string }> } | undefined)?.registry;
    expect(reg?.k1).toMatchObject({ pane: "e9" });
  });

  test("it does not claim again when its key is already registered (a restart keeps the split props)", async () => {
    // The pane was moved to tab t9; its old tab t1 now holds one editor pane that is not in before.
    host.panes = [
      { pane: "e5", tab: "t9", mod: MOD_EDITOR },
      { pane: "e9", tab: "t1", mod: MOD_EDITOR },
    ];
    host.shared.set(SHARED_KEY, { registry: { k1: { pane: "e5", tab: "t9", lastFocus: 7 } } });
    files.disk.set("/p/a.txt", "a");
    host.props = { key: "k1", file: "/p/a.txt", tab: "t1", before: [] };
    const v = makeView();
    v.init(undefined, cx);
    await settle();
    const reg = (host.shared.get(SHARED_KEY) as { registry: Record<string, unknown> }).registry;
    expect(reg).toEqual({ k1: { pane: "e5", tab: "t9", lastFocus: 7 } });
  });

  test("it does not claim a pane another key already names", async () => {
    host.panes = [{ pane: "e9", tab: "t1", mod: MOD_EDITOR }];
    host.shared.set(SHARED_KEY, { registry: { other: { pane: "e9", tab: "t1", lastFocus: 7 } } });
    files.disk.set("/p/a.txt", "a");
    host.props = { key: "k1", file: "/p/a.txt", tab: "t1", before: [] };
    const v = makeView();
    v.init(undefined, cx);
    await settle();
    const reg = (host.shared.get(SHARED_KEY) as { registry: Record<string, unknown> }).registry;
    expect(Object.keys(reg)).toEqual(["other"]);
  });

  test("with two new editor panes it cannot tell which is its own, and registers neither", async () => {
    host.panes = [
      { pane: "e8", tab: "t1", mod: MOD_EDITOR },
      { pane: "e9", tab: "t1", mod: MOD_EDITOR },
    ];
    host.focused = { pane: "e9" };
    files.disk.set("/p/a.txt", "a");
    host.props = { key: "k1", file: "/p/a.txt", tab: "t1", before: [] };
    const v = makeView();
    v.init(undefined, cx);
    await settle();
    expect((host.shared.get(SHARED_KEY) as { registry?: object } | undefined)?.registry ?? {}).toEqual({});
  });

  test("a pane opened without props.before does not register itself after loading", async () => {
    host.panes = [{ pane: "e9", tab: "t1", mod: MOD_EDITOR }];
    host.focused = { pane: "e9" };
    await opened();
    expect((host.shared.get(SHARED_KEY) as { registry?: object } | undefined)?.registry ?? {}).toEqual({});
  });

  test("registering drops other keys that name the same pane (a key from before a restart)", async () => {
    host.panes = [{ pane: "e9", tab: "t1", mod: MOD_EDITOR }];
    host.focused = { pane: "e9" };
    host.shared.set(SHARED_KEY, { registry: { old: { pane: "e9", tab: "t1", lastFocus: 1 } } });
    const v = await opened();
    await v.onCommand("focus", cx);
    const reg = (host.shared.get(SHARED_KEY) as { registry: Record<string, unknown> }).registry;
    expect(Object.keys(reg)).toEqual(["k1"]);
  });

  test("an empty editor shows Open file… and the bound key", async () => {
    host.keys = [{ section: "global", keys: "cmd-o", action: `mod.open:${MOD_OPEN}` }];
    const v = makeView();
    v.init(undefined, cx);
    await settle();
    host.texts = [];
    host.clicks.clear();
    v.render(cx);
    expect(host.texts).toContain("Open file…");
    expect(host.texts).toContain("cmd-o");
    host.clicks.get("open-file")!({}, cx);
    expect(host.run).toContainEqual({ command: "mod.open", args: { name: MOD_OPEN } });
  });

  test("an empty editor without a bound key shows only the button", async () => {
    const v = makeView();
    v.init(undefined, cx);
    await settle();
    host.texts = [];
    v.render(cx);
    expect(host.texts).toContain("Open file…");
    expect(host.texts.some((x) => x.includes("cmd-"))).toBe(false);
  });

  test("Open file… registers the empty pane so the opened file comes back to it", async () => {
    host.panes = [{ pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    host.focused = { pane: "e1" };
    const v = makeView();
    v.init(undefined, cx);
    await settle();
    host.clicks.clear();
    v.render(cx);
    host.clicks.get("open-file")!({}, cx);
    const reg = (host.shared.get(SHARED_KEY) as { registry: Record<string, { pane: string }> }).registry;
    expect(Object.values(reg)).toEqual([expect.objectContaining({ pane: "e1", tab: "t1" })]);
  });

  test("opens the file from props and remembers it for the pane", async () => {
    const v = await opened();
    expect(v.doc?.text).toBe("hello\n");
    expect(v.readonlyReason).toBeNull();
    expect(code().opts.readonly).toBe(false);
    expect(await new SlotStore(io).load(paneBase("k1"))).toEqual({
      file: "/p/a.txt",
      on: null,
      seenAt: expect.any(Number),
    });
    expect(() => v.render(cx)).not.toThrow();
  });

  test("the file remembered for the pane wins over props", async () => {
    files.disk.set("/p/b.txt", "b");
    await new SlotStore(io).save(paneBase("k1"), { file: "/p/b.txt", on: null });
    const v = await opened("/p/a.txt", "a");
    expect(v.doc?.path).toBe("/p/b.txt");
  });
});

describe("openFile", () => {
  test("shows a message for a missing, binary or unreadable file", async () => {
    const v = await opened();
    await v.openFile("/p/missing.txt", null, cx);
    expect(v.screen.text).toBe("/p/missing.txt does not exist.");
    expect(v.doc).toBeNull();

    files.disk.set("/p/bin", "a\0b");
    await v.openFile("/p/bin", null, cx);
    expect(v.screen.text).toBe("/p/bin looks like a binary file.");

    files.readError = new Error("invalid UTF-8");
    await v.openFile("/p/a.txt", null, cx);
    expect(v.screen.text).toContain("Cannot open /p/a.txt: Error: invalid UTF-8");
  });

  test("read-only reasons: remote, not writable, unknown, extension", async () => {
    const v = await opened();
    files.disk.set("/r.txt", "r");
    await v.openFile("/r.txt", "vps", cx);
    expect(v.readonlyReason).toBe("remote");
    expect(code().opts.readonly).toBe(true);

    files.writable = false;
    await v.openFile("/r.txt", null, cx);
    expect(v.readonlyReason).toBe("not-writable");

    files.writable = null;
    await v.openFile("/r.txt", null, cx);
    expect(v.readonlyReason).toBe("unknown");

    files.writable = true;
    extensions = [{ name: "lock", onFileOpen: () => ({ readonly: "locked by lock" }) }];
    const w = makeView();
    host.props = { key: "k2", file: "/r.txt" };
    w.init(undefined, cx);
    await settle();
    expect(w.readonlyReason).toBe("extension");
  });

  test("a newer open wins over an older one still reading (review B1)", async () => {
    const v = await opened();
    files.disk.set("/p/old.txt", "old");
    files.disk.set("/p/new.txt", "new");
    const gate = deferred<void>();
    files.gates.read = gate;
    const first = v.openFile("/p/old.txt", null, cx);
    const second = v.openFile("/p/new.txt", null, cx);
    await second;
    gate.resolve();
    await first;
    expect(v.doc?.path).toBe("/p/new.txt");
    expect(v.doc?.text).toBe("new");
  });

  test("an older open of a missing file does not blank out the newer document (review B1)", async () => {
    const v = await opened();
    files.disk.set("/p/new.txt", "new");
    const gate = deferred<void>();
    files.gates.read = gate;
    const first = v.openFile("/p/gone.txt", null, cx);
    await v.openFile("/p/new.txt", null, cx);
    gate.resolve();
    await first;
    expect(v.screen.kind).toBe("ready");
    expect(v.doc?.path).toBe("/p/new.txt");
  });

  test("leaving a dirty document drops its draft", async () => {
    const v = await opened();
    code().type("edited\n", cx);
    await settle();
    expect(hasDraft("/p/a.txt")).toBe(true);
    files.disk.set("/p/b.txt", "b");
    await v.openFile("/p/b.txt", null, cx);
    expect(hasDraft("/p/a.txt")).toBe(false);
    expect(v.doc?.path).toBe("/p/b.txt");
  });

  test("offers the newest draft that differs from disk, and restores it", async () => {
    const store = new SlotStore(io);
    const draft = (owner: string, text: string, savedAt: number) =>
      store.save(draftBase(null, "/p/a.txt", owner), {
        machine: null,
        path: "/p/a.txt",
        ownerKey: owner,
        baselineHash: "x",
        text,
        savedAt,
      });
    await draft("old", "older draft", 1);
    await draft("new", "newer draft", 2);
    await draft("same", "hello\n", 3); // equals disk: not an unsaved edit
    const v = await opened();
    expect(v.draftOffer?.text).toBe("newer draft");
    await v.act("restore", cx);
    expect(v.doc?.text).toBe("newer draft");
    expect(code().text).toBe("newer draft");
    expect(v.draftOffer).toBeNull();
  });

  test("restoring another pane's draft takes it over, so saving leaves no draft behind", async () => {
    // A closed pane's draft, restored in this pane (k1): nothing else would ever remove it.
    await new SlotStore(io).save(draftBase(null, "/p/a.txt", "gone"), {
      machine: null,
      path: "/p/a.txt",
      ownerKey: "gone",
      baselineHash: "x",
      text: "restored\n",
      savedAt: 1,
    });
    const v = await opened();
    await v.act("restore", cx);
    await settle();
    expect(hasDraft("/p/a.txt")).toBe(true);
    expect(draftKeys().some((k) => k.startsWith(draftBase(null, "/p/a.txt", "gone")))).toBe(false);
    expect(await v.save(cx)).toBe(true);
    expect(files.disk.get("/p/a.txt")).toBe("restored\n");
    expect(draftKeys()).toEqual([]);
  });

  test("a restored draft stays where it was if this pane's copy cannot be written", async () => {
    await new SlotStore(io).save(draftBase(null, "/p/a.txt", "gone"), {
      machine: null,
      path: "/p/a.txt",
      ownerKey: "gone",
      baselineHash: "x",
      text: "restored\n",
      savedAt: 1,
    });
    const v = await opened();
    const write = io.write.bind(io);
    io.write = async (rel, text) => {
      if (rel.startsWith(draftBase(null, "/p/a.txt", "k1"))) throw new Error("disk full");
      return write(rel, text);
    };
    await v.act("restore", cx);
    await settle();
    expect(v.doc?.text).toBe("restored\n");
    expect(draftKeys().some((k) => k.startsWith(draftBase(null, "/p/a.txt", "gone")))).toBe(true);
  });
});

describe("images (#42)", () => {
  test("an image file is shown through the image store, without reading it as text", async () => {
    const v = await opened();
    images.present.add("/p/pic.PNG");
    let read = false;
    files.read = async () => {
      read = true;
      return null;
    };
    await v.openFile("/p/pic.PNG", null, cx);
    expect(v.screen).toEqual({ kind: "image", path: "/p/pic.PNG", src: "images/k1/1" });
    expect(read).toBe(false);
    expect(v.doc).toBeNull();
    expect(code().released).toBe(true);

    host.images = [];
    host.texts = [];
    v.render(cx);
    expect(host.images).toEqual(["images/k1/1"]);
    expect(host.texts).toEqual(["pic.PNG", "/p/pic.PNG"]);
  });

  test("the pane is repainted while the host loads the picture: quickly for 3 s, then every second up to 30 s", async () => {
    const v = await opened();
    images.present.add("/p/pic.png");
    let notified = 0;
    cx.notify = () => notified++;
    await v.openFile("/p/pic.png", null, cx);
    notified = 0;
    // Without the one sleep init starts for the pane-state sweep.
    const waits = () => cx.sleeps.filter((ms) => ms !== 60_000);
    await until(() => waits().length === 39);
    await settle();
    expect(waits().length).toBe(39);
    expect(waits().slice(0, 12)).toEqual(Array(12).fill(250));
    expect(waits().reduce((a, b) => a + b, 0)).toBe(30_000);
    expect(notified).toBe(39);
  });

  test("the repaints stop once another file is open", async () => {
    const v = await opened();
    images.present.add("/p/pic.png");
    await v.openFile("/p/pic.png", null, cx);
    await v.openFile("/p/a.txt", null, cx);
    const before = cx.sleeps.length;
    let notified = 0;
    cx.notify = () => notified++;
    await until(() => false, 60);
    expect(cx.sleeps.length - before).toBeLessThanOrEqual(1);
    expect(notified).toBe(0);
  });

  test("the pane remembers the image and shows it again after a restart", async () => {
    const v = await opened();
    images.present.add("/p/pic.png");
    await v.openFile("/p/pic.png", null, cx);
    await settle();

    host.props = { key: "k1", file: "/p/a.txt" };
    const again = makeView();
    again.init(undefined, cx);
    await settle();
    expect(again.screen).toMatchObject({ kind: "image", path: "/p/pic.png" });
  });

  test("opening the shown image again exposes it under a new path (the host caches by path)", async () => {
    const v = await opened();
    images.present.add("/p/pic.png");
    await v.openFile("/p/pic.png", null, cx);
    await v.openFile("/p/pic.png", null, cx);
    expect(v.screen.src).toBe("images/k1/2");
  });

  test("a missing image and an image on another machine show a message", async () => {
    const v = await opened();
    await v.openFile("/p/gone.png", null, cx);
    expect(v.screen.text).toBe("Cannot show /p/gone.png: the file is missing or unreadable");
    expect(v.doc).toBeNull();

    images.present.add("/p/far.png");
    await v.openFile("/p/far.png", "box", cx);
    expect(v.screen.text).toBe("/p/far.png is on another machine. Images there cannot be shown yet.");
    expect(images.exposed).toEqual([]);
  });

  test("a text file opened while the image is being exposed wins", async () => {
    const v = await opened();
    images.present.add("/p/pic.png");
    files.disk.set("/p/b.txt", "b");
    images.gate = deferred();
    const gate = images.gate;
    const first = v.openFile("/p/pic.png", null, cx);
    await settle();
    await v.openFile("/p/b.txt", null, cx);
    gate.resolve();
    await first;
    expect(v.screen.kind).toBe("ready");
    expect(v.doc?.path).toBe("/p/b.txt");
  });

  test("a text file opens after an image, and an svg is still text", async () => {
    const v = await opened();
    images.present.add("/p/pic.png");
    await v.openFile("/p/pic.png", null, cx);
    files.disk.set("/p/logo.svg", "<svg/>");
    await v.openFile("/p/logo.svg", null, cx);
    expect(v.screen.kind).toBe("ready");
    expect(v.doc?.text).toBe("<svg/>");
  });

  test("leaving a dirty document for an image drops its draft", async () => {
    const v = await opened();
    code().type("edited", cx);
    await settle();
    expect(hasDraft("/p/a.txt")).toBe(true);
    images.present.add("/p/pic.png");
    await v.openFile("/p/pic.png", null, cx);
    expect(v.screen.kind).toBe("image");
    expect(hasDraft("/p/a.txt")).toBe(false);
  });

  test("closing the pane releases its image link", async () => {
    const v = await opened();
    images.present.add("/p/pic.png");
    await v.openFile("/p/pic.png", null, cx);
    await v.close(cx);
    expect(images.released).toEqual(["k1"]);
  });
});

describe("editing", () => {
  test("an edit writes a draft; undoing back to disk removes it (review S1)", async () => {
    const v = await opened();
    code().type("edited\n", cx);
    await settle();
    expect(v.doc?.status).toBe("dirty");
    expect(hasDraft("/p/a.txt")).toBe(true);
    code().type("hello\n", cx);
    await settle();
    expect(v.doc?.status).toBe("clean");
    expect(draftKeys()).toEqual([]);
  });
});

describe("save", () => {
  test("writes against the baseline, then removes the draft", async () => {
    const v = await opened();
    code().type("edited\n", cx);
    await settle();
    expect(await v.save(cx)).toBe(true);
    expect(files.writes).toEqual([{ path: "/p/a.txt", text: "edited\n", expected: "hello\n" }]);
    expect(v.doc?.status).toBe("clean");
    expect(v.doc?.baseline).toBe("edited\n");
    expect(draftKeys()).toEqual([]);
  });

  test("keeps the file's line endings", async () => {
    const v = await opened("/p/crlf.txt", "a\r\nb\r\n");
    code().type("a\nb\nc\n", cx);
    expect(await v.save(cx)).toBe(true);
    expect(files.writes[0]?.text).toBe("a\r\nb\r\nc\r\n");
  });

  test("a file that became read-only is not written", async () => {
    const v = await opened();
    code().type("edited\n", cx);
    files.writable = false;
    expect(await v.save(cx)).toBe(false);
    expect(files.writes).toEqual([]);
    expect(v.readonlyReason).toBe("not-writable");
  });

  test("switching files during the permission check: the new file is not marked read-only", async () => {
    const v = await opened();
    code().type("edited\n", cx);
    files.disk.set("/p/b.txt", "b");
    const gate = deferred<void>();
    files.gates.canWrite = gate;
    const saving = v.save(cx);
    await settle();
    await v.openFile("/p/b.txt", null, cx);
    files.writable = false; // the answer for the old file arrives after the switch
    gate.resolve();
    expect(await saving).toBe(false);
    expect(v.doc?.path).toBe("/p/b.txt");
    expect(v.readonlyReason).toBeNull();
  });

  test("an edit while beforeSave runs stops the save", async () => {
    const hook = deferred<void>();
    extensions = [
      {
        name: "slow",
        beforeSave: async () => {
          await hook.promise;
        },
      },
    ];
    const v = await opened();
    code().type("edited\n", cx);
    const saving = v.save(cx);
    await settle();
    code().type("edited again\n", cx);
    hook.resolve();
    expect(await saving).toBe(false);
    expect(files.writes).toEqual([]);
  });

  test("an edit during the permission check stops the save", async () => {
    const v = await opened();
    code().type("edited\n", cx);
    const gate = deferred<void>();
    files.gates.canWrite = gate;
    const saving = v.save(cx);
    code().type("edited again\n", cx);
    gate.resolve();
    expect(await saving).toBe(false);
    expect(files.writes).toEqual([]);
    expect(v.doc?.status).toBe("dirty");
  });

  test("a beforeSave extension can cancel the save", async () => {
    extensions = [{ name: "guard", beforeSave: () => ({ cancel: "not today" }) }];
    const v = await opened();
    code().type("edited\n", cx);
    expect(await v.save(cx)).toBe(false);
    expect(files.writes).toEqual([]);
    expect(v.extensionNotes).toEqual(["Save cancelled. guard: not today"]);
  });

  test("text rewritten by a beforeSave extension is shown and saved", async () => {
    extensions = [{ name: "upper", beforeSave: (f) => ({ text: f.text.toUpperCase() }) }];
    const v = await opened();
    code().type("edited\n", cx);
    expect(await v.save(cx)).toBe(true);
    expect(files.writes[0]?.text).toBe("EDITED\n");
    expect(code().text).toBe("EDITED\n");
    expect(v.doc?.status).toBe("clean");
  });

  test("a failed write is classified by re-reading the file", async () => {
    const v = await opened();
    code().type("edited\n", cx);
    files.failWrite = new Error("conflict");
    files.disk.set("/p/a.txt", "someone else\n");
    expect(await v.save(cx)).toBe(false);
    expect(v.doc?.status).toBe("error");
    expect(v.doc?.failure?.observed).toBe("changed");

    files.disk.delete("/p/a.txt");
    await v.act("retry", cx);
    expect(v.doc?.failure?.observed).toBe("deleted");
  });

  test("switching files while the write runs: the save does not continue", async () => {
    const v = await opened();
    code().type("edited\n", cx);
    await settle();
    const gate = deferred<void>();
    files.gates.write = gate;
    const saving = v.save(cx);
    await settle();
    files.disk.set("/p/b.txt", "b");
    await v.openFile("/p/b.txt", null, cx);
    gate.resolve();
    expect(await saving).toBe(false);
    expect(files.disk.get("/p/a.txt")).toBe("edited\n");
    expect(v.doc?.path).toBe("/p/b.txt");
    expect(hasDraft("/p/a.txt")).toBe(false);
  });

  test("switching files while the draft is flushed after a save removes the saved file's draft (#10)", async () => {
    const v = await opened();
    io.draftGate = deferred<void>();
    const gate = io.draftGate;
    code().type("edited\n", cx);
    await settle(); // the draft write of a.txt is now in flight
    const saving = v.save(cx);
    await settle(); // saved; waiting for that draft write
    files.disk.set("/p/b.txt", "b");
    await v.openFile("/p/b.txt", null, cx);
    gate.resolve();
    expect(await saving).toBe(false);
    expect(files.disk.get("/p/a.txt")).toBe("edited\n");
    expect(v.doc?.path).toBe("/p/b.txt");
    expect(hasDraft("/p/a.txt")).toBe(false);
  });

  test("save, then open: a failed save keeps the current file", async () => {
    const v = await opened();
    code().type("edited\n", cx);
    files.disk.set("/p/b.txt", "b");
    const open = (req: string) =>
      `open:${JSON.stringify({ to: "k1", req, file: "/p/b.txt", on: null, sentAt: Date.now() })}`;
    await v.onCommand(open("r1"), cx);
    expect(host.overlays).toHaveLength(1);
    files.failWrite = new Error("disk full");
    await v.onCommand(`reply:${JSON.stringify({ to: "k1", req: "r1", choice: "save" })}`, cx);
    expect(v.doc?.path).toBe("/p/a.txt");
    expect(v.doc?.status).toBe("error");

    files.failWrite = null;
    await v.onCommand(open("r2"), cx);
    await v.onCommand(`reply:${JSON.stringify({ to: "k1", req: "r2", choice: "save" })}`, cx);
    expect(files.disk.get("/p/a.txt")).toBe("edited\n");
    expect(v.doc?.path).toBe("/p/b.txt");
  });
});

describe("external changes", () => {
  test("polling reloads a clean document and marks a dirty one", async () => {
    const v = await opened();
    files.disk.set("/p/a.txt", "changed on disk\n");
    v.maybePoll(cx);
    await settle();
    expect(v.doc?.text).toBe("changed on disk\n");
    expect(code().text).toBe("changed on disk\n");

    code().type("mine\n", cx);
    files.disk.set("/p/a.txt", "changed again\n");
    (v as unknown as { lastPoll: number }).lastPoll = 0;
    v.maybePoll(cx);
    await settle();
    expect(v.doc?.status).toBe("dirtyExternal");
    expect(v.doc?.text).toBe("mine\n");
  });

  test("reload is skipped when the user edited while it was reading (review B2)", async () => {
    const v = await opened();
    code().type("mine\n", cx);
    files.disk.set("/p/a.txt", "theirs\n");
    const gate = deferred<void>();
    files.gates.read = gate;
    const reloading = v.act("reload", cx);
    code().type("mine, more\n", cx);
    gate.resolve();
    await reloading;
    await settle();
    expect(v.doc?.text).toBe("mine, more\n");
    expect(hasDraft("/p/a.txt")).toBe(true);

    await v.act("reload", cx);
    expect(v.doc?.text).toBe("theirs\n");
    expect(v.doc?.status).toBe("clean");
  });
});

describe("close", () => {
  test("a dialog button closes the overlay it was opened as, even when props() is empty later", () => {
    host.props = { role: "dialog", to: "k1", req: "r1", file: "/p/a.txt", overlay: "ov7" };
    const v = makeView();
    v.init(undefined, cx);
    host.props = {};
    host.clicks.clear();
    v.render(cx);
    host.clicks.get("dlg-cancel")!({}, cx);
    expect(host.closed).toEqual(["ov7"]);
  });

  test("a dialog closed without a choice replies cancel to its editor", async () => {
    host.props = { role: "dialog", to: "k1", req: "r1", file: "/p/a.txt" };
    const v = makeView();
    v.init(undefined, cx);
    expect(() => v.render(cx)).not.toThrow();
    await v.close(cx);
    expect(host.run.map((r) => r.command)).toEqual([
      `${MOD_EDITOR}.reply:${JSON.stringify({ to: "k1", req: "r1", choice: "cancel" })}`,
    ]);
  });

  test("closing the editor writes the pending draft", async () => {
    const v = await opened();
    // A timer that never fires: only close() can write the draft.
    cx.timer.after = () => ({ cancel() {} });
    code().type("edited\n", cx);
    await settle();
    expect(hasDraft("/p/a.txt")).toBe(false);
    await v.close(cx);
    expect(hasDraft("/p/a.txt")).toBe(true);
  });
});

describe("at: opening at a line", () => {
  const T = "l1\nl2 foo\nl3";
  const openAt = (req: string, file: string, at: unknown) =>
    `open:${JSON.stringify({ to: "k1", req, file, on: null, sentAt: Date.now(), at })}`;

  test("open with at selects the range after loading", async () => {
    const v = await opened("/p/b.txt", "b");
    files.disk.set("/p/a.txt", T);
    await v.onCommand(openAt("r1", "/p/a.txt", { line: 2, col: 4, len: 3 }), cx);
    await settle();
    expect(v.doc?.path).toBe("/p/a.txt");
    expect(code().selected).toEqual({ start: 6, end: 9 });
    expect(code().focusCount).toBeGreaterThanOrEqual(1);
  });

  test("a same-file at moves without reloading and keeps edits", async () => {
    const v = await opened("/p/a.txt", T);
    code().type("l1\nl2 foo\nl3 edited", cx);
    const states = FakeEditorState.created.length;
    await v.onCommand(openAt("r1", "/p/a.txt", { line: 3 }), cx);
    await settle();
    expect(FakeEditorState.created.length).toBe(states);
    expect(code().text).toContain("edited");
    expect(code().selected).toEqual({ start: 10, end: 10 });
    expect(host.overlays).toHaveLength(0);
  });

  test("a same-file at while that file loads is applied after the load", async () => {
    const v = await opened("/p/b.txt", "b");
    files.disk.set("/p/a.txt", T);
    const gate = deferred<void>();
    files.gates.read = gate;
    const first = v.onCommand(openAt("r1", "/p/a.txt", { line: 2 }), cx);
    await settle();
    expect(v.screen.kind).toBe("loading");
    await v.onCommand(openAt("r2", "/p/a.txt", { line: 3 }), cx);
    gate.resolve();
    await first;
    await settle();
    expect(code().selected).toEqual({ start: 10, end: 10 });
  });

  test("an at for the shown file while another file loads opens the shown file again at that line", async () => {
    const v = await opened("/p/a.txt", T);
    files.disk.set("/p/b.txt", "b");
    const gate = deferred<void>();
    files.gates.read = gate;
    const first = v.onCommand(openAt("r1", "/p/b.txt", { line: 1 }), cx);
    await settle();
    await v.onCommand(openAt("r2", "/p/a.txt", { line: 3 }), cx);
    gate.resolve();
    await first;
    await settle();
    expect(v.doc?.path).toBe("/p/a.txt");
    expect(code().selected).toEqual({ start: 10, end: 10 });
  });

  test("an at for the file being opened while the dirty one is still being left waits for that file", async () => {
    const v = await opened("/p/a.txt", "a\n");
    code().type("a edited\n", cx);
    await settle(); // the draft of a.txt is on disk
    files.disk.set("/p/b.txt", T);
    await v.onCommand(openAt("r1", "/p/b.txt", { line: 1 }), cx);
    const gate = deferred<void>();
    io.unlinkGate = gate; // "Don't save" removes the draft: hold that open
    const leaving = v.onCommand(`reply:${JSON.stringify({ to: "k1", req: "r1", choice: "discard" })}`, cx);
    await settle();
    await v.onCommand(openAt("r2", "/p/b.txt", { line: 3 }), cx);
    gate.resolve();
    await leaving;
    await settle();
    expect(v.doc?.path).toBe("/p/b.txt");
    expect(code().selected).toEqual({ start: 10, end: 10 });
  });

  test("an at for a file whose opening was given up is not applied to the file that stayed", async () => {
    const v = await opened("/p/a.txt", "a1\na2\na3\n");
    code().type("a1\na2\na3 edited\n", cx);
    await settle();
    files.disk.set("/p/b.txt", T);
    await v.onCommand(openAt("r1", "/p/b.txt", { line: 3 }), cx);
    const gate = deferred<void>();
    io.unlinkGate = gate;
    const leaving = v.onCommand(`reply:${JSON.stringify({ to: "k1", req: "r1", choice: "discard" })}`, cx);
    await settle();
    code().type("a1\na2\na3 edited again\n", cx); // edited after choosing: a.txt stays
    gate.resolve();
    await leaving;
    await settle();
    expect(v.doc?.path).toBe("/p/a.txt");
    expect(code().selected).toBeNull();
  });

  test("split props at is used on the first load", async () => {
    files.disk.set("/p/a.txt", T);
    host.props = { key: "k1", file: "/p/a.txt", at: { line: 2 } };
    const v = makeView();
    v.init(undefined, cx);
    await settle();
    expect(code().selected).toEqual({ start: 3, end: 3 });
  });

  test("split props at is ignored when a saved pane state exists", async () => {
    files.disk.set("/p/a.txt", T);
    await new SlotStore(io).save(paneBase("k1"), { file: "/p/a.txt", on: null });
    host.props = { key: "k1", file: "/p/a.txt", at: { line: 2 } };
    const v = makeView();
    v.init(undefined, cx);
    await settle();
    expect(v.screen.kind).toBe("ready");
    expect(code().selected).toBeNull();
  });

  test("an unopenable file ignores at", async () => {
    const v = await opened("/p/b.txt", "b");
    const before = FakeEditorState.created.length;
    await v.onCommand(openAt("r1", "/p/missing.txt", { line: 2 }), cx);
    await settle();
    expect(v.screen.kind).toBe("message");
    expect(FakeEditorState.created.length).toBe(before);
  });
});
