// Removes the pane records of panes that are gone (see core/pane-state).
import { paneBase } from "../core/draft/paths";
import { isStalePaneState, type PaneState } from "../core/pane-state/pane-state";
import type { SlotStore } from "./slot-store";

const PANES_DIR = "panes";

/** Removes stale records other than `selfKey`'s. Returns the removed keys; a record that cannot be read is kept. */
export async function sweepPaneStates(store: SlotStore, selfKey: string, now: number): Promise<string[]> {
  const removed: string[] = [];
  for (const key of await store.owners(PANES_DIR)) {
    if (key === selfKey) continue;
    try {
      const base = paneBase(key);
      if (!isStalePaneState(await store.load<PaneState>(base), now)) continue;
      await store.remove(base);
      removed.push(key);
    } catch {
      /* unreadable or unsafe name: leave it */
    }
  }
  return removed;
}
