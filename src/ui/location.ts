// Which folder the Files panel and the quick open overlay work on: the focused pane's folder.
// Moved from the Files fork (src/entries/editor-files.js) so the overlay uses the same rule.
import { focused, panes, spaces } from "herdr";
import { MOD_EDITOR } from "../core/names";

export interface Location {
  cwd: string | undefined;
  on: string | null;
  space: string | undefined;
}

export function currentLocation(): Location {
  const space = spaces().find((s) => s.active),
    f = focused();
  let pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  // An editor pane has no folder of its own: follow a terminal in the same tab instead of falling
  // back to another folder (the tree would jump away while editing).
  if (pane && pane.mod === MOD_EDITOR) pane = panes().find((p) => p.tab === pane!.tab && p.cwd) ?? pane;
  const on =
    f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0]! : null) : (space?.machine ?? null);
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}

/** The shown tab of the active space. */
export function activeTab(): string | null {
  return (
    spaces()
      .find((s) => s.active)
      ?.tabs.find((t) => t.active)?.id ?? null
  );
}
