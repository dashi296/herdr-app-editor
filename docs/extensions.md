# Extensions

The editor has three extension points (issue #1 P2). Extensions are plain TypeScript objects compiled into `mods/herdr-editor/main.js`; there is no runtime loader. Herdr has no "mods of mods" mechanism.

```ts
import type { Extension } from "../core/extensions/registry";

export const myExtension: Extension = {
  name: "my-extension",
  // Choose the syntax or make the file read-only (the reason is shown in a banner).
  onFileOpen: ({ path, text, language }) => (path.endsWith(".lock") ? { readonly: "lock files are generated" } : undefined),
  // Rewrite the text about to be written (a formatter), or cancel the save.
  beforeSave: ({ path, text }) => (text.includes("\t") ? { cancel: "tabs are not allowed" } : undefined),
  // Extra syntax themes, validated like editor-themes/*.json.
  themes: [{ name: "Solarized Dark", appearance: "dark", syntax: { keyword: "#859900", string: "#2aa198" } }],
};
```

Enable an extension by adding it to `EXTENSIONS` in `src/extensions/index.ts`, then run `bun run install:herdr`. The list is empty by default, so files are saved exactly as edited.

## Rules

- Extensions live in `src/extensions/` and may import only `src/core/` (enforced by dependency-cruiser). They receive data and return data. They cannot call Herdr APIs, run programs or touch files. A formatter that needs a program (for example Prettier through `exec`) needs an adapter-backed extension point first. The `beforeSave` signature already allows async work.
- `beforeSave` hooks run in list order on the text that would be written, after line endings are normalized. If a hook cancels, throws or returns something other than text, the save is cancelled and the reason is shown. Half-transformed text is never written. When a hook changes the text, the editor shows the new text before saving it, and the text is written exactly as the hook returned it, line endings included. Replacing the text clears the editor's undo history (Herdr's `EditorState.set_value()` does), and the cursor keeps its numeric offset, clamped to the new length.
- `onFileOpen` failures are shown and skipped. The first hook that asks for read-only wins, and the last language chosen is used.
- Extension themes cannot replace a built-in theme of the same name. Only themes whose `appearance` matches Herdr's current light/dark mode are offered.

An example that is not enabled by default: `src/extensions/examples/ensure-final-newline.ts`.
