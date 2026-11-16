# 実機での動作確認 3回目（インストール／アンインストール、受け入れ条件5）

実施日: 2026-11-16 / 環境: macOS、Herdr Desktop 0.1.16

## 手順と結果

1. 手でコピーしてあった editor を、最新のビルドに置き換えた。あわせて、スクリプトでインストールしたことを示す manifest（`data/editor/install.json`、元のレイアウトは `main`）を書いた。
2. `bun run scripts/uninstall.ts`
   - `editor-uninstall` Mod が、editor の pane をすべて閉じて結果を書き込み、スクリプトが nonce を照合した。
   - レイアウトは `main` に戻り、`herdr-app status` で切り替わったことを確認した。
   - `mods/editor`・`mods/editor-files`・`mods/editor-uninstall`・`layouts/editor.json`・`data/editor-files`・`data/editor-uninstall` を削除した。標準の `mods/files` は残っている。
   - shared の `editor` キーは null になった（削除する API はない）。
   - 未保存の下書き（README.md）は `data/editor/drafts` に残し、その場所を表示した。
3. `bun run scripts/install.ts`
   - 3つの Mod とレイアウトをコピーし、manifest を書いて、`editor` レイアウトに切り替えた。
   - もう一度実行（`--no-switch`）しても、自分が入れたファイルとして上書きされた。

## 見つかった問題と修正

- 削除済みの下書きのフォルダ（`drafts/<hash>/`）が、空のまま残っていた。`SlotStore.remove` で、フォルダが空になったら削除するようにした（`SlotIO.removeDirIfEmpty`）。

## 未確認

- 名前の衝突（同じ名前のファイルがすでにあり、manifest にない場合）で停止すること。実機の app home を汚さずに確かめる方法がないので、ロジックの確認だけにとどめた。
- 「space の唯一の tab に editor しかない」場合の確認ダイアログ。今回の環境では発生しなかった。
