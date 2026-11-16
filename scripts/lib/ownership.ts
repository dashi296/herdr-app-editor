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

/** Every file under the targets, including names Herdr would generate. */
export function listFiles(home: string, targets: string[]): string[] {
  return targets.flatMap((t) => walk(home, t));
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Relative path → sha256 of every file under the targets, except files Herdr generates. */
export function hashTargets(home: string, targets: string[], include: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of targets) for (const rel of walk(home, t)) if (!generated(rel) || rel in include) out[rel] = sha256(join(home, rel));
  return out;
}

/** Differences that mean someone else changed the installed files: "changed: <path>" / "added: <path>". */
export function verifyOwned(home: string, targets: string[], hashes: Record<string, string>): string[] {
  const now = hashTargets(home, targets, hashes);
  const problems: string[] = [];
  for (const [rel, hash] of Object.entries(now)) {
    if (!(rel in hashes)) problems.push(`added: ${relative(".", rel)}`);
    else if (hashes[rel] !== hash) problems.push(`changed: ${rel}`);
  }
  return problems.sort();
}
