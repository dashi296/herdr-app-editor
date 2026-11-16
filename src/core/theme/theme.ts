// Editor syntax themes as data (issue #1 P1). A theme maps the host's semantic syntax categories
// (vendor/gpui-kit/crates/shell/src/syntax.rs semantic_name) to colors. Pure.

export const SYNTAX_KEYS = [
  "keyword", "string", "string.escape", "comment", "function", "type",
  "number", "constant", "boolean", "variable", "operator", "punctuation",
] as const;
export type SyntaxKey = (typeof SYNTAX_KEYS)[number];
export type Hex = `#${string}`;

export interface EditorTheme {
  name: string;
  appearance: "dark" | "light";
  syntax: Partial<Record<SyntaxKey, Hex>>;
}

/** The default: colors taken from Herdr's own theme, so the editor follows the app (light or dark). */
export const HERDR_THEME = "Herdr";

const HEX = /^#[0-9a-fA-F]{6}$/;

export function validateTheme(input: unknown): { ok: true; theme: EditorTheme } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (typeof o.name !== "string" || !o.name.trim()) errors.push("name must be a non-empty string");
  if (o.appearance !== "dark" && o.appearance !== "light") errors.push('appearance must be "dark" or "light"');
  const syntax = (o.syntax && typeof o.syntax === "object" ? o.syntax : null) as Record<string, unknown> | null;
  if (!syntax) errors.push("syntax must be an object");
  for (const [k, v] of Object.entries(syntax ?? {})) {
    if (!(SYNTAX_KEYS as readonly string[]).includes(k)) errors.push(`syntax.${k} is not a syntax category`);
    else if (typeof v !== "string" || !HEX.test(v)) errors.push(`syntax.${k} must be a #rrggbb color, got ${JSON.stringify(v)}`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, theme: { name: o.name as string, appearance: o.appearance as "dark" | "light", syntax: syntax as EditorTheme["syntax"] } };
}

/** Colors for EditorState: the theme's, with Herdr's palette for anything it leaves out. */
export function resolveSyntax(theme: EditorTheme | null, herdr: Record<string, string>): Record<SyntaxKey, string> {
  const pick = (k: string) => herdr[k] ?? herdr.foreground ?? "#888888";
  const base: Record<SyntaxKey, string> = {
    keyword: pick("ansi5"), string: pick("ansi2"), "string.escape": pick("ansi6"), comment: pick("dim"),
    function: pick("ansi4"), type: pick("ansi3"), number: pick("ansi1"), constant: pick("ansi6"),
    boolean: pick("ansi1"), variable: pick("foreground"), operator: pick("ansi6"), punctuation: pick("foreground"),
  };
  return { ...base, ...(theme?.syntax ?? {}) };
}

/** The theme after `current` in `names`; unknown names go back to the first (Herdr). */
export function nextTheme(current: string, names: string[]): string {
  const i = names.indexOf(current);
  return names[i < 0 ? 0 : (i + 1) % names.length]!;
}

/**
 * Themes offered for the app's current appearance. The editor background comes from Herdr's theme
 * (EditorState only takes syntax colors), so a light theme on a dark app would be hard to read.
 */
export function themeNames(themes: EditorTheme[], dark: boolean): string[] {
  return [HERDR_THEME, ...themes.filter((t) => t.appearance === (dark ? "dark" : "light")).map((t) => t.name)];
}

/** The theme to apply: the chosen one if it matches the appearance, else null (Herdr's palette). */
export function pickTheme(themes: EditorTheme[], chosen: string | undefined, dark: boolean): EditorTheme | null {
  const t = themes.find((x) => x.name === chosen);
  return t && t.appearance === (dark ? "dark" : "light") ? t : null;
}
