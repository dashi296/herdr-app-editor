// The editor pane (role "editor") and its save/discard/cancel dialog (role "dialog").
// Depends on ports and core only; entries/editor.ts supplies the adapters (plan §1).
import { View, div, type AsyncContext, type Context, type Element, type KeyEvent } from "gpui-kit";
import { Editor, EditorState, h_flex, v_flex } from "gpui-base";
import * as herdr from "herdr";
import { closeOverlay, focused, nextCommand, openOverlay, panes, props, run, settings, shared, setShared, spaces, theme, window } from "herdr";
import {
  acknowledgeExternal, beginPoll, beginSave, edit, isDirty, open, pollResult, reloadFrom, saveFailed, saveSucceeded,
  type Doc, type Reread,
} from "../core/document/document";
import { draftBase, draftDir, paneBase } from "../core/draft/paths";
import { highlightFor } from "../core/language/language";
import { MOD_EDITOR, SHARED_KEY } from "../core/names";
import {
  acceptOpen, decodeCommand, dialogOpened, encodeCommand, handleOpen, handleReply, idleRouting, interacted, pruneRegistry,
  type Choice, type Effect, type OpenMessage, type Registry, type Routing,
} from "../core/routing/routing";
import { fnv1a32 } from "../core/store/slots";
import { classifyText } from "../core/text/text";
import { editorModel, type Action } from "../core/view-model/editor";
import { DraftWriter, type Timer } from "../ports/draft-writer";
import type { FileStore } from "../ports/file-store";
import type { SlotStore } from "../ports/slot-store";

export interface EditorDeps { files: FileStore; store: SlotStore }

interface Draft { machine: string | null; path: string; ownerKey: string; baselineHash: string; text: string; savedAt: number }
interface SharedState { registry?: Registry }

type Screen = { kind: "loading" } | { kind: "message"; text: string } | { kind: "ready" };

const POLL_LOCAL_MS = 3000, POLL_REMOTE_MS = 10000;

/** master-only host APIs, looked up at run time so the mod still loads on 0.1.15 (spike Step 0). */
const isChecking = (): boolean => (herdr as { checking?: () => boolean }).checking?.() ?? false;

function readShared(): SharedState {
  const v = shared(SHARED_KEY);
  return v && typeof v === "object" ? (v as SharedState) : {};
}

function timerFrom(cx: Context): Timer {
  return { now: () => Date.now(), after: (ms, fn) => cx.timer.after(ms, () => fn()) };
}

type Hex = `#${string}`;
const PALETTE_KEYS = ["background", "foreground", "border", "dim", "muted", "accent", "blocked", "raised", "surface", "popover", "input", "hover"] as const;
type Palette = Record<(typeof PALETTE_KEYS)[number], Hex>;

/** Theme colors the editor uses, with fallbacks so a missing name never breaks rendering. */
function palette(): Palette {
  const t = theme();
  const fg = (t.foreground ?? "#cccccc") as Hex;
  const out = {} as Palette;
  for (const k of PALETTE_KEYS) out[k] = (t[k] ?? (k === "background" || k === "surface" || k === "popover" ? "#1e1e1e" : fg)) as Hex;
  if (!t.input && t.border) out.input = t.border as Hex;
  if (!t.hover && t.raised) out.hover = t.raised as Hex;
  return out;
}

function syntaxColors(): Record<string, string> {
  const t = theme();
  const pick = (k: string) => t[k] ?? t.foreground ?? "#888888";
  return { keyword: pick("ansi5"), string: pick("ansi2"), comment: pick("dim"), function: pick("ansi4"), type: pick("ansi3"), number: pick("ansi1"), constant: pick("ansi6") };
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
  private readonlyReason: "remote" | "not-writable" | null = null;
  private lossy = false;
  private highlightOff = false;
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
    if (isChecking() || typeof p.key !== "string") {
      // `herdr-app check`, or a copy placed without props: render only, no side effects (S1-3).
      this.screen = { kind: "message", text: "Open a file from the Files panel." };
      return;
    }
    this.key = p.key;
    this.deps = this.makeDeps();
    const initial = { file: typeof p.file === "string" ? p.file : null, on: typeof p.on === "string" ? p.on : null };
    cx.spawn(async (cx) => {
      let target = initial;
      try {
        const saved = await this.deps.store.load<{ file: string; on: string | null }>(paneBase(this.key));
        if (saved?.file) target = saved;
      } catch { /* fall back to props */ }
      if (target.file) await this.openFile(target.file, target.on, cx);
      else this.screen = { kind: "message", text: "Open a file from the Files panel." };
      cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        // No await here: hand each command to its own task (plan §3).
        cx.spawn(async (cx) => { await this.onCommand(command, cx); cx.notify(); });
      }
    });
    cx.timer.every(1000, (cx) => this.maybePoll(cx));
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
    // Leaving a dirty document only happens after "Don't save": its draft goes too.
    if (this.doc && isDirty(this.doc)) { this.writer?.discard(); await this.writer?.flush(); await this.dropDraft(); }
    this.screen = { kind: "loading" };
    cx.notify();
    let text: string | null;
    try { text = await this.deps.files.read(path, on); }
    catch (e) { this.showMessage(`Cannot open ${path}: ${String(e)} (only UTF-8 text up to 1 MiB can be edited)`); return; }
    if (text === null) { this.showMessage(`${path} does not exist.`); return; }
    const cls = classifyText(text, { remote: on !== null });
    if (cls.kind === "binary") { this.showMessage(`${path} looks like a binary file.`); return; }
    const writable = on === null ? await this.deps.files.canWrite(path, on) : false;
    this.readonlyReason = on !== null ? "remote" : writable === false ? "not-writable" : null;
    this.lossy = cls.kind === "text" && cls.lossy === true;
    this.forceHighlight = false;
    this.setDoc(open({ path, machine: on, text }));
    this.writer = new DraftWriter<Draft>({ save: (d) => this.deps.store.save(draftBase(d.machine, d.path, d.ownerKey), d) }, { now: () => Date.now() },
      { debounceMs: 250, maxWaitMs: 1000, onError: (e) => { this.draftError = String(e); } });
    this.deps.store.save(paneBase(this.key), { file: path, on }).catch(() => {});
    await this.findDraft(path, on, text);
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
    const hl = highlightFor(doc.path, doc.text.length, { force: this.forceHighlight });
    this.highlightOff = hl.off;
    this.code = EditorState.new({
      language: hl.language, value: doc.text, readonly: this.readonlyReason !== null,
      font_family: String(settings().font_family ?? ""), font_size: 13, syntax: syntaxColors(),
    });
    this.code.on("change", (_e, cx) => this.onChange(cx));
  }

  private async findDraft(path: string, on: string | null, disk: string) {
    this.draftOffer = null;
    try {
      const dir = draftDir(on, path);
      for (const owner of await this.deps.store.owners(dir)) {
        const d = await this.deps.store.load<Draft>(`${dir}/${owner}`);
        if (!d || d.path !== path || d.machine !== on || d.text === disk) continue;
        if (!this.draftOffer || d.savedAt > this.draftOffer.savedAt) this.draftOffer = d;
      }
    } catch (e) { this.draftError = String(e); }
  }

  // ---------- editing and saving ----------

  private onChange(cx: Context) {
    if (!this.doc || !this.code) return;
    if (this.routing.pending) this.apply(interacted(this.routing), cx);
    this.doc = edit(this.doc, this.code.value());
    const d = this.doc;
    if (isDirty(d)) {
      this.writer?.update({ machine: d.machine, path: d.path, ownerKey: this.key, baselineHash: fnv1a32(d.baseline), text: d.text, savedAt: Date.now() }, timerFrom(cx));
    }
    cx.notify();
  }

  private async save(cx: Context | AsyncContext): Promise<boolean> {
    if (!this.doc || this.doc.status === "saving" || this.readonlyReason) return false;
    const writable = await this.deps.files.canWrite(this.doc.path, this.doc.machine);
    if (writable === false) { this.readonlyReason = "not-writable"; cx.notify(); return false; }
    const { state, request } = beginSave(this.doc);
    this.doc = state;
    cx.notify();
    try {
      await this.deps.files.write(request.path, request.text, request.expected);
      this.doc = saveSucceeded(this.doc, request.generation);
      if (!isDirty(this.doc)) { this.writer?.discard(); await this.writer?.flush(); await this.dropDraft(); }
      cx.notify();
      return true;
    } catch (e) {
      let reread: Reread;
      try {
        const now = await this.deps.files.read(request.path, request.machine);
        reread = now === null ? { kind: "missing" } : { kind: "text", text: now };
      } catch (re) { reread = { kind: "unreadable", error: String(re) }; }
      this.doc = saveFailed(this.doc, request.generation, reread, String(e));
      cx.notify();
      return false;
    }
  }

  private async dropDraft() {
    const d = this.doc;
    if (!d) return;
    await this.deps.store.remove(draftBase(d.machine, d.path, this.key)).catch((e) => { this.draftError = String(e); });
  }

  // ---------- external changes ----------

  private maybePoll(cx: AsyncContext) {
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
        if (this.doc !== before && this.doc.status === "clean" && this.doc.text !== before.text) this.code?.set_value(this.doc.text);
      } catch { /* unreadable for now: try again next time */ }
      finally { this.polling = false; cx.notify(); }
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
    if (verb === "focus") { this.register(); this.handle?.focus(); return; }
    if (verb === "open" && payload) {
      const m = payload as OpenMessage;
      const verdict = acceptOpen({ key: this.key, seen: this.seen, now: Date.now() }, m);
      if (verdict !== "accept") return;
      this.seen = [...this.seen.slice(-31), m.req];
      this.register();
      const r = handleOpen(this.routing, { req: m.req, file: m.file, on: m.on }, { dirty: this.doc ? isDirty(this.doc) : false });
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
      else if (e.type === "saveThenOpen") { if (await this.save(cx)) await this.openFile(e.file, e.on, cx as AsyncContext); }
      else if (e.type === "closeDialog") closeOverlay(e.overlay);
      else if (e.type === "focusEditor") (this.code as { focus?: () => void } | null)?.focus?.();
      else if (e.type === "openDialog") {
        const overlay = openOverlay({ mod: MOD_EDITOR, kind: "dialog", modal: true, width: 440, height: 150,
          props: { role: "dialog", to: this.key, req: e.req, file: this.doc?.path ?? "" } });
        this.routing = dialogOpened(this.routing, e.req, overlay);
      }
    }
  }

  /** Records this pane as the latest focused editor. The "focus" command reaches the focused copy. */
  private register() {
    const f = focused();
    const pane = f?.pane;
    if (!pane || !panes().some((p) => p.pane === pane && p.mod === MOD_EDITOR)) return;
    const me = panes().find((p) => p.pane === pane)!;
    const s = readShared();
    const registry = pruneRegistry(s.registry ?? {}, panes(), MOD_EDITOR);
    registry[this.key] = { pane, tab: me.tab, lastFocus: Date.now() };
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
      const sel = (this.code as { selected_range?: () => { start: number; end: number } } | null)?.selected_range?.();
      this.forceHighlight = true;
      this.setDoc(d);
      if (sel) (this.code as { set_selected_range?: (r: { start: number; end: number }) => void } | null)?.set_selected_range?.(sel);
    }
    else if (a === "reload") {
      const disk = await this.deps.files.read(d.path, d.machine).catch(() => null);
      if (disk !== null) { this.setDoc(reloadFrom(d, disk)); await this.dropDraft(); }
    } else if (a === "restore" && this.draftOffer) {
      this.code?.set_value(this.draftOffer.text);
      this.doc = edit(d, this.draftOffer.text);
      this.draftOffer = null;
    } else if (a === "discardDraft" && this.draftOffer) {
      const o = this.draftOffer;
      this.draftOffer = null;
      await this.deps.store.remove(draftBase(o.machine, o.path, o.ownerKey)).catch((e) => { this.draftError = String(e); });
    }
    cx.notify();
  }

  // ---------- rendering ----------

  private onKey(e: KeyEvent, cx: Context) {
    const saveKey = window()?.platform === "macos" ? "cmd-s" : "ctrl-s";
    if (e.keystroke !== saveKey || this.role !== "editor") return;
    cx.stop_propagation();
    cx.spawn(async (cx) => { await this.save(cx); cx.notify(); });
  }

  override render(_cx: Context): Element {
    const t = palette();
    if (this.role === "dialog") return this.renderDialog(t);
    const root = v_flex().id("editor").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .track_focus(this.handle!)
      .on_key_down((e: KeyEvent, cx: Context) => this.onKey(e, cx))
      .on_mouse_down("left", () => { if (!this.code) this.handle?.focus(); });
    if (this.screen.kind !== "ready" || !this.doc || !this.code) {
      const text = this.screen.kind === "message" ? this.screen.text : "Loading…";
      return root.child(div().p(16).text_color(t.dim).child(text));
    }
    const model = editorModel({
      doc: this.doc, readonly: this.readonlyReason, lossy: this.lossy, draftError: this.draftError, highlightOff: this.highlightOff,
      draftOffer: this.draftOffer && { savedAt: new Date(this.draftOffer.savedAt).toLocaleTimeString(), conflict: this.draftOffer.baselineHash !== fnv1a32(this.doc.baseline) },
    });
    const header = h_flex().h(34).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().w(10).text_color(t.accent).child(model.dirty ? "●" : ""))
      .child(div().font_semibold().child(model.title))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(11).text_color(t.dim).child(this.doc.path))
      .child(div().text_size(11).text_color(t.dim).child(this.doc.status === "saving" ? "Saving…" : ""));
    const banners = model.banners.map((b, i) =>
      h_flex().id(`banner-${i}`).flex_none().px(12).py(6).gap(8).items_center().border_b(1).border_color(t.border)
        .bg(b.kind === "error" ? t.blocked : b.kind === "warn" ? t.raised : t.surface)
        .child(div().flex_1().min_w(0).child(b.text))
        .children(b.actions.map((a) => this.button(`act-${i}-${a}`, ACTION_LABEL[a], t, (cx) => { cx.spawn(async (cx) => { await this.act(a, cx); }); }))));
    return root.child(header).children(banners).child(Editor.new(this.code).flex_1().min_h(0));
  }

  private button(id: string, label: string, t: Palette, onClick: (cx: Context) => void) {
    return h_flex().id(id).h(26).px(10).items_center().rounded(6).border_1().border_color(t.input)
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => onClick(cx)).child(label);
  }

  private renderDialog(t: Palette): Element {
    const d = this.dialogProps!;
    const choose = (c: Choice) => (_cx: Context) => { this.choice = c; closeOverlay(String((props() as { overlay?: string }).overlay)); };
    return v_flex().id("editor-dialog").size_full().p(18).gap(12).bg(t.popover).text_color(t.foreground).text_size(13)
      .track_focus(this.handle!)
      .child(div().font_semibold().child("Save changes before opening another file?"))
      .child(div().text_color(t.muted).truncate().child(d.file))
      .child(h_flex().gap(8).justify_end()
        .child(this.button("dlg-cancel", "Cancel", t, choose("cancel")))
        .child(this.button("dlg-discard", "Don't save", t, choose("discard")))
        .child(this.button("dlg-save", "Save", t, choose("save"))));
  }
}

const ACTION_LABEL: Record<Action, string> = {
  reload: "Reload", keep: "Keep mine", retry: "Retry", restore: "Restore draft", discardDraft: "Discard draft",
  highlightOn: "Highlight anyway (slower typing)",
};
