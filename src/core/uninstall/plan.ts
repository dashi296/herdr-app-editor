// Which panes, tabs and spaces to close before the editor mods are removed (plan §4 Step 5).
// pane.close on a tab's last pane becomes tab.close, and tab.close on a space's last tab becomes
// space.close without `confirmed` (src/window.rs), so the plan closes at the right level itself.

export interface PaneLite {
  pane: string;
  mod?: string;
  tab: string;
}
export interface SpaceLite {
  id: string;
  tabs: { id: string }[];
}

export type CloseStep =
  | { kind: "pane"; pane: string }
  | { kind: "tab"; tab: string }
  | { kind: "space"; space: string; confirm: true }
  | { kind: "unreachable"; pane: string };

export function planClose(panes: PaneLite[], spaces: SpaceLite[], mod: string): CloseStep[] {
  const steps: CloseStep[] = [];
  const spaceOf = new Map<string, SpaceLite>();
  for (const s of spaces) for (const t of s.tabs) spaceOf.set(t.id, s);
  const byTab = new Map<string, PaneLite[]>();
  for (const p of panes) byTab.set(p.tab, [...(byTab.get(p.tab) ?? []), p]);

  const onlyEditors = (tab: string) => (byTab.get(tab) ?? []).length > 0 && byTab.get(tab)!.every((p) => p.mod === mod);
  const handledSpaces = new Set<string>();

  for (const [tab, inTab] of byTab) {
    const editors = inTab.filter((p) => p.mod === mod);
    if (!editors.length) continue;
    const space = spaceOf.get(tab);
    if (!space) {
      for (const e of editors) steps.push({ kind: "unreachable", pane: e.pane });
      continue;
    }
    if (!onlyEditors(tab)) {
      for (const e of editors) steps.push({ kind: "pane", pane: e.pane });
      continue;
    }
    if (space.tabs.every((t) => onlyEditors(t.id))) {
      if (!handledSpaces.has(space.id)) steps.push({ kind: "space", space: space.id, confirm: true });
      handledSpaces.add(space.id);
      continue;
    }
    steps.push({ kind: "tab", tab });
  }
  return steps;
}
