import { describe, expect, test } from "bun:test";
import { fnv1a32, makeRecord, parseSlot, pickCurrent, planDelete, planWrite } from "../../src/core/store/slots";

const raw = (r: unknown) => JSON.stringify(r);

describe("fnv1a32", () => {
  test("known vectors", () => {
    expect(fnv1a32("")).toBe("811c9dc5");
    expect(fnv1a32("a")).toBe("e40c292c");
    expect(fnv1a32("foobar")).toBe("bf9cf968");
  });
  test("non-ASCII is hashed as UTF-8", () => {
    const viaEncoder = (t: string) => { let h = 0x811c9dc5; for (const b of new TextEncoder().encode(t)) h = Math.imul(h ^ b, 0x01000193) >>> 0; return h.toString(16).padStart(8, "0"); };
    for (const t of ["é", "日本語", "😀/p/a.ts", "\0/path"]) expect(fnv1a32(t)).toBe(viaEncoder(t));
  });
});

describe("parseSlot", () => {
  test("round trip", () => {
    const r = makeRecord(3, { text: "a\r\n" });
    expect(parseSlot(raw(r))).toEqual(r);
  });
  test("missing or truncated file is invalid", () => {
    expect(parseSlot(null)).toBeNull();
    expect(parseSlot(raw(makeRecord(1, { text: "x" })).slice(0, 10))).toBeNull();
  });
  test("checksum mismatch is invalid", () => {
    const r = { ...makeRecord(1, { text: "x" }), payload: { text: "tampered" } };
    expect(parseSlot(raw(r))).toBeNull();
  });
  test("checksum does not depend on key order", () => {
    const r = makeRecord(2, { b: 1, a: 2 });
    const reordered = { checksum: r.checksum, payload: { a: 2, b: 1 }, deleted: r.deleted, seq: r.seq, schema: r.schema };
    expect(parseSlot(raw(reordered))).not.toBeNull();
  });
});

describe("pickCurrent", () => {
  test("highest valid seq wins", () => {
    const a = makeRecord(4, { v: "old" }), b = makeRecord(5, { v: "new" });
    expect(pickCurrent(raw(a), raw(b))).toEqual({ slot: "b", payload: { v: "new" }, seq: 5 });
  });
  test("a corrupt newer slot falls back to the older one", () => {
    const a = makeRecord(4, { v: "old" });
    expect(pickCurrent(raw(a), "{broken")).toEqual({ slot: "a", payload: { v: "old" }, seq: 4 });
  });
  test("a tombstone with the highest seq means nothing is stored", () => {
    const a = makeRecord(4, { v: "old" }), b = makeRecord(5, null);
    expect(pickCurrent(raw(a), raw(b))).toEqual({ slot: "b", payload: null, seq: 5 });
  });
  test("both missing", () => expect(pickCurrent(null, null)).toEqual({ slot: null, payload: null, seq: 0 }));
});

describe("planWrite", () => {
  test("writes into the slot that does not hold the current record", () => {
    const a = makeRecord(7, { v: 1 });
    const plan = planWrite(raw(a), null, { v: 2 });
    expect(plan.target).toBe("b");
    expect(plan.record.seq).toBe(8);
    expect(pickCurrent(raw(a), raw(plan.record)).payload).toEqual({ v: 2 });
  });
  test("starts at seq 1 in slot a", () => {
    const plan = planWrite(null, null, { v: 1 });
    expect(plan).toMatchObject({ target: "a", record: { seq: 1 } });
  });
});

describe("planDelete", () => {
  test("tombstone first, then the live slot, the tombstone last", () => {
    const a = makeRecord(1, { v: 1 }), b = makeRecord(2, { v: 2 });
    const steps = planDelete(raw(a), raw(b));
    expect(steps.map((s) => s.op + ":" + s.slot)).toEqual(["write:a", "unlink:b", "unlink:a"]);
  });

  test("a crash after any step never brings the draft back", () => {
    const a = makeRecord(1, { v: 1 }), b = makeRecord(2, { v: 2 });
    const steps = planDelete(raw(a), raw(b));
    const files: Record<"a" | "b", string | null> = { a: raw(a), b: raw(b) };
    for (const step of steps) {
      if (step.op === "write") files[step.slot] = raw(step.record);
      else files[step.slot] = null;
      expect(pickCurrent(files.a, files.b).payload).toBeNull();
    }
    expect(files).toEqual({ a: null, b: null });
  });

  test("nothing stored: nothing to do", () => expect(planDelete(null, null)).toEqual([]));
});
