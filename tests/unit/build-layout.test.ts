// The packages scripts/build.ts writes (#29): each herdr.dev listing folder holds only its own mods.
// Run `bun run build` first; CI does, and checks the output is committed.
import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const dirs = (p: string) =>
  readdirSync(join(ROOT, p), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

test("each package holds only its own mods", () => {
  expect(dirs("editor/mods")).toEqual(["herdr-app-editor", "herdr-app-editor-open"]);
  expect(dirs("files/mods")).toEqual(["herdr-app-editor-files"]);
});

test("no package folder has layouts/ and the root has no RECIPE.md, mods/ or layouts/", () => {
  for (const p of ["editor/layouts", "files/layouts", "RECIPE.md", "mods", "layouts"])
    expect(existsSync(join(ROOT, p))).toBe(false);
});

test("editor/keys.json binds cmd-o to the overlay", () => {
  expect(JSON.parse(readFileSync(join(ROOT, "editor/keys.json"), "utf8"))).toEqual({
    global: { "cmd-o": "mod.open:herdr-app-editor-open" },
  });
});

test("the Files fork keeps its notice and licenses", () => {
  const dir = join(ROOT, "files/mods/herdr-app-editor-files");
  expect(readFileSync(join(dir, "main.js"), "utf8").split("\n").slice(0, 10).join("\n")).toContain("Modified from");
  expect(existsSync(join(dir, "LICENSE"))).toBe(true);
  expect(existsSync(join(dir, "LICENSE-Lucide.txt"))).toBe(true);
});
