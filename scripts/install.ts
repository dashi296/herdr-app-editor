// Installs the editor into the running Herdr's app home (plan §4 Step 5).
//   bun run scripts/build.ts && bun run scripts/install.ts [--no-switch] [--force]
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  LAYOUT,
  MODS,
  REPO,
  appHome,
  dataDir,
  exists,
  manifestPath,
  readManifest,
  status,
  switchLayout,
} from "./lib/herdr";
import { hashTargets, packageFiles, verifyOwned } from "./lib/ownership";

const home = appHome();
const st = status();
if (!st) {
  console.error("Herdr is not running. Start it, then run this again.");
  process.exit(1);
}

for (const m of MODS)
  if (!exists(join(REPO, "mods", m, "main.js"))) {
    console.error(`mods/${m} is not built. Run: bun run build`);
    process.exit(1);
  }

const targets = [...MODS.map((m) => `mods/${m}`), `layouts/${LAYOUT}.json`];
const previous = readManifest();
const ours = new Set(previous?.files ?? []);
const taken = targets.filter((t) => exists(join(home, t)) && !ours.has(t));
if (taken.length) {
  console.error(`Stopped: these already exist and were not installed by this script:\n  ${taken.join("\n  ")}`);
  console.error("Rename the mods with src/core/names.ts and rebuild, or remove those files yourself.");
  process.exit(1);
}
const force = process.argv.includes("--force");
if (previous && !previous.hashes && !force) {
  console.error("Stopped: the previous install has no file hashes, so changes to its files cannot be detected.");
  console.error(`Check ${targets.join(", ")} in the app home, then run again with --force.`);
  process.exit(1);
}
if (previous?.hashes && !force) {
  const changed = verifyOwned(home, previous.files, previous.hashes);
  if (changed.length) {
    console.error(
      `Stopped: installed files were changed since the last install and would be overwritten:\n  ${changed.join("\n  ")}`,
    );
    console.error("Back them up, then run again with --force.");
    process.exit(1);
  }
}

// File by file: files Herdr generated in the repo's mod folders (after `herdr-app check`) stay behind.
for (const rel of packageFiles(REPO, targets)) {
  mkdirSync(dirname(join(home, rel)), { recursive: true });
  cpSync(join(REPO, rel), join(home, rel));
}

const previousLayout = previous?.previousLayout ?? (st.layout && st.layout !== LAYOUT ? st.layout : "main");
mkdirSync(dataDir(), { recursive: true });
writeFileSync(
  manifestPath(),
  JSON.stringify(
    {
      installedAt: new Date().toISOString(),
      files: targets,
      previousLayout,
      hashes: hashTargets(home, targets),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Installed into ${home}:\n  ${targets.join("\n  ")}`);

if (!process.argv.includes("--no-switch")) {
  await Bun.sleep(1500); // let Herdr load the new layout file
  await switchLayout(LAYOUT);
  console.log(`Switched to the "${LAYOUT}" layout. scripts/uninstall.ts switches back to "${previousLayout}".`);
}
