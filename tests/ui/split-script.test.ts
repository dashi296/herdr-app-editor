// SPLIT_SCRIPT (src/ui/open-view.ts) run by a real sh with a fake herdr-app on PATH: the exit code,
// the arguments it passes through untouched, and that it splits only once the overlay is gone.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "./host";

install();
const { SPLIT_SCRIPT } = await import("../../src/ui/open-view");

let dir: string;
const log = () => (existsSync(join(dir, "log")) ? readFileSync(join(dir, "log"), "utf8").trim().split("\n") : []);
async function until(cond: () => boolean, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end && !cond();) await Bun.sleep(20);
}
/** A fake herdr-app: logs each call; `status` lists the overlay for the first `listed` calls. */
function fakeCli(listed: number) {
  const bin = join(dir, "bin");
  Bun.spawnSync(["mkdir", "-p", bin]);
  const cli = join(bin, "herdr-app");
  writeFileSync(
    cli,
    [
      "#!/bin/sh",
      `n=$(cat "${dir}/n" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "${dir}/n"`,
      `printf '%s\\t%s\\t%s\\n' "$HERDR_APP_HOME" "$1" "$3" >> "${dir}/log"`,
      `if [ "$1" = status ]; then if [ "$n" -le ${listed} ]; then echo '{ "overlays": [ "herdr-app-editor-open" ] }'; else echo '{ "overlays": [] }'; fi; fi`,
      "",
    ].join("\n"),
  );
  chmodSync(cli, 0o755);
  return bin;
}
const run = (path: string, args: string[]) =>
  Bun.spawnSync(["sh", "-c", SPLIT_SCRIPT, "sh", ...args], { env: { PATH: path, HOME: join(dir, "home") } });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "split-script-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(process.platform === "win32")("SPLIT_SCRIPT", () => {
  const json = `{"pane":"p1","props":{"file":"/w/it's $(echo x) \\"q\\".ts"}}`;

  test("exits 3 at once when herdr-app is neither on PATH nor in ~/.local/bin", () => {
    expect(run("/usr/bin:/bin", [json, "/app home", "herdr-app-editor-open"]).exitCode).toBe(3);
  });

  test("returns at once, waits while status lists the overlay, then splits with the arguments untouched", async () => {
    const bin = fakeCli(2);
    const r = run(`${bin}:/usr/bin:/bin`, [json, "/app home", "herdr-app-editor-open"]);
    expect(r.exitCode).toBe(0);
    await until(() => log().some((l) => l.includes("\tdo\t")));
    const lines = log();
    expect(lines.map((l) => l.split("\t")[1])).toEqual(["status", "status", "status", "do"]);
    expect(lines.at(-1)).toBe(`/app home\tdo\t${json}`);
  });

  test("splits after about 3 s even if status keeps listing the overlay", async () => {
    const bin = fakeCli(1_000);
    run(`${bin}:/usr/bin:/bin`, [json, "/app", "herdr-app-editor-open"]);
    await until(() => log().some((l) => l.includes("\tdo\t")), 10_000);
    expect(log().filter((l) => l.includes("\tstatus\t"))).toHaveLength(60);
  }, 15_000);
});
