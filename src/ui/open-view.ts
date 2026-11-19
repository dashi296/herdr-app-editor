// Quick open (#29): a popup that lists the files of the focused folder, filters them as the person
// types and opens the chosen one in an editor pane. The target tab and folder are taken when the
// overlay opens; while it is shown, focused() still reports the pane underneath (spike S9).
import { View, div, type AsyncContext, type Context, type Element, type KeyEvent } from "gpui-kit";
import { Input, InputState, h_flex, v_flex } from "gpui-base";
import { checking, closeOverlay, exec, props, window } from "herdr";
import { LIST_LIMIT, SHOW_LIMIT, parseLines, parseNul, rankPaths } from "../core/quick-open/match";
import { activeTab, currentLocation, type Location } from "./location";
import { EditorOpener } from "./opener";
import { palette } from "./palette";

const GIT_ARGS = ["ls-files", "-co", "--exclude-standard", "-z"];
const FIND_ARGS = [".", "-type", "f", "-not", "-path", "*/.git/*", "-not", "-path", "*/node_modules/*"];

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
  private opener = new EditorOpener();
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

  /** Opens shown[i] once, then closes the overlay. */
  private choose(i: number, newPane: boolean) {
    const path = this.shown[i];
    if (this.done || !path || !this.loc?.cwd || !this.tab || !this.cx) return;
    this.done = true;
    this.opener.open({ file: `${this.loc.cwd}/${path}`, on: this.loc.on, tab: this.tab, newPane }, this.cx);
    this.dismiss();
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
