// Opening a file at a line (#search): turning { line, col, len } into an editor range. Pure.
import { expect, test } from "bun:test";
import { parseAt, rangeAt } from "../../src/core/jump/jump";

const T = "one\ntwo\nthree";
test("line only puts the cursor at the line start", () =>
  expect(rangeAt(T, { line: 2 })).toEqual({ start: 4, end: 4 }));
test("col and len select within the line", () =>
  expect(rangeAt(T, { line: 3, col: 2, len: 3 })).toEqual({ start: 9, end: 12 }));
test("a line past the end clamps to the last line", () =>
  expect(rangeAt(T, { line: 99 })).toEqual({ start: 8, end: 8 }));
test("col and len clamp to the line", () =>
  expect(rangeAt(T, { line: 1, col: 9, len: 9 })).toEqual({ start: 3, end: 3 }));
test("CRLF: lines split on \\n and the \\r is not part of the line", () => {
  const c = "a\r\nbb\r\nc";
  expect(rangeAt(c, { line: 2, col: 1, len: 9 })).toEqual({ start: 3, end: 5 });
  expect(rangeAt(c, { line: 3 })).toEqual({ start: 7, end: 7 });
});
test("empty text", () => expect(rangeAt("", { line: 5, col: 3 })).toEqual({ start: 0, end: 0 }));
test("parseAt accepts valid and rejects invalid", () => {
  expect(parseAt({ line: 3, col: 2, len: 1 })).toEqual({ line: 3, col: 2, len: 1 });
  expect(parseAt({ line: 3 })).toEqual({ line: 3 });
  for (const bad of [null, {}, { line: 0 }, { line: 1.5 }, { line: "3" }, { line: 2, col: 0 }, { line: 2, len: -1 }])
    expect(parseAt(bad)).toBeNull();
});
