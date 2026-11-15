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
