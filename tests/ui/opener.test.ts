// EditorOpener (src/ui/opener.ts): which editor pane a file goes to, splitting a new one when
// needed, and the queue that keeps clicks made during a split in order.
import { beforeEach, describe, expect, test } from "bun:test";
import { MOD_EDITOR, SHARED_KEY } from "../../src/core/names";
import { decodeCommand } from "../../src/core/routing/routing";
import { host, install, makeCx, reset, settle, type FakeCx, type FakePane } from "./host";

install();
const { EditorOpener } = await import("../../src/ui/opener");

let cx: FakeCx;
const TERMINAL: FakePane = { pane: "p1", tab: "t1", cwd: "/work/app" };
const req = (file: string, newPane = false) => ({ file: `/work/app/${file}`, on: null, tab: "t1", newPane });
const commands = () => host.run.map((r) => r.command);
const opens = () =>
  host.run
    .filter((r) => r.command.startsWith(`${MOD_EDITOR}.`))
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

describe("EditorOpener", () => {
  test("goes to the latest focused editor in the tab", () => {
    host.panes = [TERMINAL, { pane: "e1", tab: "t1", mod: MOD_EDITOR }, { pane: "e2", tab: "t1", mod: MOD_EDITOR }];
    host.shared.set(SHARED_KEY, {
      registry: { k1: { pane: "e1", tab: "t1", lastFocus: 1 }, k2: { pane: "e2", tab: "t1", lastFocus: 2 } },
    });
    new EditorOpener().open(req("src/a.ts"), cx);
    expect(host.run[0]).toEqual({ command: "pane.focus", args: { pane: "e2" } });
    expect(opens()).toEqual([expect.objectContaining({ to: "k2", file: "/work/app/src/a.ts", on: null })]);
  });

  test("an editor in another tab is not used: a new one is split next to the focused pane and registered", async () => {
    host.panes = [TERMINAL, { pane: "e9", tab: "t9", mod: MOD_EDITOR }];
    host.shared.set(SHARED_KEY, { registry: { k9: { pane: "e9", tab: "t9", lastFocus: 1 } } });
    host.onRun = (command) => {
      if (command === "pane.split") host.panes = [...host.panes, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    };
    const o = new EditorOpener();
    o.open(req("a.ts"), cx);
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
    expect(o.splitting).toBe(false);
  });

  test("requests during a split wait for it, then go to the new editor in order", async () => {
    let created = false;
    host.onRun = (command) => {
      if (command === "pane.split") {
        if (created) throw new Error("second split");
        created = true;
        host.panes = [...host.panes, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
      }
    };
    const o = new EditorOpener();
    o.open(req("a.ts"), cx);
    o.open(req("b.ts"), cx);
    o.open(req("c.ts"), cx);
    expect(commands().filter((c) => c === "pane.split")).toHaveLength(1);
    expect(opens()).toEqual([]);
    await settle();
    const key = Object.keys(registry())[0]!;
    expect(opens().map((x) => [x.to, x.file])).toEqual([
      [key, "/work/app/b.ts"],
      [key, "/work/app/c.ts"],
    ]);
  });

  test("a failed split lets the next request try again", () => {
    host.onRun = (command) => {
      if (command === "pane.split") throw new Error("no room");
    };
    const o = new EditorOpener();
    expect(() => o.open(req("a.ts"), cx)).toThrow("no room");
    expect(o.splitting).toBe(false);
    expect(() => o.open(req("b.ts"), cx)).toThrow("no room");
    expect(commands().filter((c) => c === "pane.split")).toHaveLength(2);
  });

  test("newPane splits even when an editor exists", () => {
    host.panes = [TERMINAL, { pane: "e1", tab: "t1", mod: MOD_EDITOR }];
    host.shared.set(SHARED_KEY, { registry: { k1: { pane: "e1", tab: "t1", lastFocus: 1 } } });
    new EditorOpener().open(req("a.ts", true), cx);
    expect(commands()).toEqual(["pane.split"]);
  });
});

describe("location", () => {
  test("currentLocation follows a terminal in the same tab while an editor has focus", async () => {
    const { currentLocation, activeTab } = await import("../../src/ui/location");
    host.panes = [{ pane: "p0", tab: "t0", cwd: "/elsewhere" }, TERMINAL, { pane: "p2", tab: "t1", mod: MOD_EDITOR }];
    host.focused = { pane: "p2" };
    expect(currentLocation()).toEqual({ cwd: "/work/app", on: null, space: "s1" });
    expect(activeTab()).toBe("t1");
  });
});
