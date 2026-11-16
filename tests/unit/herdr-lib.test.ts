import { afterEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { appHome, dataDir, manifestPath } from "../../scripts/lib/herdr";
import { NS } from "../../src/core/names";

const saved = { HERDR_APP_HOME: process.env.HERDR_APP_HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("appHome", () => {
  test("HERDR_APP_HOME wins, then XDG_CONFIG_HOME/herdr-app, then ~/.config/herdr-app", () => {
    process.env.HERDR_APP_HOME = "/h";
    process.env.XDG_CONFIG_HOME = "/x";
    expect(appHome()).toBe("/h");
    delete process.env.HERDR_APP_HOME;
    expect(appHome()).toBe(join("/x", "herdr-app"));
    delete process.env.XDG_CONFIG_HOME;
    expect(appHome()).toBe(join(homedir(), ".config", "herdr-app"));
  });

  test("the install record lives in the editor's data folder", () => {
    process.env.HERDR_APP_HOME = "/h";
    expect(dataDir()).toBe(join("/h", "data", NS));
    expect(manifestPath()).toBe(join("/h", "data", NS, "install.json"));
  });
});
