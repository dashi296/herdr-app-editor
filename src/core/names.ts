// Every name the mods share, from one place. Renaming means changing this file and rebuilding:
// the names are compiled into command targets (`<mod>.open`), the shared key and asset paths, so
// renaming only the folders (as herdr.dev install instructions do on a clash) would break them.
// Host mod names allow ASCII letters, digits, '-' and '_' only (src/mods.rs valid_name).
export const NS = "herdr-editor";
export const MOD_EDITOR = "herdr-editor";
export const MOD_FILES = "herdr-editor-files";
export const MOD_UNINSTALL = "herdr-editor-uninstall";
export const LAYOUT_NAME = "herdr-editor";
export const SHARED_KEY = NS;

export function isValidModName(name: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(name);
}
