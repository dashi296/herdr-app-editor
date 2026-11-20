# S12: 選択範囲を設定すると、その位置まで表示が動くか

実施日: 2026-11-20 / 環境: macOS、Herdr Desktop 0.1.16 / 目的: 行への移動とファイル内検索が作れるかを決める

## 型定義から分かること（`gpui-kit.d.ts` の `EditorState`）

| 操作 | API |
|---|---|
| 内容の取得・置換 | `value()`、`set_value()`（undo が消える）、`replace(text)`（選択範囲を置き換え、undo 1回分） |
| 選択範囲・カーソル | `selected_range()`、`set_selected_range({ start, end })`（UTF-16 のオフセット） |
| 検索 | なし |
| 指定位置へのスクロール | なし |

## 手順

使い捨ての mod（`zz-scroll-spike`、ポップアップのオーバーレイ）を `~/.config/herdr-app/mods/` に置いた。600行の文章を `EditorState` に入れ、高さ 420 px の `Editor` に表示した。2.5 秒ごとに 400 → 550 → 10 → 300 行目の先頭 8 文字を `set_selected_range` で選び、`focus()` した。`herdr-app shot` でそれぞれの画面を撮った。

## 結果

| 移動 | 表示 |
|---|---|
| 1 → 400 行目（下へ） | 381〜400 行目が表示された。400 行目は最下行で、選択された 8 文字が強調された |
| 550 → 10 行目（上へ） | 10 行目が最上行になった |
| 10 → 300 行目（下へ） | 281〜300 行目。300 行目は最下行 |

`selected_range()` は設定した値をそのまま返した。`herdr-app status` の `errors` は空だった。

**結論:** `set_selected_range` は選んだ位置が見える最小限だけ表示を動かす（下へ移動すると最下行、上へ移動すると最上行に来る）。行への移動と、`value()` を自前で検索して `set_selected_range` で選ぶファイル内検索は、この API だけで作れる。移動先が画面の端に来るので、前後の行が見えにくい点は残る（画面の中央に寄せる API はない）。

## 片付けで分かったこと

- オーバーレイを開いたまま mod のフォルダを消すと、`status.overlays` に残り、`errors` に「reloading … does not exist」が出た。`overlay.close {"id":"zz-scroll-spike"}` は `ok` を返したが閉じなかった。同じ名前のフォルダを作り直し、`mod.open`（2回目の呼び出しで閉じる）で閉じてから消すと、両方とも空になった。
- `data/zz-scroll-spike/`（空）が自動で作られていたので消した。
