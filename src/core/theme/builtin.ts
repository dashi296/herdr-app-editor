// Themes shipped in editor-themes/*.json, embedded into main.js at build time (plan §1).
// To add one: drop a JSON file there and list it here; the unit test validates every entry.
import dracula from "../../../editor-themes/dracula.json";
import githubLight from "../../../editor-themes/github-light.json";
import nord from "../../../editor-themes/nord.json";
import oneDark from "../../../editor-themes/one-dark.json";
import { validateTheme, type EditorTheme } from "./theme";

export const BUILTIN_THEMES: EditorTheme[] = [oneDark, dracula, githubLight, nord].map((raw) => {
  const r = validateTheme(raw);
  if (!r.ok) throw new Error(`invalid editor theme: ${r.errors.join("; ")}`);
  return r.theme;
});
