// Line-ending and content checks. Pure: no host imports.

export type Eol = "none" | "lf" | "crlf" | "mixed";

/** What line endings a file uses when it is opened. A lone CR makes it "mixed". */
export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13 /* \r */) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else return "mixed";
    } else if (c === 10 /* \n */) lf++;
  }
  if (crlf && lf) return "mixed";
  if (crlf) return "crlf";
  if (lf) return "lf";
  return "none";
}

/**
 * The text to write for a file that was opened with `original` line endings.
 * The editor inserts LF on Enter even in CRLF documents (spike S2b), so a file that was
 * CRLF-only gets its lone LFs converted. Every other file is written as edited.
 */
export function prepareForSave(text: string, original: Eol): string {
  if (original !== "crlf") return text;
  return text.replace(/\r?\n/g, "\r\n");
}

export type TextClass = { kind: "text"; lossy?: true } | { kind: "binary" };

/**
 * Whether read text can be shown. NUL means binary. A remote read replaces invalid UTF-8
 * with U+FFFD (src/mods.rs read_remote), so U+FFFD there may mean lost bytes.
 */
export function classifyText(text: string, where: { remote: boolean }): TextClass {
  if (text.includes("\0")) return { kind: "binary" };
  if (where.remote && text.includes("�")) return { kind: "text", lossy: true };
  return { kind: "text" };
}
