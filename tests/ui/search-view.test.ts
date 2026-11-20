// The text search popup (src/ui/search-view.ts): searching the focused folder with git grep or grep,
// one search at a time, and opening a hit at its line in an editor pane of the tab that was shown
// when the popup opened. Like quick open, it never creates a pane itself.
import { beforeEach, describe, expect, test } from "bun:test";
import { MOD_EDITOR, MOD_SEARCH, SHARED_KEY } from "../../src/core/names";
import { gitGrepArgs, grepArgs } from "../../src/core/search/search";
import {
  deferred,
  FakeInputState,
  host,
  install,
  makeCx,
  reset,
  settle,
  type ExecOptions,
  type ExecResult,
  type FakeCx,
} from "./host";

install();
const { SearchView, SEARCH_TIMEOUT_MS } = await import("../../src/ui/search-view");
const { SPLIT_SCRIPT } = await import("../../src/ui/split");

interface View {
  init(props: unknown, cx: FakeCx): void;
  render(cx: FakeCx): unknown;
  onKey(e: { key: string; modifiers?: Record<string, boolean> }, cx: FakeCx): void;
}

let cx: FakeCx;
let calls: { cmd: string; args: string[]; opts?: ExecOptions | undefined }[];
/** Answers for each search command; rev-parse answers `inGit`. */
let inGit: boolean;
let answer: (cmd: string, args: string[]) => Promise<ExecResult> | ExecResult;

const searches = () => calls.filter((c) => c.cmd === "grep" || (c.cmd === "git" && c.args[0] === "grep"));
async function start(): Promise<View> {
  const v = new SearchView() as unknown as View;
  v.init(undefined, cx);
  await settle();
  return v;
}
const input = () => FakeInputState.created.at(-1)!;
async function type(text: string) {
  input().type(text, cx);
  await settle();
}
function shown(v: View) {
  host.texts = [];
  host.clicks.clear();
  v.render(cx);
  return host.texts;
}
const split = () => {
  const c = calls.find((x) => x.cmd === "sh");
  return c ? (JSON.parse(c.args[3]!) as { mod: string; props: Record<string, unknown> }) : undefined;
};

beforeEach(() => {
  reset();
  cx = makeCx();
  calls = [];
  inGit = true;
  answer = () => ({ code: 0, stdout: "src/a.ts\x003\x005\x00  let foo = 1\n", stderr: "" });
  host.exec = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (cmd === "git" && args[0] === "rev-parse") return { code: inGit ? 0 : 128, stdout: "true\n", stderr: "" };
    return answer(cmd, args);
  };
  host.props = { overlay: "ov1" };
  host.spaces = [{ id: "s1", active: true, folder: "/space", machine: null, tabs: [{ id: "t1", active: true }] }];
  host.panes = [{ pane: "p1", tab: "t1", cwd: "/work/app" }];
  host.focused = { pane: "p1" };
});

describe("searching", () => {
  test("inside git: types, waits, runs git grep with smart case in the captured folder", async () => {
    await start();
    await type("foo");
    expect(searches()).toEqual([
      { cmd: "git", args: gitGrepArgs("foo"), opts: { cwd: "/work/app", on: null, timeout: SEARCH_TIMEOUT_MS } },
    ]);
  });

  test("a search waits 250 ms after the last keystroke", async () => {
    await start();
    cx.sleeps = [];
    await type("foo");
    expect(cx.sleeps).toEqual([250]);
  });

  test("outside git uses grep", async () => {
    inGit = false;
    await start();
    await type("Foo");
    expect(searches().map((c) => [c.cmd, c.args])).toEqual([["grep", grepArgs("Foo")]]);
  });

  test("one character shows the hint and runs nothing", async () => {
    const v = await start();
    await type("f");
    expect(searches()).toEqual([]);
    expect(shown(v)).toContain("Type at least 2 characters.");
  });

  test("shows hits as path:line and the line", async () => {
    const v = await start();
    await type("foo");
    expect(shown(v)).toEqual(expect.arrayContaining(["src/a.ts:3", "let foo = 1"]));
  });

  test("typing during a search runs only the newest query, and old results never show", async () => {
    const first = deferred<ExecResult>();
    let n = 0;
    answer = (_cmd, args) =>
      n++ === 0 ? first.promise : { code: 0, stdout: `food.ts\x001\x001\x00${args.at(-1)}\n`, stderr: "" };
    const v = await start();
    await type("fo");
    input().type("foo", cx);
    input().type("food", cx);
    await settle();
    first.resolve({ code: 0, stdout: "old.ts\x001\x001\x00fo\n", stderr: "" });
    await settle();
    expect(searches().map((c) => c.args.at(-1))).toEqual(["fo", "food"]);
    const texts = shown(v);
    expect(texts).not.toContain("old.ts:1");
    expect(texts).toContain("food.ts:1");
  });

  test("results of the previous text are hidden as soon as the text changes, so Enter cannot open them", async () => {
    host.panes = [...host.panes, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    host.shared.set(SHARED_KEY, { registry: { k1: { pane: "e1", tab: "t1", lastFocus: 1 } } });
    const v = await start();
    await type("foo");
    expect(shown(v)).toContain("src/a.ts:3");
    input().type("foo_bar", cx); // Enter before the debounce runs the new search
    v.onKey({ key: "enter", modifiers: {} }, cx);
    expect(host.run).toEqual([]);
    expect(shown(v)).not.toContain("src/a.ts:3");
  });

  test("exit 1 with no output shows No matches.", async () => {
    answer = () => ({ code: 1, stdout: "", stderr: "" });
    const v = await start();
    await type("zzz");
    expect(shown(v)).toContain("No matches.");
  });

  test("an error exit with output shows the hits and the stopped-early notice", async () => {
    answer = () => ({ code: 2, stdout: "a.ts\x001\x001\x00foo\nb.ts\x002\x001\x00fo", stderr: "Permission denied" });
    const v = await start();
    await type("foo");
    const texts = shown(v);
    expect(texts).toContain("a.ts:1");
    expect(texts).not.toContain("b.ts:2");
    expect(texts).toContain("Stopped early: showing what was found");
  });

  test("output cut mid-line with exit 0 (the 8 MiB cap) says it stopped early", async () => {
    answer = () => ({ code: 0, stdout: "a.ts\x001\x001\x00foo\nb.ts\x002\x001\x00fo", stderr: "" });
    const v = await start();
    await type("foo");
    const texts = shown(v);
    expect(texts).toContain("a.ts:1");
    expect(texts).toContain("Stopped early: showing what was found");
  });

  test("a single cut line with exit 0 is not reported as No matches.", async () => {
    answer = () => ({ code: 0, stdout: "a.ts\x001\x001\x00fo", stderr: "" });
    const v = await start();
    await type("foo");
    const texts = shown(v);
    expect(texts).not.toContain("No matches.");
    expect(texts).toContain("Stopped early: showing what was found");
  });

  test("an error exit without output shows the error", async () => {
    answer = () => ({ code: 2, stdout: "", stderr: "grep: bad" });
    const v = await start();
    await type("foo");
    expect(shown(v)).toContain("Cannot search this folder: grep: bad");
  });

  test("a rejected exec shows Cannot search this folder", async () => {
    answer = () => Promise.reject(new Error("timed out"));
    const v = await start();
    await type("foo");
    expect(shown(v).some((t) => t.startsWith("Cannot search this folder") && t.includes("timed out"))).toBe(true);
  });

  test("more than 500 hits says so", async () => {
    answer = () => ({
      code: 0,
      stdout: Array.from({ length: 501 }, (_, i) => `f.ts\x00${i + 1}\x001\x00foo\n`).join(""),
      stderr: "",
    });
    const v = await start();
    await type("foo");
    expect(shown(v)).toContain("Showing the first 500 matches");
  });
});

describe("opening", () => {
  test("Enter sends open with at to the tab's editor, and the popup closes", async () => {
    host.panes = [...host.panes, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    host.shared.set(SHARED_KEY, { registry: { k1: { pane: "e1", tab: "t1", lastFocus: 1 } } });
    const v = await start();
    await type("foo");
    v.onKey({ key: "enter", modifiers: {} }, cx);
    await settle();
    expect(host.run[0]).toEqual({ command: "pane.focus", args: { pane: "e1" } });
    const cmd = host.run[1]!.command;
    expect(cmd.startsWith(`${MOD_EDITOR}.open:`)).toBe(true);
    const payload = JSON.parse(cmd.slice(`${MOD_EDITOR}.open:`.length));
    expect(payload).toMatchObject({ to: "k1", file: "/work/app/src/a.ts", at: { line: 3, col: 5, len: 3 } });
    expect(host.closed).toEqual(["ov1"]);
  });

  test("cmd-Enter splits through sh with at in the props", async () => {
    host.panes = [...host.panes, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    host.shared.set(SHARED_KEY, { registry: { k1: { pane: "e1", tab: "t1", lastFocus: 1 } } });
    const v = await start();
    await type("foo");
    v.onKey({ key: "enter", modifiers: { platform: true } }, cx);
    await settle();
    const sh = calls.find((c) => c.cmd === "sh")!;
    expect(sh.args[1]).toBe(SPLIT_SCRIPT);
    expect(sh.args[5]).toBe(MOD_SEARCH);
    expect(split()).toMatchObject({ mod: MOD_EDITOR });
    expect(split()!.props).toMatchObject({
      file: "/work/app/src/a.ts",
      tab: "t1",
      before: ["e1"],
      at: { line: 3, col: 5, len: 3 },
    });
    expect(host.closed).toEqual(["ov1"]);
  });

  test("exit 3 from the split shows the herdr-app notice and stays open", async () => {
    const base = answer;
    answer = (cmd, args) => (cmd === "sh" ? { code: 3, stdout: "", stderr: "" } : base(cmd, args));
    const v = await start();
    await type("foo");
    v.onKey({ key: "enter", modifiers: {} }, cx);
    await settle();
    expect(host.closed).toEqual([]);
    expect(shown(v).some((t) => t.includes("herdr-app"))).toBe(true);
  });

  test("Esc closes without opening", async () => {
    const v = await start();
    v.onKey({ key: "escape", modifiers: {} }, cx);
    expect(host.closed).toEqual(["ov1"]);
    expect(host.run).toEqual([]);
  });

  test("herdr-app check renders without running exec", async () => {
    host.checking = true;
    const v = await start();
    expect(calls).toEqual([]);
    expect(() => v.render(cx)).not.toThrow();
  });
});
