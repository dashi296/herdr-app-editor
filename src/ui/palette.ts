// Theme colors the editor and the quick open overlay draw with, by Herdr theme name.
import { theme } from "herdr";

export type Hex = `#${string}`;
const PALETTE_KEYS = [
  "background",
  "foreground",
  "border",
  "dim",
  "muted",
  "accent",
  "blocked",
  "raised",
  "surface",
  "popover",
  "input",
  "hover",
] as const;
export type Palette = Record<(typeof PALETTE_KEYS)[number], Hex>;

/** Theme colors the editor uses, with fallbacks so a missing name never breaks rendering. */
export function palette(): Palette {
  const t = theme();
  const fg = (t.foreground ?? "#cccccc") as Hex;
  const out = {} as Palette;
  for (const k of PALETTE_KEYS)
    out[k] = (t[k] ?? (k === "background" || k === "surface" || k === "popover" ? "#1e1e1e" : fg)) as Hex;
  if (!t.input && t.border) out.input = t.border as Hex;
  if (!t.hover && t.raised) out.hover = t.raised as Hex;
  return out;
}
