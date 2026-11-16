# herdr-app-editor
Native, extensible code editor mod for Herdr Desktop

## Install

Requires Herdr Desktop 0.1.16 or later and [Bun](https://bun.sh) 1.3.5 (`mise install`). Herdr must be running.

```sh
bun install
bun run install:herdr     # builds, copies mods/ and layouts/editor.json into the app home, switches to the "editor" layout
bun run uninstall:herdr   # closes editor panes, switches back to the previous layout, removes the files
```

In the Files panel, click a file to open it in the editor; cmd-click (ctrl-click on Linux/Windows) opens it in a new editor pane. Save with cmd-s / ctrl-s.
