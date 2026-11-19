# herdr-app-editor
Native, extensible code editor mods for Herdr Desktop

Two pieces you add to the layout you already use, each listed on [herdr.dev/mods](https://herdr.dev/gallery/?type=mods):

| Folder | What it is |
|---|---|
| [`editor/`](editor/RECIPE.md) | **Herdr Editor**: an editable editor pane, and quick open (cmd-o) to find a file by name and open it there. |
| [`files/`](files/RECIPE.md) | **Herdr Editor Files**: Herdr's Files panel, changed so that clicking a file opens it in Herdr Editor. Without Herdr Editor it shows the usual read-only preview. |

![Herdr Editor](editor/preview.png)

## Add it

Ask your agent, with the folder's GitHub URL:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/dashi296/herdr-app-editor/tree/main/editor
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/dashi296/herdr-app-editor/tree/main/files
```

The agent copies the mod folders into `~/.config/herdr-app/mods/`. For `editor/`, it asks which key opens quick open (cmd-o by default) and adds it to `keys.json`. For `files/`, it points the Files block of your layout at the new panel (cloning the layout first if it is one of Herdr's own). Each RECIPE.md says how to remove it again.

Nothing needs building: the built `main.js` files are committed. Requires Herdr Desktop 0.1.16 or later.

Tested on macOS only. Linux and Windows are untested: the code has their paths (ctrl-s, permission checks), but nobody has run it there yet.

## Develop

Requires [Bun](https://bun.sh) 1.3.5 (`mise install`; run `mise trust` once if mise reports the config as not trusted).

```sh
bun install
bun run ci       # typecheck, lint, format check, tests, dependency rules, build, and a check that the build output is committed
bun run build    # writes editor/mods/* and files/mods/* from src/
```

To try a build, copy `editor/mods/*` and `files/mods/*` into `~/.config/herdr-app/mods/` and run `herdr-app check` on each. See [docs/extensions.md](docs/extensions.md) for editor extensions.

## License

[Apache-2.0](LICENSE). `files/mods/herdr-app-editor-files` is a modified copy of Herdr's `files` mod ([herdrdev/herdr-app](https://github.com/herdrdev/herdr-app), Apache-2.0); its icons are from [Lucide](https://lucide.dev) (ISC, `LICENSE-Lucide.txt`).
