// Opening a file at a line: where in the editor's text a { line, col, len } request points. Pure.

/** A place in a file. `line` and `col` count from 1; `col` and `len` are UTF-16 units. */
export interface At {
  line: number;
  col?: number;
  len?: number;
}

const int = (v: unknown, min: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min;

/** Checks an `at` that arrived as JSON (a command or split props). */
export function parseAt(v: unknown): At | null {
  if (!v || typeof v !== "object") return null;
  const { line, col, len } = v as Record<string, unknown>;
  if (!int(line, 1)) return null;
  if (col !== undefined && !int(col, 1)) return null;
  if (len !== undefined && !int(len, 0)) return null;
  return { line, ...(col !== undefined ? { col } : {}), ...(len !== undefined ? { len } : {}) };
}

/**
 * The editor range for `at` in `text`. Lines split on "\n"; a trailing "\r" is not part of a line.
 * A line past the end means the last line; `col` and `len` stay within the line.
 */
export function rangeAt(text: string, at: At): { start: number; end: number } {
  let start = 0;
  for (let n = 1; n < at.line; n++) {
    const nl = text.indexOf("\n", start);
    if (nl < 0) break;
    start = nl + 1;
  }
  const nl = text.indexOf("\n", start);
  let lineEnd = nl < 0 ? text.length : nl;
  if (lineEnd > start && text.charCodeAt(lineEnd - 1) === 13) lineEnd--;
  const from = Math.min(start + (at.col ?? 1) - 1, lineEnd);
  const to = Math.min(from + (at.len ?? 0), lineEnd);
  return { start: from, end: to };
}
