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

export type SweepDecision<T> = { op: "keep" } | { op: "remove" } | { op: "write"; payload: T };

/**
 * What the sweep does with another pane's record. A record without seenAt is not removed at once:
 * its pane may be alive but not yet started (a tab not shown since the update) or unable to open
 * its file, so it gets seenAt = now and the full limit from there.
 */
export function sweepDecision(state: PaneState | null, now: number): SweepDecision<PaneState> {
  if (!state || typeof state !== "object") return { op: "remove" };
  if (typeof state.seenAt !== "number") return { op: "write", payload: { ...state, seenAt: now } };
  return now - state.seenAt > PANE_STATE_MAX_AGE_MS ? { op: "remove" } : { op: "keep" };
}
