// A stand-in for the `herdr-app` CLI, driven by a JSON state file (FAKE_HERDR_STATE).
// Supports what scripts/lib/herdr.ts calls: `status` and `do <command> <json>`.
// `do mod.open` plays the uninstall mod: it answers the request file with `uninstallStatus`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { slotFiles } from "../../src/core/draft/paths";
import { NS } from "../../src/core/names";
import { planWrite } from "../../src/core/store/slots";
import { REQUEST_FILE, RESULT_BASE, type UninstallResult } from "../../src/core/uninstall/protocol";

export interface FakeState {
  running: boolean;
  layout: string;
  overlays: string[];
  uninstallStatus: UninstallResult["status"];
  remaining: string[];
  calls: string[][];
}

const statePath = process.env.FAKE_HERDR_STATE!;
const state: FakeState = JSON.parse(readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
state.calls.push(args);
const save = () => writeFileSync(statePath, JSON.stringify(state));

if (!state.running) {
  save();
  console.error("no window");
  process.exit(1);
}

if (args[0] === "status") {
  console.log(JSON.stringify({ layout: state.layout, overlays: state.overlays }));
} else if (args[0] === "do" && args[1] === "layout.switch") {
  state.layout = (JSON.parse(args[2] ?? "{}") as { name: string }).name;
  console.log("{}");
} else if (args[0] === "do" && args[1] === "mod.open") {
  const dir = join(process.env.HERDR_APP_HOME!, "data", NS);
  const { nonce } = JSON.parse(readFileSync(join(dir, REQUEST_FILE), "utf8")) as { nonce: string };
  const result: UninstallResult = {
    nonce,
    status: state.uninstallStatus,
    closed: [],
    remaining: state.remaining,
    finishedAt: Date.now(),
  };
  const files = slotFiles(join(dir, RESULT_BASE));
  const { target, record } = planWrite<UninstallResult>(null, null, result);
  writeFileSync(files[target], JSON.stringify(record));
  console.log("{}");
} else {
  console.log(JSON.stringify({ error: `unknown: ${args.join(" ")}` }));
}
save();
