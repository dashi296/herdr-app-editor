// Which installed files are still exactly what install.ts wrote (review B5): reinstall and uninstall
// overwrite or delete only files whose content hash still matches the manifest.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Files Herdr itself writes into a mod folder on load (src/mods.rs), plus OS clutter. */
function generated(rel: string): boolean {
  const name = rel.split("/").pop() ?? "";
  return name === "jsconfig.json" || name.endsWith(".d.ts") || name.startsWith(".");
}

function walk(home: string, target: string): string[] {
  const abs = join(home, target);
  if (!existsSync(abs)) return [];
  if (!statSync(abs).isDirectory()) return [target];
  return readdirSync(abs, { recursive: true })
    .map((f) => join(target, String(f)))
    .filter((rel) => statSync(join(home, rel)).isFile());
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Relative path → sha256 of every file under the targets, except files Herdr generates. */
export function hashTargets(home: string, targets: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of targets) for (const rel of walk(home, t)) if (!generated(rel)) out[rel] = sha256(join(home, rel));
  return out;
}

/** Differences that mean someone else changed the installed files: "changed: <path>" / "added: <path>". */
export function verifyOwned(home: string, targets: string[], hashes: Record<string, string>): string[] {
  const now = hashTargets(home, targets);
  const problems: string[] = [];
  for (const [rel, hash] of Object.entries(now)) {
    if (!(rel in hashes)) problems.push(`added: ${relative(".", rel)}`);
    else if (hashes[rel] !== hash) problems.push(`changed: ${rel}`);
  }
  return problems.sort();
}
