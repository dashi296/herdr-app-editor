// Text search: the git grep / grep arguments and reading their output into hits. Pure.
import { expect, test } from "bun:test";
import * as S from "../../src/core/search/search";

test("smart case", () => {
  expect(S.ignoreCase("foo")).toBe(true);
  expect(S.ignoreCase("Foo")).toBe(false);
  expect(S.ignoreCase("12")).toBe(true);
});
test("git grep args", () => {
  expect(S.gitGrepArgs("foo")).toEqual([
    "grep",
    "-n",
    "-I",
    "--column",
    "--no-color",
    "--untracked",
    "-F",
    "-i",
    "-e",
    "foo",
  ]);
  expect(S.gitGrepArgs("Foo")).toEqual([
    "grep",
    "-n",
    "-I",
    "--column",
    "--no-color",
    "--untracked",
    "-F",
    "-e",
    "Foo",
  ]);
});
test("grep args", () => {
  expect(S.grepArgs("-x")).toEqual([
    "-rnI",
    "-F",
    "-i",
    "--exclude-dir=.git",
    "--exclude-dir=node_modules",
    "-e",
    "-x",
    ".",
  ]);
});
test("byte column to UTF-16 column", () => {
  expect(S.byteToUtf16Col("あいう foo", 11)).toBe(5);
  expect(S.byteToUtf16Col("😀 foo", 6)).toBe(4);
  expect(S.byteToUtf16Col("foo", 1)).toBe(1);
});
test("parseGitGrep", () => {
  const out = "src/a.ts:3:21:  const あいう = foo;\nb.txt:1:1:foo\n";
  expect(S.parseGitGrep(out, "foo").hits).toEqual([
    { path: "src/a.ts", line: 3, col: 15, len: 3, text: "const あいう = foo;" },
    { path: "b.txt", line: 1, col: 1, len: 3, text: "foo" },
  ]);
});
test("a path containing a colon still parses (git grep)", () => {
  expect(S.parseGitGrep("a:b.txt:2:1:foo\n", "foo").hits[0]).toMatchObject({ path: "a:b.txt", line: 2 });
});
test("a cut-off last line is dropped", () => {
  expect(S.parseGitGrep("a.ts:1:1:foo\nb.ts:2:1:fo", "foo").hits.map((h) => h.path)).toEqual(["a.ts"]);
});
test("parseGrep strips ./ and finds the column case-insensitively", () => {
  expect(S.parseGrep("./d/x.md:7:Hello FOO bar\n", "foo").hits).toEqual([
    { path: "d/x.md", line: 7, col: 7, len: 3, text: "Hello FOO bar" },
  ]);
});
test("hits are capped at HIT_LIMIT", () => {
  const out = Array.from({ length: S.HIT_LIMIT + 5 }, (_, i) => `f.ts:${i + 1}:1:foo\n`).join("");
  const r = S.parseGitGrep(out, "foo");
  expect(r.hits).toHaveLength(S.HIT_LIMIT);
  expect(r.truncated).toBe(true);
});
test("long lines are cut for display", () => {
  const r = S.parseGitGrep(`f.ts:1:1:foo${"x".repeat(500)}\n`, "foo");
  expect(r.hits[0]!.text.length).toBe(S.LINE_SHOW);
});
test("CRLF output lines lose the \\r", () => {
  expect(S.parseGitGrep("f.ts:1:1:foo\r\n", "foo").hits[0]!.text).toBe("foo");
});
