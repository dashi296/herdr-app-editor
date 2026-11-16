import { describe, expect, test } from "bun:test";
import { classifyText, detectEol, prepareForSave } from "../../src/core/text/text";

describe("detectEol", () => {
  test("no line breaks", () => expect(detectEol("abc")).toBe("none"));
  test("LF only", () => expect(detectEol("a\nb\n")).toBe("lf"));
  test("CRLF only", () => expect(detectEol("a\r\nb\r\n")).toBe("crlf"));
  test("CRLF and LF mixed", () => expect(detectEol("a\r\nb\n")).toBe("mixed"));
  test("lone CR counts as mixed", () => expect(detectEol("a\rb\n")).toBe("mixed"));
  test("lone CR only counts as mixed", () => expect(detectEol("a\rb")).toBe("mixed"));
});

describe("prepareForSave", () => {
  test("CRLF file: LF inserted by Enter becomes CRLF (S2b)", () => {
    expect(prepareForSave("line1\r\nline2\r\n\nx", "crlf")).toBe("line1\r\nline2\r\n\r\nx");
  });
  test("CRLF file: existing CRLF is not doubled", () => {
    expect(prepareForSave("a\r\nb\r\n", "crlf")).toBe("a\r\nb\r\n");
  });
  test("LF file is unchanged even if CRLF was pasted", () => {
    expect(prepareForSave("a\nb\r\n", "lf")).toBe("a\nb\r\n");
  });
  test("mixed file is unchanged", () => {
    expect(prepareForSave("a\r\nb\nc", "mixed")).toBe("a\r\nb\nc");
  });
  test("file without line breaks keeps what the user typed", () => {
    expect(prepareForSave("a\nb", "none")).toBe("a\nb");
  });
  test("BOM and missing trailing newline are kept", () => {
    expect(prepareForSave("﻿a\r\nb", "crlf")).toBe("﻿a\r\nb");
  });
});

describe("classifyText", () => {
  test("plain text is editable", () =>
    expect(classifyText("const a = 1;\n", { remote: false })).toEqual({ kind: "text" }));
  test("NUL means binary", () => expect(classifyText("a\0b", { remote: false })).toEqual({ kind: "binary" }));
  test("remote text with U+FFFD may have lost bytes", () =>
    expect(classifyText("a�b", { remote: true })).toEqual({ kind: "text", lossy: true }));
  test("local U+FFFD is a real character", () =>
    expect(classifyText("a�b", { remote: false })).toEqual({ kind: "text" }));
});
