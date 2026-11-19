// The quick open overlay (src/ui/open-view.ts): listing the focused folder, filtering, and opening
// the chosen file in an editor pane of the tab that was shown when the overlay opened. The overlay
// never creates a pane itself (device test S11): a new editor pane is split by a detached
// `herdr-app do pane.split` that runs after the overlay has closed.
import { beforeEach, describe, expect, test } from "bun:test";
import { MOD_EDITOR, SHARED_KEY } from "../../src/core/names";
import { FakeInputState, host, install, makeCx, reset, settle, type ExecOptions, type FakeCx } from "./host";

install();
const { OpenView, SPLIT_SCRIPT } = await import("../../src/ui/open-view");

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
/** The pane.split the overlay handed to the detached herdr-app call, if any. */
const split = () => {
  const c = calls.find((x) => x.cmd === "sh");
  return c
    ? (JSON.parse(c.args[3]!) as {
        pane: string;
        direction: string;
        mod: string;
        props: { key: string; file: string; on: string | null };
      })
    : undefined;
};

beforeEach(() => {
  reset();
  cx = makeCx();
  calls = [];
  host.props = { overlay: "ov1" };
  host.spaces = [{ id: "s1", active: true, folder: "/space", machine: null, tabs: [{ id: "t1", active: true }] }];
  host.panes = [{ pane: "p1", tab: "t1", cwd: "/work/app" }];
  host.focused = { pane: "p1" };
});

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
    await settle();
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

  test("with no editor in the tab, Enter closes first, then a detached herdr-app splits one next to the focused pane", async () => {
    gitFiles(["src/a.ts", "src/b.ts"]);
    const v = await start();
    v.onKey({ key: "down", modifiers: {} }, cx);
    v.onKey({ key: "enter", modifiers: {} }, cx);
    await settle();
    expect(host.run.filter((r) => r.command === "pane.split")).toEqual([]);
    const sh = calls.find((x) => x.cmd === "sh")!;
    expect(sh.args.slice(0, 3)).toEqual(["-c", SPLIT_SCRIPT, "sh"]);
    expect(sh.args[4]).toBe("/fake-home");
    expect(split()).toMatchObject({ pane: "p1", direction: "right", mod: MOD_EDITOR });
    expect(split()!.props).toMatchObject({ file: "/work/app/src/b.ts", on: null, key: expect.stringMatching(/^e/) });
    expect(host.closed).toEqual(["ov1"]);
  });

  test("the script waits, then runs herdr-app do pane.split in the background", () => {
    expect(SPLIT_SCRIPT).toContain("sleep 0.3");
    expect(SPLIT_SCRIPT).toContain('do pane.split "$1"');
    expect(SPLIT_SCRIPT).toContain('HERDR_APP_HOME="$2"');
    expect(SPLIT_SCRIPT.trim().endsWith("&")).toBe(true);
  });

  test("the file goes to the tab shown when the overlay opened, even after switching tabs", async () => {
    gitFiles(["a.ts"]);
    const v = await start();
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
    host.panes = [...host.panes, { pane: "q1", tab: "t2", cwd: "/x" }];
    host.focused = { pane: "q1" };
    v.onKey({ key: "enter", modifiers: {} }, cx);
    await settle();
    expect(split()!.pane).toBe("p1");
  });

  test("an editor in the tab gets the file as a command, and the overlay closes", async () => {
    host.panes = [...host.panes, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    host.shared.set(SHARED_KEY, { registry: { k1: { pane: "e1", tab: "t1", lastFocus: 1 } } });
    gitFiles(["a.ts"]);
    const v = await start();
    v.onKey({ key: "enter", modifiers: {} }, cx);
    await settle();
    expect(host.run[0]).toEqual({ command: "pane.focus", args: { pane: "e1" } });
    expect(host.run[1]!.command.startsWith(`${MOD_EDITOR}.open:`)).toBe(true);
    expect(split()).toBeUndefined();
    expect(host.closed).toEqual(["ov1"]);
  });

  test("cmd-Enter on macOS splits a new pane even when an editor exists", async () => {
    host.panes = [...host.panes, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    host.shared.set(SHARED_KEY, { registry: { k1: { pane: "e1", tab: "t1", lastFocus: 1 } } });
    gitFiles(["a.ts"]);
    const v = await start();
    v.onKey({ key: "enter", modifiers: { platform: true } }, cx);
    await settle();
    expect(host.run).toEqual([]);
    expect(split()).toBeDefined();
  });

  test("ctrl-Enter splits a new pane on Linux and Windows", async () => {
    host.platform = "linux";
    host.panes = [...host.panes, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    host.shared.set(SHARED_KEY, { registry: { k1: { pane: "e1", tab: "t1", lastFocus: 1 } } });
    gitFiles(["a.ts"]);
    const v = await start();
    v.onKey({ key: "enter", modifiers: { control: true } }, cx);
    await settle();
    expect(split()).toBeDefined();
  });

  test("Enter in the input (submit) opens the selected file once", async () => {
    gitFiles(["a.ts"]);
    const v = await start();
    input().submit(cx);
    v.onKey({ key: "enter", modifiers: {} }, cx);
    await settle();
    expect(calls.filter((x) => x.cmd === "sh")).toHaveLength(1);
  });

  test("a click on a row opens it", async () => {
    gitFiles(["a.ts", "b.ts"]);
    const v = await start();
    shown(v);
    host.clicks.get("open-row-1")!({ modifiers: {} }, cx);
    await settle();
    expect(split()!.props.file).toBe("/work/app/b.ts");
  });

  test("↑ from the top stays at the top; Esc closes without opening", async () => {
    gitFiles(["a.ts", "b.ts"]);
    const v = await start();
    v.onKey({ key: "up", modifiers: {} }, cx);
    v.onKey({ key: "escape", modifiers: {} }, cx);
    await settle();
    expect(host.closed).toEqual(["ov1"]);
    expect(split()).toBeUndefined();
  });
});
