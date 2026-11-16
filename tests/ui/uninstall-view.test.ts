// UninstallView with fake host modules: the script request (scripts/uninstall.ts), the manual
// removal from an overlay opened by hand, and the confirmation before closing a whole space.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MOD_EDITOR, SHARED_KEY } from "../../src/core/names";
import { REQUEST_FILE, RESULT_BASE, type UninstallResult } from "../../src/core/uninstall/protocol";
import { SlotStore, type SlotIO } from "../../src/ports/slot-store";
import { host, install, makeCx, reset, settle, type FakeCx } from "./host";

install();
const { UninstallView } = await import("../../src/ui/uninstall-view");

class MemoryIO implements SlotIO {
  files = new Map<string, string>();
  failWrite: Error | null = null;
  async read(rel: string) {
    return this.files.get(rel) ?? null;
  }
  async write(rel: string, text: string) {
    if (this.failWrite) throw this.failWrite;
    this.files.set(rel, text);
  }
  async unlink(rel: string) {
    this.files.delete(rel);
  }
  async list(dir: string) {
    return [...this.files.keys()].filter((k) => k.startsWith(dir + "/")).map((k) => k.slice(dir.length + 1));
  }
}

interface Internals {
  phase: { kind: string; text?: string };
  manual: boolean;
  init(props: unknown, cx: FakeCx): void;
  render(cx: FakeCx): unknown;
}

let io: MemoryIO, store: SlotStore, cx: FakeCx;
/** The view's loops sleep; after a test they stop instead of polling forever. */
let alive = true;

function makeView(): Internals {
  class TestUninstall extends UninstallView {
    protected makeDeps() {
      return { io, store };
    }
  }
  return new TestUninstall() as unknown as Internals;
}

/** Closing a pane, tab or space removes the matching panes, as the host does. */
function closeLikeHost(unclosable: string[] = []) {
  host.onRun = (command, args) => {
    const a = args as { pane?: string; id?: string };
    if (command === "pane.close" && !unclosable.includes(a.pane!))
      host.panes = host.panes.filter((p) => p.pane !== a.pane);
    if (command === "tab.close") host.panes = host.panes.filter((p) => p.tab !== a.id);
    if (command === "space.close") {
      const tabs = host.spaces.find((s) => s.id === a.id)?.tabs.map((t) => t.id) ?? [];
      host.panes = host.panes.filter((p) => !tabs.includes(p.tab));
    }
  };
}

/** One space s1 with tab t1 (an editor beside a terminal) and tab t2 (only an editor). */
function mixedLayout() {
  host.spaces = [
    {
      id: "s1",
      active: true,
      tabs: [
        { id: "t1", active: true },
        { id: "t2", active: false },
      ],
    },
  ];
  host.panes = [
    { pane: "term", tab: "t1" },
    { pane: "e1", tab: "t1", mod: MOD_EDITOR },
    { pane: "e2", tab: "t2", mod: MOD_EDITOR },
  ];
}

/** Space s2 holds only an editor; it can be closed only after a confirmation. */
function editorOnlySpace() {
  host.spaces = [
    { id: "s1", active: true, tabs: [{ id: "t1", active: true }] },
    { id: "s2", active: false, tabs: [{ id: "t9", active: true }] },
  ];
  host.panes = [
    { pane: "term", tab: "t1" },
    { pane: "e9", tab: "t9", mod: MOD_EDITOR },
  ];
}

const request = (nonce = "n1") => io.files.set(REQUEST_FILE, JSON.stringify({ nonce }));
const result = () => store.load<UninstallResult>(RESULT_BASE);
const click = (id: string) => {
  const fn = host.clicks.get(id);
  if (!fn) throw new Error(`no button "${id}" in the last render`);
  fn(null, cx);
};

/** Waits until the view reaches `kind` (the view sleeps between polls). */
async function until(v: Internals, kind: string) {
  for (let i = 0; i < 200 && v.phase.kind !== kind; i++) await settle();
  expect(v.phase.kind).toBe(kind);
}

beforeEach(() => {
  reset();
  io = new MemoryIO();
  store = new SlotStore(io);
  alive = true;
  cx = makeCx();
  cx.sleep = () => (alive ? new Promise((r) => setTimeout(r, 0)) : new Promise(() => {}));
  host.props = { overlay: "ov1" };
});

afterEach(() => {
  alive = false;
});

describe("init", () => {
  test("without an overlay prop it does nothing (herdr-app check)", async () => {
    host.props = {};
    const v = makeView();
    v.init(undefined, cx);
    await settle();
    expect(v.phase.kind).toBe("idle");
    expect(() => v.render(cx)).not.toThrow();
  });

  test("an unreadable request counts as no request", async () => {
    io.files.set(REQUEST_FILE, "{not json");
    const v = makeView();
    v.init(undefined, cx);
    await until(v, "manual");
    expect(host.run).toEqual([]);
  });
});

describe("script request", () => {
  test("closes editor panes and tabs, clears shared state and reports complete", async () => {
    mixedLayout();
    closeLikeHost();
    host.shared.set(SHARED_KEY, { registry: {} });
    request();
    const v = makeView();
    v.init(undefined, cx);
    await until(v, "done");

    expect(host.run).toEqual([
      { command: "pane.close", args: { pane: "e1" } },
      { command: "tab.close", args: { id: "t2" } },
    ]);
    expect(host.shared.get(SHARED_KEY)).toBeNull();
    const r = await result();
    expect(r).toMatchObject({ nonce: "n1", status: "complete", remaining: [] });
    expect(r!.closed).toHaveLength(2);
    expect(io.files.has(REQUEST_FILE)).toBe(false);
    expect(v.phase.text).toBe("Done. The script removes the files next.");
    await settle();
    expect(host.closed).toEqual(["ov1"]);
  });

  test("a pane on a machine that is not connected is reported as remaining", async () => {
    host.spaces = [{ id: "s1", active: true, tabs: [{ id: "t1", active: true }] }];
    host.panes = [
      { pane: "term", tab: "t1" },
      { pane: "e1", tab: "t1", mod: MOD_EDITOR },
      { pane: "far", tab: "t-remote", mod: MOD_EDITOR },
    ];
    closeLikeHost();
    request();
    const v = makeView();
    v.init(undefined, cx);
    await until(v, "done");

    const r = await result();
    expect(r).toMatchObject({ status: "incomplete", remaining: ["far"] });
    expect(r!.closed).toContainEqual({ kind: "unreachable", pane: "far" });
    expect(v.phase.text).toBe("Stopped (incomplete).");
  });

  test("a space that holds only editors waits for confirmation, then closes with confirmed: true", async () => {
    editorOnlySpace();
    closeLikeHost();
    request();
    const v = makeView();
    v.init(undefined, cx);
    await until(v, "confirm");
    expect(host.run).toEqual([]);

    v.render(cx);
    click("ok");
    await until(v, "done");
    expect(host.run).toEqual([{ command: "space.close", args: { id: "s2", confirmed: true } }]);
    expect(await result()).toMatchObject({ status: "complete" });
  });

  test("Cancel uninstall reports cancelled and closes nothing", async () => {
    editorOnlySpace();
    closeLikeHost();
    request();
    const v = makeView();
    v.init(undefined, cx);
    await until(v, "confirm");

    v.render(cx);
    click("cancel");
    await until(v, "done");
    expect(host.run).toEqual([]);
    expect(await result()).toMatchObject({ nonce: "n1", status: "cancelled", closed: [], remaining: ["e9"] });
    expect(io.files.has(REQUEST_FILE)).toBe(false);
    expect(v.phase.text).toBe("Stopped (cancelled).");
  });

  test("a result that cannot be written is shown and the request is kept", async () => {
    mixedLayout();
    closeLikeHost();
    request();
    io.failWrite = new Error("disk full");
    const v = makeView();
    v.init(undefined, cx);
    await until(v, "done");

    expect(v.phase.text).toBe("Could not write the result: Error: disk full");
    expect(io.files.has(REQUEST_FILE)).toBe(true);
  });
});

describe("opened by hand", () => {
  test("offers to close the editor panes, then tells what to delete; no result is written", async () => {
    mixedLayout();
    closeLikeHost();
    const v = makeView();
    v.init(undefined, cx);
    await until(v, "manual");
    expect(() => v.render(cx)).not.toThrow();

    click("manual-ok");
    await until(v, "done");
    expect(host.run.map((r) => r.command)).toEqual(["pane.close", "tab.close"]);
    expect(v.phase.text).toStartWith("All editor panes are closed. Next: switch back to your layout");
    expect(host.shared.get(SHARED_KEY)).toBeNull();
    expect(await result()).toBeNull();

    v.render(cx);
    click("done");
    expect(host.closed).toEqual(["ov1"]);
  });

  test("Not now closes the overlay without closing panes", async () => {
    mixedLayout();
    const v = makeView();
    v.init(undefined, cx);
    await until(v, "manual");
    v.render(cx);
    click("close");
    expect(host.closed).toEqual(["ov1"]);
    expect(host.run).toEqual([]);
  });

  test("panes that do not close are counted", async () => {
    mixedLayout();
    closeLikeHost(["e1"]);
    const v = makeView();
    v.init(undefined, cx);
    await until(v, "manual");
    v.render(cx);
    click("manual-ok");
    await until(v, "done");
    expect(v.phase.text).toBe(
      "1 editor pane(s) could not be closed (on a machine that is not connected?). Close them first.",
    );
  });

  test("cancelling the space confirmation returns to the offer", async () => {
    editorOnlySpace();
    const v = makeView();
    v.init(undefined, cx);
    await until(v, "manual");
    v.render(cx);
    click("manual-ok");
    expect(v.phase.kind).toBe("confirm");
    expect(() => v.render(cx)).not.toThrow();

    click("cancel");
    expect(v.phase.kind).toBe("manual");
    expect(v.manual).toBe(false);
    expect(host.run).toEqual([]);
  });

  test("a script request that arrives after the manual removal started is ignored", async () => {
    mixedLayout();
    host.onRun = () => {}; // panes stay open, so execute() is still waiting
    const v = makeView();
    v.init(undefined, cx);
    await until(v, "manual");
    v.render(cx);
    click("manual-ok");
    request();
    await until(v, "done");
    // Long enough for a second (script) run to finish and write its result, had it started.
    for (let i = 0; i < 100; i++) await settle();
    expect(v.phase.text).toStartWith("2 editor pane(s) could not be closed");
    expect(host.run.map((r) => r.command)).toEqual(["pane.close", "tab.close"]);
    expect(await result()).toBeNull();
    expect(io.files.has(REQUEST_FILE)).toBe(true);
  });
});
