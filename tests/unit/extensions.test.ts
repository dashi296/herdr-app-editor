import { describe, expect, test } from "bun:test";
import { createRegistry, type Extension } from "../../src/core/extensions/registry";
import { ensureFinalNewline } from "../../src/extensions/examples/ensure-final-newline";

const file = { path: "/p/a.ts", machine: null, text: "x", language: "js" };

describe("onFileOpen", () => {
  test("no extensions: nothing changes", async () => {
    expect(await createRegistry([]).fileOpened(file)).toEqual({ language: "js", readonly: null, messages: [] });
  });
  test("an extension can choose the language and make the file read-only", async () => {
    const ext: Extension = { name: "lock-lockfiles", onFileOpen: (f) => (f.path.endsWith(".ts") ? { language: "txt", readonly: "generated file" } : undefined) };
    expect(await createRegistry([ext]).fileOpened(file)).toEqual({ language: "txt", readonly: "generated file", messages: [] });
  });
  test("a throwing extension is reported and skipped", async () => {
    const bad: Extension = { name: "bad", onFileOpen: () => { throw new Error("boom"); } };
    expect(await createRegistry([bad]).fileOpened(file)).toEqual({ language: "js", readonly: null, messages: ["bad: Error: boom"] });
  });
});

describe("beforeSave", () => {
  const save = { path: "/p/a.ts", machine: null, text: "a" };
  test("extensions transform the text in order", async () => {
    const a: Extension = { name: "a", beforeSave: (s) => ({ text: s.text + "1" }) };
    const b: Extension = { name: "b", beforeSave: async (s) => ({ text: s.text + "2" }) };
    expect(await createRegistry([a, b]).beforeSave(save)).toEqual({ ok: true, text: "a12" });
  });
  test("an extension can cancel the save with a reason", async () => {
    const stop: Extension = { name: "lint", beforeSave: () => ({ cancel: "2 errors" }) };
    const after: Extension = { name: "after", beforeSave: () => { throw new Error("must not run"); } };
    expect(await createRegistry([stop, after]).beforeSave(save)).toEqual({ ok: false, reason: "lint: 2 errors" });
  });
  test("a throwing extension cancels the save rather than writing half-transformed text", async () => {
    const bad: Extension = { name: "fmt", beforeSave: () => { throw new Error("parse error"); } };
    expect(await createRegistry([bad]).beforeSave(save)).toEqual({ ok: false, reason: "fmt failed: Error: parse error" });
  });
  test("a primitive result cancels the save instead of throwing", async () => {
    const bad = { name: "prim", beforeSave: () => "oops" } as unknown as Extension;
    expect(await createRegistry([bad]).beforeSave(save)).toEqual({ ok: false, reason: "prim returned invalid text" });
  });
  test("a result that is not text cancels the save", async () => {
    const bad = { name: "odd", beforeSave: () => ({ text: 42 }) } as unknown as Extension;
    expect(await createRegistry([bad]).beforeSave(save)).toEqual({ ok: false, reason: "odd returned invalid text" });
  });
});

describe("themes", () => {
  test("valid extension themes are added after the built-ins; invalid ones are reported", () => {
    const ext: Extension = { name: "solar", themes: [
      { name: "Solar", appearance: "dark", syntax: { keyword: "#859900" } },
      { name: "", appearance: "dark", syntax: {} } as never,
    ] };
    const r = createRegistry([ext]).themes([{ name: "One Dark", appearance: "dark", syntax: {} }]);
    expect(r.themes.map((t) => t.name)).toEqual(["One Dark", "Solar"]);
    expect(r.messages).toEqual(["solar: theme #2: name must be a non-empty string"]);
  });
  test("a theme cannot replace a built-in of the same name", () => {
    const ext: Extension = { name: "x", themes: [{ name: "One Dark", appearance: "dark", syntax: {} }] };
    expect(createRegistry([ext]).themes([{ name: "One Dark", appearance: "dark", syntax: { keyword: "#000000" } }]).messages)
      .toEqual(['x: theme "One Dark" already exists']);
  });
});

describe("example: ensure-final-newline", () => {
  test("adds a newline only when missing, matching CRLF files", async () => {
    const r = createRegistry([ensureFinalNewline]);
    expect(await r.beforeSave({ path: "a", machine: null, text: "a" })).toEqual({ ok: true, text: "a\n" });
    expect(await r.beforeSave({ path: "a", machine: null, text: "a\r\nb" })).toEqual({ ok: true, text: "a\r\nb\r\n" });
    expect(await r.beforeSave({ path: "a", machine: null, text: "a\n" })).toEqual({ ok: true, text: "a\n" });
    expect(await r.beforeSave({ path: "a", machine: null, text: "" })).toEqual({ ok: true, text: "" });
  });
});
