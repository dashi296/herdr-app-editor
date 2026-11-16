// Example extension (not enabled by default: the editor must not change formatting on its own).
// Enable it by adding it to src/extensions/index.ts.
import { newlineOf, type Extension } from "../../core/extensions/registry";

export const ensureFinalNewline: Extension = {
  name: "ensure-final-newline",
  beforeSave: ({ text }) => (text === "" || text.endsWith("\n") ? undefined : { text: text + newlineOf(text) }),
};
