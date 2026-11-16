import { describe, expect, test } from "bun:test";
import { planClose } from "../../src/core/uninstall/plan";

const S = (id: string, tabs: string[]) => ({ id, tabs: tabs.map((t) => ({ id: t })) });

describe("planClose (plan §4 Step 5)", () => {
  test("an editor beside a terminal: close the pane", () => {
    const panes = [
      { pane: "p1", tab: "t1" },
      { pane: "e1", mod: "editor", tab: "t1" },
    ];
    expect(planClose(panes, [S("s1", ["t1"])], "editor")).toEqual([{ kind: "pane", pane: "e1" }]);
  });
  test("a tab with only editors, in a space with other tabs: close the tab", () => {
    const panes = [
      { pane: "p1", tab: "t1" },
      { pane: "e1", mod: "editor", tab: "t2" },
      { pane: "e2", mod: "editor", tab: "t2" },
    ];
    expect(planClose(panes, [S("s1", ["t1", "t2"])], "editor")).toEqual([{ kind: "tab", tab: "t2" }]);
  });
  test("the only tab of a space holds only editors: closing the space needs confirmation", () => {
    const panes = [{ pane: "e1", mod: "editor", tab: "t1" }];
    expect(planClose(panes, [S("s1", ["t1"])], "editor")).toEqual([{ kind: "space", space: "s1", confirm: true }]);
  });
  test("every tab of a space holds only editors: one space step", () => {
    const panes = [
      { pane: "e1", mod: "editor", tab: "t1" },
      { pane: "e2", mod: "editor", tab: "t2" },
    ];
    expect(planClose(panes, [S("s1", ["t1", "t2"])], "editor")).toEqual([
      { kind: "space", space: "s1", confirm: true },
    ]);
  });
  test("other mods are left alone", () => {
    const panes = [
      { pane: "p1", tab: "t1" },
      { pane: "m1", mod: "markdown", tab: "t1" },
    ];
    expect(planClose(panes, [S("s1", ["t1"])], "editor")).toEqual([]);
  });
  test("panes in tabs the model does not list (another machine not loaded) are reported", () => {
    const panes = [{ pane: "e9", mod: "editor", tab: "vps/t9" }];
    expect(planClose(panes, [S("s1", ["t1"])], "editor")).toEqual([{ kind: "unreachable", pane: "e9" }]);
  });
});
