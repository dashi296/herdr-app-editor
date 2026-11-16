import { describe, expect, test } from "bun:test";
import { DraftWriter, type Timer } from "../../src/ports/draft-writer";

/** Manual clock: timers fire only when advanced. */
class FakeTime implements Timer {
  t = 0;
  timers: { at: number; fn: () => void; dead: boolean }[] = [];
  now() {
    return this.t;
  }
  after(ms: number, fn: () => void) {
    const timer = { at: this.t + ms, fn, dead: false };
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.dead = true;
      },
    };
  }
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const next = this.timers.filter((x) => !x.dead && x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.t = next.at;
      next.dead = true;
      next.fn();
      await flush();
    }
    this.t = end;
    await flush();
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const time = new FakeTime();
  const saved: { at: number; v: unknown }[] = [];
  const writer = new DraftWriter<unknown>(
    {
      save: async (v) => {
        saved.push({ at: time.now(), v });
      },
    },
    time,
    { debounceMs: 250, maxWaitMs: 1000 },
  );
  return { time, saved, writer };
}

describe("DraftWriter", () => {
  test("writes 250ms after the last change", async () => {
    const { time, saved, writer } = setup();
    writer.update("a", time);
    await time.advance(249);
    expect(saved).toEqual([]);
    await time.advance(1);
    expect(saved).toEqual([{ at: 250, v: "a" }]);
  });
  test("continuous typing still writes within 1s of the first unsaved change", async () => {
    const { time, saved, writer } = setup();
    for (let i = 0; i < 20; i++) {
      writer.update(`v${i}`, time);
      await time.advance(100);
    }
    expect(saved[0]).toEqual({ at: 1000, v: "v9" });
    expect(saved.every((s, i) => i === 0 || s.at - saved[i - 1]!.at <= 1000)).toBe(true);
  });
  test("a change during a write is written right after it", async () => {
    const time = new FakeTime();
    const saved: unknown[] = [];
    let release!: () => void;
    const writer = new DraftWriter<string>(
      {
        save: (v) => {
          saved.push(v);
          return v === "a"
            ? new Promise<void>((r) => {
                release = r;
              })
            : Promise.resolve();
        },
      },
      time,
      { debounceMs: 250, maxWaitMs: 1000 },
    );
    writer.update("a", time);
    await time.advance(250);
    writer.update("b", time);
    await time.advance(300);
    expect(saved).toEqual(["a"]);
    release();
    await flush();
    await flush();
    expect(saved).toEqual(["a", "b"]);
  });
  test("flush writes the pending change immediately", async () => {
    const { time, saved, writer } = setup();
    writer.update("a", time);
    await writer.flush();
    expect(saved).toEqual([{ at: 0, v: "a" }]);
    await time.advance(1000);
    expect(saved.length).toBe(1);
  });
  test("a failed write is reported and retried on the next change", async () => {
    const time = new FakeTime();
    const errors: unknown[] = [];
    let fail = true;
    const saved: unknown[] = [];
    const writer = new DraftWriter<string>(
      {
        save: async (v) => {
          if (fail) throw new Error("full");
          saved.push(v);
        },
      },
      time,
      { debounceMs: 250, maxWaitMs: 1000, onError: (e) => errors.push(String(e)) },
    );
    writer.update("a", time);
    await time.advance(250);
    expect(errors).toEqual(["Error: full"]);
    fail = false;
    writer.update("b", time);
    await time.advance(250);
    expect(saved).toEqual(["b"]);
  });
  test("discard drops the pending snapshot and its timer", async () => {
    const { time, saved, writer } = setup();
    writer.update("a", time);
    writer.discard();
    await time.advance(2000);
    await writer.flush();
    expect(saved).toEqual([]);
  });
});

describe("DraftWriter failure keeps the snapshot (review B3)", () => {
  test("a failed snapshot is retried by flush without a new edit", async () => {
    const time = new FakeTime();
    let fail = true;
    const saved: unknown[] = [];
    const writer = new DraftWriter<string>(
      {
        save: async (v) => {
          if (fail) throw new Error("full");
          saved.push(v);
        },
      },
      time,
      { debounceMs: 250, maxWaitMs: 1000 },
    );
    writer.update("a", time);
    await time.advance(250);
    expect(saved).toEqual([]);
    fail = false;
    await writer.flush();
    expect(saved).toEqual(["a"]);
  });
  test("a newer snapshot wins over the failed one", async () => {
    const time = new FakeTime();
    let fail = true;
    const saved: unknown[] = [];
    const writer = new DraftWriter<string>(
      {
        save: async (v) => {
          if (fail) throw new Error("full");
          saved.push(v);
        },
      },
      time,
      { debounceMs: 250, maxWaitMs: 1000 },
    );
    writer.update("a", time);
    await time.advance(250);
    fail = false;
    writer.update("b", time);
    await writer.flush();
    expect(saved).toEqual(["b"]);
  });
});

describe("flush reports a snapshot it could not write (review NB2)", () => {
  test("flush rejects while the snapshot stays pending", async () => {
    const time = new FakeTime();
    let fail = true;
    const saved: unknown[] = [];
    const writer = new DraftWriter<string>(
      {
        save: async (v) => {
          if (fail) throw new Error("full");
          saved.push(v);
        },
      },
      time,
      { debounceMs: 250, maxWaitMs: 1000 },
    );
    writer.update("a", time);
    await expect(writer.flush()).rejects.toThrow("full");
    fail = false;
    await writer.flush();
    expect(saved).toEqual(["a"]);
  });
});

describe("discard wins over a failing write in flight (review NB)", () => {
  test("a discarded snapshot is not restored when its write fails", async () => {
    const time = new FakeTime();
    let reject!: (e: Error) => void;
    const saved: unknown[] = [];
    let calls = 0;
    const writer = new DraftWriter<string>(
      {
        save: (v) => {
          calls++;
          if (calls === 1)
            return new Promise<void>((_, r) => {
              reject = r;
            });
          saved.push(v);
          return Promise.resolve();
        },
      },
      time,
      { debounceMs: 250, maxWaitMs: 1000 },
    );
    writer.update("dirty", time);
    await time.advance(250);
    writer.discard();
    reject(new Error("full"));
    await flush();
    await flush();
    await writer.flush();
    expect(saved).toEqual([]);
  });
});
