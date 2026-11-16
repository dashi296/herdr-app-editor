// S2b + Esc spike (manual). Opened with `herdr-app do mod.open '{"name":"s2b-esc"}'`.
// S2b: which newline does Enter insert into a CRLF document?
// Esc: does a dialog closed with Esc deliver its reply through close()?
import { View, div } from "gpui-kit";
import { v_flex, h_flex, EditorState, Editor } from "gpui-base";
import { props, run, nextCommand, openOverlay, closeOverlay, appHome, theme } from "herdr";
import * as fs from "fs/promises";

export default class S2bEsc extends View {
  init(_props, cx) {
    this.role = props()?.role ?? "main";
    if (this.role === "dialog") return;
    this.log = [];
    this.q = Promise.resolve();
    if (!props()?.overlay) return; // `herdr-app check`: no side effects
    this.code = EditorState.new({ language: "txt", value: "line1\r\nline2\r\n" });
    this.code.on("change", () => this.record("change", { value: JSON.stringify(this.code.value()) }));
    this.record("open", { value: JSON.stringify(this.code.value()) });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c.startsWith("reply:")) {
          const msg = JSON.parse(c.slice(6));
          this.record("reply", { ...msg, matches: msg.req === this.pending?.req });
          this.pending = null;
        }
        cx.notify();
      }
    });
  }

  async close(_cx) {
    if (this.role !== "dialog") return;
    run("s2b-esc.reply:" + JSON.stringify({ req: props().req, choice: "cancel", via: "close()" }));
  }

  openDialog() {
    const req = `d${Date.now()}`;
    const id = openOverlay({ mod: "s2b-esc", kind: "dialog", modal: true, width: 360, height: 120, props: { role: "dialog", req } });
    this.pending = { req, id };
    this.record("dialog-open", { req, id });
  }

  record(event, data) {
    this.log.push({ t: Date.now(), event, ...data });
    const body = JSON.stringify(this.log, null, 1), dir = `${appHome()}/data/s2b-esc`;
    this.q = this.q.then(async () => {
      try { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(`${dir}/result.json`, body); } catch {}
    });
  }

  render(_cx) {
    const t = theme();
    if (this.role === "dialog")
      return v_flex().id("dlg").size_full().bg(t.popover).text_color(t.foreground).p(14).gap(8)
        .child(div().font_semibold().child("確認用ダイアログ"))
        .child(div().child("Esc キーで閉じてください"));
    const btn = (id, label, fn) => h_flex().id(id).h(28).px(12).items_center().rounded(6).border_1().border_color(t.input)
      .cursor_pointer().hover(s => s.bg(t.hover)).on_click((_e, cx) => { fn(); cx.notify(); }).child(label);
    return v_flex().id("s2b").size_full().bg(t.popover).text_color(t.foreground).p(12).gap(8).text_size(13)
      .child(div().child("1) コード欄の line1 の行末をクリック → Enter → x と入力"))
      .child(this.code ? div().h(110).flex_none().border_1().border_color(t.border).child(Editor.new(this.code).size_full()) : div().child("(check)"))
      .child(h_flex().gap(8)
        .child(btn("open-dialog", "2) ダイアログを開く（開いたら Esc）", () => this.openDialog()))
        .child(btn("done", "3) 閉じる", () => closeOverlay(props().overlay))))
      .child(div().text_size(11).text_color(t.dim).child(`記録: ${this.log?.length ?? 0} 件 / 最後: ${this.log?.at(-1)?.event ?? "-"}`));
  }
}
