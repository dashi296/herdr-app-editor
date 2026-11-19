import { expect, test } from "bun:test";
import { LIST_LIMIT, SHOW_LIMIT, parseLines, parseNul, rankPaths } from "../../src/core/quick-open/match";

test("limits are the spec's values", () => {
  expect(LIST_LIMIT).toBe(20000);
  expect(SHOW_LIMIT).toBe(50);
});
test("parseNul drops the empty tail and stops at the limit", () => {
  expect(parseNul("a.ts\0b/c.ts\0", 10)).toEqual({ paths: ["a.ts", "b/c.ts"], truncated: false });
  expect(parseNul("a\0b\0c\0", 2)).toEqual({ paths: ["a", "b"], truncated: true });
});
test("parseLines strips ./ and blank lines", () => {
  expect(parseLines("./a.ts\n./b/c.ts\n\n", 10)).toEqual({ paths: ["a.ts", "b/c.ts"], truncated: false });
  expect(parseLines("./a\n./b\n./c\n", 2)).toEqual({ paths: ["a", "b"], truncated: true });
});
test("an empty query keeps the order and the limit", () => {
  expect(rankPaths(["b", "a", "c"], "", 2)).toEqual(["b", "a"]);
});
test("matches a subsequence, ignoring case", () => {
  expect(rankPaths(["src/main.rs", "README.md", "tests/main.rs"], "MainRS", 10)).toEqual([
    "src/main.rs",
    "tests/main.rs",
  ]);
});
test("a contiguous match in the file name ranks first, then a subsequence in the file name, then in the path", () => {
  const paths = ["main/x.ts", "src/m_a_i_n.ts", "lib/main.ts"];
  expect(rankPaths(paths, "main", 10)).toEqual(["lib/main.ts", "src/m_a_i_n.ts", "main/x.ts"]);
});
test("ties go to the shorter path, then alphabetical", () => {
  expect(rankPaths(["b/a.ts", "a.ts", "c/a.ts"], "a.ts", 10)).toEqual(["a.ts", "b/a.ts", "c/a.ts"]);
});
test("the result stops at the limit", () => {
  expect(rankPaths(["a1", "a2", "a3"], "a", 2)).toHaveLength(2);
});
