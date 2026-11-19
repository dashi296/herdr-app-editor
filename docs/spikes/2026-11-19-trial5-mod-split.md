# 実機での動作確認 5回目（mod 版と Files 連携に分けた後）

実施日: 2026-11-19 / 環境: macOS、Herdr Desktop 0.1.16 / 対象: ブランチ `feat/mod-split`（#29）

公開中の layout 版を実機から外し、`editor/` と `files/` の3つの mod を入れて確かめた。layout は `main` を `layout.clone` で複製した `trial-layout` にし、その Files ブロックを `herdr-app-editor-files` に差し替えた。`keys.json` には `"cmd-o": "mod.open:herdr-app-editor-open"` を足した（確認後に元へ戻した）。キー入力とクリックは人が行い、ディスクの内容・`herdr-app status`・`herdr-app shot` で結果を確かめた。

## 手順と結果

| 手順 | 結果 |
|---|---|
| 3つの mod を `herdr-app check` | すべて通った |
| 端末で cmd-o → `readme` → Enter | 最初は editor の pane が "Loading…" のまま止まった（下記 S10）。修正後は開いた |
| 開いた pane を閉じ、もう一度 cmd-o で開く | 最初の修正の後も "this editor state has been released" の帯になった（下記 S11）。2つ目の修正の後は開いた |
| 入力 → `●` → cmd-s | 保存され、`●` が消えた |
| cmd-o で別のファイルを cmd-Enter | 2つ目の editor の pane に開いた |
| Files パネルでクリック | editor で開いた |
| `herdr-app status` の `errors` | どの時点でも空だった |

実施者の報告: 修正後の手順はすべて問題なし。

## 見つかった問題と修正

- **S10: オーバーレイから作った pane が "Loading…" のまま止まる。** 新しい pane の最初のファイル読み込み（`fs/promises` の `exists`）が、作ったオーバーレイが閉じると返ってこない。オーバーレイを先に閉じても、開いた直後に閉じても止まった。1 秒残すと読み込みは終わった。
  - 最初の修正（`8c9fc58`）: editor が読み込み完了を共有の状態に書き、オーバーレイはそれを待ってから閉じる。
- **S11: 最初の修正の後、新しい pane の `EditorState` が解放される。** 計測すると、`EditorState` を作った約 65 ms 後に解放済みとして描画されていた（こちらのコードは解放していない）。オーバーレイが開いている間に作られた pane は、Herdr がそのオーバーレイに結び付けて扱い、閉じると資源を解放すると見られる。`herdr-app do pane.split` を外部プログラムとして、オーバーレイを開いたまま実行しても同じだった。オーバーレイを閉じた後に、バックグラウンドの `herdr-app do pane.split` で作った pane は正常だった。
  - 2つ目の修正（`6554e79`）: オーバーレイは自分では pane を作らない。既存の editor の pane には今どおり `open` 命令を送る。新しい pane が必要なときは、オーバーレイを閉じ、0.3 秒後に `herdr-app do pane.split` を実行する処理を `sh` でバックグラウンド起動する。新しい pane は最初の読み込みの後、フォーカスがあり未登録なら自分を登録する。最初の修正（待機）は取り除いた。
  - 修正後、実際のオーバーレイに一時的な自動選択を入れて「開く → pane を閉じる → もう一度開く」を確かめ、2回とも 6 秒後も表示が崩れていないことを確かめた（自動選択は外した）。
- 確認の途中で、計測のために実機の `main.js` を何度か書き換えたが、mod の読み込み直しそのものでは問題は起きなかった。

## preview

`/tmp` のデモ用フォルダ（Rust の小さな CLI、Git 管理）と専用の space を作り、`herdr-app shot` で撮ってサイドバーを切り取った。`editor/preview.png` はファイル検索を開いた画面、`files/preview.png` は Files パネルと editor の pane。撮影後、space とフォルダは削除した。

## 未確認

- エージェントが RECIPE だけで導入できること（別の app home で、`keys.json` のキーの確認の質問、Files ブロックの差し替えと `main` の複製）。2つ目の Herdr を起動する必要があり、この確認では行っていない。
- Linux / Windows。ファイル検索から新しい pane を作る処理は `sh` と `herdr-app` を使う。

## 補足: `herdr-app status` の `overlays`

ファイル検索の分割スクリプトは、オーバーレイが閉じたことを `herdr-app status` で確かめる。実機（0.1.16）では、ファイル検索を開いている間は `"overlays": ["herdr-app-editor-open"]`、閉じた後は `"overlays": []` だった（オーバーレイの mod 名が JSON の文字列として並ぶ）。形が変わって一致しなくなると、待たずにすぐ分割する。確認は 50 ms おきに最大 60 回（約 3 秒に、確認そのものにかかる時間が加わる）。
