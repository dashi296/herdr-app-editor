// Which installed files are still exactly what install.ts wrote (review B5): reinstall and uninstall
// overwrite or delete only files whose content hash still matches the manifest.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Files Herdr writes at the root of a mod folder when it loads the mod (upstream src/mods.rs:318:
 * "gpui-kit.d.ts" | "jsconfig.json"), plus macOS .DS_Store. Anything else is a user file.
 */
function generated(rel: string): boolean {
  const parts = rel.split("/");
  if (parts[parts.length - 1] === ".DS_Store") return true;
  return parts.length === 3 && parts[0] === "mods" && (parts[2] === "gpui-kit.d.ts" || parts[2] === "jsconfig.json");
}

function walk(home: string, target: string): string[] {
  const abs = join(home, target);
  if (!existsSync(abs)) return [];
  if (!statSync(abs).isDirectory()) return [target];
  return readdirSync(abs, { recursive: true })
    .map((f) => join(target, String(f)).replace(/\\/g, "/")) // one separator on every OS
    .filter((rel) => statSync(join(home, rel)).isFile());
}

/**
 * The files of the package under the targets: everything except names Herdr generates. A mod folder
 * that `herdr-app check` loaded in the repo holds such files too; they are not part of the package.
 */
export function packageFiles(root: string, targets: string[]): string[] {
  return targets.flatMap((t) => walk(root, t)).filter((rel) => !generated(rel));
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * Relative path → sha256 of every file under the targets, except files Herdr generates. Those are
 * never checked, even when an older install recorded them: Herdr rewrites them on an update.
 */
export function hashTargets(home: string, targets: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of packageFiles(home, targets)) out[rel] = sha256(join(home, rel));
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
