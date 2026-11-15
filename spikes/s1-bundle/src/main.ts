// S1 spike: a Bun-bundled mod with nested modules and host externals.
import { View, div } from "gpui-kit";
import { v_flex, EditorState, Editor } from "gpui-base";
import { theme, settings } from "herdr";
import * as fs from "fs/promises";
import { describe } from "./core/describe";

export default class S1 extends View {
  init(_props: unknown, _cx: unknown) {
    this.code = EditorState.new({ language: "ts", value: describe("bundled"), font_family: settings().font_family });
    this.fsType = typeof fs.readFile;
  }

  render(_cx: unknown) {
    const t = theme();
    return v_flex().id("s1").size_full().bg(t.background).text_color(t.foreground).p(8).gap(6)
      .child(div().child(`fs.readFile: ${this.fsType}`))
      .child(Editor.new(this.code).flex_1().min_h(0));
  }
}
