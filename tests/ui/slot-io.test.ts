// HerdrSlotIO against a real temporary folder standing in for appHome() (files live in data/<ns>/).
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NS } from "../../src/core/names";
import { SlotStore } from "../../src/ports/slot-store";
import { host, install, reset } from "./host";

install();
const { HerdrSlotIO } = await import("../../src/adapters/herdr/slot-io");

let home: string;
const root = () => join(home, "data", NS);

beforeEach(async () => {
  reset();
  home = await mkdtemp(join(tmpdir(), "slot-io-"));
  host.appHome = home;
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

test("files live under appHome()/data/<ns>/, and missing parent folders are created", async () => {
  const io = new HerdrSlotIO();
  await io.write("drafts/abc/k1.a.json", "x");
  expect(await Bun.file(join(root(), "drafts/abc/k1.a.json")).text()).toBe("x");
  expect(await io.read("drafts/abc/k1.a.json")).toBe("x");
});

test("a missing file reads as null and unlinks without an error", async () => {
  const io = new HerdrSlotIO();
  expect(await io.read("nope.json")).toBeNull();
  await io.unlink("nope.json");
  await io.write("a.json", "1");
  await io.unlink("a.json");
  expect(await io.read("a.json")).toBeNull();
});

test("list returns file names, or nothing for a missing folder", async () => {
  const io = new HerdrSlotIO();
  expect(await io.list("drafts")).toEqual([]);
  await io.write("drafts/b.a.json", "");
  await io.write("drafts/a.b.json", "");
  expect((await io.list("drafts")).sort()).toEqual(["a.b.json", "b.a.json"]);
});

test("removeDirIfEmpty removes only an empty folder and never throws", async () => {
  const io = new HerdrSlotIO();
  await io.write("drafts/full/x.a.json", "1");
  await io.write("drafts/empty/y.a.json", "1");
  await io.unlink("drafts/empty/y.a.json");

  await io.removeDirIfEmpty("drafts/full");
  await io.removeDirIfEmpty("drafts/empty");
  await io.removeDirIfEmpty("drafts/missing");
  expect(await readdir(join(root(), "drafts"))).toEqual(["full"]);
});

test("SlotStore on top of it: save, load and remove leave no empty draft folder", async () => {
  const store = new SlotStore(new HerdrSlotIO());
  await store.save("drafts/h1/k1", { text: "a" });
  await store.save("drafts/h1/k1", { text: "b" });
  expect(await store.load<{ text: string }>("drafts/h1/k1")).toEqual({ text: "b" });
  expect(await store.owners("drafts/h1")).toEqual(["k1"]);

  await store.remove("drafts/h1/k1");
  expect(await store.load("drafts/h1/k1")).toBeNull();
  expect(await stat(join(root(), "drafts/h1")).catch(() => null)).toBeNull();
});
