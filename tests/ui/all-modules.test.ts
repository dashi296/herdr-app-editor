// Imports every module under src so that `bun test --coverage` lists files no test uses yet
// (bun reports only the files a test loaded).
import { expect, test } from "bun:test";
import { join } from "node:path";
import { install } from "./host";

install();
const SRC = join(import.meta.dir, "..", "..", "src");

test("every module under src loads", async () => {
  const files = [...new Bun.Glob("**/*.{ts,js}").scanSync(SRC)];
  expect(files.length).toBeGreaterThan(20);
  for (const f of files) await import(join(SRC, f));
});
