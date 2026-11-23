// Where drafts and pane state live, relative to the store root (appHome()/data/<ns>/). Plan §5.
// Drafts are found by (machine, path) with a readdir of one folder, so no shared index file exists.
import { fnv1a32 } from "../store/slots";

const SAFE = /^[A-Za-z0-9_-]+$/;

function safe(name: string): string {
  if (!SAFE.test(name)) throw new Error(`unsafe store name: ${JSON.stringify(name)}`);
  return name;
}

/** Folder holding every pane's draft of one file. */
export function draftDir(machine: string | null, path: string): string {
  return `drafts/${fnv1a32(`${machine ?? ""}\0${path}`)}`;
}

/** One pane's draft of one file (a slot base: `.a.json` / `.b.json` are appended). */
export function draftBase(machine: string | null, path: string, ownerKey: string): string {
  return `${draftDir(machine, path)}/${safe(ownerKey)}`;
}

/** A pane's own state (the file it shows now). */
export function paneBase(key: string): string {
  return `panes/${safe(key)}`;
}

export function slotFiles(base: string): { a: string; b: string } {
  return { a: `${base}.a.json`, b: `${base}.b.json` };
}

/** Folder of the links through which a pane shows images (ports/image-store.ts). */
export function imageDir(key: string): string {
  return `images/${safe(key)}`;
}
