// Opening a new editor pane from a popup (quick open, text search). A popup never creates a pane
// itself: Herdr ties a pane created while an overlay is open to that overlay, and releases its file
// reads and editor state when the overlay closes (device tests S10, S11). Instead a detached
// `herdr-app do pane.split` runs once the popup has closed.
import { appHome, exec } from "herdr";

/**
 * Run as `sh -c SPLIT_SCRIPT sh <pane.split args JSON> <app home> <overlay mod>`. Exits 3 at once
 * if `herdr-app` cannot be found. Otherwise it returns at once; in the background it waits until
 * `herdr-app status` no longer lists the overlay (at most 60 checks 50 ms apart: about 3 s plus the time
 * the checks take), then splits the pane.
 */
export const SPLIT_SCRIPT =
  'cli=$(command -v herdr-app || echo "$HOME/.local/bin/herdr-app"); ' +
  '[ -x "$cli" ] || exit 3; ' +
  '(i=0; while [ "$i" -lt 60 ] && HERDR_APP_HOME="$2" "$cli" status 2>/dev/null | grep -qF "\\"$3\\""; ' +
  "do sleep 0.05; i=$((i+1)); done; " +
  'HERDR_APP_HOME="$2" "$cli" do pane.split "$1" >/dev/null 2>&1) >/dev/null 2>&1 &';
export const NO_CLI =
  "Cannot open a new editor pane: the herdr-app command was not found (on PATH or in ~/.local/bin).";

export interface SplitArgs {
  pane: string;
  direction: "right";
  mod: string;
  props: Record<string, unknown>;
}

/** Starts the detached split. Null when it is on its way; otherwise the problem to show. */
export async function splitEditor(args: SplitArgs, overlayMod: string): Promise<string | null> {
  try {
    const r = await exec("sh", ["-c", SPLIT_SCRIPT, "sh", JSON.stringify(args), appHome(), overlayMod]);
    return r.code === 3 ? NO_CLI : null;
  } catch (e) {
    // sh did not start (none on Windows, or a spawn error): no background split exists either.
    return `Cannot open a new editor pane: ${String(e)}`;
  }
}
