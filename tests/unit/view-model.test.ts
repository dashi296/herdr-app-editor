import { describe, expect, test } from "bun:test";
import { beginPoll, beginSave, edit, open, pollResult, saveFailed } from "../../src/core/document/document";
import { editorModel } from "../../src/core/view-model/editor";

const base = { readonly: null, lossy: false, draftOffer: null, draftError: null } as const;
const doc = open({ path: "/p/src/a.ts", machine: null, text: "a\n" });

describe("editorModel", () => {
  test("clean: file name, no dirty mark, no banners", () => {
    expect(editorModel({ ...base, doc })).toEqual({ title: "a.ts", dirty: false, banners: [] });
  });
  test("dirty mark follows the content, not the keystrokes", () => {
    expect(editorModel({ ...base, doc: edit(doc, "b\n") }).dirty).toBe(true);
    expect(editorModel({ ...base, doc: edit(edit(doc, "b\n"), "a\n") }).dirty).toBe(false);
  });
  test("external change while dirty offers reload or keep", () => {
    const d = edit(doc, "mine\n");
    const m = editorModel({ ...base, doc: pollResult(d, beginPoll(d), "theirs\n") });
    expect(m.banners).toEqual([
      { kind: "warn", text: "The file changed on disk. Your edits are not saved.", actions: ["reload", "keep"] },
    ]);
  });
  test("deleted on disk while dirty", () => {
    const d = edit(doc, "mine\n");
    expect(editorModel({ ...base, doc: pollResult(d, beginPoll(d), null) }).banners[0]?.text).toBe(
      "The file was deleted on disk. Your edits are not saved.",
    );
  });
  test("save failure shows what was observed and the raw message", () => {
    const { state, request } = beginSave(edit(doc, "mine\n"));
    const failed = saveFailed(
      state,
      request.generation,
      { kind: "text", text: "a\n" },
      "Permission denied (os error 13)",
    );
    expect(editorModel({ ...base, doc: failed }).banners).toEqual([
      { kind: "error", text: "Save failed. Your edits are kept. Permission denied (os error 13)", actions: ["retry"] },
    ]);
    expect(editorModel({ ...base, doc: failed }).dirty).toBe(true);
  });
  test("unknown write permission disables saving with its own text", () => {
    expect(editorModel({ ...base, doc, readonly: "unknown" }).banners[0]?.text).toBe(
      "Read-only: write permission could not be checked, so saving is disabled.",
    );
  });
  test("extension read-only reason and notes", () => {
    const m = editorModel({
      ...base,
      doc,
      readonly: "extension",
      readonlyNote: "generated file",
      extensionNotes: ["Save cancelled. lint: 2 errors"],
    });
    expect(m.banners.map((b) => b.text)).toEqual(["Read-only: generated file", "Save cancelled. lint: 2 errors"]);
  });
  test("highlighting switched off for size", () => {
    expect(editorModel({ ...base, doc, highlightOff: true }).banners).toEqual([
      {
        kind: "info",
        text: "Syntax highlighting is off for files over 30 KB to keep typing fast.",
        actions: ["highlightOn"],
      },
    ]);
  });
  test("read-only, lossy and draft banners", () => {
    const m = editorModel({
      ...base,
      doc,
      readonly: "remote",
      lossy: true,
      draftOffer: { savedAt: "10:42", conflict: true },
      draftError: "disk full",
    });
    expect(m.banners.map((b) => [b.kind, b.actions])).toEqual([
      ["info", []],
      ["warn", []],
      ["info", ["restore", "discardDraft"]],
      ["warn", []],
    ]);
    expect(m.banners[0]?.text).toBe("Read-only: files on other machines cannot be saved.");
    expect(m.banners[2]?.text).toBe("An unsaved draft from 10:42 exists. The file has changed since then.");
  });
});
