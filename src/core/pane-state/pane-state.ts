// What a pane remembers under panes/<key> (plan §5 "pane の状態"): the file it shows, so the pane
// reopens it after a restart. A closed pane's record is never removed by the pane itself, because
// close() cannot tell a pane closed for good from an app quit, and panes() does not give the key
// of a live editor. Records not written for PANE_STATE_MAX_AGE_MS are swept instead.

export interface PaneState {
  file: string;
  on: string | null;
  /** When the pane last opened a file (ms). Missing in records written before the sweep existed. */
  seenAt?: number;
}

export const PANE_STATE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** A record nobody wrote for longer than the limit, one without seenAt, or a missing one. */
export function isStalePaneState(state: PaneState | null, now: number): boolean {
  if (!state || typeof state.seenAt !== "number") return true;
  return now - state.seenAt > PANE_STATE_MAX_AGE_MS;
}
