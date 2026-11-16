// mods/editor-uninstall: closes every editor pane and clears shared state, then reports to
// scripts/uninstall.ts through a result record (plan §4 Step 5). It acts only when the script left
// a request, so opening it by hand does nothing.
import { View, div, type AsyncContext, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, panes, props, run, setShared, spaces, theme } from "herdr";
import { LAYOUT_NAME, MOD_EDITOR, MOD_FILES, MOD_UNINSTALL, SHARED_KEY } from "../core/names";
import { planClose, type CloseStep } from "../core/uninstall/plan";
import { REQUEST_FILE, RESULT_BASE, type UninstallResult } from "../core/uninstall/protocol";
import type { SlotIO, SlotStore } from "../ports/slot-store";

export interface UninstallDeps {
  io: SlotIO;
  store: SlotStore;
}

type Phase =
  | { kind: "idle"; text: string }
  | { kind: "manual" }
  | { kind: "confirm"; steps: CloseStep[] }
  | { kind: "running" }
  | { kind: "done"; text: string };

/** What a person who installed by copying folders (herdr.dev) does after closing the panes. */
const MANUAL_NEXT = `Next: switch back to your layout (ctrl-shift-l), then delete mods/${MOD_EDITOR}, mods/${MOD_FILES}, mods/${MOD_UNINSTALL} and layouts/${LAYOUT_NAME}.json in the Herdr app home. Unsaved drafts stay in data/${MOD_EDITOR}/drafts.`;

const editorPanes = () =>
  panes()
    .filter((p) => p.mod === MOD_EDITOR)
    .map((p) => p.pane);

export abstract class UninstallView extends View {
  protected abstract makeDeps(): UninstallDeps;
  private phase: Phase = { kind: "idle", text: "Run scripts/uninstall.ts to remove the editor mods." };
  private nonce = "";
  /** Opened by hand (no request from scripts/uninstall.ts): no result record, keep the overlay open. */
  private manual = false;
  private deps!: UninstallDeps;

  override init(_props: unknown, cx: AsyncContext): void {
    if (!(props() as { overlay?: string } | null)?.overlay) return; // `herdr-app check`
    this.deps = this.makeDeps();
    cx.spawn(async (cx) => {
      // Wait for a request: the script may find this copy already open (mod.open would only close it).
      // Opened by hand, it offers to close the editor panes itself (installs copied from herdr.dev).
      let request: { nonce?: string } | null = null;
      for (;;) {
        try {
          request = JSON.parse((await this.deps.io.read(REQUEST_FILE)) ?? "null");
        } catch {
          request = null;
        }
        // A script request is honoured unless the person already started the manual removal here.
        if (request?.nonce && !this.manual) break;
        if (this.phase.kind === "idle") {
          this.phase = { kind: "manual" };
          cx.notify();
        }
        await cx.sleep(1000);
      }
      this.nonce = request.nonce!;
      const steps = planClose(panes(), spaces(), MOD_EDITOR);
      if (steps.some((s) => s.kind === "space")) {
        this.phase = { kind: "confirm", steps };
        cx.notify();
        return;
      }
      await this.execute(steps, cx);
    });
  }

  private async execute(steps: CloseStep[], cx: AsyncContext | Context) {
    this.phase = { kind: "running" };
    cx.notify();
    for (const s of steps) {
      if (s.kind === "pane") run("pane.close", { pane: s.pane });
      else if (s.kind === "tab") run("tab.close", { id: s.tab });
      else if (s.kind === "space") run("space.close", { id: s.space, confirmed: true });
    }
    for (let i = 0; i < 30 && editorPanes().length > steps.filter((s) => s.kind === "unreachable").length; i++)
      await cx.sleep(100);
    await cx.sleep(1000); // closed editors flush their drafts in close() (at most 250 ms)
    const remaining = editorPanes();
    setShared(SHARED_KEY, null); // no API removes the key; null means "no state"
    if (this.manual) {
      this.phase = {
        kind: "done",
        text: remaining.length
          ? `${remaining.length} editor pane(s) could not be closed (on a machine that is not connected?). Close them first.`
          : `All editor panes are closed. ${MANUAL_NEXT}`,
      };
      cx.notify();
      return;
    }
    await this.finish(remaining.length ? "incomplete" : "complete", steps, remaining, cx);
  }

  private startManual(cx: Context) {
    this.manual = true;
    const steps = planClose(panes(), spaces(), MOD_EDITOR);
    if (steps.some((s) => s.kind === "space")) {
      this.phase = { kind: "confirm", steps };
      cx.notify();
      return;
    }
    cx.spawn(async (cx) => this.execute(steps, cx));
  }

  private async finish(
    status: UninstallResult["status"],
    closed: CloseStep[],
    remaining: string[],
    cx: AsyncContext | Context,
  ) {
    const result: UninstallResult = { nonce: this.nonce, status, closed, remaining, finishedAt: Date.now() };
    try {
      await this.deps.store.save(RESULT_BASE, result);
      await this.deps.io.unlink(REQUEST_FILE);
      this.phase = {
        kind: "done",
        text: status === "complete" ? "Done. The script removes the files next." : `Stopped (${status}).`,
      };
    } catch (e) {
      this.phase = { kind: "done", text: `Could not write the result: ${String(e)}` };
    }
    cx.notify();
    await cx.sleep(800);
    closeOverlay(String((props() as { overlay?: string }).overlay));
  }

  override render(_cx: Context): Element {
    const t = theme() as Record<string, `#${string}`>;
    const root = v_flex()
      .id("uninstall")
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover!)
      .text_color(t.foreground!)
      .text_size(13);
    const p = this.phase;
    const btn = (id: string, label: string, fn: (cx: Context) => void) =>
      h_flex()
        .id(id)
        .h(28)
        .px(12)
        .items_center()
        .rounded(6)
        .border_1()
        .border_color(t.border!)
        .cursor_pointer()
        .on_click((_e, cx) => fn(cx))
        .child(label);
    const closeSelf = () => closeOverlay(String((props() as { overlay?: string }).overlay));
    if (p.kind === "manual") {
      const n = editorPanes().length;
      return root
        .child(div().font_semibold().child("Remove the editor"))
        .child(
          div().child(
            `${n} editor pane(s) are open. Close them before deleting the mod folders, or Herdr shows them as broken panes. Unsaved edits stay as drafts.`,
          ),
        )
        .child(
          h_flex()
            .gap(8)
            .justify_end()
            .child(btn("close", "Not now", () => closeSelf()))
            .child(btn("manual-ok", "Close all editor panes", (cx) => this.startManual(cx))),
        );
    }
    if (p.kind === "confirm") {
      const names = p.steps
        .filter((s) => s.kind === "space")
        .map((s) => spaces().find((x) => x.id === (s as { space: string }).space)?.name ?? "?");
      return root
        .child(div().font_semibold().child("Remove the editor"))
        .child(div().child(`These spaces only contain editor panes and will be closed: ${names.join(", ")}`))
        .child(
          h_flex()
            .gap(8)
            .justify_end()
            .child(
              btn("cancel", "Cancel uninstall", (cx) => {
                if (this.manual) {
                  this.phase = { kind: "manual" };
                  this.manual = false;
                  cx.notify();
                  return;
                }
                cx.spawn(async (cx) => this.finish("cancelled", [], editorPanes(), cx));
              }),
            )
            .child(
              btn("ok", "Close them and continue", (cx) => {
                cx.spawn(async (cx) => this.execute(p.steps, cx));
              }),
            ),
        );
    }
    if (p.kind === "done" && this.manual) {
      return root
        .child(div().font_semibold().child("Remove the editor"))
        .child(div().child(p.text))
        .child(
          h_flex()
            .justify_end()
            .child(btn("done", "Close", () => closeSelf())),
        );
    }
    const text = p.kind === "running" ? "Closing editor panes…" : p.text;
    return root.child(div().font_semibold().child("Remove the editor")).child(div().child(text));
  }
}
