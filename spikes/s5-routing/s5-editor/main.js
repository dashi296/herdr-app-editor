// S5 spike: receiver. Learns its own pane id, accepts fresh "open" requests addressed to it,
// acks back to s5-files, and logs everything to data/s5-spike/editor-<key>.json.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, focused, panes, run, nextCommand, shared, setShared, appHome, theme } from "herdr";
import * as fs from "fs/promises";

const MAX_AGE_MS = 300;

export default class S5Editor extends View {
  init(_props, cx) {
    this.key = props()?.key ?? "none";
    this.log = [];
    this.handle = cx.focus_handle();
    this.file = props()?.file ?? null;
    this.seen = new Set();
    const f = focused();
    const mine = f?.pane ? panes().find(p => p.pane === f.pane && p.mod === "s5-editor") : null;
    this.pane = mine?.pane ?? null;
    this.record("init", { focusedPane: f?.pane ?? null, ownPane: this.pane });
    this.register();
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        // No await inside the loop body: hand work to its own task.
        this.onCommand(c, Date.now());
        cx.notify();
      }
    });
  }

  register() {
    if (!this.pane) return;
    const reg = { ...(shared("s5.registry") ?? {}) };
    reg[this.key] = { pane: this.pane, lastFocus: Date.now() };
    setShared("s5.registry", reg);
  }

  onCommand(c, receivedAt) {
    if (c === "focus") {
      const f = focused();
      if (f?.pane && panes().some(p => p.pane === f.pane && p.mod === "s5-editor")) this.pane = this.pane ?? f.pane;
      this.record("focus", { focusedPane: f?.pane ?? null, ownPane: this.pane });
      this.register();
      return;
    }
    const i = c.indexOf(":");
    const verb = i < 0 ? c : c.slice(0, i);
    if (verb !== "open") { this.record("other", { c }); return; }
    let msg;
    try { msg = JSON.parse(c.slice(i + 1)); } catch (e) { this.record("bad-json", { c, error: String(e) }); return; }
    const age = receivedAt - msg.sentAt;
    if (msg.to !== this.key) { this.record("not-mine", { req: msg.req, to: msg.to, age }); return; }
    if (age > MAX_AGE_MS) { this.record("expired", { req: msg.req, age }); return; }
    if (this.seen.has(msg.req)) { this.record("duplicate", { req: msg.req }); return; }
    this.seen.add(msg.req);
    this.file = msg.file;
    this.record("accept", { req: msg.req, age, payloadBytes: c.length });
    run("s5-files.ack:" + JSON.stringify({ req: msg.req, key: this.key, age }));
  }

  record(event, data) {
    this.log.push({ t: Date.now(), event, ...data });
    const dir = `${appHome()}/data/s5-spike`;
    const body = JSON.stringify(this.log, null, 1);
    try {
      fs.mkdir(dir, { recursive: true }).then(() => fs.writeFile(`${dir}/editor-${this.key}.json`, body)).catch(e => { this.writeError = String(e); });
    } catch (e) { this.writeError = String(e); }
  }

  render(_cx) {
    const t = theme();
    return v_flex().id("s5-editor").size_full().track_focus(this.handle).bg(t.background).text_color(t.foreground).p(10).gap(4).text_size(12)
      .child(div().font_semibold().child(`s5-editor key=${this.key} pane=${this.pane}`))
      .child(div().child(`file: ${this.file ?? "-"}`))
      .children(this.log.slice(-12).map((e, n) => div().id(`l${n}`).text_color(t.muted).child(JSON.stringify(e))));
  }
}
