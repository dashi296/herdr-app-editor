// Removes the pane records of panes that are gone (see core/pane-state).
import { paneBase } from "../core/draft/paths";
import { sweepDecision, type PaneState } from "../core/pane-state/pane-state";
import type { SlotStore } from "./slot-store";

const PANES_DIR = "panes";

/**
 * Applies sweepDecision to every record but `selfKey`'s. Each record is read, judged and changed in
 * one SlotStore.update, so a pane saving its record meanwhile is never undone. A record that cannot
 * be read is kept. Throws only when the folder cannot be listed.
 */
export async function sweepPaneStates(
  store: SlotStore,
  selfKey: string,
  now: number,
): Promise<{ removed: string[]; stamped: string[] }> {
  const removed: string[] = [],
    stamped: string[] = [];
  for (const key of await store.owners(PANES_DIR)) {
    if (key === selfKey) continue;
    try {
      const d = await store.update<PaneState>(paneBase(key), (s) => sweepDecision(s, now));
      if (d.op === "remove") removed.push(key);
      else if (d.op === "write") stamped.push(key);
    } catch {
      /* unreadable or unsafe name: leave it */
    }
  }
  return { removed, stamped };
}
