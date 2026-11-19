// The quick open overlay (src/ui/open-view.ts): listing the focused folder, filtering, and opening
// the chosen file in an editor pane of the tab that was shown when the overlay opened.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MOD_EDITOR, SHARED_KEY } from "../../src/core/names";
import { FakeInputState, host, install, makeCx, reset, settle, until, type ExecOptions, type FakeCx } from "./host";

install();
const { OpenView, LOAD_WAIT_MS } = await import("../../src/ui/open-view");

interface View {
  init(props: unknown, cx: FakeCx): void;
  render(cx: FakeCx): unknown;
  onKey(e: { key: string; modifiers?: Record<string, boolean> }, cx: FakeCx): void;
}

let cx: FakeCx;
let calls: { cmd: string; args: string[]; opts?: ExecOptions | undefined }[];
const GIT = ["ls-files", "-co", "--exclude-standard", "-z"];
const FIND = [".", "-type", "f", "-not", "-path", "*/.git/*", "-not", "-path", "*/node_modules/*"];

function gitFiles(paths: string[]) {
  host.exec = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return cmd === "git"
      ? { code: 0, stdout: paths.map((p) => p + "\0").join(""), stderr: "" }
      : { code: 1, stdout: "", stderr: "" };
  };
}
async function start(): Promise<View> {
  const v = new OpenView() as unknown as View;
  v.init(undefined, cx);
  await settle();
  return v;
}
const input = () => FakeInputState.created.at(-1)!;
function shown(v: View) {
  host.texts = [];
  host.clicks.clear();
  v.render(cx);
  return host.texts;
}
const split = () =>
  host.run.find((r) => r.command === "pane.split")?.args as { props: { file: string; on: string | null } } | undefined;

beforeEach(() => {
  reset();
  cx = makeCx();
  calls = [];
  host.props = { overlay: "ov1" };
  host.spaces = [{ id: "s1", active: true, folder: "/space", machine: null, tabs: [{ id: "t1", active: true }] }];
  host.panes = [{ pane: "p1", tab: "t1", cwd: "/work/app" }];
  host.focused = { pane: "p1" };
});

// A choice leaves the opener registering a split pane for up to 30 sleeps; let it finish so it does
// not close the next test's overlay.
afterEach(() => until(() => false, 50));

describe("listing", () => {
  test("lists git files of the focused terminal's folder", async () => {
    gitFiles(["src/a.ts", "README.md"]);
    const v = await start();
    expect(calls[0]).toEqual({ cmd: "git", args: GIT, opts: { cwd: "/work/app", on: null } });
    expect(shown(v)).toEqual(expect.arrayContaining(["src/a.ts", "README.md"]));
  });

  test("falls back to find when git fails", async () => {
    host.exec = async (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return cmd === "git"
        ? { code: 128, stdout: "", stderr: "not a git repository" }
        : { code: 0, stdout: "./notes.txt\n", stderr: "" };
    };
    const v = await start();
    expect(calls[1]).toEqual({ cmd: "find", args: FIND, opts: { cwd: "/work/app", on: null } });
    expect(shown(v)).toContain("notes.txt");
  });

  test("shows that the list was cut", async () => {
    gitFiles(Array.from({ length: 20001 }, (_, i) => `f${i}`));
    const v = await start();
    expect(shown(v)).toContain("Showing the first 20000 files");
  });

  test("a remote space lists and opens with on", async () => {
    host.spaces = [{ id: "s1", active: true, folder: "/srv", machine: "vps", tabs: [{ id: "t1", active: true }] }];
    gitFiles(["a.ts"]);
    const v = await start();
    expect(calls[0]!.opts).toEqual({ cwd: "/work/app", on: "vps" });
    v.onKey({ key: "enter", modifiers: {} }, cx);
    expect(split()!.props).toMatchObject({ file: "/work/app/a.ts", on: "vps" });
  });

  test("herdr-app check renders without running exec", async () => {
    host.checking = true;
    const v = await start();
    expect(calls).toEqual([]);
    expect(() => v.render(cx)).not.toThrow();
  });
});

describe("filtering and choosing", () => {
  test("typing filters with rankPaths and shows at most SHOW_LIMIT rows", async () => {
    gitFiles([...Array.from({ length: 60 }, (_, i) => `x/main${i}.rs`), "README.md"]);
    const v = await start();
    input().type("main", cx);
    const rows = shown(v).filter((t) => t.startsWith("x/"));
    expect(rows).toHaveLength(50);
    expect(shown(v)).not.toContain("README.md");
  });

  test("Enter opens the selected file in the tab shown when the overlay opened, then closes", async () => {
    gitFiles(["src/a.ts", "src/b.ts"]);
    const v = await start();
    // The person switches tabs while the overlay is open: the file still goes to t1.
    host.spaces = [
      {
        id: "s1",
        active: true,
        folder: "/space",
        machine: null,
        tabs: [
          { id: "t1", active: false },
          { id: "t2", active: true },
        ],
      },
    ];
    v.onKey({ key: "down", modifiers: {} }, cx);
    v.onKey({ key: "enter", modifiers: {} }, cx);
    expect(host.run.find((r) => r.command === "pane.split")!.args).toMatchObject({ pane: "p1", mod: MOD_EDITOR });
    expect(split()!.props.file).toBe("/work/app/src/b.ts");
  });

  test("after a split the overlay stays, showing Opening…, until the new editor reports it loaded", async () => {
    gitFiles(["a.ts"]);
    host.onRun = (command) => {
      if (command === "pane.split") host.panes = [...host.panes, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    };
    const v = await start();
    v.onKey({ key: "enter", modifiers: {} }, cx);
    const state = () =>
      (host.shared.get(SHARED_KEY) ?? {}) as { registry?: Record<string, unknown>; loaded?: Record<string, number> };
    await until(() => Object.keys(state().registry ?? {}).length > 0);
    await settle();
    expect(host.closed).toEqual([]);
    expect(shown(v)).toContain("Opening a.ts…");
    const key = Object.keys(state().registry!)[0]!;
    host.shared.set(SHARED_KEY, { ...state(), loaded: { [key]: Date.now() } });
    await until(() => host.closed.length > 0);
    expect(host.closed).toEqual(["ov1"]);
  });

  test("the overlay closes after LOAD_WAIT_MS even if the editor never reports", async () => {
    gitFiles(["a.ts"]);
    host.onRun = (command) => {
      if (command === "pane.split") host.panes = [...host.panes, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    };
    const v = await start();
    const t0 = Date.now();
    v.onKey({ key: "enter", modifiers: {} }, cx);
    await until(() => host.closed.length > 0, 5000);
    expect(LOAD_WAIT_MS).toBe(5000);
    expect(host.closed).toEqual(["ov1"]);
    expect(Date.now() - t0).toBeLessThan(5000); // fake sleeps return at once
  });

  test("sending to an existing editor closes at once", async () => {
    host.panes = [...host.panes, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    host.shared.set(SHARED_KEY, { registry: { k1: { pane: "e1", tab: "t1", lastFocus: 1 } } });
    gitFiles(["a.ts"]);
    const v = await start();
    v.onKey({ key: "enter", modifiers: {} }, cx);
    await settle();
    expect(host.closed).toEqual(["ov1"]);
  });

  test("cmd-Enter on macOS opens a new pane even when an editor exists", async () => {
    host.panes = [...host.panes, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    host.shared.set("herdr-app-editor", { registry: { k1: { pane: "e1", tab: "t1", lastFocus: 1 } } });
    gitFiles(["a.ts"]);
    const v = await start();
    v.onKey({ key: "enter", modifiers: { platform: true } }, cx);
    expect(host.run.map((r) => r.command)).toEqual(["pane.split"]);
  });

  test("ctrl-Enter opens a new pane on Linux and Windows", async () => {
    host.platform = "linux";
    host.panes = [...host.panes, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    host.shared.set("herdr-app-editor", { registry: { k1: { pane: "e1", tab: "t1", lastFocus: 1 } } });
    gitFiles(["a.ts"]);
    const v = await start();
    v.onKey({ key: "enter", modifiers: { control: true } }, cx);
    expect(host.run.map((r) => r.command)).toEqual(["pane.split"]);
  });

  test("Enter in the input (submit) opens the selected file once", async () => {
    gitFiles(["a.ts"]);
    const v = await start();
    input().submit(cx);
    v.onKey({ key: "enter", modifiers: {} }, cx);
    expect(host.run.filter((r) => r.command === "pane.split")).toHaveLength(1);
  });

  test("a click on a row opens it", async () => {
    gitFiles(["a.ts", "b.ts"]);
    const v = await start();
    shown(v);
    host.clicks.get("open-row-1")!({ modifiers: {} }, cx);
    expect(split()!.props.file).toBe("/work/app/b.ts");
  });

  test("↑ from the top stays at the top; Esc closes without opening", async () => {
    gitFiles(["a.ts", "b.ts"]);
    const v = await start();
    v.onKey({ key: "up", modifiers: {} }, cx);
    v.onKey({ key: "escape", modifiers: {} }, cx);
    expect(host.closed).toEqual(["ov1"]);
    expect(split()).toBeUndefined();
  });
});
