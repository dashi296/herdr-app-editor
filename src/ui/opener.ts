// Sends a file to an editor pane: the most recently focused editor in the tab, or a new one split
// to the right of the focused pane. Used by the Files fork and the quick open overlay. Messages are
// `<mod>.open:<json>` commands (src/core/routing/routing.ts, spike S5).
import { focused, panes, run, setShared, shared } from "herdr";
import type { At } from "../core/jump/jump";
import { MOD_EDITOR, SHARED_KEY } from "../core/names";
import { encodeCommand, newPaneAfterSplit, pickTarget, pruneRegistry, type Registry } from "../core/routing/routing";

export interface OpenRequest {
  /** Absolute path. */
  file: string;
  /** Machine (null: this computer). */
  on: string | null;
  /** The tab to open in, captured when the person asked. */
  tab: string;
  /** Always split a new editor pane. */
  newPane: boolean;
}

/** What the opener needs from a gpui-kit context: run a task that can sleep. */
export interface OpenerContext {
  spawn(fn: (cx: OpenerContext & { sleep(ms: number): Promise<void> }) => Promise<unknown>): unknown;
}

/** Where a request went: the editor pane's key, and whether that pane was split for it. */
export interface OpenResult {
  key: string;
  split: boolean;
}

type SharedState = { registry?: Registry } & Record<string, unknown>;
const readShared = () => (shared(SHARED_KEY) ?? {}) as SharedState;
/** The editor a file in `tab` goes to: the most recently focused live editor there, if any. */
export function editorIn(tab: string): { key: string; pane: string } | null {
  const all = panes();
  return pickTarget(pruneRegistry(readShared().registry ?? {}, all, MOD_EDITOR), all, MOD_EDITOR, tab);
}

/** Shows that editor and sends it the file, to be opened at `at` when given. */
export function sendTo(target: { key: string; pane: string }, file: string, on: string | null, at?: At): void {
  // pane.focus first: FIFO delivery makes the editor shown when "open" arrives (spike S5).
  run("pane.focus", { pane: target.pane });
  run(
    `${MOD_EDITOR}.${encodeCommand("open", { to: target.key, req: id("r"), file, on, sentAt: Date.now(), ...(at ? { at } : {}) })}`,
  );
}

export const id = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class EditorOpener {
  /** A split is being registered: a second split would make the new pane ambiguous
   *  (newPaneAfterSplit needs exactly one), so requests wait in `queued` and replay in order. */
  splitting = false;
  private queued: { request: OpenRequest; resolve: (r: OpenResult | null) => void }[] = [];

  /** Resolves once the file was sent to an existing editor, or once a new editor pane is registered
   *  (null if the new pane never showed up). Throws at once if the split itself fails. */
  open(request: OpenRequest, cx: OpenerContext): Promise<OpenResult | null> {
    if (this.splitting) return new Promise((resolve) => this.queued.push({ request, resolve }));
    const { file, on, tab, newPane } = request;
    const all = panes();
    const target = newPane ? null : editorIn(tab);
    if (target) {
      sendTo(target, file, on);
      return Promise.resolve({ key: target.key, split: false });
    }
    const inTab = all.filter((p) => p.tab === tab);
    const f = focused();
    const base = inTab.find((p) => p.pane === f?.pane) ?? inTab[0];
    if (!base) return Promise.resolve(null);
    const before = all.filter((p) => p.mod === MOD_EDITOR).map((p) => p.pane);
    const key = id("e");
    this.splitting = true;
    try {
      run("pane.split", { pane: base.pane, direction: "right", mod: MOD_EDITOR, props: { key, file, on } });
    } catch (e) {
      this.splitting = false;
      this.drain(cx);
      throw e;
    }
    // The editor cannot learn its own pane at init (spike S5 result 6): register it from here.
    return new Promise((resolve) => {
      cx.spawn(async (cx) => {
        let result: OpenResult | null = null;
        try {
          for (let i = 0; i < 30; i++) {
            await cx.sleep(100);
            const pane = newPaneAfterSplit(before, panes(), MOD_EDITOR, tab);
            if (!pane) continue;
            const now = readShared();
            const reg = pruneRegistry(now.registry ?? {}, panes(), MOD_EDITOR);
            reg[key] = { pane, tab, lastFocus: Date.now() };
            setShared(SHARED_KEY, { ...now, registry: reg });
            result = { key, split: true };
            return;
          }
        } finally {
          this.splitting = false;
          resolve(result);
          this.drain(cx);
        }
      });
    });
  }

  private drain(cx: OpenerContext) {
    while (this.queued.length && !this.splitting) {
      const { request, resolve } = this.queued.shift()!;
      try {
        void this.open(request, cx).then(resolve);
      } catch {
        resolve(null);
      }
    }
  }
}
