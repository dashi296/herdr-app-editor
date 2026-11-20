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
    "-z",
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
    "-z",
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
  const out = "src/a.ts\x003\x0021\x00  const あいう = foo;\nb.txt\x001\x001\x00foo\n";
  expect(S.parseGitGrep(out, "foo").hits).toEqual([
    { path: "src/a.ts", line: 3, col: 15, len: 3, text: "const あいう = foo;" },
    { path: "b.txt", line: 1, col: 1, len: 3, text: "foo" },
  ]);
});
test("paths come unquoted: colons, non-ASCII and quotes (git grep -z)", () => {
  expect(S.parseGitGrep("a:1:2:b.txt\x002\x001\x00foo\n", "foo").hits[0]).toMatchObject({
    path: "a:1:2:b.txt",
    line: 2,
  });
  expect(S.parseGitGrep("日本 語.txt\x001\x003\x00x foo\n", "foo").hits[0]).toMatchObject({
    path: "日本 語.txt",
    col: 3,
  });
  expect(S.parseGitGrep('a"b.txt\x001\x001\x00foo\n', "foo").hits[0]!.path).toBe('a"b.txt');
});
test("a cut-off last line is dropped", () => {
  expect(S.parseGitGrep("a.ts\x001\x001\x00foo\nb.ts\x002\x001\x00fo", "foo").hits.map((h) => h.path)).toEqual([
    "a.ts",
  ]);
});
test("parseGrep strips ./ and finds the column case-insensitively", () => {
  expect(S.parseGrep("./d/x.md:7:Hello FOO bar\n", "foo").hits).toEqual([
    { path: "d/x.md", line: 7, col: 7, len: 3, text: "Hello FOO bar" },
  ]);
});
test("hits are capped at HIT_LIMIT", () => {
  const out = Array.from({ length: S.HIT_LIMIT + 5 }, (_, i) => `f.ts\x00${i + 1}\x001\x00foo\n`).join("");
  const r = S.parseGitGrep(out, "foo");
  expect(r.hits).toHaveLength(S.HIT_LIMIT);
  expect(r.truncated).toBe(true);
});
test("long lines are cut for display", () => {
  const r = S.parseGitGrep(`f.ts\x001\x001\x00foo${"x".repeat(500)}\n`, "foo");
  expect(r.hits[0]!.text.length).toBe(S.LINE_SHOW);
});
test("CRLF output lines lose the \\r", () => {
  expect(S.parseGitGrep("f.ts\x001\x001\x00foo\r\n", "foo").hits[0]!.text).toBe("foo");
});
