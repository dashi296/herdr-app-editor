import { describe, expect, test } from "bun:test";
import { BUILTIN_THEMES } from "../../src/core/theme/builtin";
import { HERDR_THEME, nextTheme, pickTheme, resolveSyntax, SYNTAX_KEYS, themeNames, validateTheme } from "../../src/core/theme/theme";

const herdrColors = { ansi1: "#ff0000", ansi2: "#00ff00", ansi3: "#ffff00", ansi4: "#0000ff", ansi5: "#ff00ff", ansi6: "#00ffff", dim: "#888888", foreground: "#cccccc" };

describe("validateTheme", () => {
  test("every built-in theme is valid and complete", () => {
    expect(BUILTIN_THEMES.map((t) => t.name)).toEqual(["One Dark", "Dracula", "GitHub Light", "Nord"]);
    for (const t of BUILTIN_THEMES) expect(Object.keys(t.syntax).sort()).toEqual([...SYNTAX_KEYS].sort());
  });
  test("rejects unknown categories, bad colors and missing names", () => {
    const r = validateTheme({ name: "", appearance: "dim", syntax: { keyword: "red", nope: "#000000" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual([
      "name must be a non-empty string",
      'appearance must be "dark" or "light"',
      'syntax.keyword must be a #rrggbb color, got "red"',
      "syntax.nope is not a syntax category",
    ]);
  });
  test("a partial theme is valid: missing categories fall back to Herdr's colors", () => {
    const r = validateTheme({ name: "Mini", appearance: "dark", syntax: { keyword: "#112233" } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(resolveSyntax(r.theme, herdrColors).keyword).toBe("#112233");
    if (r.ok) expect(resolveSyntax(r.theme, herdrColors).string).toBe("#00ff00");
  });
});

describe("resolveSyntax", () => {
  test("the Herdr theme follows the app's terminal palette", () => {
    expect(resolveSyntax(null, herdrColors)).toMatchObject({ keyword: "#ff00ff", string: "#00ff00", comment: "#888888", function: "#0000ff" });
  });
});

describe("nextTheme", () => {
  test("cycles Herdr → built-ins → Herdr", () => {
    const names = [HERDR_THEME, ...BUILTIN_THEMES.map((t) => t.name)];
    expect(nextTheme(HERDR_THEME, names)).toBe("One Dark");
    expect(nextTheme("Nord", names)).toBe(HERDR_THEME);
    expect(nextTheme("removed theme", names)).toBe(HERDR_THEME);
  });
});

describe("themes follow the app's appearance (the editor background is Herdr's)", () => {
  test("only matching themes are offered", () => {
    expect(themeNames(BUILTIN_THEMES, true)).toEqual([HERDR_THEME, "One Dark", "Dracula", "Nord"]);
    expect(themeNames(BUILTIN_THEMES, false)).toEqual([HERDR_THEME, "GitHub Light"]);
  });
  test("a chosen theme that does not match falls back to Herdr", () => {
    expect(pickTheme(BUILTIN_THEMES, "GitHub Light", true)).toBeNull();
    expect(pickTheme(BUILTIN_THEMES, "GitHub Light", false)?.name).toBe("GitHub Light");
    expect(pickTheme(BUILTIN_THEMES, undefined, true)).toBeNull();
  });
});
