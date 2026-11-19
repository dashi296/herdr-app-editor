// The editor pane (role "editor") and its save/discard/cancel dialog (role "dialog").
// Depends on ports and core only; entries/editor.ts supplies the adapters (plan §1).
import { View, div, type AsyncContext, type Context, type Element, type KeyEvent } from "gpui-kit";
import { Editor, EditorState, h_flex, v_flex } from "gpui-base";
import * as herdr from "herdr";
import {
  closeOverlay,
  focused,
  keys,
  nextCommand,
  openOverlay,
  panes,
  props,
  run,
  settings,
  shared,
  setShared,
  spaces,
  theme,
  window,
} from "herdr";
import {
  acknowledgeExternal,
  applyFormatted,
  beginPoll,
  beginSave,
  edit,
  isDirty,
  open,
  pollResult,
  reloadFrom,
  saveFailed,
  saveSucceeded,
  type Doc,
  type Reread,
  type SaveRequest,
} from "../core/document/document";
import { draftBase, draftDir, paneBase } from "../core/draft/paths";
import type { PaneState } from "../core/pane-state/pane-state";
import type { Registry as ExtensionRegistry } from "../core/extensions/registry";
import { highlightFor, languageFor } from "../core/language/language";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { HERDR_THEME, nextTheme, pickTheme, resolveSyntax, themeNames, type EditorTheme } from "../core/theme/theme";
import { MOD_EDITOR, MOD_OPEN, SHARED_KEY } from "../core/names";
import { palette, type Palette } from "./palette";
import {
  acceptOpen,
  decodeCommand,
  dialogOpened,
  encodeCommand,
  handleOpen,
  handleReply,
  idleRouting,
  interacted,
  newPaneAfterSplit,
  pruneRegistry,
  type Choice,
  type Effect,
  type OpenMessage,
  type Registry,
  type Routing,
} from "../core/routing/routing";
import { fnv1a32 } from "../core/store/slots";
import { classifyText, prepareForSave } from "../core/text/text";
import { editorModel, type Action } from "../core/view-model/editor";
import { DraftWriter, type Timer } from "../ports/draft-writer";
import type { FileStore } from "../ports/file-store";
import { sweepPaneStates } from "../ports/pane-states";
import type { SlotStore } from "../ports/slot-store";

export interface EditorDeps {
  files: FileStore;
  store: SlotStore;
  extensions: ExtensionRegistry;
}

interface Draft {
  machine: string | null;
  path: string;
  ownerKey: string;
  baselineHash: string;
  text: string;
  savedAt: number;
}
interface SharedState {
  registry?: Registry;
  theme?: string;
}

type Screen = { kind: "loading" } | { kind: "message"; text: string } | { kind: "empty" } | { kind: "ready" };

const POLL_LOCAL_MS = 3000,
  POLL_REMOTE_MS = 10000;

/** master-only host APIs, looked up at run time so the mod still loads on 0.1.15 (spike Step 0). */
/**
 * Stale pane records are swept once per module load (shared by every copy), a while after start.
 * Every copy waits and the first one to wake sweeps: the host can create a copy and drop it at once
 * (seen on 0.1.16: two inits for one pane), and a dropped copy's task never wakes. A failed sweep
 * lets the next copy to wake try again.
 */
const SWEEP_DELAY_MS = 60_000;
let sweep: "waiting" | "running" | "done" = "waiting";

const isChecking = (): boolean => (herdr as { checking?: () => boolean }).checking?.() ?? false;

function readShared(): SharedState {
  const v = shared(SHARED_KEY);
  return v && typeof v === "object" ? (v as SharedState) : {};
}

function timerFrom(cx: Context): Timer {
  return { now: () => Date.now(), after: (ms, fn) => cx.timer.after(ms, () => fn()) };
}

const isDark = () => settings().dark !== false;

/** The chosen editor theme (shared by every editor), if it suits the app's appearance, and its colors now. */
function chosenTheme(themes: EditorTheme[]): { name: string; syntax: Record<string, string> } {
  const picked = pickTheme(themes, readShared().theme, isDark());
  return { name: picked?.name ?? HERDR_THEME, syntax: resolveSyntax(picked, theme()) };
}

export abstract class EditorView extends View {
  protected abstract makeDeps(): EditorDeps;

  private role: "editor" | "dialog" = "editor";
  private deps!: EditorDeps;
  private key = "default";
  private handle: ReturnType<AsyncContext["focus_handle"]> | null = null;
  private screen: Screen = { kind: "loading" };
  private doc: Doc | null = null;
  private code: EditorState | null = null;
  private readonlyReason: "remote" | "not-writable" | "unknown" | "extension" | null = null;
  /** Highest document generation this view has used; the next document starts above it (review B1). */
  private lastGeneration = 0;
  /** Bumped by every openFile; an older open stops at its next await (review B1). */
  private openSeq = 0;
  private lossy = false;
  private highlightOff = false;
  /** Built-in themes plus valid extension themes. */
  private themes: EditorTheme[] = BUILTIN_THEMES;
  /** Language chosen by an onFileOpen extension for the current file. */
  private languageOverride: string | undefined;
  private readonlyNote: string | undefined;
  /** Messages from extensions (failing hooks, invalid themes, a cancelled save). */
  private extensionNotes: string[] = [];
  private themeNotes: string[] = [];
  /** The theme the current EditorState was built with (EditorState cannot change colors: R8). */
  private appliedTheme: { name: string; key: string } | null = null;
  /** The user turned highlighting back on for this file (spike S8). */
  private forceHighlight = false;
  private draftOffer: Draft | null = null;
  private draftError: string | null = null;
  private writer: DraftWriter<Draft> | null = null;
  private routing: Routing = idleRouting();
  private seen: string[] = [];
  private polling = false;
  private lastPoll = 0;
  // dialog role
  private dialogProps: { to: string; req: string; file: string } | null = null;
  private choice: Choice | null = null;

  override init(_props: unknown, cx: AsyncContext): void {
    const p = (props() ?? {}) as Record<string, unknown>;
    if (p.role === "dialog") {
      this.role = "dialog";
      this.dialogProps = { to: String(p.to), req: String(p.req), file: String(p.file ?? "") };
      this.handle = cx.focus_handle();
      this.handle.focus();
      return;
    }
    this.handle = cx.focus_handle();
    if (isChecking()) {
      // `herdr-app check`: render only, no side effects (S1-3).
      this.screen = { kind: "empty" };
      return;
    }
    // A pane opened without a key (by an agent, another mod, or by hand) gets one for this run:
    // its drafts are still found by file, but after a restart it reopens props.file (#29).
    this.key =
      typeof p.key === "string" ? p.key : `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    this.deps = this.makeDeps();
    const t = this.deps.extensions.themes(BUILTIN_THEMES);
    this.themes = t.themes;
    this.themeNotes = t.messages;
    const initial = { file: typeof p.file === "string" ? p.file : null, on: typeof p.on === "string" ? p.on : null };
    cx.spawn(async (cx) => {
      let target = initial;
      const seq = this.openSeq;
      try {
        const saved = await this.deps.store.load<PaneState>(paneBase(this.key));
        if (saved?.file) target = saved;
      } catch {
        /* fall back to props */
      }
      // A file opened from Files while this was loading wins over the remembered one (review).
      if (seq !== this.openSeq) return;
      if (target.file) await this.openFile(target.file, target.on, cx);
      else this.screen = { kind: "empty" };
      this.claimNewPane();
      cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        // No await here: hand each command to its own task (plan §3).
        cx.spawn(async (cx) => {
          await this.onCommand(command, cx);
          cx.notify();
        });
      }
    });
    cx.timer.every(1000, (cx) => this.maybePoll(cx));
    // After the delay every live editor has opened its file and so refreshed its own record.
    cx.spawn(async (cx) => {
      await cx.sleep(SWEEP_DELAY_MS);
      if (sweep !== "waiting") return;
      sweep = "running";
      try {
        await sweepPaneStates(this.deps.store, this.key, Date.now());
        sweep = "done";
      } catch {
        sweep = "waiting";
      }
    });
  }

  override async close(_cx: AsyncContext): Promise<void> {
    if (this.role === "dialog") {
      const d = this.dialogProps!;
      run(`${MOD_EDITOR}.${encodeCommand("reply", { to: d.to, req: d.req, choice: this.choice ?? "cancel" })}`);
      return;
    }
    await this.writer?.flush();
  }

  // ---------- opening ----------

  private async openFile(path: string, on: string | null, cx: AsyncContext): Promise<void> {
    const seq = ++this.openSeq;
    const stale = () => seq !== this.openSeq;
    // Leaving a dirty document only happens after "Don't save": its draft goes too.
    const leaving = this.doc;
    if (leaving && isDirty(leaving)) {
      this.writer?.discard();
      try {
        await this.writer?.flush();
      } catch {
        /* the draft is being discarded anyway */
      }
      if (this.doc !== leaving) return; // edited after choosing: keep editing, keep the draft
      await this.dropDraft();
      if (this.doc !== leaving) return;
    }
    if (stale()) return;
    this.screen = { kind: "loading" };
    cx.notify();
    let text: string | null;
    try {
      text = await this.deps.files.read(path, on);
    } catch (e) {
      if (!stale()) this.showMessage(`Cannot open ${path}: ${String(e)} (only UTF-8 text up to 1 MiB can be edited)`);
      return;
    }
    if (stale()) return;
    if (text === null) {
      this.showMessage(`${path} does not exist.`);
      return;
    }
    const cls = classifyText(text, { remote: on !== null });
    if (cls.kind === "binary") {
      this.showMessage(`${path} looks like a binary file.`);
      return;
    }
    const writable = on === null ? await this.deps.files.canWrite(path, on) : false;
    if (stale()) return;
    const ext = await this.deps.extensions.fileOpened({ path, machine: on, text, language: languageFor(path) });
    if (stale()) return;
    this.languageOverride = ext.language === languageFor(path) ? undefined : ext.language;
    this.readonlyNote = ext.readonly ?? undefined;
    this.extensionNotes = ext.messages;
    // Saving needs a confirmed write permission: writeTextFile replaces read-only files (R17, review B4).
    this.readonlyReason =
      on !== null
        ? "remote"
        : writable === true
          ? ext.readonly
            ? "extension"
            : null
          : writable === false
            ? "not-writable"
            : "unknown";
    this.lossy = cls.kind === "text" && cls.lossy === true;
    this.forceHighlight = false;
    this.draftOffer = null;
    this.setDoc(open({ path, machine: on, text, after: Math.max(this.lastGeneration, this.doc?.generation ?? 0) }));
    this.writer = new DraftWriter<Draft>(
      { save: (d) => this.deps.store.save(draftBase(d.machine, d.path, d.ownerKey), d) },
      { now: () => Date.now() },
      {
        debounceMs: 250,
        maxWaitMs: 1000,
        onError: (e) => {
          this.draftError = String(e);
        },
      },
    );
    this.deps.store.save<PaneState>(paneBase(this.key), { file: path, on, seenAt: Date.now() }).catch(() => {});
    const found = await this.findDraft(path, on, text);
    if (stale()) return;
    this.draftOffer = found.draft;
    this.draftError = found.error;
    this.screen = { kind: "ready" };
  }

  private showMessage(text: string) {
    this.code?.release();
    this.code = null;
    this.doc = null;
    this.screen = { kind: "message", text };
  }

  private setDoc(doc: Doc) {
    this.code?.release();
    this.doc = doc;
    this.lastGeneration = Math.max(this.lastGeneration, doc.generation);
    const hl = highlightFor(doc.path, doc.text.length, {
      force: this.forceHighlight,
      ...(this.languageOverride ? { language: this.languageOverride } : {}),
    });
    const applied = chosenTheme(this.themes);
    this.appliedTheme = { name: applied.name, key: JSON.stringify(applied.syntax) };
    this.highlightOff = hl.off;
    this.code = EditorState.new({
      language: hl.language,
      value: doc.text,
      readonly: this.readonlyReason !== null,
      font_family: String(settings().font_family ?? ""),
      font_size: 13,
      syntax: applied.syntax,
    });
    this.code.on("change", (_e, cx) => this.onChange(cx));
    // The editor itself took the keyboard: this is now the latest focused editor (review S2).
    this.code.on("focus", () => this.register());
  }

  /** The newest draft of this file that differs from disk. Returned, not stored: the caller commits it only if still current. */
  private async findDraft(
    path: string,
    on: string | null,
    disk: string,
  ): Promise<{ draft: Draft | null; error: string | null }> {
    let best: Draft | null = null;
    try {
      const dir = draftDir(on, path);
      for (const owner of await this.deps.store.owners(dir)) {
        const d = await this.deps.store.load<Draft>(`${dir}/${owner}`);
        if (!d || d.path !== path || d.machine !== on || d.text === disk) continue;
        if (!best || d.savedAt > best.savedAt) best = d;
      }
    } catch (e) {
      return { draft: best, error: String(e) };
    }
    return { draft: best, error: null };
  }

  // ---------- editing and saving ----------

  private onChange(cx: Context) {
    if (!this.doc || !this.code) return;
    if (this.routing.pending) this.apply(interacted(this.routing), cx);
    this.doc = edit(this.doc, this.code.value());
    const d = this.doc;
    if (isDirty(d)) {
      this.writer?.update(
        {
          machine: d.machine,
          path: d.path,
          ownerKey: this.key,
          baselineHash: fnv1a32(d.baseline),
          text: d.text,
          savedAt: Date.now(),
        },
        timerFrom(cx),
      );
    } else {
      // Back to the saved content (e.g. undo): the draft is no longer an unsaved edit (review S1).
      this.writer?.discard();
      void this.dropDraft();
    }
    cx.notify();
  }

  private async save(cx: Context | AsyncContext): Promise<boolean> {
    if (!this.doc || this.doc.status === "saving" || this.readonlyReason) return false;
    const target = this.doc;
    const writable = await this.deps.files.canWrite(target.path, target.machine);
    if (this.doc !== target) return false; // edited or switched while checking: the user saves again
    if (writable !== true) {
      this.readonlyReason = writable === false ? "not-writable" : "unknown";
      cx.notify();
      return false;
    }
    // beforeSave extensions see exactly the text that would be written (plan §4 Step 5).
    const hooked = await this.deps.extensions.beforeSave({
      path: target.path,
      machine: target.machine,
      text: prepareForSave(target.text, target.eol),
    });
    if (this.doc !== target) return false; // edited or switched while the hooks ran
    if (!hooked.ok) {
      this.extensionNotes = [`Save cancelled. ${hooked.reason}`];
      cx.notify();
      return false;
    }
    this.extensionNotes = [];
    if (hooked.text !== prepareForSave(target.text, target.eol)) {
      // An extension rewrote the text (e.g. a formatter): show what will be saved.
      const sel = (this.code as { selected_range?: () => { start: number; end: number } } | null)?.selected_range?.();
      // set_value fires no "change" event and clears undo, so record the draft here (review).
      this.code?.set_value(hooked.text);
      this.doc = applyFormatted(target, hooked.text);
      const f = this.doc;
      if (isDirty(f))
        this.writer?.update(
          {
            machine: f.machine,
            path: f.path,
            ownerKey: this.key,
            baselineHash: fnv1a32(f.baseline),
            text: f.text,
            savedAt: Date.now(),
          },
          timerFrom(cx),
        );
      if (sel)
        (
          this.code as { set_selected_range?: (r: { start: number; end: number }) => void } | null
        )?.set_selected_range?.({
          start: Math.min(sel.start, hooked.text.length),
          end: Math.min(sel.end, hooked.text.length),
        });
    }
    const { state, request } = beginSave(this.doc!);
    this.doc = state;
    cx.notify();
    try {
      await this.deps.files.write(request.path, request.text, request.expected);
      // Another document now: the old file was saved, but nothing that follows (e.g. "save, then open") may act on this one.
      if (!this.doc || this.doc.generation !== request.generation || this.doc.path !== request.path) return false;
      this.doc = saveSucceeded(this.doc, request.generation);
    } catch (e) {
      return await this.saveFailedAfter(request, e, cx);
    }
    // The file is saved. Draft cleanup failing must not turn that into a save failure (review).
    const saved = this.doc;
    if (saved && !isDirty(saved)) {
      this.writer?.discard();
      try {
        await this.writer?.flush();
      } catch (e) {
        this.draftError = String(e);
      }
      // Edited while waiting: that edit's draft stays, and "save, then open" must not continue (review).
      // Switched to another file while waiting: the saved file's draft is stale, so remove it anyway (#10).
      if (this.doc !== saved) {
        if (this.doc?.path !== saved.path || this.doc?.machine !== saved.machine) await this.dropDraft(saved);
        cx.notify();
        return false;
      }
      await this.dropDraft(saved);
      if (this.doc !== saved) {
        cx.notify();
        return false;
      }
    }
    cx.notify();
    return true;
  }

  /** writeTextFile rejected: classify by what a re-read observes (plan §2). */
  private async saveFailedAfter(request: SaveRequest, e: unknown, cx: Context | AsyncContext): Promise<boolean> {
    let reread: Reread;
    try {
      const now = await this.deps.files.read(request.path, request.machine);
      reread = now === null ? { kind: "missing" } : { kind: "text", text: now };
    } catch (re) {
      reread = { kind: "unreadable", error: String(re) };
    }
    if (!this.doc || this.doc.path !== request.path || this.doc.machine !== request.machine) return false;
    this.doc = saveFailed(this.doc, request.generation, reread, String(e));
    cx.notify();
    return false;
  }

  /** Removes this pane's draft of `d` (the current document unless given). */
  private async dropDraft(d: Doc | null = this.doc) {
    if (!d) return;
    await this.deps.store.remove(draftBase(d.machine, d.path, this.key)).catch((e) => {
      this.draftError = String(e);
    });
  }

  // ---------- external changes ----------

  /**
   * Rebuilds the EditorState when the theme changed: at once when another theme was chosen, and
   * when Herdr's own palette changed only while the document is clean (a rebuild drops undo: R8).
   */
  private maybeRetheme() {
    const d = this.doc,
      applied = this.appliedTheme;
    if (!d || !applied || this.screen.kind !== "ready") return;
    const want = chosenTheme(this.themes);
    if (want.name === applied.name && JSON.stringify(want.syntax) === applied.key) return;
    if (want.name === applied.name && isDirty(d)) return;
    this.rebuildKeepingSelection(d);
  }

  private rebuildKeepingSelection(d: Doc) {
    const sel = (this.code as { selected_range?: () => { start: number; end: number } } | null)?.selected_range?.();
    this.setDoc(d);
    if (sel)
      (this.code as { set_selected_range?: (r: { start: number; end: number }) => void } | null)?.set_selected_range?.(
        sel,
      );
  }

  private maybePoll(cx: AsyncContext) {
    this.maybeRetheme();
    const d = this.doc;
    if (!d || this.polling || d.status === "saving" || !this.isVisible()) return;
    const interval = d.machine === null ? POLL_LOCAL_MS : POLL_REMOTE_MS;
    if (Date.now() - this.lastPoll < interval) return;
    this.lastPoll = Date.now();
    this.polling = true;
    const token = beginPoll(d);
    cx.spawn(async (cx) => {
      try {
        const disk = await this.deps.files.read(d.path, d.machine);
        if (!this.doc) return;
        const before = this.doc;
        this.doc = pollResult(this.doc, token, disk);
        if (this.doc !== before && this.doc.status === "clean" && this.doc.text !== before.text)
          this.code?.set_value(this.doc.text);
      } catch {
        /* unreadable for now: try again next time */
      } finally {
        this.polling = false;
        cx.notify();
      }
    });
  }

  /** Visible: window active, own tab shown in the active space, and not hidden behind a zoom (plan §4 Step 2). */
  private isVisible(): boolean {
    if (window()?.active === false) return false;
    const entry = readShared().registry?.[this.key];
    if (!entry) return true; // unknown pane: polling a little too often is the safe side
    const me = panes().find((p) => p.pane === entry.pane);
    if (!me) return true;
    const space = spaces().find((s) => s.tabs.some((t) => t.id === me.tab));
    const tab = space?.tabs.find((t) => t.id === me.tab);
    if (!space?.active || !tab?.active) return false;
    if (panes().some((p) => p.tab === me.tab && p.zoomed) && !me.zoomed) return false;
    return true;
  }

  // ---------- routing (plan §3) ----------

  private async onCommand(command: string, cx: AsyncContext) {
    const { verb, payload } = decodeCommand(command);
    if (verb === "focus") {
      this.register();
      this.handle?.focus();
      return;
    }
    if (verb === "open" && payload) {
      const m = payload as OpenMessage;
      const verdict = acceptOpen({ key: this.key, seen: this.seen, now: Date.now() }, m);
      if (verdict !== "accept") return;
      this.seen = [...this.seen.slice(-31), m.req];
      this.register();
      const r = handleOpen(
        this.routing,
        { req: m.req, file: m.file, on: m.on },
        { dirty: this.doc ? isDirty(this.doc) : false },
      );
      await this.apply(r, cx);
      return;
    }
    if (verb === "reply" && payload) {
      const m = payload as { to: string; req: string; choice: Choice };
      if (m.to !== this.key) return;
      await this.apply(handleReply(this.routing, m), cx);
    }
  }

  private async apply(r: { state: Routing; effects: Effect[] }, cx: Context | AsyncContext) {
    this.routing = r.state;
    for (const e of r.effects) {
      if (e.type === "open") await this.openFile(e.file, e.on, cx as AsyncContext);
      else if (e.type === "saveThenOpen") {
        if (await this.save(cx)) await this.openFile(e.file, e.on, cx as AsyncContext);
      } else if (e.type === "closeDialog") closeOverlay(e.overlay);
      else if (e.type === "focusEditor") (this.code as { focus?: () => void } | null)?.focus?.();
      else if (e.type === "openDialog") {
        const overlay = openOverlay({
          mod: MOD_EDITOR,
          kind: "dialog",
          modal: true,
          width: 440,
          height: 150,
          props: { role: "dialog", to: this.key, req: e.req, file: this.doc?.path ?? "" },
        });
        this.routing = dialogOpened(this.routing, e.req, overlay);
      }
    }
  }

  /**
   * After the first load, for a pane split by quick open (props `before` and `tab`): nobody else is
   * left to register it, and it cannot learn its own pane id. Its pane is the one editor pane in
   * that tab that was not there before the split; with more than one candidate it registers nothing
   * and waits for its editor to get focus (register()).
   */
  private claimNewPane() {
    const p = (props() ?? {}) as { before?: unknown; tab?: unknown };
    if (!Array.isArray(p.before) || typeof p.tab !== "string") return;
    const pane = newPaneAfterSplit(p.before.map(String), panes(), MOD_EDITOR, p.tab);
    if (pane) this.writeEntry(pane, p.tab);
  }

  /** Records this pane as the latest focused editor. The "focus" command reaches the focused copy. */
  private register() {
    const pane = focused()?.pane;
    const me = pane ? panes().find((p) => p.pane === pane && p.mod === MOD_EDITOR) : undefined;
    if (me) this.writeEntry(me.pane, me.tab);
  }

  /** registry[this.key] = pane, dropping any other key that names the same pane (a key a keyless
   *  pane had before a restart or reload would otherwise get the next file). */
  private writeEntry(pane: string, tab: string) {
    const s = readShared();
    const registry = Object.fromEntries(
      Object.entries(pruneRegistry(s.registry ?? {}, panes(), MOD_EDITOR)).filter(
        ([k, e]) => k === this.key || e.pane !== pane,
      ),
    );
    registry[this.key] = { pane, tab, lastFocus: Date.now() };
    setShared(SHARED_KEY, { ...s, registry });
  }

  // ---------- banner actions ----------

  private async act(a: Action, cx: Context) {
    const d = this.doc;
    if (!d) return;
    if (a === "keep") this.doc = acknowledgeExternal(d);
    else if (a === "retry") await this.save(cx);
    else if (a === "highlightOn") {
      // EditorState has no set_language (R8): rebuild it, keeping the text and the selection.
      this.forceHighlight = true;
      this.rebuildKeepingSelection(d);
    } else if (a === "reload") {
      const disk = await this.deps.files.read(d.path, d.machine).catch(() => null);
      // Edits made while reading win: reload only if nothing changed meanwhile (review B2).
      if (disk !== null && this.doc === d) {
        this.writer?.discard();
        await this.dropDraft();
        if (this.doc === d) this.setDoc(reloadFrom(d, disk));
      }
    } else if (a === "restore" && this.draftOffer) {
      const o = this.draftOffer;
      this.code?.set_value(o.text);
      this.doc = edit(d, o.text);
      this.draftOffer = null;
      // Take the draft over: saving or discarding removes only this pane's draft, and the pane that
      // wrote it may be gone. set_value fires no "change", so write this pane's copy here, and remove
      // the restored one only once the copy is on disk.
      const r = this.doc;
      if (o.ownerKey !== this.key && isDirty(r) && this.writer) {
        this.writer.update(
          {
            machine: r.machine,
            path: r.path,
            ownerKey: this.key,
            baselineHash: fnv1a32(r.baseline),
            text: r.text,
            savedAt: Date.now(),
          },
          timerFrom(cx),
        );
        try {
          await this.writer.flush();
          await this.deps.store.remove(draftBase(o.machine, o.path, o.ownerKey));
        } catch (e) {
          this.draftError = String(e);
        }
      }
    } else if (a === "discardDraft" && this.draftOffer) {
      const o = this.draftOffer;
      this.draftOffer = null;
      await this.deps.store.remove(draftBase(o.machine, o.path, o.ownerKey)).catch((e) => {
        this.draftError = String(e);
      });
    }
    cx.notify();
  }

  // ---------- rendering ----------

  private onKey(e: KeyEvent, cx: Context) {
    const saveKey = window()?.platform === "macos" ? "cmd-s" : "ctrl-s";
    if (e.keystroke !== saveKey || this.role !== "editor") return;
    cx.stop_propagation();
    cx.spawn(async (cx) => {
      await this.save(cx);
      cx.notify();
    });
  }

  override render(_cx: Context): Element {
    const t = palette();
    if (this.role === "dialog") return this.renderDialog(t);
    const root = v_flex()
      .id("editor")
      .size_full()
      .min_h(0)
      .bg(t.background)
      .text_color(t.foreground)
      .text_size(13)
      .track_focus(this.handle!)
      .on_key_down((e: KeyEvent, cx: Context) => this.onKey(e, cx))
      .on_mouse_down("left", () => {
        if (!this.code) this.handle?.focus();
      });
    if (this.screen.kind === "empty") return root.child(this.renderEmpty(t));
    if (this.screen.kind !== "ready" || !this.doc || !this.code) {
      const text = this.screen.kind === "message" ? this.screen.text : "Loading…";
      return root.child(div().p(16).text_color(t.dim).child(text));
    }
    const model = editorModel({
      doc: this.doc,
      readonly: this.readonlyReason,
      lossy: this.lossy,
      draftError: this.draftError,
      highlightOff: this.highlightOff,
      ...(this.readonlyNote ? { readonlyNote: this.readonlyNote } : {}),
      extensionNotes: [...this.themeNotes, ...this.extensionNotes],
      draftOffer: this.draftOffer && {
        savedAt: new Date(this.draftOffer.savedAt).toLocaleTimeString(),
        conflict: this.draftOffer.baselineHash !== fnv1a32(this.doc.baseline),
      },
    });
    const header = h_flex()
      .id("editor-header")
      .h(34)
      .flex_none()
      .px(12)
      .gap(8)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      // A click outside the text area gives the keyboard to the pane, so cmd-s / ctrl-s still arrives (review S2).
      .on_mouse_down("left", () => this.handle?.focus())
      .child(
        div()
          .w(10)
          .text_color(t.accent)
          .child(model.dirty ? "●" : ""),
      )
      .child(div().font_semibold().child(model.title))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(11).text_color(t.dim).child(this.doc.path))
      .child(
        div()
          .text_size(11)
          .text_color(t.dim)
          .child(this.doc.status === "saving" ? "Saving…" : ""),
      )
      .child(
        h_flex()
          .id("theme-switch")
          .h(22)
          .px(8)
          .items_center()
          .rounded(5)
          .border_1()
          .border_color(t.border)
          .text_size(11)
          .text_color(t.muted)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => {
            const s = readShared();
            setShared(SHARED_KEY, {
              ...s,
              theme: nextTheme(chosenTheme(this.themes).name, themeNames(this.themes, isDark())),
            });
            this.maybeRetheme(); // this copy at once; the others on their next timer tick
            cx.notify();
          })
          .child(`Theme: ${this.appliedTheme?.name ?? HERDR_THEME}`),
      );
    const banners = model.banners.map((b, i) =>
      h_flex()
        .id(`banner-${i}`)
        .flex_none()
        .px(12)
        .py(6)
        .gap(8)
        .items_center()
        // In a narrow pane the buttons wrap below the text instead of squeezing it to one word per line.
        .flex_wrap()
        .border_b(1)
        .border_color(t.border)
        .bg(b.kind === "error" ? t.blocked : b.kind === "warn" ? t.raised : t.surface)
        .child(div().flex_grow(1).flex_basis(BANNER_TEXT_MIN).min_w(0).child(b.text))
        // The buttons move together; in a pane narrower than all of them, they wrap among themselves.
        // A banner without buttons gets no group, so no empty item can wrap and add a gap.
        .children(
          b.actions.length === 0
            ? []
            : [
                h_flex()
                  .flex_wrap()
                  .min_w(0)
                  .gap(8)
                  .children(
                    b.actions.map((a) =>
                      this.button(`act-${i}-${a}`, ACTION_LABEL[a], t, (cx) => {
                        cx.spawn(async (cx) => {
                          await this.act(a, cx);
                        });
                      }).flex_shrink_0(),
                    ),
                  ),
              ],
        ),
    );
    return root.child(header).children(banners).child(Editor.new(this.code).flex_1().min_h(0));
  }

  /** No file: a button that opens the quick open overlay, and the key bound to it, if any. */
  private renderEmpty(t: Palette): Element {
    const bound = keys().find((k) => k.action === `mod.open:${MOD_OPEN}`)?.keys;
    return v_flex()
      .p(16)
      .gap(10)
      .items_start()
      .child(div().text_color(t.dim).child("No file open."))
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(
            this.button("open-file", "Open file…", t, () => {
              // Clicking focused this pane: record it so the file chosen next comes back here.
              this.register();
              run("mod.open", { name: MOD_OPEN });
            }),
          )
          .children(bound ? [div().text_size(12).text_color(t.dim).child(bound)] : []),
      );
  }

  private button(id: string, label: string, t: Palette, onClick: (cx: Context) => void) {
    return h_flex()
      .id(id)
      .h(26)
      .px(10)
      .items_center()
      .rounded(6)
      .border_1()
      .border_color(t.input)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => onClick(cx))
      .child(label);
  }

  private renderDialog(t: Palette): Element {
    const d = this.dialogProps!;
    const choose = (c: Choice) => (_cx: Context) => {
      this.choice = c;
      closeOverlay(String((props() as { overlay?: string }).overlay));
    };
    return v_flex()
      .id("editor-dialog")
      .size_full()
      .p(18)
      .gap(12)
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(13)
      .track_focus(this.handle!)
      .child(div().font_semibold().child("Save changes before opening another file?"))
      .child(div().text_color(t.muted).truncate().child(d.file))
      .child(
        h_flex()
          .gap(8)
          .justify_end()
          .child(this.button("dlg-cancel", "Cancel", t, choose("cancel")))
          .child(this.button("dlg-discard", "Don't save", t, choose("discard")))
          .child(this.button("dlg-save", "Save", t, choose("save"))),
      );
  }
}

/** The width a banner's text keeps beside its buttons; below it the buttons wrap to the next line. */
const BANNER_TEXT_MIN = 320;

const ACTION_LABEL: Record<Action, string> = {
  reload: "Reload",
  keep: "Keep mine",
  retry: "Retry",
  restore: "Restore draft",
  discardDraft: "Discard draft",
  highlightOn: "Highlight anyway (slower typing)",
};
