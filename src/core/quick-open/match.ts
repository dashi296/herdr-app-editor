// Quick open (#29): reading a folder's file list and ranking it against what the person typed. Pure.

/** At most this many paths are read from a folder. */
export const LIST_LIMIT = 20000;
/** At most this many rows are shown. */
export const SHOW_LIMIT = 50;

export interface FileList {
  paths: string[];
  /** The folder had more files than the limit. */
  truncated: boolean;
}

function take(items: string[], limit: number): FileList {
  return { paths: items.slice(0, limit), truncated: items.length > limit };
}

/** `git ls-files -z` output: NUL-separated paths. */
export function parseNul(stdout: string, limit: number): FileList {
  return take(
    stdout.split("\0").filter((p) => p !== ""),
    limit,
  );
}

/** `find . … -print0` output: NUL-separated `./path`s (a newline inside a name stays in it). */
export function parseFind(stdout: string, limit: number): FileList {
  return take(
    stdout
      .split("\0")
      .filter((p) => p !== "")
      .map((p) => (p.startsWith("./") ? p.slice(2) : p)),
    limit,
  );
}

function isSubsequence(query: string, text: string): boolean {
  let i = 0;
  for (const c of text) if (c === query[i] && ++i === query.length) return true;
  return query.length === 0;
}

/** 0: the file name contains the query; 1: the file name contains its letters in order;
 *  2: the path does; null: no match. */
function tier(path: string, query: string): number | null {
  const lower = path.toLowerCase();
  const name = lower.slice(lower.lastIndexOf("/") + 1);
  if (name.includes(query)) return 0;
  if (isSubsequence(query, name)) return 1;
  if (isSubsequence(query, lower)) return 2;
  return null;
}

/** The paths that match `query` (case-insensitive), best first, at most `limit`.
 *  An empty query keeps the given order. */
export function rankPaths(paths: string[], query: string, limit: number): string[] {
  const q = query.toLowerCase();
  if (q === "") return paths.slice(0, limit);
  const scored: { path: string; tier: number }[] = [];
  for (const path of paths) {
    const t = tier(path, q);
    if (t !== null) scored.push({ path, tier: t });
  }
  scored.sort(
    (a, b) => a.tier - b.tier || a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
  return scored.slice(0, limit).map((s) => s.path);
}
