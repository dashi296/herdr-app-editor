// Text search: a popup that searches the files of the focused folder for a literal string and opens
// the chosen hit at its line in an editor pane. The folder and target tab are taken when the popup
// opens, as in quick open (open-view.ts). `exec` cannot be cancelled, so at most one search runs:
// a query typed meanwhile waits for it, and only the newest one is run.
import { View, div, type AsyncContext, type Context, type Element, type KeyEvent } from "gpui-kit";
import { Input, InputState, h_flex, v_flex } from "gpui-base";
import { checking, closeOverlay, exec, focused, panes, props, window } from "herdr";
import { MOD_EDITOR, MOD_SEARCH } from "../core/names";
import {
  DEBOUNCE_MS,
  HIT_LIMIT,
  MIN_QUERY,
  gitGrepArgs,
  grepArgs,
  parseGitGrep,
  parseGrep,
  cut,
  type Hit,
  type Hits,
} from "../core/search/search";
import { activeTab, currentLocation, type Location } from "./location";
import { editorIn, id, sendTo } from "./opener";
import { palette } from "./palette";
import { splitEditor } from "./split";

/** A search that takes longer is given up (a terminal sitting in a huge folder such as ~). */
export const SEARCH_TIMEOUT_MS = 10_000;

type State =
  | { kind: "hint"; text: string }
  | { kind: "searching" }
  | { kind: "message"; text: string }
  | { kind: "ready"; hits: Hit[]; truncated: boolean; early: boolean };

const HINT = `Type at least ${MIN_QUERY} characters.`;

export class SearchView extends View {
  private handle: ReturnType<AsyncContext["focus_handle"]> | null = null;
  private input: ReturnType<typeof InputState.new> | null = null;
  private state: State = { kind: "hint", text: HINT };
  private at = 0;
  private done = false;
  private loc: Location | null = null;
  private tab: string | null = null;
  private base: string | null = null;
  private cx: AsyncContext | null = null;
  private overlay = "";
  private notice: string | null = null;
  /** Whether the folder is in a Git work tree (null until known). */
  private git: Promise<boolean> | null = null;
  /** The query the person last typed. */
  private wanted = "";
  /** The text whose delay passed while another search was running: that search runs it when it ends. */
  private due: string | null = null;
  private running = false;

  override init(_props: unknown, cx: AsyncContext): void {
    this.handle = cx.focus_handle();
    this.cx = cx;
    this.overlay = String((props() as { overlay?: string } | null)?.overlay);
    this.input = InputState.new({ placeholder: "Search in files…" });
    if (checking()) return;
    this.input.on("change", (_e: unknown, cx: Context) => {
      this.queryChanged(cx);
      cx.notify();
    });
    this.input.on("submit", (e: { secondary?: boolean } | null) => this.choose(this.at, Boolean(e?.secondary)));
    this.input.focus();
    this.loc = currentLocation();
    this.tab = activeTab();
    const f = focused()?.pane;
    const inTab = panes().filter((p) => p.tab === this.tab);
    this.base = (inTab.find((p) => p.pane === f) ?? inTab[0])?.pane ?? null;
    const { cwd, on } = this.loc;
    if (!cwd || !this.tab) {
      this.state = { kind: "message", text: "No folder to search here." };
      return;
    }
    this.git = exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd, on, timeout: SEARCH_TIMEOUT_MS }).then(
      (r) => r.code === 0,
      () => false,
    );
  }

  private queryChanged(cx: Context) {
    if (!this.git) return;
    const q = this.input?.value() ?? "";
    this.wanted = q;
    this.due = null; // every new text waits its own delay
    if (q.length < MIN_QUERY) {
      this.state = { kind: "hint", text: HINT };
      this.at = 0;
      return;
    }
    // Hits of the previous text must not be picked while this one waits (spec §4).
    this.state = { kind: "searching" };
    this.at = 0;
    cx.spawn(async (cx: AsyncContext) => {
      await cx.sleep(DEBOUNCE_MS);
      if (this.wanted !== q) return;
      if (this.running) this.due = q;
      else await this.search(cx);
    });
  }

  /** Runs the newest text. Only one search runs at a time (exec cannot be cancelled). */
  private async search(cx: AsyncContext) {
    if (this.running || !this.loc?.cwd || !this.git) return;
    this.running = true;
    this.due = null;
    const q = this.wanted;
    this.state = { kind: "searching" };
    cx.notify();
    const { cwd, on } = this.loc;
    let next: State;
    try {
      const git = await this.git;
      const r = git
        ? await exec("git", gitGrepArgs(q), { cwd, on, timeout: SEARCH_TIMEOUT_MS })
        : await exec("grep", grepArgs(q), { cwd, on, timeout: SEARCH_TIMEOUT_MS });
      const parse = (out: string): Hits => (git ? parseGitGrep(out, q) : parseGrep(out, q));
      if (r.code === 0) next = { kind: "ready", ...parse(r.stdout), early: cut(r.stdout) };
      else if (r.stdout !== "") next = { kind: "ready", ...parse(r.stdout), early: true };
      else if (r.code === 1) next = { kind: "message", text: "No matches." };
      else next = { kind: "message", text: `Cannot search this folder: ${r.stderr.trim() || `exit ${r.code}`}` };
    } catch (e) {
      next = { kind: "message", text: `Cannot search this folder: ${String(e)}` };
    }
    this.running = false;
    if (this.wanted === q) {
      if (next.kind === "ready" && next.hits.length === 0 && !next.early)
        next = { kind: "message", text: "No matches." };
      this.state = next;
      this.at = 0;
      cx.notify();
    } else if (this.due === this.wanted) await this.search(cx); // else its own delay is still running
  }

  private hits(): Hit[] {
    return this.state.kind === "ready" ? this.state.hits : [];
  }

  private dismiss() {
    closeOverlay(this.overlay);
  }

  /** Opens hits[i] once at its line and closes the popup. */
  private choose(i: number, newPane: boolean) {
    const hit = this.hits()[i];
    const cx = this.cx;
    if (this.done || !hit || !this.loc?.cwd || !this.tab || !cx) return;
    this.done = true;
    const file = `${this.loc.cwd}/${hit.path}`,
      on = this.loc.on;
    const at = { line: hit.line, col: hit.col, len: hit.len };
    const target = newPane ? null : editorIn(this.tab);
    if (target) {
      sendTo(target, file, on, at);
      this.dismiss();
      return;
    }
    const base = this.base;
    if (!base) {
      this.dismiss();
      return;
    }
    const before = panes()
      .filter((p) => p.mod === MOD_EDITOR)
      .map((p) => p.pane);
    const props = { key: id("e"), file, on, tab: this.tab, before, at };
    cx.spawn(async (cx) => {
      const problem = await splitEditor({ pane: base, direction: "right", mod: MOD_EDITOR, props }, MOD_SEARCH);
      if (problem) {
        this.done = false; // the person can fix it and press Enter again
        this.notice = problem;
        cx.notify();
        return;
      }
      this.dismiss();
    });
  }

  onKey(e: KeyEvent, cx: Context) {
    const k = e.key;
    const mod = window()?.platform === "macos" ? e.modifiers?.platform : e.modifiers?.control;
    const n = this.hits().length;
    if (k === "escape") this.dismiss();
    else if (k === "down") this.at = Math.min(this.at + 1, Math.max(0, n - 1));
    else if (k === "up") this.at = Math.max(0, this.at - 1);
    else if (k === "enter") this.choose(this.at, Boolean(mod));
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  override render(_cx: Context): Element {
    const t = palette();
    const s = this.state;
    const note = (text: string) => div().p(8).text_color(t.dim).child(text);
    const body =
      s.kind === "hint" || s.kind === "message"
        ? [note(s.text)]
        : s.kind === "searching"
          ? [note("Searching…")]
          : s.hits.map((hit, i) =>
              h_flex()
                .id(`search-row-${i}`)
                .h(28)
                .flex_none()
                .px(8)
                .gap(8)
                .items_center()
                .rounded(7)
                .cursor_pointer()
                .when(i === this.at, (el: Element) => el.bg(t.hover))
                .hover((st: Element) => st.bg(t.hover))
                .on_click((ev: { modifiers?: KeyEvent["modifiers"] }) =>
                  this.choose(
                    i,
                    Boolean(window()?.platform === "macos" ? ev?.modifiers?.platform : ev?.modifiers?.control),
                  ),
                )
                .child(div().flex_none().max_w(260).truncate().text_color(t.dim).child(`${hit.path}:${hit.line}`))
                .child(div().flex_1().min_w(0).truncate().child(hit.text)),
            );
    const notes: string[] = [];
    if (s.kind === "ready" && s.truncated) notes.push(`Showing the first ${HIT_LIMIT} matches`);
    if (s.kind === "ready" && s.early) notes.push("Stopped early: showing what was found");
    return v_flex()
      .id("text-search")
      .track_focus(this.handle!)
      .on_key_down((e: KeyEvent, cx: Context) => this.onKey(e, cx))
      .size_full()
      .min_h(0)
      .p(14)
      .gap(8)
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(13)
      .child(
        h_flex()
          .h(36)
          .flex_none()
          .px(10)
          .items_center()
          .rounded(9)
          .border_1()
          .border_color(t.accent)
          .bg(t.background)
          .child(Input.new(this.input!).flex_1().h_full()),
      )
      .children(notes.map((n) => div().text_size(11).text_color(t.dim).child(n)))
      .children(this.notice ? [div().text_size(12).text_color(t.blocked).child(this.notice)] : [])
      .child(v_flex().id("search-list").flex_1().min_h(0).overflow_y_scroll().children(body));
  }
}
