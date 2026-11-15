// File extension → syntax name for EditorState. The host's syntect set has no TS or TOML,
// so they map to the closest grammar, as the shipped Files mod does (defaults/mods/files/main.js:13).

const ALIASES: Record<string, string> = {
  ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js", js: "js",
  json: "json", jsonc: "json",
  rs: "rs", py: "py",
  yaml: "yaml", yml: "yaml", toml: "yaml",
  md: "md", markdown: "md",
  html: "html", htm: "html", svelte: "html", vue: "html", css: "css",
  sh: "sh", bash: "sh", zsh: "sh",
  go: "go", c: "c", h: "c", cpp: "cpp", hpp: "cpp", java: "java", rb: "rb", sql: "sql", xml: "xml",
};

/** Syntax name for a path; "txt" (plain text) when the extension is unknown or absent. */
export function languageFor(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "txt";
  return ALIASES[name.slice(dot + 1).toLowerCase()] ?? "txt";
}

/**
 * Highlighting re-parses the whole document on every edit (syntax.rs; spike S8: 50 KB slight lag,
 * 400 KB clearly slow, 1 MiB heavy; plain text stays fast). Larger files open as plain text.
 */
export const HIGHLIGHT_LIMIT = 100_000;

/** Syntax to use for a file of `length` UTF-16 units; `off` when highlighting was switched off for size. `force`: the user turned it back on. */
export function highlightFor(path: string, length: number, opts: { force?: boolean } = {}): { language: string; off: boolean } {
  const language = languageFor(path);
  if (!opts.force && language !== "txt" && length > HIGHLIGHT_LIMIT) return { language: "txt", off: true };
  return { language, off: false };
}
