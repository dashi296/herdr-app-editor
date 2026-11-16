// A/B slot store for drafts and pane state (plan §5). Pure: callers do the file I/O.
// The host's fs has no rename (typings.rs fs/promises), so each record alternates between two
// files; a reader takes the valid slot with the highest seq, and a tombstone hides older data.

export const SCHEMA = 1;
export type SlotName = "a" | "b";

export interface SlotRecord<T> {
  schema: number;
  seq: number;
  deleted: boolean;
  payload: T | null;
  checksum: string;
}

/** 32-bit FNV-1a over UTF-8, as 8 hex digits. Stable across builds (unlike the host's DefaultHasher). */
export function fnv1a32(text: string): string {
  let h = 0x811c9dc5;
  const mix = (byte: number) => {
    h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  };
  // UTF-8 by hand: the host runtime is not guaranteed to provide TextEncoder.
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) mix(c);
    else if (c < 0x800) {
      mix(0xc0 | (c >> 6));
      mix(0x80 | (c & 63));
    } else if (c < 0x10000) {
      mix(0xe0 | (c >> 12));
      mix(0x80 | ((c >> 6) & 63));
      mix(0x80 | (c & 63));
    } else {
      mix(0xf0 | (c >> 18));
      mix(0x80 | ((c >> 12) & 63));
      mix(0x80 | ((c >> 6) & 63));
      mix(0x80 | (c & 63));
    }
  }
  return h.toString(16).padStart(8, "0");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function checksumOf(r: Omit<SlotRecord<unknown>, "checksum">): string {
  return fnv1a32(canonical({ schema: r.schema, seq: r.seq, deleted: r.deleted, payload: r.payload }));
}

/** A record holding `payload`, or a tombstone when `payload` is null. */
export function makeRecord<T>(seq: number, payload: T | null): SlotRecord<T> {
  const base = { schema: SCHEMA, seq, deleted: payload === null, payload };
  return { ...base, checksum: checksumOf(base) };
}

/** The record in a slot file, or null when it is missing, torn or from another schema. */
export function parseSlot<T>(raw: string | null): SlotRecord<T> | null {
  if (raw == null) return null;
  let r: SlotRecord<T>;
  try {
    r = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!r || typeof r !== "object" || r.schema !== SCHEMA || !Number.isInteger(r.seq) || typeof r.deleted !== "boolean")
    return null;
  if (r.deleted !== (r.payload === null)) return null;
  return checksumOf(r) === r.checksum ? r : null;
}

export interface Current<T> {
  slot: SlotName | null;
  payload: T | null;
  seq: number;
}

/** What is stored: the valid slot with the highest seq. A tombstone there means nothing. */
export function pickCurrent<T>(a: string | null, b: string | null): Current<T> {
  const ra = parseSlot<T>(a),
    rb = parseSlot<T>(b);
  const best = !ra ? (rb ? "b" : null) : !rb ? "a" : ra.seq >= rb.seq ? "a" : "b";
  if (!best) return { slot: null, payload: null, seq: 0 };
  const r = (best === "a" ? ra : rb)!;
  return { slot: best, payload: r.deleted ? null : r.payload, seq: r.seq };
}

const other = (s: SlotName): SlotName => (s === "a" ? "b" : "a");

/** Where to write the next record so the current one survives a torn write. */
export function planWrite<T>(
  a: string | null,
  b: string | null,
  payload: T | null,
): { target: SlotName; record: SlotRecord<T> } {
  const cur = pickCurrent<T>(a, b);
  return { target: cur.slot ? other(cur.slot) : "a", record: makeRecord(cur.seq + 1, payload) };
}

export type DeleteStep<T> = { op: "write"; slot: SlotName; record: SlotRecord<T> } | { op: "unlink"; slot: SlotName };

/**
 * Removes a record so that a crash after any step never resurrects it:
 * write a tombstone over the older slot, unlink the live slot, then unlink the tombstone.
 */
export function planDelete<T>(a: string | null, b: string | null): DeleteStep<T>[] {
  if (parseSlot(a) === null && parseSlot(b) === null) return [];
  const { target, record } = planWrite<T>(a, b, null);
  return [
    { op: "write", slot: target, record },
    { op: "unlink", slot: other(target) },
    { op: "unlink", slot: target },
  ];
}
