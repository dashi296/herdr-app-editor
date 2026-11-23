// S13 spike (manual): what image() can read, how long it takes, and how to fit a picture in a box.
// Opened with `herdr-app do mod.open '{"name":"s13-image"}'`; a path sent as `herdr-app do s13-image.<path>` is added to the view.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, nextCommand } from "herdr";
const fixed = [
  ["absolute", "/tmp/s13/img/fresh-abs.png"],
  ["dotdot", "../../projects/herdr-app-editor/files/preview.png"],
  ["tilde", "~/projects/herdr-app-editor/files/preview.png"],
];
export default class Spike extends View {
  init(_p, cx) {
    this.tick = 0; this.added = [];
    cx.timer.every(1000, (cx) => { this.tick++; cx.notify(); });
    cx.spawn(async (cx) => { for (;;) { const c = await nextCommand(); this.added.push(c); cx.notify(); } });
  }
  render(_cx) {
    const t = theme();
    const contain = (p, w, h) => div().w(w).h(h).border_1().border_color(t.ansi2).overflow_hidden()
      .child(div().size_full().flex().items_center().justify_center().child(image(p).max_w_full().max_h_full()));
    return v_flex().id("sp").size_full().bg(t.popover).text_color(t.foreground).p(8).gap(8).text_size(11)
      .child(div().child("tick " + this.tick))
      .child(h_flex().gap(6).children(fixed.map(([l, p]) => v_flex().gap(2).child(div().child(l)).child(contain(p, 120, 90)))))
      .child(h_flex().gap(6).flex_wrap().children(this.added.map((p, i) => v_flex().id("a" + i).gap(2).child(div().child(p.slice(-28))).child(contain(p, 200, 80)).child(contain(p, 60, 140)))));
  }
}
