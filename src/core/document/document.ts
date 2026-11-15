// One open file: edits, saves and external changes as pure state transitions (plan §2, §4 Step 2).
// `revision` counts edits; `generation` invalidates in-flight I/O (R14).
import { detectEol, prepareForSave, type Eol } from "../text/text";

export type Status = "clean" | "dirty" | "saving" | "dirtyExternal" | "error";

export interface Failure {
  observed: "deleted" | "changed" | "failed" | "unreadable";
  message: string;
  readError?: string;
}

export interface Doc {
  readonly path: string;
  readonly machine: string | null;
  readonly eol: Eol;
  /** The disk content this document is based on; the `expected` of the next save. */
  readonly baseline: string;
  /** What the editor shows. */
  readonly text: string;
  readonly revision: number;
  readonly generation: number;
  readonly status: Status;
  /** Text being written by the save in flight. */
  readonly saving?: string;
  /** Disk content seen while dirty; null when the file is gone. */
  readonly external?: { text: string | null };
  /** An external version the user chose to keep their edits over. */
  readonly acknowledged?: { text: string | null };
  readonly failure?: Failure;
}

export function open(f: { path: string; machine: string | null; text: string }): Doc {
  return { path: f.path, machine: f.machine, eol: detectEol(f.text), baseline: f.text, text: f.text, revision: 0, generation: 1, status: "clean" };
}

/** Whether saving would change the file. */
export function isDirty(d: Doc): boolean {
  return prepareForSave(d.text, d.eol) !== d.baseline;
}

function settle(d: Doc): Doc {
  if (d.status === "saving" || d.status === "dirtyExternal" || d.status === "error") return d;
  return { ...d, status: isDirty(d) ? "dirty" : "clean" };
}

export function edit(d: Doc, text: string): Doc {
  if (text === d.text) return d;
  return settle({ ...d, text, revision: d.revision + 1 });
}

export interface SaveRequest { path: string; machine: string | null; text: string; expected: string; generation: number }

export function beginSave(d: Doc): { state: Doc; request: SaveRequest } {
  const text = prepareForSave(d.text, d.eol);
  const { external: _e, failure: _f, ...rest } = d;
  const state: Doc = { ...rest, status: "saving", saving: text, generation: d.generation + 1 };
  return { state, request: { path: d.path, machine: d.machine, text, expected: d.baseline, generation: state.generation } };
}

export function saveSucceeded(d: Doc, generation: number): Doc {
  if (generation !== d.generation || d.saving === undefined) return d;
  const { saving, acknowledged: _a, ...rest } = d;
  return settle({ ...rest, baseline: saving, status: "clean", generation: d.generation + 1 });
}

/** What a re-read after a failed save found. */
export type Reread = { kind: "missing" } | { kind: "text"; text: string } | { kind: "unreadable"; error: string };

export function saveFailed(d: Doc, generation: number, reread: Reread, message: string): Doc {
  if (generation !== d.generation) return d;
  const failure: Failure =
    reread.kind === "missing" ? { observed: "deleted", message }
    : reread.kind === "unreadable" ? { observed: "unreadable", message, readError: reread.error }
    : reread.text !== d.baseline ? { observed: "changed", message }
    : { observed: "failed", message };
  const { saving: _s, ...rest } = d;
  return { ...rest, status: "error", failure, generation: d.generation + 1 };
}

export interface PollToken { generation: number; revision: number }

export function beginPoll(d: Doc): PollToken {
  return { generation: d.generation, revision: d.revision };
}

/** Applies a poll read (null: the file is gone). Stale or redundant results return `d` itself. */
export function pollResult(d: Doc, token: PollToken, disk: string | null): Doc {
  if (token.generation !== d.generation || d.status === "saving") return d;
  if (disk === d.baseline) return d;
  if (d.acknowledged && d.acknowledged.text === disk) return d;
  if (d.external && d.external.text === disk) return d;
  const untouched = d.status === "clean" && token.revision === d.revision;
  if (untouched && disk !== null) return reloadFrom(d, disk);
  return { ...d, status: "dirtyExternal", external: { text: disk } };
}

/** Replaces the document with disk content (automatic reload, or the user chose "reload"). */
export function reloadFrom(d: Doc, disk: string): Doc {
  return { path: d.path, machine: d.machine, eol: detectEol(disk), baseline: disk, text: disk, revision: d.revision + 1, generation: d.generation + 1, status: "clean" };
}

/** The user keeps their edits over an external change; the next save will be refused as a conflict. */
export function acknowledgeExternal(d: Doc): Doc {
  if (d.status !== "dirtyExternal" || !d.external) return d;
  const { external, ...rest } = d;
  return { ...rest, status: isDirty(d) ? "dirty" : "clean", acknowledged: external };
}
