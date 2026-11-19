// The herdr-app-editor changes to the forked Files panel (src/entries/editor-files.js): which folder
// it shows while an editor has focus, sending clicked files to an editor, and releasing folder watches.
import { beforeEach, describe, expect, test } from "bun:test";
import { MOD_EDITOR } from "../../src/core/names";
import { FakeEditorState, host, install, makeCx, reset, settle, type FakeCx, type FakePane } from "./host";

install();
// @ts-expect-error -- untyped JavaScript forked from upstream; FilesView below lists what the tests use
const { default: Files, EDITOR_CHECK_MS } = await import("../../src/entries/editor-files.js");

interface FilesView {
  root: string | undefined;
  opener?: { splitting: boolean };
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

describe("opening files", () => {
  // Which editor pane a file goes to is EditorOpener's job (tests/ui/opener.test.ts).
  const MOD_JSON = "/fake-home/mods/herdr-app-editor/mod.json";

  test("with the editor mod, a click opens the editor", async () => {
    host.files.set(MOD_JSON, "{}");
    host.files.set("/work/app/a.ts", "a");
    const v = start();
    v.openInEditor("a.ts", cx);
    await settle();
    const split = host.run.find((r) => r.command === "pane.split")!.args as { mod: string; props: { file: string } };
    expect(split).toMatchObject({ mod: MOD_EDITOR, props: { file: "/work/app/a.ts" } });
    expect(FakeEditorState.created).toEqual([]);
  });

  test("without the editor mod, a click shows the read-only preview", async () => {
    host.files.set("/work/app/a.ts", "preview me");
    const v = start();
    v.openInEditor("a.ts", cx);
    await settle();
    expect(commands()).toEqual([]);
    expect(FakeEditorState.created.at(-1)).toMatchObject({ opts: { readonly: true, value: "preview me" } });
  });

  test("without the editor mod, a click made before the folder changed previews nothing from the new folder", async () => {
    host.files.set("/work/app/a.ts", "old");
    host.files.set("/work/other/a.ts", "new");
    const v = start();
    v.openInEditor("a.ts", cx);
    // The person switches to another folder before the install check returns.
    host.panes = [{ ...TERMINAL, cwd: "/work/other" }];
    v.refresh(cx);
    await settle();
    expect(host.reads).not.toContain("/work/other/a.ts");
  });

  test("without the editor mod, a click made before switching to the same path on another machine previews nothing", async () => {
    host.files.set("/work/app/a.ts", "local");
    const v = start();
    v.openInEditor("a.ts", cx);
    host.spaces = [{ id: "s1", active: true, folder: "/space", machine: "vps", tabs: [{ id: "t1", active: true }] }];
    v.refresh(cx);
    await settle();
    expect(FakeEditorState.created).toEqual([]);
  });

  test("the check is cached for EDITOR_CHECK_MS", async () => {
    host.files.set(MOD_JSON, "{}");
    host.onRun = (command) => {
      if (command === "pane.split") host.panes = [...host.panes, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    };
    const v = start();
    v.openInEditor("a.ts", cx);
    await settle();
    v.openInEditor("b.ts", cx);
    await settle();
    expect(EDITOR_CHECK_MS).toBe(5000);
    expect(host.reads.filter((r) => r === MOD_JSON)).toHaveLength(1);
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
    host.clicks.clear();
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
