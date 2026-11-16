// The herdr-app-editor changes to the forked Files panel (src/entries/editor-files.js): which folder
// it shows while an editor has focus, sending clicked files to an editor, and releasing folder watches.
import { beforeEach, describe, expect, test } from "bun:test";
import { MOD_EDITOR, SHARED_KEY } from "../../src/core/names";
import { decodeCommand } from "../../src/core/routing/routing";
import { host, install, makeCx, reset, settle, type FakeCx, type FakePane } from "./host";

install();
// @ts-expect-error -- untyped JavaScript forked from upstream; FilesView below lists what the tests use
const { default: Files } = await import("../../src/entries/editor-files.js");

interface FilesView {
  root: string | undefined;
  splitting?: boolean;
  init(props: unknown, cx: FakeCx): void;
  refresh(cx: FakeCx): void;
  openInEditor(path: string, cx: FakeCx, newPane?: boolean): void;
  entries: Map<string, { name: string; dir: boolean }[]>;
  folders: Set<string>;
  rows(prefix: string, depth: number, out: unknown[], theme: unknown): unknown[];
  close(): Promise<void>;
}

let cx: FakeCx;
const TERMINAL: FakePane = { pane: "p1", tab: "t1", cwd: "/work/app" };

function start(): FilesView {
  const v = new Files() as unknown as FilesView;
  v.init(undefined, cx);
  return v;
}
const commands = () => host.run.map((r) => r.command);
const opens = () =>
  host.run
    .map((r) => decodeCommand(r.command.slice(MOD_EDITOR.length + 1)))
    .filter((c) => c.verb === "open")
    .map((c) => c.payload as { to: string; file: string; on: string | null });
const registry = () =>
  ((host.shared.get(SHARED_KEY) as { registry?: Record<string, { pane: string; tab: string }> }) ?? {}).registry ?? {};

beforeEach(() => {
  reset();
  cx = makeCx();
  host.spaces = [{ id: "s1", active: true, folder: "/space", machine: null, tabs: [{ id: "t1", active: true }] }];
  host.panes = [TERMINAL];
  host.focused = { pane: "p1" };
});

describe("folder", () => {
  test("while an editor pane has focus, the tree follows a terminal in the same tab", () => {
    host.panes = [{ pane: "p0", tab: "t0", cwd: "/elsewhere" }, TERMINAL, { pane: "p2", tab: "t1", mod: MOD_EDITOR }];
    host.focused = { pane: "p2" };
    expect(start().root).toBe("/work/app");
  });

  test("the pending folder watch is released when the folder changes and on close", async () => {
    host.exec = async (cmd) => ({ code: cmd === "sh" ? 0 : 1, stdout: "", stderr: "" });
    const v = start();
    await settle();
    expect(host.watches).toHaveLength(1);
    const first = host.watches[0]!;
    host.panes = [{ ...TERMINAL, cwd: "/work/other" }];
    v.refresh(cx);
    expect(first.cancelled).toBe(true);
    await settle();
    expect(host.watches).toHaveLength(2);
    await v.close();
    await settle();
    // The cancelled watch resolves; the watch loop must stop instead of watching again.
    expect(host.watches.map((w) => w.cancelled)).toEqual([true, true]);
  });
});

describe("opening files in the editor", () => {
  test("goes to the latest focused editor in this tab", () => {
    host.panes = [TERMINAL, { pane: "e1", tab: "t1", mod: MOD_EDITOR }, { pane: "e2", tab: "t1", mod: MOD_EDITOR }];
    host.shared.set(SHARED_KEY, {
      registry: {
        k1: { pane: "e1", tab: "t1", lastFocus: 1 },
        k2: { pane: "e2", tab: "t1", lastFocus: 2 },
      },
    });
    const v = start();
    v.openInEditor("src/a.ts", cx);
    expect(host.run[0]).toEqual({ command: "pane.focus", args: { pane: "e2" } });
    expect(opens()).toEqual([expect.objectContaining({ to: "k2", file: "/work/app/src/a.ts", on: null })]);
  });

  test("an editor in another tab is not used: a new one is split next to the focused pane and registered", async () => {
    host.panes = [TERMINAL, { pane: "e9", tab: "t9", mod: MOD_EDITOR }];
    host.shared.set(SHARED_KEY, { registry: { k9: { pane: "e9", tab: "t9", lastFocus: 1 } } });
    host.onRun = (command) => {
      if (command === "pane.split") host.panes = [...host.panes, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    };
    const v = start();
    v.openInEditor("a.ts", cx);
    const split = host.run.find((r) => r.command === "pane.split")!.args as {
      pane: string;
      direction: string;
      mod: string;
      props: { key: string; file: string; on: null };
    };
    expect(split).toMatchObject({ pane: "p1", direction: "right", mod: MOD_EDITOR });
    expect(split.props).toMatchObject({ file: "/work/app/a.ts", on: null });
    await settle();
    expect(registry()[split.props.key]).toMatchObject({ pane: "e1", tab: "t1" });
    expect(registry().k9).toBeDefined();
    expect(v.splitting).toBe(false);
  });

  test("clicks during a split wait for it, then go to the new editor in order", async () => {
    let created = false;
    host.onRun = (command) => {
      if (command === "pane.split") {
        if (created) throw new Error("second split");
        created = true;
        host.panes = [...host.panes, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
      }
    };
    const v = start();
    v.openInEditor("a.ts", cx);
    v.openInEditor("b.ts", cx);
    v.openInEditor("c.ts", cx);
    expect(commands().filter((c) => c === "pane.split")).toHaveLength(1);
    expect(opens()).toEqual([]);
    await settle();
    const key = Object.keys(registry())[0]!;
    expect(opens().map((o) => [o.to, o.file])).toEqual([
      [key, "/work/app/b.ts"],
      [key, "/work/app/c.ts"],
    ]);
  });

  test("a failed split lets the next click try again", () => {
    host.onRun = (command) => {
      if (command === "pane.split") throw new Error("no room");
    };
    const v = start();
    expect(() => v.openInEditor("a.ts", cx)).toThrow("no room");
    expect(v.splitting).toBe(false);
    expect(() => v.openInEditor("b.ts", cx)).toThrow("no room");
    expect(commands().filter((c) => c === "pane.split")).toHaveLength(2);
  });

  test("newPane splits even when an editor exists", () => {
    host.panes = [TERMINAL, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    host.shared.set(SHARED_KEY, { registry: { k1: { pane: "e1", tab: "t1", lastFocus: 1 } } });
    const v = start();
    v.openInEditor("a.ts", cx, true);
    expect(commands()).toEqual(["pane.split"]);
  });
});

describe("clicking a row", () => {
  /** Renders the tree rows and records which file openInEditor received. */
  function rendered() {
    const v = start();
    const calls: { path: string; newPane: boolean }[] = [];
    v.openInEditor = (path, _cx, newPane = false) => calls.push({ path, newPane });
    v.entries.set("", [
      { name: "src", dir: true },
      { name: "a.txt", dir: false },
    ]);
    v.rows("", 0, [], {});
    const click = (id: string, modifiers: Record<string, boolean> = {}) => host.clicks.get(id)!({ modifiers }, cx);
    return { v, calls, click };
  }

  test("a file opens in the editor; cmd-click on macOS opens a new editor pane", () => {
    const { calls, click } = rendered();
    click("file-a.txt");
    click("file-a.txt", { platform: true });
    click("file-a.txt", { control: true });
    expect(calls).toEqual([
      { path: "a.txt", newPane: false },
      { path: "a.txt", newPane: true },
      { path: "a.txt", newPane: false },
    ]);
  });

  test("ctrl-click opens a new editor pane on Linux and Windows", () => {
    host.platform = "linux";
    const { calls, click } = rendered();
    click("file-a.txt", { platform: true });
    click("file-a.txt", { control: true });
    expect(calls).toEqual([
      { path: "a.txt", newPane: false },
      { path: "a.txt", newPane: true },
    ]);
  });

  test("a folder expands and collapses instead of opening", () => {
    const { v, calls, click } = rendered();
    click("file-src");
    expect(v.folders.has("src")).toBe(true);
    click("file-src");
    expect(v.folders.has("src")).toBe(false);
    expect(calls).toEqual([]);
  });
});
