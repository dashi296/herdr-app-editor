// HerdrImageStore against a real temporary folder standing in for appHome(), with exec running
// the real `test`, `ln` and `rm`.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { lstat, mkdtemp, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NS } from "../../src/core/names";
import { host, install, reset } from "./host";

install();
const { HerdrImageStore } = await import("../../src/adapters/herdr/image-store");

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

test("release of a pane that never showed an image does nothing", async () => {
  await new HerdrImageStore().release("never");
});

test("an unsafe pane key is refused before anything is touched", async () => {
  await expect(new HerdrImageStore().expose(join(outside, "a.png"), "../x")).rejects.toThrow("unsafe store name");
});
