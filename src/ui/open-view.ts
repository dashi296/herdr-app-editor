// Quick open (#29): a popup that lists the files of the focused folder, filters them as the person
// types and opens the chosen one in an editor pane. The target tab and folder are taken when the
// overlay opens; while it is shown, focused() still reports the pane underneath (spike S9).
// The overlay never creates a pane itself: Herdr ties a pane created while an overlay is open to that
// overlay, and releases its file reads and editor state when the overlay closes (device tests S10,
// S11). A file for an existing editor goes as a command; a new editor pane is split by a detached
// `herdr-app do pane.split` that runs after the overlay has closed.
import { View, div, type AsyncContext, type Context, type Element, type KeyEvent } from "gpui-kit";
import { Input, InputState, h_flex, v_flex } from "gpui-base";
import { appHome, checking, closeOverlay, exec, focused, panes, props, window } from "herdr";
import { MOD_EDITOR, MOD_OPEN } from "../core/names";
import { LIST_LIMIT, SHOW_LIMIT, parseFind, parseNul, rankPaths } from "../core/quick-open/match";
import { activeTab, currentLocation, type Location } from "./location";
import { editorIn, id, sendTo } from "./opener";
import { palette } from "./palette";

const GIT_ARGS = ["ls-files", "-co", "--exclude-standard", "-z"];
// Outside Git: every file to 12 levels down, without .git and node_modules, NUL-separated.
const FIND_ARGS = [
  ".",
  "-maxdepth",
  "12",
  "(",
  "-name",
  ".git",
  "-o",
  "-name",
  "node_modules",
  ")",
  "-prune",
  "-o",
  "-type",
  "f",
  "-print0",
];
/** A listing that takes longer is cut off (a terminal sitting in a huge folder such as ~). */
export const LIST_TIMEOUT_MS = 10_000;

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
const NO_CLI = "Cannot open a new editor pane: the herdr-app command was not found (on PATH or in ~/.local/bin).";

type State = { kind: "loading" } | { kind: "message"; text: string } | { kind: "ready" };

export class OpenView extends View {
  private handle: ReturnType<AsyncContext["focus_handle"]> | null = null;
  private input: ReturnType<typeof InputState.new> | null = null;
  private state: State = { kind: "loading" };
  private paths: string[] = [];
  private truncated = false;
  private shown: string[] = [];
  private at = 0;
  private done = false;
  private loc: Location | null = null;
  private tab: string | null = null;
  /** The pane focused when the overlay opened: a new editor pane splits next to it. */
  private base: string | null = null;
  private cx: AsyncContext | null = null;
  /** This overlay's id, read in init(): on the device props() can be empty after an await. */
  private overlay = "";
  /** A problem to show above the list (herdr-app not found). */
  private notice: string | null = null;

  override init(_props: unknown, cx: AsyncContext): void {
    this.handle = cx.focus_handle();
    this.cx = cx;
    this.overlay = String((props() as { overlay?: string } | null)?.overlay);
    this.input = InputState.new({ placeholder: "Open a file…" });
    if (checking()) return;
    this.input.on("change", (_e: unknown, cx: Context) => {
      this.filter();
      cx.notify();
    });
    // Enter in the field; `secondary` is cmd on macOS, ctrl elsewhere: a new pane.
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
    cx.spawn(async (cx) => {
      try {
        const opts = { cwd, on, timeout: LIST_TIMEOUT_MS };
        const git = await exec("git", GIT_ARGS, opts);
        const list =
          git.code === 0
            ? parseNul(git.stdout, LIST_LIMIT)
            : await exec("find", FIND_ARGS, opts).then((r) => {
                // find exits 1 when any folder is unreadable (~/Library on macOS) but lists the rest.
                if (r.stdout === "" && r.code !== 0) throw new Error(r.stderr || `find exited with ${r.code}`);
                return parseFind(r.stdout, LIST_LIMIT);
              });
        this.paths = list.paths;
        this.truncated = list.truncated;
        this.state = { kind: "ready" };
        this.filter();
      } catch (e) {
        this.state = { kind: "message", text: `Cannot list this folder: ${String(e)}` };
      }
      cx.notify();
    });
  }

  private filter() {
    this.shown = rankPaths(this.paths, this.input?.value() ?? "", SHOW_LIMIT);
    this.at = 0;
  }

  private dismiss() {
    closeOverlay(this.overlay);
  }

  /** Opens shown[i] once and closes the overlay. */
  private choose(i: number, newPane: boolean) {
    const path = this.shown[i];
    const cx = this.cx;
    if (this.done || !path || !this.loc?.cwd || !this.tab || !cx) return;
    this.done = true;
    const file = `${this.loc.cwd}/${path}`,
      on = this.loc.on;
    const target = newPane ? null : editorIn(this.tab);
    if (target) {
      sendTo(target, file, on);
      this.dismiss();
      return;
    }
    if (!this.base) {
      this.dismiss();
      return;
    }
    // `before` and `tab` let the new pane find itself among the editor panes (it cannot learn its own
    // pane id, and nobody else is left to register it).
    const before = panes()
      .filter((p) => p.mod === MOD_EDITOR)
      .map((p) => p.pane);
    const props = { key: id("e"), file, on, tab: this.tab, before };
    const args = { pane: this.base, direction: "right", mod: MOD_EDITOR, props };
    cx.spawn(async (cx) => {
      let problem: string | null = null;
      try {
        const r = await exec("sh", ["-c", SPLIT_SCRIPT, "sh", JSON.stringify(args), appHome(), MOD_OPEN]);
        if (r.code === 3) problem = NO_CLI;
      } catch (e) {
        // sh did not start (none on Windows, or a spawn error): no background split exists either.
        problem = `Cannot open a new editor pane: ${String(e)}`;
      }
      if (problem) {
        this.done = false; // the person can fix it and press Enter again
        this.notice = problem; // above the list, which stays on screen: Enter opens what is shown
        cx.notify();
        return;
      }
      this.dismiss();
    });
  }

  onKey(e: KeyEvent, cx: Context) {
    const k = e.key;
    const mod = window()?.platform === "macos" ? e.modifiers?.platform : e.modifiers?.control;
    if (k === "escape") this.dismiss();
    else if (k === "down") this.at = Math.min(this.at + 1, Math.max(0, this.shown.length - 1));
    else if (k === "up") this.at = Math.max(0, this.at - 1);
    else if (k === "enter") this.choose(this.at, Boolean(mod));
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  override render(_cx: Context): Element {
    const t = palette();
    const body =
      this.state.kind === "loading"
        ? [div().p(8).text_color(t.dim).child("Loading…")]
        : this.state.kind === "message"
          ? [div().p(8).text_color(t.dim).child(this.state.text)]
          : this.shown.length === 0
            ? [div().p(8).text_color(t.dim).child("No files match.")]
            : this.shown.map((path, i) =>
                h_flex()
                  .id(`open-row-${i}`)
                  .h(28)
                  .flex_none()
                  .px(8)
                  .items_center()
                  .rounded(7)
                  .cursor_pointer()
                  .when(i === this.at, (el: Element) => el.bg(t.hover))
                  .hover((s: Element) => s.bg(t.hover))
                  .on_click((ev: { modifiers?: KeyEvent["modifiers"] }) =>
                    this.choose(
                      i,
                      Boolean(window()?.platform === "macos" ? ev?.modifiers?.platform : ev?.modifiers?.control),
                    ),
                  )
                  .child(div().flex_1().min_w(0).truncate().child(path)),
              );
    return v_flex()
      .id("quick-open")
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
      .children(
        this.truncated ? [div().text_size(11).text_color(t.dim).child(`Showing the first ${LIST_LIMIT} files`)] : [],
      )
      .children(this.notice ? [div().text_size(12).text_color(t.blocked).child(this.notice)] : [])
      .child(v_flex().id("open-list").flex_1().min_h(0).overflow_y_scroll().children(body));
  }
}
