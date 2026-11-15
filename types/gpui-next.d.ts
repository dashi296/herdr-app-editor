// EditorState additions in herdr-app master (vendor/gpui-kit/crates/shell/src/typings.rs:3203-3215)
// that Herdr Desktop 0.1.15's generated gpui-kit.d.ts lacks.
declare module "gpui-base" {
  interface EditorState {
    selected_range(): { start: number; end: number };
    set_selected_range(range: { start: number; end: number }): void;
    replace(text: string): void;
    focus(): void;
  }
}
export {};
