// Opening files from editor-files in an editor pane (plan §3, spike S5). Pure.
// Messages travel as `<mod>.<verb>:<json>` commands; they reach every shown copy, so each carries `to`.

export interface PaneLite { pane: string; mod?: string; tab: string }
export interface RegistryEntry { pane: string; tab: string; lastFocus: number }
export type Registry = Record<string, RegistryEntry>;

const liveEditors = (panes: PaneLite[], mod: string) =>
  new Map(panes.filter((p) => p.mod === mod).map((p) => [p.pane, p.tab]));

/** Drops entries whose pane is no longer a live editor (close() may never have run: R1). */
export function pruneRegistry(reg: Registry, panes: PaneLite[], mod: string): Registry {
  const live = liveEditors(panes, mod);
  return Object.fromEntries(Object.entries(reg).filter(([, e]) => live.has(e.pane)));
}

/** The editor to send a file to: the most recently focused live editor in `tab`. */
export function pickTarget(reg: Registry, panes: PaneLite[], mod: string, tab: string): { key: string; pane: string } | null {
  const live = liveEditors(panes, mod);
  let best: { key: string; pane: string; at: number } | null = null;
  for (const [key, e] of Object.entries(reg)) {
    if (live.get(e.pane) !== tab) continue;
    if (!best || e.lastFocus > best.at) best = { key, pane: e.pane, at: e.lastFocus };
  }
  return best && { key: best.key, pane: best.pane };
}

/** The pane a split just created: the only new `mod` pane in `tab` (null while absent or ambiguous). */
export function newPaneAfterSplit(before: string[], after: PaneLite[], mod: string, tab: string): string | null {
  const known = new Set(before);
  const fresh = after.filter((p) => p.mod === mod && p.tab === tab && !known.has(p.pane));
  return fresh.length === 1 ? fresh[0]!.pane : null;
}

export function encodeCommand(verb: string, payload: unknown): string {
  return `${verb}:${JSON.stringify(payload)}`;
}

export function decodeCommand(command: string): { verb: string; payload: unknown; error?: true } {
  const i = command.indexOf(":");
  if (i < 0) return { verb: command, payload: null };
  try { return { verb: command.slice(0, i), payload: JSON.parse(command.slice(i + 1)) }; }
  catch { return { verb: command.slice(0, i), payload: null, error: true }; }
}

export interface OpenMessage { to: string; req: string; file: string; on: string | null; sentAt: number }

/** Requests older than this are left alone (hot reload or a restarted copy: plan §3). */
export const MAX_OPEN_AGE_MS = 2000;

export function acceptOpen(self: { key: string; seen: string[]; now: number }, m: OpenMessage): "accept" | "not-mine" | "expired" | "duplicate" {
  if (m.to !== self.key) return "not-mine";
  if (self.now - m.sentAt > MAX_OPEN_AGE_MS) return "expired";
  if (self.seen.includes(m.req)) return "duplicate";
  return "accept";
}

export interface OpenRequest { req: string; file: string; on: string | null }
export type Choice = "save" | "discard" | "cancel";

export type Effect =
  | { type: "open"; file: string; on: string | null }
  | { type: "saveThenOpen"; file: string; on: string | null }
  | { type: "openDialog"; req: string }
  | { type: "closeDialog"; overlay: string }
  | { type: "focusEditor" };

export interface Routing { pending: (OpenRequest & { overlay: string | null }) | null }

export const idleRouting = (): Routing => ({ pending: null });

/** An accepted open request: open now, or ask save/discard/cancel when the document is dirty. */
export function handleOpen(s: Routing, r: OpenRequest, doc: { dirty: boolean }): { state: Routing; effects: Effect[] } {
  const effects: Effect[] = [];
  if (s.pending?.overlay) effects.push({ type: "closeDialog", overlay: s.pending.overlay });
  if (!doc.dirty) return { state: idleRouting(), effects: [...effects, { type: "open", file: r.file, on: r.on }] };
  return { state: { pending: { ...r, overlay: null } }, effects: [...effects, { type: "openDialog", req: r.req }] };
}

export function dialogOpened(s: Routing, req: string, overlay: string): Routing {
  return s.pending?.req === req ? { pending: { ...s.pending, overlay } } : s;
}

/** The dialog's answer. Only the first reply for the pending request counts. */
export function handleReply(s: Routing, reply: { req: string; choice: Choice }): { state: Routing; effects: Effect[] } {
  const p = s.pending;
  if (!p || p.req !== reply.req) return { state: s, effects: [] };
  const effects: Effect[] =
    reply.choice === "save" ? [{ type: "saveThenOpen", file: p.file, on: p.on }]
    : reply.choice === "discard" ? [{ type: "open", file: p.file, on: p.on }]
    : [{ type: "focusEditor" }];
  return { state: idleRouting(), effects };
}

/**
 * The user typed or clicked in the editor while a reply was pending. The modal dialog prevents
 * that, so the reply was lost: treat it as cancel (no API reports a closed overlay: plan §3).
 */
export function interacted(s: Routing): { state: Routing; effects: Effect[] } {
  if (!s.pending) return { state: s, effects: [] };
  return { state: idleRouting(), effects: s.pending.overlay ? [{ type: "closeDialog", overlay: s.pending.overlay }] : [] };
}
