// Files shared by scripts/uninstall.ts and mods/editor-uninstall, relative to appHome()/data/<ns>/.
import type { CloseStep } from "./plan";

/** Written by the script; the mod acts only when it exists (opening the mod by hand does nothing). */
export const REQUEST_FILE = "uninstall-request.json";
/** An A/B slot record (core/store), so the script never reads a half-written result. */
export const RESULT_BASE = "uninstall-result";

export interface UninstallResult {
  nonce: string;
  status: "complete" | "incomplete" | "cancelled";
  closed: CloseStep[];
  remaining: string[];
  finishedAt: number;
}
