// Removes the editor and returns to the layout used before installing (plan §4 Step 5, acceptance 5).
//   bun run scripts/uninstall.ts
import { readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { NS } from "../src/core/names";
import { slotFiles } from "../src/core/draft/paths";
import { pickCurrent } from "../src/core/store/slots";
import { REQUEST_FILE, RESULT_BASE, type UninstallResult } from "../src/core/uninstall/protocol";
import { LAYOUT, MODS, appHome, dataDir, exists, readManifest, run, status, switchLayout } from "./lib/herdr";

const home = appHome();
if (!status()) {
  console.error("Herdr is not running. Start it first: removing the mods while editor panes are saved would leave broken panes.");
  process.exit(1);
}
const manifest = readManifest();
const previousLayout = manifest?.previousLayout ?? "main";

// 1. Ask the uninstall mod to close every editor pane.
const dir = dataDir();
mkdirSync(dir, { recursive: true });
const result = slotFiles(join(dir, RESULT_BASE));
rmSync(result.a, { force: true });
rmSync(result.b, { force: true });
const nonce = crypto.randomUUID();
writeFileSync(join(dir, REQUEST_FILE), JSON.stringify({ nonce, at: Date.now() }));
run("mod.open", { name: "editor-uninstall" });
console.log("Closing editor panes… (answer the dialog in Herdr if it asks about spaces)");

const read = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
let outcome: UninstallResult | null = null;
for (let i = 0; i < 1800 && !outcome; i++) {
  const r = pickCurrent<UninstallResult>(read(result.a), read(result.b)).payload;
  if (r?.nonce === nonce) outcome = r;
  else await Bun.sleep(100);
}
if (!outcome) { console.error("No answer from the uninstall mod within 3 minutes. Nothing was removed."); process.exit(1); }
if (outcome.status !== "complete") {
  console.error(`Uninstall ${outcome.status}. Nothing was removed.${outcome.remaining.length ? ` Editor panes still open: ${outcome.remaining.join(", ")}` : ""}`);
  process.exit(1);
}

// 2. Back to the previous layout, verified.
if (status()?.layout === LAYOUT) await switchLayout(previousLayout === LAYOUT ? "main" : previousLayout);

// 3. Remove the files.
for (const m of MODS) rmSync(join(home, "mods", m), { recursive: true, force: true });
rmSync(join(home, "layouts", `${LAYOUT}.json`), { force: true });
for (const m of MODS) if (m !== NS) rmSync(join(home, "data", m), { recursive: true, force: true });

const draftsDir = join(dir, "drafts");
const draftFiles = exists(draftsDir) ? readdirSync(draftsDir, { recursive: true }).filter((f) => String(f).endsWith(".json")) : [];
if (draftFiles.length) {
  console.log(`Kept unsaved drafts in ${draftsDir} (${draftFiles.length} files). Delete that folder when you no longer need them.`);
  for (const f of readdirSync(dir)) if (f !== "drafts") rmSync(join(dir, f), { recursive: true, force: true });
} else {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`Removed the editor. Layout: ${status()?.layout}. The "${NS}" key in shared.json stays as null (Herdr has no API to delete it).`);
