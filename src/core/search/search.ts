// Text search: the git grep / grep arguments, and reading their output into hits. Pure.
// The match is literal (-F). Smart case: a query without uppercase letters ignores case.

/** Fewer characters than this do not start a search. */
export const MIN_QUERY = 2;
/** A search starts this long after typing stops. */
export const DEBOUNCE_MS = 250;
/** At most this many hits are kept. */
export const HIT_LIMIT = 500;
/** A hit's line is cut to this many characters for display. */
export const LINE_SHOW = 200;

export interface Hit {
  /** Relative to the searched folder. */
  path: string;
  line: number;
  /** 1-based UTF-16 column of the match in the full line. */
  col: number;
  /** The query's UTF-16 length. */
  len: number;
  /** The line, trimmed and cut to LINE_SHOW. */
  text: string;
}

export interface Hits {
  hits: Hit[];
  /** There were more than HIT_LIMIT. */
  truncated: boolean;
}

export const ignoreCase = (q: string): boolean => q === q.toLowerCase();

const caseFlag = (q: string) => (ignoreCase(q) ? ["-i"] : []);

export function gitGrepArgs(q: string): string[] {
  return ["grep", "-n", "-I", "--column", "--no-color", "--untracked", "-F", ...caseFlag(q), "-e", q];
}

export function grepArgs(q: string): string[] {
  return ["-rnI", "-F", ...caseFlag(q), "--exclude-dir=.git", "--exclude-dir=node_modules", "-e", q, "."];
}

/** git grep's 1-based byte column as a 1-based UTF-16 column of `line`. */
export function byteToUtf16Col(line: string, byteCol: number): number {
  let bytes = 0,
    units = 0;
  for (const ch of line) {
    if (bytes >= byteCol - 1) break;
    const cp = ch.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    units += ch.length;
  }
  return units + 1;
}

/** Complete output lines only: a last line without "\n" was cut short (timeout or output cap). */
function completeLines(stdout: string): string[] {
  const end = stdout.lastIndexOf("\n");
  return end < 0 ? [] : stdout.slice(0, end).split("\n");
}

const show = (line: string) => line.trim().slice(0, LINE_SHOW);
const stripCr = (s: string) => (s.endsWith("\r") ? s.slice(0, -1) : s);

function collect(stdout: string, read: (line: string) => Hit | null): Hits {
  const hits: Hit[] = [];
  let truncated = false;
  for (const raw of completeLines(stdout)) {
    const hit = read(raw);
    if (!hit) continue;
    if (hits.length === HIT_LIMIT) {
      truncated = true;
      break;
    }
    hits.push(hit);
  }
  return { hits, truncated };
}

/** `git grep -n --column` output: `path:line:bytecol:text`. */
export function parseGitGrep(stdout: string, q: string): Hits {
  return collect(stdout, (raw) => {
    const m = /^(.*?):(\d+):(\d+):(.*)$/s.exec(raw);
    if (!m) return null;
    const text = stripCr(m[4]!);
    return {
      path: m[1]!,
      line: Number(m[2]),
      col: byteToUtf16Col(text, Number(m[3])),
      len: q.length,
      text: show(text),
    };
  });
}

/** `grep -rn` output: `./path:line:text`. The column is the first match of `q` in the line. */
export function parseGrep(stdout: string, q: string): Hits {
  const fold = ignoreCase(q);
  return collect(stdout, (raw) => {
    const m = /^(.*?):(\d+):(.*)$/s.exec(raw);
    if (!m) return null;
    const text = stripCr(m[3]!);
    const at = (fold ? text.toLowerCase() : text).indexOf(q);
    const path = m[1]!.startsWith("./") ? m[1]!.slice(2) : m[1]!;
    return { path, line: Number(m[2]), col: at < 0 ? 1 : at + 1, len: q.length, text: show(text) };
  });
}
