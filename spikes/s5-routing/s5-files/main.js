// S5 spike: sender/driver. `herdr-app do s5-files.run` runs the automated scenarios and
// writes results to data/s5-spike/files.json.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { focused, panes, run, nextCommand, shared, appHome, theme } from "herdr";
import * as fs from "fs/promises";

const ACK_WAIT_MS = 1000;

export default class S5Files extends View {
  init(_props, cx) {
    this.log = [];
    this.acks = new Map();
    this.n = 0;
    const f = focused();
    this.pane = f?.pane ?? null;
    this.record("init", { ownPane: this.pane });
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        const at = Date.now();
        if (c.startsWith("ack:")) {
          const msg = JSON.parse(c.slice(4));
          this.acks.set(msg.req, { at, ...msg });
          this.record("ack", { req: msg.req, editorAge: msg.age });
        } else if (c === "run") {
          cx.spawn(async cx => { await this.scenarios(cx); cx.notify(); });
        } else this.record("other", { c });
        cx.notify();
      }
    });
  }

  editors() {
    const live = new Set(panes().filter(p => p.mod === "s5-editor").map(p => p.pane));
    return Object.entries(shared("s5.registry") ?? {}).filter(([, e]) => live.has(e.pane));
  }

  // Sends focus then open in the same callback, waits for an ack.
  async openVia(cx, key, pane, label, { focus = true, payloadExtra = "" } = {}) {
    const req = `r${++this.n}-${Date.now()}`;
    const sentAt = Date.now();
    if (focus) run("pane.focus", { pane });
    run("s5-editor.open:" + JSON.stringify({ to: key, req, file: `src/example${payloadExtra}.ts`, sentAt }));
    await cx.sleep(ACK_WAIT_MS);
    const ack = this.acks.get(req);
    this.record("result", { label, req, acked: Boolean(ack), latency: ack ? ack.at - sentAt : null });
    return Boolean(ack);
  }

  async scenarios(cx) {
    this.record("run-start", { ownPane: this.pane, editors: this.editors() });
    if (this.editors().length === 0) {
      run("pane.split", { pane: this.pane, direction: "right", mod: "s5-editor", props: { key: "k1", file: "src/a.ts" } });
      await cx.sleep(1500);
      this.record("after-split", { editors: this.editors(), panes: panes().filter(p => p.tab === panes().find(q => q.pane === this.pane)?.tab).map(p => ({ pane: p.pane, mod: p.mod, focused: p.focused, zoomed: p.zoomed })) });
    }
    const [key, entry] = this.editors()[0] ?? [];
    if (!key) { this.record("abort", { reason: "no editor registered" }); return; }
    // 1. plain focus+open
    await this.openVia(cx, key, entry.pane, "focus+open");
    // 2. payload containing '.' and ':' characters and a long body
    await this.openVia(cx, key, entry.pane, "payload-special", { payloadExtra: ".a:b." + "x".repeat(20000) });
    // 3. wrong recipient: every shown copy receives it, only "to" should act
    const req = `r${++this.n}-wrong`;
    run("s5-editor.open:" + JSON.stringify({ to: "nobody", req, file: "x", sentAt: Date.now() }));
    await cx.sleep(300);
    // 4. zoom files pane (editor hidden), then focus+open the editor
    run("pane.zoom", { pane: this.pane });
    await cx.sleep(500);
    this.record("zoomed", { panes: panes().filter(p => p.pane === this.pane || p.pane === entry.pane).map(p => ({ pane: p.pane, zoomed: p.zoomed })) });
    await this.openVia(cx, key, entry.pane, "zoomed-behind:focus+open");
    this.record("after-zoom-open", { panes: panes().filter(p => p.pane === this.pane || p.pane === entry.pane).map(p => ({ pane: p.pane, zoomed: p.zoomed, focused: p.focused })) });
    // 5. stale request (sentAt in the past) must be ignored and not acked
    const stale = `r${++this.n}-stale`;
    run("s5-editor.open:" + JSON.stringify({ to: key, req: stale, file: "x", sentAt: Date.now() - 5000 }));
    await cx.sleep(ACK_WAIT_MS);
    this.record("result", { label: "stale", req: stale, acked: this.acks.has(stale) });
    // restore: un-zoom
    if (panes().some(p => p.zoomed)) run("pane.zoom", { pane: entry.pane });
    this.record("run-end", {});
  }

  record(event, data) {
    this.log.push({ t: Date.now(), event, ...data });
    const dir = `${appHome()}/data/s5-spike`;
    const body = JSON.stringify(this.log, null, 1);
    try {
      fs.mkdir(dir, { recursive: true }).then(() => fs.writeFile(`${dir}/files.json`, body)).catch(e => { this.writeError = String(e); });
    } catch (e) { this.writeError = String(e); }
  }

  render(_cx) {
    const t = theme();
    return v_flex().id("s5-files").size_full().bg(t.background).text_color(t.foreground).p(10).gap(4).text_size(12)
      .child(div().font_semibold().child(`s5-files pane=${this.pane}`))
      .children(this.log.slice(-14).map((e, n) => div().id(`l${n}`).text_color(t.muted).child(JSON.stringify(e).slice(0, 200))));
  }
}
