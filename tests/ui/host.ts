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

export interface FakePane {
  pane: string;
  tab: string;
  mod?: string;
  cwd?: string;
  zoomed?: boolean;
}
export interface FakeSpace {
  id: string;
  active: boolean;
  folder?: string;
  machine?: string | null;
  tabs: { id: string; active: boolean }[];
}
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** A pending folder watch: a promise with cancel(), as herdr's watchFolder returns. */
export type FakeWatch = Promise<void> & { cancel(): void; cancelled: boolean };

export const host = {
  props: {} as Record<string, unknown>,
  shared: new Map<string, unknown>(),
  /** Every run() call: the command and its arguments. */
  run: [] as { command: string; args?: unknown }[],
  /** Called by run(); may change panes (a split) or throw. */
  onRun: null as ((command: string, args: unknown) => void) | null,
  overlays: [] as unknown[],
  closed: [] as string[],
  panes: [] as FakePane[],
  spaces: [] as FakeSpace[],
  focused: null as { pane: string | null; cwd?: string; terminal?: string } | null,
  exec: async (_cmd: string, _args: string[]): Promise<ExecResult> => ({ code: 1, stdout: "", stderr: "" }),
  watches: [] as FakeWatch[],
};

export function reset() {
  host.props = {};
  host.shared.clear();
  host.run = [];
  host.onRun = null;
  host.overlays = [];
  host.closed = [];
  host.panes = [];
  host.spaces = [];
  host.focused = null;
  host.exec = async () => ({ code: 1, stdout: "", stderr: "" });
  host.watches = [];
  FakeEditorState.created = [];
}

function fakeWatch(): FakeWatch {
  const w = new Promise<void>(() => {}) as FakeWatch;
  w.cancelled = false;
  w.cancel = () => {
    w.cancelled = true;
  };
  host.watches.push(w);
  return w;
}

export function install() {
  mock.module("gpui-kit", () => ({ View: class {}, div: element, svg: element }));
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
    run: (command: string, args?: unknown) => {
      host.run.push(args === undefined ? { command } : { command, args });
      host.onRun?.(command, args);
    },
    openOverlay: (o: unknown) => {
      host.overlays.push(o);
      return `overlay-${host.overlays.length}`;
    },
    closeOverlay: (id: string) => host.closed.push(id),
    focused: () => host.focused,
    panes: () => host.panes,
    spaces: () => host.spaces,
    settings: () => ({ dark: true }),
    theme: () => ({}),
    window: () => ({ active: true, platform: "macos" }),
    exec: (cmd: string, args: string[]) => host.exec(cmd, args),
    watchFolder: fakeWatch,
    // Used by src/adapters; not exercised by the tests yet.
    appHome: () => "/fake-home",
    readTextFile: async () => null,
    writeTextFile: async () => {},
  }));
}

export interface FakeCx {
  notify(): void;
  focus_handle(): { focus(): void };
  spawn(fn: (cx: FakeCx) => Promise<unknown>): Promise<unknown>;
  timer: { every(ms: number, fn: unknown): void; after(ms: number, fn: () => void): { cancel(): void } };
  stop_propagation(): void;
  sleep(ms: number): Promise<void>;
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
    sleep: () => new Promise((r) => setTimeout(r, 0)),
  };
  return cx;
}
