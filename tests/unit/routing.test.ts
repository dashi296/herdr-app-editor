import { describe, expect, test } from "bun:test";
import {
  acceptOpen,
  decodeCommand,
  dialogOpened,
  encodeCommand,
  handleOpen,
  handleReply,
  idleRouting,
  interacted,
  newPaneAfterSplit,
  pickTarget,
  pruneRegistry,
  type PaneLite,
  type Registry,
} from "../../src/core/routing/routing";

const panes: PaneLite[] = [
  { pane: "p1", mod: "editor-files", tab: "t1" },
  { pane: "p2", mod: "editor", tab: "t1" },
  { pane: "p3", mod: "editor", tab: "t1" },
  { pane: "p4", mod: "editor", tab: "t2" },
  { pane: "p5", tab: "t1" },
];

describe("registry", () => {
  const reg: Registry = {
    k2: { pane: "p2", tab: "t1", lastFocus: 10 },
    k3: { pane: "p3", tab: "t1", lastFocus: 30 },
    k4: { pane: "p4", tab: "t2", lastFocus: 99 },
    gone: { pane: "p9", tab: "t1", lastFocus: 100 },
    notEditor: { pane: "p5", tab: "t1", lastFocus: 200 },
  };
  test("entries whose pane is not a live editor are pruned", () => {
    expect(Object.keys(pruneRegistry(reg, panes, "editor")).sort()).toEqual(["k2", "k3", "k4"]);
  });
  test("target: most recently focused editor in the current tab", () => {
    expect(pickTarget(reg, panes, "editor", "t1")).toEqual({ key: "k3", pane: "p3" });
  });
  test("no editor in the tab", () => expect(pickTarget(reg, panes, "editor", "t9")).toBeNull());
  test("tab comes from panes(), not the stored entry", () => {
    const moved: Registry = { k4: { pane: "p4", tab: "t1", lastFocus: 1 } };
    expect(pickTarget(moved, panes, "editor", "t1")).toBeNull();
  });
});

describe("newPaneAfterSplit (spike S5 result 7)", () => {
  test("the single new editor pane in the tab", () => {
    const after = [...panes, { pane: "p6", mod: "editor", tab: "t1" }];
    expect(newPaneAfterSplit(["p2", "p3", "p4"], after, "editor", "t1")).toBe("p6");
  });
  test("none yet", () => expect(newPaneAfterSplit(["p2", "p3", "p4"], panes, "editor", "t1")).toBeNull());
  test("ambiguous: two new panes", () => {
    const after = [...panes, { pane: "p6", mod: "editor", tab: "t1" }, { pane: "p7", mod: "editor", tab: "t1" }];
    expect(newPaneAfterSplit(["p2", "p3", "p4"], after, "editor", "t1")).toBeNull();
  });
  test("a new pane in another tab is not ours", () => {
    const after = [...panes, { pane: "p6", mod: "editor", tab: "t2" }];
    expect(newPaneAfterSplit(["p2", "p3", "p4"], after, "editor", "t1")).toBeNull();
  });
});

describe("commands", () => {
  test("round trip with '.' and ':' in the payload", () => {
    const c = encodeCommand("open", { file: "a.b:c", n: 1 });
    expect(c.startsWith("open:")).toBe(true);
    expect(decodeCommand(c)).toEqual({ verb: "open", payload: { file: "a.b:c", n: 1 } });
  });
  test("bare verb", () => expect(decodeCommand("focus")).toEqual({ verb: "focus", payload: null }));
  test("bad JSON", () => expect(decodeCommand("open:{x")).toEqual({ verb: "open", payload: null, error: true }));
});

describe("acceptOpen", () => {
  const msg = { to: "k1", req: "r1", file: "/p/a.ts", on: null, sentAt: 1000 };
  test("accepted", () => expect(acceptOpen({ key: "k1", seen: [], now: 1100 }, msg)).toBe("accept"));
  test("not mine", () => expect(acceptOpen({ key: "k2", seen: [], now: 1100 }, msg)).toBe("not-mine"));
  test("expired (older than 2s)", () => expect(acceptOpen({ key: "k1", seen: [], now: 3001 }, msg)).toBe("expired"));
  test("duplicate", () => expect(acceptOpen({ key: "k1", seen: ["r1"], now: 1100 }, msg)).toBe("duplicate"));
});

describe("open requests and the save/discard/cancel dialog", () => {
  const req = (n: number) => ({ req: `r${n}`, file: `/p/${n}.ts`, on: null });

  test("clean: open right away", () => {
    const { state, effects } = handleOpen(idleRouting(), req(1), { dirty: false, file: null, on: null });
    expect(effects).toEqual([{ type: "open", file: "/p/1.ts", on: null }]);
    expect(state.pending).toBeNull();
  });

  test("dirty: ask first, then follow the choice", () => {
    let { state, effects } = handleOpen(idleRouting(), req(1), { dirty: true, file: null, on: null });
    expect(effects).toEqual([{ type: "openDialog", req: "r1" }]);
    state = dialogOpened(state, "r1", "o1");
    let r = handleReply(state, { req: "r1", choice: "save" });
    expect(r.effects).toEqual([{ type: "saveThenOpen", file: "/p/1.ts", on: null }]);
    expect(r.state.pending).toBeNull();

    r = handleReply(
      dialogOpened(handleOpen(idleRouting(), req(2), { dirty: true, file: null, on: null }).state, "r2", "o2"),
      {
        req: "r2",
        choice: "discard",
      },
    );
    expect(r.effects).toEqual([{ type: "open", file: "/p/2.ts", on: null }]);

    r = handleReply(
      dialogOpened(handleOpen(idleRouting(), req(3), { dirty: true, file: null, on: null }).state, "r3", "o3"),
      {
        req: "r3",
        choice: "cancel",
      },
    );
    expect(r.effects).toEqual([{ type: "focusEditor" }]);
  });

  test("only the first reply counts (close() replies again after a button)", () => {
    let state = dialogOpened(
      handleOpen(idleRouting(), req(1), { dirty: true, file: null, on: null }).state,
      "r1",
      "o1",
    );
    const first = handleReply(state, { req: "r1", choice: "discard" });
    expect(handleReply(first.state, { req: "r1", choice: "cancel" }).effects).toEqual([]);
  });

  test("a new request while asking replaces the dialog; the old reply is ignored", () => {
    let state = dialogOpened(
      handleOpen(idleRouting(), req(1), { dirty: true, file: null, on: null }).state,
      "r1",
      "o1",
    );
    const r = handleOpen(state, req(2), { dirty: true, file: null, on: null });
    expect(r.effects).toEqual([
      { type: "closeDialog", overlay: "o1" },
      { type: "openDialog", req: "r2" },
    ]);
    state = dialogOpened(r.state, "r2", "o2");
    expect(handleReply(state, { req: "r1", choice: "cancel" }).effects).toEqual([]);
    expect(handleReply(state, { req: "r2", choice: "discard" }).effects).toEqual([
      { type: "open", file: "/p/2.ts", on: null },
    ]);
  });

  test("typing in the editor while a reply is pending means the reply was lost: cancel", () => {
    const state = dialogOpened(
      handleOpen(idleRouting(), req(1), { dirty: true, file: null, on: null }).state,
      "r1",
      "o1",
    );
    const r = interacted(state);
    expect(r.state.pending).toBeNull();
    expect(r.effects).toEqual([{ type: "closeDialog", overlay: "o1" }]);
    expect(interacted(r.state).effects).toEqual([]);
  });
});

describe("opening at a line", () => {
  const AT = { line: 4, col: 2, len: 3 };
  test("same file with at: jump, no dialog, even when dirty", () => {
    const r = handleOpen(
      idleRouting(),
      { req: "r1", file: "/a", on: null, at: AT },
      { dirty: true, file: "/a", on: null },
    );
    expect(r.effects).toEqual([{ type: "jump", at: AT }]);
    expect(r.state.pending).toBeNull();
  });
  test("same file with at closes a pending dialog for another file", () => {
    const s = { pending: { req: "r0", file: "/b", on: null, overlay: "ov1" } };
    const r = handleOpen(s, { req: "r1", file: "/a", on: null, at: AT }, { dirty: true, file: "/a", on: null });
    expect(r.effects).toEqual([
      { type: "closeDialog", overlay: "ov1" },
      { type: "jump", at: AT },
    ]);
  });
  test("same file without at keeps today's behaviour (dialog when dirty)", () => {
    const r = handleOpen(idleRouting(), { req: "r1", file: "/a", on: null }, { dirty: true, file: "/a", on: null });
    expect(r.effects).toEqual([{ type: "openDialog", req: "r1" }]);
  });
  test("other file with at: open carries at; after the dialog, save and discard carry it", () => {
    expect(
      handleOpen(idleRouting(), { req: "r1", file: "/b", on: null, at: AT }, { dirty: false, file: "/a", on: null })
        .effects,
    ).toEqual([{ type: "open", file: "/b", on: null, at: AT }]);
    const p = handleOpen(
      idleRouting(),
      { req: "r1", file: "/b", on: null, at: AT },
      { dirty: true, file: "/a", on: null },
    );
    expect(handleReply(p.state, { req: "r1", choice: "save" }).effects).toEqual([
      { type: "saveThenOpen", file: "/b", on: null, at: AT },
    ]);
    expect(handleReply(p.state, { req: "r1", choice: "discard" }).effects).toEqual([
      { type: "open", file: "/b", on: null, at: AT },
    ]);
  });
  test("same path on another machine is another file", () => {
    const r = handleOpen(
      idleRouting(),
      { req: "r1", file: "/a", on: "vps", at: AT },
      { dirty: false, file: "/a", on: null },
    );
    expect(r.effects).toEqual([{ type: "open", file: "/a", on: "vps", at: AT }]);
  });
});
