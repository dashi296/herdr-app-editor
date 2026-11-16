// Shared helpers for scripts/install.ts and scripts/uninstall.ts.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MOD_EDITOR, MOD_FILES, MOD_UNINSTALL, NS } from "../../src/core/names";

export const LAYOUT = "editor";
export const MODS = [MOD_EDITOR, MOD_FILES, MOD_UNINSTALL];
export const REPO = join(import.meta.dir, "..", "..");

/** The app home as Herdr resolves it: HERDR_APP_HOME, then XDG_CONFIG_HOME/herdr-app, then ~/.config/herdr-app. */
export function appHome(): string {
  if (process.env.HERDR_APP_HOME) return process.env.HERDR_APP_HOME;
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, "herdr-app");
  return join(homedir(), ".config", "herdr-app");
}

export const dataDir = () => join(appHome(), "data", NS);
export const manifestPath = () => join(dataDir(), "install.json");

export interface Manifest {
  installedAt: string;
  files: string[];
  previousLayout: string;
  /** Relative path → sha256 of each installed file (absent in manifests written before review B5). */
  hashes?: Record<string, string>;
}

export function readManifest(): Manifest | null {
  try { return JSON.parse(readFileSync(manifestPath(), "utf8")); } catch { return null; }
}

function herdrApp(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(["herdr-app", ...args], { env: process.env });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

/** `herdr-app status` as JSON, or null when no window answers (Herdr not running). */
export function status(): { layout?: string; errors?: unknown[] } | null {
  const r = herdrApp(["status"]);
  if (r.code !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

/** Runs an app command; throws on an error reply. */
export function run(command: string, args: Record<string, unknown> = {}): unknown {
  const r = herdrApp(["do", command, JSON.stringify(args)]);
  let reply: { error?: string } = {};
  try { reply = JSON.parse(r.stdout || "{}"); } catch { /* not JSON */ }
  if (r.code !== 0 || reply.error) throw new Error(`herdr-app do ${command} failed: ${reply.error ?? r.stderr ?? r.stdout}`);
  return reply;
}

/** Switches the layout and checks that it took effect (an unknown name is ignored silently: src/window.rs). */
export async function switchLayout(name: string): Promise<void> {
  run("layout.switch", { name });
  for (let i = 0; i < 20; i++) {
    if (status()?.layout === name) return;
    await Bun.sleep(100);
  }
  throw new Error(`layout did not switch to ${name}`);
}

export const exists = (p: string) => existsSync(p);
