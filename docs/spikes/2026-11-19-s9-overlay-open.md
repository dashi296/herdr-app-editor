# S9: オーバーレイから editor の pane を開く

実施日: 2026-11-19 / 環境: macOS、Herdr Desktop 0.1.16 / 対象: #29（`docs/superpowers/plans/2026-11-19-mod-split.md` Task 1）

## 目的

ファイル検索のオーバーレイ（`herdr-app-editor-open`）から、裏にあるタブへ editor の pane を開けるかを確かめる。

## 手順

使い捨ての mod（`spikes/s9-overlay/`、`mod.json` は計画のオーバーレイと同じ `popup` / `at: top` / `focusable: true`）を `~/.config/herdr-app/mods/` に置き、`herdr-app do mod.open '{"name":"s9-overlay"}'` で開いた。mod は次を `data/s9-<時刻>.json` に書いた。

1. `init` の時点の `focused()` と、アクティブな space のアクティブなタブ
2. 自分の focus handle に focus し、400ms 後の同じ値
3. 1 の pane に対する `run("pane.split", { pane, direction: "right", mod: "herdr-app-editor", props: { key, file } })`
4. 800ms 後の `focused()` と `panes()`

## 結果

| 確かめたこと | 結果 |
|---|---|
| `init` の `focused()` | 裏の端末の pane（`pane`、`tab`、`cwd` あり） |
| オーバーレイが自分に focus した後の `focused()` | **変わらず裏の pane**。オーバーレイは `focused()` に現れない |
| オーバーレイからの `pane.split` | 裏のタブに `herdr-app-editor` の pane が開いた。`focused()` は新しい pane に移った |
| `herdr-app status` の `errors` | 空 |

後片付け: 開いた pane を閉じ、mod、`data/s9-*.json`、`data/herdr-app-editor/panes/s9test.*` を削除した。

## キーの OS ごとの扱い（AGENTS.md と `keys.json` から）

- `keys.json` は OS ごとの内容。macOS の既定は `cmd-` を使い、AGENTS.md の例（Linux / Windows の既定と見られる）は `ctrl-shift-` を使う。`cmd-` が他の OS で `ctrl-` に読み替えられるという記述はない。
- AGENTS.md の例では `ctrl-shift-o` が `pane.split:right` に割り当てられている。Linux / Windows では、修飾キーのない `ctrl-<文字>` は端末のプログラムに渡る（AGENTS.md「Plain ctrl+letters go to the program unless bound」）。
- **`keys.json` を一度でも編集すると、その後の Herdr の更新で新しい既定のキーが自動では入らなくなる**（AGENTS.md「Any edit, even whitespace, keeps the entire file as yours」）。

## 計画への影響

- Task 4: 開く先のタブと一覧の対象フォルダは、計画どおり `init` の時点の `currentLocation()` と `activeTab()` で決めてよい。変更なし。
- Task 7: `editor/RECIPE.md` に、キーは macOS の割り当てであること、Linux / Windows では利用者に聞き、修飾キーのない `ctrl-<文字>` と既定の `ctrl-shift-o` を避けることを書く。`keys.json` をマージすると、以後の Herdr の更新で新しい既定のキーが自動では入らなくなることを、導入時の確認で利用者に伝える。
