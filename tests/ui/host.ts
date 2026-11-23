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
/** Runs pending tasks until cond() holds, or gives up after `rounds` turns. */
export async function until(cond: () => boolean, rounds = 1000): Promise<void> {
  for (let i = 0; i < rounds && !cond(); i++) await new Promise((r) => setTimeout(r, 0));
}

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
  /** The last range set_selected_range was given (null: never). */
  selected: { start: number; end: number } | null = null;
  focusCount = 0;
  set_selected_range(r: { start: number; end: number }) {
    this.selected = r;
  }
  selected_range() {
    return this.selected ?? { start: 0, end: 0 };
  }
  focus() {
    this.focusCount++;
  }
  /** The user types: the text changes and the "change" event fires. */
  type(text: string, cx: unknown) {
    this.text = text;
    this.handlers.change?.(null, cx);
  }
}

/** gpui-base InputState: tests type into it and press Enter. */
export class FakeInputState {
  static created: FakeInputState[] = [];
  text = "";
  focused = 0;
  handlers: Record<string, (e: unknown, cx: unknown) => void> = {};
  constructor(public opts: Record<string, unknown>) {}
  static new(opts: Record<string, unknown> = {}) {
    const s = new FakeInputState(opts);
    FakeInputState.created.push(s);
    return s;
  }
  value() {
    return this.text;
  }
  on(event: string, fn: (e: unknown, cx: unknown) => void) {
    this.handlers[event] = fn;
  }
  focus() {
    this.focused++;
  }
  /** The person types: the text changes and "change" fires. */
  type(text: string, cx: unknown) {
    this.text = text;
    this.handlers.change?.(null, cx);
  }
  /** Enter in the field; `secondary` is cmd on macOS, ctrl elsewhere (gpui-base InputEvent). */
  submit(cx: unknown, event: { secondary?: boolean } = {}) {
    this.handlers.submit?.(event, cx);
  }
}

/**
 * Any element builder: every method returns the builder again. `.id(x)` followed by
 * `.on_click(fn)` records fn in host.clicks[x], so tests can press a rendered button
 * (clear host.clicks before the render, or handlers of earlier screens stay).
 */
const element = (): unknown => {
  let id: string | null = null;
  const self: unknown = new Proxy(function () {}, {
    get:
      (_t, key) =>
      (...args: unknown[]) => {
        if (key === "id") id = String(args[0]);
        else if (key === "on_click" && id !== null) host.clicks.set(id, args[0] as Click);
        else if (key === "child" && typeof args[0] === "string") host.texts.push(args[0]);
        return self;
      },
    apply: () => element(),
  });
  return self;
};
type Click = (event: unknown, cx: unknown) => void;

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
export interface ExecOptions {
  cwd?: string;
  on?: string | null;
  timeout?: number;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** A pending folder watch: a promise with cancel(), as herdr's watchFolder returns. */
export type FakeWatch = Promise<string[]> & { cancel(): void; cancelled: boolean };

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
  exec: async (_cmd: string, _args: string[], _opts?: ExecOptions): Promise<ExecResult> => ({
    code: 1,
    stdout: "",
    stderr: "",
  }),
  watches: [] as FakeWatch[],
  /** Click handlers by element id. Builders only add to it: clear it before a render to see one screen's buttons. */
  clicks: new Map<string, Click>(),
  appHome: "/fake-home",
  platform: "macos",
  /** What `settings()` returns. */
  settings: { dark: true } as Record<string, unknown>,
  /** Every string passed to .child(): what a render shows. Clear it before the render you check. */
  texts: [] as string[],
  keys: [] as { section: string; keys: string; action: string }[],
  checking: false,
  /** readTextFile serves these; every path asked for is recorded in reads. */
  files: new Map<string, string>(),
  reads: [] as string[],
  /** Every path given to image(). Clear it before the render you check. */
  images: [] as string[],
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
  host.clicks.clear();
  host.appHome = "/fake-home";
  host.platform = "macos";
  host.settings = { dark: true };
  host.texts = [];
  host.keys = [];
  host.checking = false;
  host.files = new Map();
  host.reads = [];
  host.images = [];
  FakeEditorState.created = [];
  FakeInputState.created = [];
}

function fakeWatch(): FakeWatch {
  let resolve!: (changes: string[]) => void;
  const w = new Promise<string[]>((r) => {
    resolve = r;
  }) as FakeWatch;
  w.cancelled = false;
  // Like the host (types/herdr.d.ts FolderWatch.cancel): resolves with [] and releases the watch.
  w.cancel = () => {
    w.cancelled = true;
    resolve([]);
  };
  host.watches.push(w);
  return w;
}

export function install() {
  mock.module("gpui-kit", () => ({
    View: class {},
    div: element,
    svg: element,
    image: (path: string) => {
      host.images.push(path);
      return element();
    },
  }));
  mock.module("gpui-base", () => ({
    Editor: { new: element },
    EditorState: FakeEditorState,
    InputState: FakeInputState,
    Input: { new: element },
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
    settings: () => host.settings,
    theme: () => ({}),
    window: () => ({ active: true, platform: host.platform }),
    exec: (cmd: string, args: string[], opts?: ExecOptions) => host.exec(cmd, args, opts),
    watchFolder: fakeWatch,
    appHome: () => host.appHome,
    keys: () => host.keys,
    checking: () => host.checking,
    readTextFile: async (path: string) => {
      host.reads.push(path);
      return host.files.get(path) ?? null;
    },
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
  /** Every delay sleep() was asked for (it resolves at once). */
  sleeps: number[];
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
    sleeps: [],
    sleep: (ms) => {
      cx.sleeps.push(ms);
      return new Promise((r) => setTimeout(r, 0));
    },
  };
  return cx;
}
