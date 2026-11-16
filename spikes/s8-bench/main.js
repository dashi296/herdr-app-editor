// S8 benchmark: per-keystroke cost of EditorState with and without syntax highlighting.
// Opened once as an overlay (`herdr-app do mod.open '{"name":"s8-bench"}'`). Each case renders an
// editor, waits for it to settle, then types one character N times with replace() and records:
//   syncMs  - the replace() call itself (the highlighter update runs inside it)
//   stallMs - from just before replace() until a 0 ms timer fires (includes the next frame)
// Results go to data/s8-bench/result.json; the overlay closes itself.
import { View, div } from "gpui-kit";
import { v_flex, EditorState, Editor } from "gpui-base";
import { props, appHome, closeOverlay, theme, settings } from "herdr";
import * as fs from "fs/promises";

const SIZES = [10_000, 50_000, 100_000, 400_000, 1_000_000];
const LANGS = ["txt", "js"];
const RUNS = 15;
const LINE = (i) => `export function f${i}(a: number, b: string): string { return \`\${a}:\${b}:${i}\`; } // comment ${i}\n`;

function makeText(size) {
  let out = "", i = 0;
  while (out.length + LINE(i).length <= size) out += LINE(i++);
  return out;
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { median: q(0.5), p90: q(0.9), max: s[s.length - 1], min: s[0] };
};

export default class S8Bench extends View {
  init(_props, cx) {
    this.status = "idle";
    this.results = [];
    this.code = null;
    if (!props()?.overlay) return; // herdr-app check
    cx.spawn(async (cx) => {
      for (const size of SIZES) for (const language of LANGS) {
        this.status = `${language} ${size}`;
        const text = makeText(size);
        const createStart = Date.now();
        this.code?.release();
        this.code = EditorState.new({ language, value: text, folding: false, soft_wrap: false, font_family: String(settings().font_family ?? "") });
        const createMs = Date.now() - createStart;
        cx.notify();
        await cx.sleep(800); // let the first layout and highlight settle
        const sync = [], stall = [];
        for (let i = 0; i < RUNS; i++) {
          const at = 40 + i; // inside the first line
          this.code.set_selected_range({ start: at, end: at });
          const t0 = Date.now();
          this.code.replace("x");
          sync.push(Date.now() - t0);
          cx.notify();
          await new Promise((resolve) => cx.timer.after(0, () => resolve()));
          stall.push(Date.now() - t0);
          await cx.sleep(50);
        }
        this.results.push({ language, size: text.length, lines: text.split("\n").length - 1, createMs, syncMs: stats(sync), stallMs: stats(stall), raw: { sync, stall } });
        await this.save();
      }
      this.status = "done";
      this.code?.release();
      this.code = null;
      cx.notify();
      await cx.sleep(300);
      closeOverlay(props().overlay);
    });
  }

  async save() {
    try {
      const dir = `${appHome()}/data/s8-bench`;
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(`${dir}/result.json`, JSON.stringify(this.results, null, 1));
    } catch (e) { this.status += ` (save failed: ${e})`; }
  }

  render(_cx) {
    const t = theme();
    return v_flex().id("s8").size_full().bg(t.popover).text_color(t.foreground).p(10).gap(6)
      .child(div().child(`s8-bench: ${this.status}`))
      .child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div());
  }
}
