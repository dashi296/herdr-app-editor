import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashTargets, packageFiles, verifyOwned } from "../../scripts/lib/ownership";

let home = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "own-"));
  mkdirSync(join(home, "mods/editor"), { recursive: true });
  mkdirSync(join(home, "layouts"), { recursive: true });
  writeFileSync(join(home, "mods/editor/main.js"), "code");
  writeFileSync(join(home, "mods/editor/mod.json"), "{}");
  writeFileSync(join(home, "layouts/editor.json"), "{}");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const targets = ["mods/editor", "layouts/editor.json"];

describe("ownership (review B5)", () => {
  test("unchanged files are ours", () => {
    expect(verifyOwned(home, targets, hashTargets(home, targets))).toEqual([]);
  });
  test("files Herdr writes into a mod folder are ignored", () => {
    const hashes = hashTargets(home, targets);
    writeFileSync(join(home, "mods/editor/jsconfig.json"), "{}");
    writeFileSync(join(home, "mods/editor/gpui-kit.d.ts"), "");
    writeFileSync(join(home, "mods/editor/.DS_Store"), "");
    expect(verifyOwned(home, targets, hashes)).toEqual([]);
  });
  test("other .d.ts files and dotfiles are user files (review B5 follow-up)", () => {
    const hashes = hashTargets(home, targets);
    writeFileSync(join(home, "mods/editor/custom.d.ts"), "");
    writeFileSync(join(home, "mods/editor/.env"), "SECRET=1");
    mkdirSync(join(home, "mods/editor/sub"));
    writeFileSync(join(home, "mods/editor/sub/jsconfig.json"), "{}");
    expect(verifyOwned(home, targets, hashes)).toEqual([
      "added: mods/editor/.env",
      "added: mods/editor/custom.d.ts",
      "added: mods/editor/sub/jsconfig.json",
    ]);
  });
  test("a generated name is never checked, even one an older install recorded", () => {
    // Installs before this fix copied and hashed them; Herdr rewrites them on an update.
    writeFileSync(join(home, "mods/editor/jsconfig.json"), '{"old":1}');
    const hashes = { ...hashTargets(home, targets), "mods/editor/jsconfig.json": "an old hash" };
    writeFileSync(join(home, "mods/editor/jsconfig.json"), "{}");
    expect(verifyOwned(home, targets, hashes)).toEqual([]);
  });
  test("package files leave out what Herdr generates", () => {
    writeFileSync(join(home, "mods/editor/jsconfig.json"), "{}");
    writeFileSync(join(home, "mods/editor/gpui-kit.d.ts"), "");
    expect(packageFiles(home, targets).sort()).toEqual([
      "layouts/editor.json",
      "mods/editor/main.js",
      "mods/editor/mod.json",
    ]);
  });
  test("a changed file is reported", () => {
    const hashes = hashTargets(home, targets);
    writeFileSync(join(home, "mods/editor/main.js"), "someone else's code");
    expect(verifyOwned(home, targets, hashes)).toEqual(["changed: mods/editor/main.js"]);
  });
  test("an added file is reported", () => {
    const hashes = hashTargets(home, targets);
    writeFileSync(join(home, "mods/editor/notes.md"), "mine");
    expect(verifyOwned(home, targets, hashes)).toEqual(["added: mods/editor/notes.md"]);
  });
  test("a replaced layout is reported", () => {
    const hashes = hashTargets(home, targets);
    writeFileSync(join(home, "layouts/editor.json"), '{"mine":true}');
    expect(verifyOwned(home, targets, hashes)).toEqual(["changed: layouts/editor.json"]);
  });
  test("a missing file is not a conflict (nothing to lose)", () => {
    const hashes = hashTargets(home, targets);
    rmSync(join(home, "mods/editor/mod.json"));
    expect(verifyOwned(home, targets, hashes)).toEqual([]);
  });
});
