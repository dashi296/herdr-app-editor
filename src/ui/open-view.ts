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
import { MOD_EDITOR } from "../core/names";
import { LIST_LIMIT, SHOW_LIMIT, parseLines, parseNul, rankPaths } from "../core/quick-open/match";
import { activeTab, currentLocation, type Location } from "./location";
import { editorIn, id, sendTo } from "./opener";
import { palette } from "./palette";

const GIT_ARGS = ["ls-files", "-co", "--exclude-standard", "-z"];
const FIND_ARGS = [".", "-type", "f", "-not", "-path", "*/.git/*", "-not", "-path", "*/node_modules/*"];

/** Run as `sh -c SPLIT_SCRIPT sh <pane.split args JSON> <app home>`: returns at once and splits the
 *  pane 0.3 s later, after the overlay has closed. */
export const SPLIT_SCRIPT =
  'cli=$(command -v herdr-app || echo "$HOME/.local/bin/herdr-app"); ' +
  '(sleep 0.3; HERDR_APP_HOME="$2" "$cli" do pane.split "$1" >/dev/null 2>&1) >/dev/null 2>&1 &';

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

  override init(_props: unknown, cx: AsyncContext): void {
    this.handle = cx.focus_handle();
    this.cx = cx;
    this.input = InputState.new({ placeholder: "Open a file…" });
    if (checking()) return;
    this.input.on("change", (_e: unknown, cx: Context) => {
      this.filter();
      cx.notify();
    });
    this.input.on("submit", () => this.choose(this.at, false));
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
        const git = await exec("git", GIT_ARGS, { cwd, on });
        const list =
          git.code === 0
            ? parseNul(git.stdout, LIST_LIMIT)
            : await exec("find", FIND_ARGS, { cwd, on }).then((r) => {
                if (r.code !== 0) throw new Error(r.stderr || `find exited with ${r.code}`);
                return parseLines(r.stdout, LIST_LIMIT);
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
    closeOverlay(String((props() as { overlay?: string } | null)?.overlay));
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
    const args = { pane: this.base, direction: "right", mod: MOD_EDITOR, props: { key: id("e"), file, on } };
    cx.spawn(async () => {
      try {
        await exec("sh", ["-c", SPLIT_SCRIPT, "sh", JSON.stringify(args), appHome()]);
      } catch {
        /* nothing more to do from here: the overlay is closing */
      } finally {
        this.dismiss();
      }
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
      .child(v_flex().id("open-list").flex_1().min_h(0).overflow_y_scroll().children(body));
  }
}
