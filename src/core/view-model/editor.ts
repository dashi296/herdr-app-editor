// What the editor header and banners show (plan §2 "dirty の表示と外部変更"). Pure.
import { isDirty, type Doc } from "../document/document";

export type Action = "reload" | "keep" | "retry" | "restore" | "discardDraft" | "highlightOn";
export interface Banner { kind: "info" | "warn" | "error"; text: string; actions: Action[] }
export interface EditorModel { title: string; dirty: boolean; banners: Banner[] }

export interface EditorInput {
  doc: Doc;
  /** Why saving is not possible, if it is not. */
  readonly: "remote" | "not-writable" | "unknown" | "extension" | null;
  /** Why an extension made the file read-only (with readonly "extension"). */
  readonlyNote?: string;
  /** Messages from extensions: a cancelled save, a failing hook, an invalid theme. */
  extensionNotes?: string[];
  /** Remote text containing U+FFFD (R4). */
  lossy: boolean;
  draftOffer: { savedAt: string; conflict: boolean } | null;
  draftError: string | null;
  /** Highlighting switched off for size (spike S8). */
  highlightOff?: boolean;
}

const READONLY_TEXT = {
  remote: "Read-only: files on other machines cannot be saved.",
  "not-writable": "Read-only: you do not have permission to write this file.",
  unknown: "Read-only: write permission could not be checked, so saving is disabled.",
} as const;

export function editorModel(i: EditorInput): EditorModel {
  const d = i.doc;
  const banners: Banner[] = [];
  if (i.readonly === "extension") banners.push({ kind: "info", text: `Read-only: ${i.readonlyNote ?? "set by an extension"}`, actions: [] });
  else if (i.readonly) banners.push({ kind: "info", text: READONLY_TEXT[i.readonly], actions: [] });
  for (const note of i.extensionNotes ?? []) banners.push({ kind: "warn", text: note, actions: [] });
  if (i.highlightOff) banners.push({ kind: "info", text: "Syntax highlighting is off for files over 30 KB to keep typing fast.", actions: ["highlightOn"] });
  if (i.lossy) banners.push({ kind: "warn", text: "Some bytes could not be read as UTF-8 and were replaced (U+FFFD).", actions: [] });
  if (d.status === "dirtyExternal" && d.external) {
    banners.push(d.external.text === null
      ? { kind: "warn", text: "The file was deleted on disk. Your edits are not saved.", actions: [] }
      : { kind: "warn", text: "The file changed on disk. Your edits are not saved.", actions: ["reload", "keep"] });
  }
  if (d.status === "error" && d.failure) {
    const f = d.failure;
    const text =
      f.observed === "deleted" ? "Save failed: the file was deleted. Your edits are kept."
      : f.observed === "changed" ? "Save failed: the file changed on disk. Your edits are kept."
      : f.observed === "unreadable" ? `Save failed and the file cannot be read. Your edits are kept. ${f.message} / ${f.readError ?? ""}`.trim()
      : `Save failed. Your edits are kept. ${f.message}`;
    banners.push({ kind: "error", text, actions: f.observed === "changed" ? ["reload", "retry"] : ["retry"] });
  }
  if (i.draftOffer) {
    const tail = i.draftOffer.conflict ? " The file has changed since then." : "";
    banners.push({ kind: "info", text: `An unsaved draft from ${i.draftOffer.savedAt} exists.${tail}`, actions: ["restore", "discardDraft"] });
  }
  if (i.draftError) banners.push({ kind: "warn", text: `Drafts cannot be saved: ${i.draftError}`, actions: [] });
  return { title: d.path.split(/[\\/]/).pop() ?? d.path, dirty: isDirty(d), banners };
}
