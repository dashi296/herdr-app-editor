import { describe, expect, test } from "bun:test";
import {
  acknowledgeExternal, beginPoll, beginSave, edit, isDirty, open, pollResult, reloadFrom, saveFailed, saveSucceeded,
} from "../../src/core/document/document";

const doc = (text = "a\n") => open({ path: "/p/a.ts", machine: null, text });

describe("generations never repeat across documents (review B1)", () => {
  test("a document opened after another starts above its generation", () => {
    const a = beginSave(edit(doc(), "x\n")).state;
    const b = open({ path: "/p/b.ts", machine: null, text: "b\n", after: a.generation });
    expect(b.generation).toBeGreaterThan(a.generation);
  });
  test("a save result of the previous document is ignored by the next one", () => {
    const { state: a, request } = beginSave(edit(doc(), "x\n"));
    let b = open({ path: "/p/b.ts", machine: null, text: "b\n", after: a.generation });
    b = beginSave(edit(b, "y\n")).state;
    expect(saveSucceeded(b, request.generation)).toBe(b);
  });
});

describe("editing", () => {
  test("opens clean", () => {
    const d = doc();
    expect(d.status).toBe("clean");
    expect(isDirty(d)).toBe(false);
  });
  test("an edit makes it dirty, undoing it makes it clean again", () => {
    let d = edit(doc(), "b\n");
    expect(d.status).toBe("dirty");
    expect(d.revision).toBe(1);
    d = edit(d, "a\n");
    expect(d.status).toBe("clean");
  });
  test("in a CRLF file, typing Enter is not a change by itself once normalized", () => {
    const d = edit(doc("a\r\n"), "a\n");
    expect(d.status).toBe("clean");
  });
});

describe("saving", () => {
  test("save request carries the normalized text and the baseline as expected", () => {
    const d = edit(doc("a\r\n"), "a\r\nb\n");
    const { state, request } = beginSave(d);
    expect(state.status).toBe("saving");
    expect(request).toEqual({ path: "/p/a.ts", machine: null, text: "a\r\nb\r\n", expected: "a\r\n", generation: state.generation });
  });
  test("success moves the baseline", () => {
    const { state, request } = beginSave(edit(doc(), "b\n"));
    const d = saveSucceeded(state, request.generation);
    expect(d.baseline).toBe("b\n");
    expect(d.status).toBe("clean");
  });
  test("edits made while saving stay dirty after success", () => {
    const { state, request } = beginSave(edit(doc(), "b\n"));
    const d = saveSucceeded(edit(state, "c\n"), request.generation);
    expect(d.baseline).toBe("b\n");
    expect(d.status).toBe("dirty");
  });
  test("a stale save result is ignored", () => {
    const { state, request } = beginSave(edit(doc(), "b\n"));
    const reopened = reloadFrom(state, "z\n");
    expect(saveSucceeded(reopened, request.generation)).toBe(reopened);
  });
});

describe("save failures are classified by what a re-read observed", () => {
  const failing = () => beginSave(edit(doc(), "mine\n"));
  test("file gone", () => {
    const { state, request } = failing();
    const d = saveFailed(state, request.generation, { kind: "missing" }, "Error: changed outside");
    expect(d.status).toBe("error");
    expect(d.failure).toEqual({ observed: "deleted", message: "Error: changed outside" });
    expect(d.text).toBe("mine\n");
  });
  test("disk differs from baseline", () => {
    const { state, request } = failing();
    expect(saveFailed(state, request.generation, { kind: "text", text: "theirs\n" }, "e").failure?.observed).toBe("changed");
  });
  test("disk equals baseline: other failure (permission, size)", () => {
    const { state, request } = failing();
    expect(saveFailed(state, request.generation, { kind: "text", text: "a\n" }, "Permission denied").failure?.observed).toBe("failed");
  });
  test("re-read failed too", () => {
    const { state, request } = failing();
    expect(saveFailed(state, request.generation, { kind: "unreadable", error: "EACCES" }, "e").failure)
      .toEqual({ observed: "unreadable", message: "e", readError: "EACCES" });
  });
});

describe("polling for external changes", () => {
  test("unchanged disk does nothing", () => {
    const d = doc();
    expect(pollResult(d, beginPoll(d), "a\n")).toBe(d);
  });
  test("clean document reloads automatically", () => {
    const d = doc();
    const r = pollResult(d, beginPoll(d), "theirs\n");
    expect(r.status).toBe("clean");
    expect(r.text).toBe("theirs\n");
    expect(r.baseline).toBe("theirs\n");
    expect(r.revision).toBeGreaterThan(d.revision);
  });
  test("dirty document is not reloaded: dirtyExternal keeps the edits", () => {
    const d = edit(doc(), "mine\n");
    const r = pollResult(d, beginPoll(d), "theirs\n");
    expect(r.status).toBe("dirtyExternal");
    expect(r.text).toBe("mine\n");
    expect(r.external).toEqual({ text: "theirs\n" });
  });
  test("an edit during the read prevents the automatic reload", () => {
    const d = doc();
    const token = beginPoll(d);
    const edited = edit(d, "typing\n");
    expect(pollResult(edited, token, "theirs\n").status).toBe("dirtyExternal");
  });
  test("a poll that started before a save is ignored", () => {
    const d = edit(doc(), "b\n");
    const token = beginPoll(d);
    const { state } = beginSave(d);
    expect(pollResult(state, token, "b\n")).toBe(state);
  });
  test("deleted on disk while dirty", () => {
    const d = edit(doc(), "mine\n");
    expect(pollResult(d, beginPoll(d), null).external).toEqual({ text: null });
  });
  test("keeping my version does not re-raise the same external change", () => {
    const d = edit(doc(), "mine\n");
    const ext = pollResult(d, beginPoll(d), "theirs\n");
    const kept = acknowledgeExternal(ext);
    expect(kept.status).toBe("dirty");
    expect(kept.baseline).toBe("a\n");
    expect(pollResult(kept, beginPoll(kept), "theirs\n")).toBe(kept);
    expect(pollResult(kept, beginPoll(kept), "newer\n").status).toBe("dirtyExternal");
  });
});
