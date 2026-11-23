// HerdrImageStore against a real temporary folder standing in for appHome(), with exec running
// the real `test`, `ln` and `rm`.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { lstat, mkdtemp, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NS } from "../../src/core/names";
import { host, install, reset } from "./host";

install();
const { HerdrImageStore, FOREIGN_LINK_MAX_AGE_MS } = await import("../../src/adapters/herdr/image-store");

let home: string, outside: string;
const dir = (key: string) => join(home, "data", NS, "images", key);

beforeEach(async () => {
  reset();
  home = await mkdtemp(join(tmpdir(), "image-home-"));
  outside = await mkdtemp(join(tmpdir(), "image-src-"));
  host.appHome = home;
  host.exec = async (cmd, args) => {
    const p = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { code, stdout, stderr };
  };
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

test("expose links the file under data/<ns>/images/<key>/ and returns the path relative to the app home", async () => {
  const pic = join(outside, "a b.png");
  await writeFile(pic, "png");
  const store = new HerdrImageStore();
  const rel = await store.expose(pic, "k1");
  expect(rel.startsWith(`data/${NS}/images/k1/`)).toBe(true);
  expect((await lstat(join(home, rel))).isSymbolicLink()).toBe(true);
  expect(await readlink(join(home, rel))).toBe(pic);
});

test("every expose uses a new path and removes the pane's earlier link, not the file it pointed to", async () => {
  const a = join(outside, "a.png"),
    b = join(outside, "b.png");
  await writeFile(a, "a");
  await writeFile(b, "b");
  const store = new HerdrImageStore();
  const first = await store.expose(a, "k1");
  const second = await store.expose(a, "k1");
  const third = await store.expose(b, "k1");
  expect(new Set([first, second, third]).size).toBe(3);
  expect(await readdir(dir("k1"))).toEqual([third.split("/").pop()!]);
  expect(await Bun.file(a).text()).toBe("a");
});

test("panes do not remove each other's links", async () => {
  const a = join(outside, "a.png");
  await writeFile(a, "a");
  const store = new HerdrImageStore();
  await store.expose(a, "k1");
  await store.expose(a, "k2");
  await store.release("k2");
  expect((await readdir(dir("k1"))).length).toBe(1);
  expect(await readdir(dir("k2"))).toEqual([]);
});

test("a missing file and a folder are rejected, and no link is left", async () => {
  const store = new HerdrImageStore();
  await expect(store.expose(join(outside, "nope.png"), "k1")).rejects.toThrow("missing or unreadable");
  await expect(store.expose(outside, "k1")).rejects.toThrow("missing or unreadable");
  expect(await readdir(dir("k1"))).toEqual([]);
});

test("exposes started together run one after another: only the last link is left", async () => {
  const a = join(outside, "a.png"),
    b = join(outside, "b.png");
  await writeFile(a, "a");
  await writeFile(b, "b");
  const store = new HerdrImageStore();
  const [, , last] = await Promise.all([store.expose(a, "k1"), store.expose(b, "k1"), store.expose(a, "k1")]);
  expect(await readdir(dir("k1"))).toEqual([last.split("/").pop()!]);
});

test("a failed expose does not block the next one", async () => {
  const a = join(outside, "a.png");
  await writeFile(a, "a");
  const store = new HerdrImageStore();
  await expect(store.expose(join(outside, "nope.png"), "k1")).rejects.toThrow();
  expect((await store.expose(a, "k1")).startsWith(`data/${NS}/images/k1/`)).toBe(true);
});

test("a relative path is refused: its link would point inside the images folder", async () => {
  const store = new HerdrImageStore();
  await expect(store.expose("pictures/a.png", "k1")).rejects.toThrow("not an absolute path");
  await expect(store.expose("-s.png", "k1")).rejects.toThrow("not an absolute path");
});

test("a second store for the same pane leaves the first one's fresh link, and removes it once it is old", async () => {
  const a = join(outside, "a.png");
  await writeFile(a, "a");
  const shown = await new HerdrImageStore().expose(a, "k1");
  const other = new HerdrImageStore();
  await other.release("k1"); // the dropped copy closes
  expect(await readdir(dir("k1"))).toEqual([shown.split("/").pop()!]);

  const second = await other.expose(a, "k1");
  expect((await readdir(dir("k1"))).length).toBe(2);

  // A link left by an earlier run: named a minute ago, or not named by this code at all.
  const old = `${(Date.now() - FOREIGN_LINK_MAX_AGE_MS).toString(36)}-old`;
  await symlink(a, join(dir("k1"), old));
  await symlink(a, join(dir("k1"), "junk"));
  await other.release("k1");
  expect(await readdir(dir("k1"))).toEqual([shown.split("/").pop()!]);
  expect(second).not.toBe(shown);
});

test("release of a pane that never showed an image does nothing", async () => {
  await new HerdrImageStore().release("never");
});

test("an unsafe pane key is refused before anything is touched", async () => {
  await expect(new HerdrImageStore().expose(join(outside, "a.png"), "../x")).rejects.toThrow("unsafe store name");
});
