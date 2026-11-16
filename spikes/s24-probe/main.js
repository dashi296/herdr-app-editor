// S2 + S4 spike: runs once when opened as an overlay (`herdr-app do mod.open '{"name":"s24-probe"}'`),
// writes results to data/s24-probe/result.json, then closes itself. Touches only ~/herdr-spike-s24
// and /tmp/herdr-spike-s24-outside.
import { View, div } from "gpui-kit";
import { EditorState } from "gpui-base";
import { props, home, appHome, readTextFile, writeTextFile, closeOverlay, theme } from "herdr";
import * as fs from "fs/promises";

const esc = (s) => (s == null ? s : JSON.stringify(s));

export default class S24 extends View {
  init(_props, cx) {
    this.status = "running";
    this.results = { s2: [], s4: [] };
    // Only run when opened as an overlay by the spike script (not during `herdr-app check`).
    if (!props()?.overlay) { this.status = "idle (no overlay)"; return; }
    cx.spawn(async (cx) => {
      try { await this.run(); this.status = "done"; }
      catch (e) { this.results.fatal = String(e); this.status = "fatal"; }
      await this.save();
      cx.notify();
      await cx.sleep(300);
      closeOverlay(props().overlay);
    });
  }

  s2(label, value) {
    const st = EditorState.new({ language: "txt", value });
    const out = st.value();
    st.set_value(value);
    const out2 = st.value();
    st.release();
    this.results.s2.push({ label, in: esc(value), out: esc(out), same: out === value, setValueSame: out2 === value });
  }

  async attempt(label, fn) {
    try { const r = await fn(); this.results.s4.push({ label, ok: true, result: r ?? null }); }
    catch (e) { this.results.s4.push({ label, ok: false, error: String(e) }); }
  }

  async run() {
    const B = `${home()}/herdr-spike-s24`;
    // S2: EditorState round trips
    this.s2("crlf", "a\r\nb\r\n");
    this.s2("bom", "﻿bom\n");
    this.s2("no-trailing-newline", "no-trailing");
    this.s2("tabs", "\tx\t\n");
    this.s2("mixed", "a\r\nb\nc\rd");
    this.s2("lone-cr", "a\rb");
    this.s2("empty", "");
    // S2: what readTextFile returns for fixtures
    await this.attempt("read crlf.txt", async () => esc(await readTextFile(`${B}/crlf.txt`)));
    await this.attempt("read bom.txt", async () => esc(await readTextFile(`${B}/bom.txt`)));
    await this.attempt("read notrail.txt", async () => esc(await readTextFile(`${B}/notrail.txt`)));
    await this.attempt("read binary.bin (invalid UTF-8)", async () => esc(await readTextFile(`${B}/binary.bin`)));
    await this.attempt("read missing file", async () => esc(await readTextFile(`${B}/deleted.txt`)));
    // S4: writes
    await this.attempt("write normal (expected matches)", () => writeTextFile(`${B}/normal.txt`, "normal-2\n", "normal\n"));
    await this.attempt("write crlf round trip", () => writeTextFile(`${B}/crlf.txt`, "a\r\nb\r\nc\r\n", "a\r\nb\r\n"));
    await this.attempt("write stale (expected mismatch)", () => writeTextFile(`${B}/stale.txt`, "x\n", "not-the-content\n"));
    await this.attempt("write readonly file 444", () => writeTextFile(`${B}/readonly.txt`, "ro-2\n", "ro\n"));
    await this.attempt("write file in readonly dir 555", () => writeTextFile(`${B}/rodir/file.txt`, "changed\n", "in-ro-dir\n"));
    await this.attempt("write deleted file with expected", () => writeTextFile(`${B}/deleted.txt`, "x\n", "gone\n"));
    await this.attempt("write existing with expected=null", () => writeTextFile(`${B}/target.txt`, "x\n", null));
    await this.attempt("write new file with expected=null", () => writeTextFile(`${B}/created.txt`, "new\n", null));
    await this.attempt("write via symlink", () => writeTextFile(`${B}/link.txt`, "target-2\n", "target\n"));
    await this.attempt("write hard link", () => writeTextFile(`${B}/hard.txt`, "hard-2\n", "hard\n"));
    await this.attempt("write > 1 MiB", () => writeTextFile(`${B}/big.txt`, "y".repeat(1024 * 1024 + 1), "big\n"));
    await this.attempt("write exactly 1 MiB", () => writeTextFile(`${B}/big.txt`, "z".repeat(1024 * 1024), "big\n"));
    await this.attempt("write outside home (/tmp)", () => writeTextFile(`/tmp/herdr-spike-s24-outside/out.txt`, "y\n", "x\n"));
  }

  async save() {
    const dir = `${appHome()}/data/s24-probe`;
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(`${dir}/result.json`, JSON.stringify(this.results, null, 1));
    } catch (e) { this.status += ` (save failed: ${e})`; }
  }

  render(_cx) {
    const t = theme();
    return div().id("s24").size_full().bg(t.popover).text_color(t.foreground).p(12).child(`s24-probe: ${this.status}`);
  }
}
