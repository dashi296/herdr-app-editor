// Every name the mods share, from one place (plan §1: renaming means changing this and rebuilding).
// Host mod names allow ASCII letters, digits, '-' and '_' only (src/mods.rs valid_name).
export const NS = "editor";
export const MOD_EDITOR = "editor";
export const MOD_FILES = "editor-files";
export const MOD_UNINSTALL = "editor-uninstall";
export const SHARED_KEY = NS;

export function isValidModName(name: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(name);
}
