import { describe, expect, test } from "bun:test";
import { languageFor } from "../../src/core/language/language";

describe("languageFor (P0 extensions)", () => {
  const cases: [string, string][] = [
    ["src/a.ts", "js"], ["a.tsx", "js"], ["a.mts", "js"], ["a.cts", "js"],
    ["a.js", "js"], ["a.jsx", "js"], ["a.mjs", "js"], ["a.cjs", "js"],
    ["a.json", "json"], ["tsconfig.jsonc", "json"],
    ["main.rs", "rs"], ["a.py", "py"], ["a.yaml", "yaml"], ["a.yml", "yaml"],
    ["Cargo.toml", "yaml"], ["README.md", "md"],
  ];
  for (const [path, lang] of cases) test(`${path} → ${lang}`, () => expect(languageFor(path)).toBe(lang));

  test("extension match ignores case", () => expect(languageFor("A.TS")).toBe("js"));
  test("unknown extension is plain text", () => expect(languageFor("data.weird")).toBe("txt"));
  test("no extension is plain text", () => expect(languageFor("Makefile.d/LICENSE")).toBe("txt"));
  test("dotfile without extension is plain text", () => expect(languageFor(".env")).toBe("txt"));
  test("dot in a folder name is not an extension", () => expect(languageFor("a.b/c")).toBe("txt"));
});
