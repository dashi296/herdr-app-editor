import { describe, expect, test } from "bun:test";
import { highlightFor, languageFor } from "../../src/core/language/language";

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

describe("highlightFor (spike S8: syntect re-parses the whole file on every edit)", () => {
  test("small files are highlighted", () => expect(highlightFor("a.ts", 30_000)).toEqual({ language: "js", off: false }));
  test("over 30 KB: plain text", () => expect(highlightFor("a.ts", 30_001)).toEqual({ language: "txt", off: true }));
  test("plain text is never reported as switched off", () => expect(highlightFor("a.txt", 900_000)).toEqual({ language: "txt", off: false }));
  test("the user can turn it back on for a large file", () => expect(highlightFor("a.ts", 900_000, { force: true })).toEqual({ language: "js", off: false }));
});
