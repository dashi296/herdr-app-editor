import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashTargets, verifyOwned } from "../../scripts/lib/ownership";

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
