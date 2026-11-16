// Extension points (issue #1 P2): onFileOpen, beforeSave and themes. Extensions are plain objects
// registered at build time (src/extensions/index.ts); there is no dynamic loader (issue #1: not required).
// Pure: hooks get data, return data, and never touch the host.
import { detectEol } from "../text/text";
import { validateTheme, type EditorTheme } from "../theme/theme";

export interface OpenedFile { path: string; machine: string | null; text: string; language: string }
export interface SavingFile { path: string; machine: string | null; text: string }

export type OpenResult = { language?: string; readonly?: string } | void | undefined;
export type SaveResult = { text: string } | { cancel: string } | void | undefined;
type MaybePromise<T> = T | Promise<T>;

export interface Extension {
  /** Shown in messages. */
  name: string;
  /** May choose the syntax and make the file read-only (with the reason shown in a banner). */
  onFileOpen?: (file: OpenedFile) => MaybePromise<OpenResult>;
  /** May rewrite the text about to be written (a formatter), or cancel the save with a reason. */
  beforeSave?: (file: SavingFile) => MaybePromise<SaveResult>;
  /** Extra syntax themes (validated like editor-themes/*.json). */
  themes?: EditorTheme[];
}

export interface Registry {
  fileOpened(file: OpenedFile): Promise<{ language: string; readonly: string | null; messages: string[] }>;
  beforeSave(file: SavingFile): Promise<{ ok: true; text: string } | { ok: false; reason: string }>;
  themes(builtin: EditorTheme[]): { themes: EditorTheme[]; messages: string[] };
}

export function createRegistry(extensions: Extension[]): Registry {
  return {
    async fileOpened(file) {
      let language = file.language;
      let readonly: string | null = null;
      const messages: string[] = [];
      for (const ext of extensions) {
        if (!ext.onFileOpen) continue;
        try {
          const r = await ext.onFileOpen({ ...file, language });
          if (r?.language) language = r.language;
          if (r?.readonly && !readonly) readonly = r.readonly;
        } catch (e) { messages.push(`${ext.name}: ${String(e)}`); }
      }
      return { language, readonly, messages };
    },

    // Hooks run in order on the text that would be written. Any failure cancels the whole save:
    // writing half-transformed text would be worse than not saving.
    async beforeSave(file) {
      let text = file.text;
      for (const ext of extensions) {
        if (!ext.beforeSave) continue;
        let r: SaveResult;
        try { r = await ext.beforeSave({ ...file, text }); }
        catch (e) { return { ok: false, reason: `${ext.name} failed: ${String(e)}` }; }
        if (r === undefined || r === null) continue;
        if (typeof r !== "object") return { ok: false, reason: `${ext.name} returned invalid text` };
        if ("cancel" in r) return { ok: false, reason: `${ext.name}: ${String(r.cancel)}` };
        if (typeof r.text !== "string") return { ok: false, reason: `${ext.name} returned invalid text` };
        text = r.text;
      }
      return { ok: true, text };
    },

    themes(builtin) {
      const themes = [...builtin];
      const messages: string[] = [];
      for (const ext of extensions) {
        (ext.themes ?? []).forEach((raw, i) => {
          const r = validateTheme(raw);
          if (!r.ok) { messages.push(`${ext.name}: theme #${i + 1}: ${r.errors.join("; ")}`); return; }
          if (themes.some((t) => t.name === r.theme.name)) { messages.push(`${ext.name}: theme "${r.theme.name}" already exists`); return; }
          themes.push(r.theme);
        });
      }
      return { themes, messages };
    },
  };
}

/** Line ending to use when an extension adds lines: the file's own, LF when it has none. */
export function newlineOf(text: string): "\n" | "\r\n" {
  return detectEol(text) === "crlf" ? "\r\n" : "\n";
}
