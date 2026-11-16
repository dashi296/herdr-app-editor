// Fakes for the host modules ("herdr", "gpui-kit", "gpui-base") so src/ui can run under bun test.
// install() must run before src/ui is imported; reset() clears the shared state between tests.
import { mock } from "bun:test";

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}
export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run. */
export const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

export class FakeEditorState {
  static created: FakeEditorState[] = [];
  static new(opts: { value: string; readonly: boolean; language: string }) {
    const s = new FakeEditorState(opts);
    FakeEditorState.created.push(s);
    return s;
  }
  text: string;
  released = false;
  private handlers: Record<string, (e: unknown, cx: unknown) => void> = {};
  constructor(readonly opts: { value: string; readonly: boolean; language: string }) {
    this.text = opts.value;
  }
  value() {
    return this.text;
  }
  set_value(t: string) {
    this.text = t;
  }
  on(event: string, fn: (e: unknown, cx: unknown) => void) {
    this.handlers[event] = fn;
  }
  release() {
    this.released = true;
  }
  /** The user types: the text changes and the "change" event fires. */
  type(text: string, cx: unknown) {
    this.text = text;
    this.handlers.change?.(null, cx);
  }
}

/** Any element builder: every method returns the builder again. */
const element = (): unknown =>
  new Proxy(function () {}, {
    get: () => () => element(),
    apply: () => element(),
  });

export const host = {
  props: {} as Record<string, unknown>,
  shared: new Map<string, unknown>(),
  commands: [] as string[],
  run: [] as string[],
  overlays: [] as unknown[],
  closed: [] as string[],
};

export function reset() {
  host.props = {};
  host.shared.clear();
  host.commands = [];
  host.run = [];
  host.overlays = [];
  host.closed = [];
  FakeEditorState.created = [];
}

export function install() {
  mock.module("gpui-kit", () => ({ View: class {}, div: element }));
  mock.module("gpui-base", () => ({
    Editor: { new: element },
    EditorState: FakeEditorState,
    h_flex: element,
    v_flex: element,
  }));
  mock.module("herdr", () => ({
    props: () => host.props,
    // Commands are pushed by tests through onCommand; the init loop waits forever.
    nextCommand: () => new Promise<string>(() => {}),
    shared: (k: string) => host.shared.get(k),
    setShared: (k: string, v: unknown) => host.shared.set(k, v),
    run: (c: string) => host.run.push(c),
    openOverlay: (o: unknown) => {
      host.overlays.push(o);
      return `overlay-${host.overlays.length}`;
    },
    closeOverlay: (id: string) => host.closed.push(id),
    focused: () => null,
    panes: () => [],
    spaces: () => [],
    settings: () => ({ dark: true }),
    theme: () => ({}),
    window: () => ({ active: true, platform: "macos" }),
  }));
}

export interface FakeCx {
  notify(): void;
  focus_handle(): { focus(): void };
  spawn(fn: (cx: FakeCx) => Promise<unknown>): Promise<unknown>;
  timer: { every(ms: number, fn: unknown): void; after(ms: number, fn: () => void): { cancel(): void } };
  stop_propagation(): void;
}

export function makeCx(): FakeCx {
  const cx: FakeCx = {
    notify() {},
    focus_handle: () => ({ focus() {} }),
    spawn: (fn) => Promise.resolve().then(() => fn(cx)),
    // Draft timers fire at once: these tests check what is written, not when.
    timer: {
      every() {},
      after(_ms, fn) {
        let cancelled = false;
        queueMicrotask(() => {
          if (!cancelled) fn();
        });
        return {
          cancel() {
            cancelled = true;
          },
        };
      },
    },
    stop_propagation() {},
  };
  return cx;
}
