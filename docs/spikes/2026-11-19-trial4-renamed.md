# 実機での動作確認 4回目（改名後の名前 `herdr-app-editor*`）

実施日: 2026-11-19 / 環境: macOS、Herdr Desktop 0.1.16 / 検証用フォルダ: `~/herdr-editor-trial` / 対象: PR #23 のビルド（`chore/license`）

1〜3回目（2026-11-16）は改名前の `editor*` で行った。`e007b91` で mod と layout の名前を `herdr-app-editor*` に変えたので、その名前で一通り確かめ直した。キー入力とクリックは人が行い、ディスクの内容・`herdr-app status`・`herdr-app shot` で結果を確かめた。

## 手順と結果

| 手順 | 結果 |
|---|---|
| Files から main.rs を開く → 入力 → `●` → cmd-s | 保存され、`●` が消えた |
| dirty で別ファイル → Cancel / Esc / Don't save | Cancel と Esc は編集が残った。Don't save の後、破棄した内容はディスクに書かれていない |
| dirty で別ファイル → Save | 保存してから切り替わった |
| mid.ts（43 KB）を cmd-click | 新しい pane に開き、30 KB を超えたためハイライトを切る帯が出た |
| crlf.txt に Enter で1行追加 → cmd-s | `line3\r\n` で保存された |
| clean で外部変更 | 約3秒以内に自動で再読込された |
| dirty で外部変更 → Keep mine → cmd-s → Reload | 帯が出て編集は残った。保存は拒否され、外部の変更は上書きされなかった。Reload で外部の内容になった |
| readonly.txt（`chmod 444`） | 読み取り専用の帯（`info`）が出て、編集できない。カーソルは表示され、選択できる |
| big.txt（1.1 MB）・latin1.txt・nul.txt | 開かずに理由を表示した |
| note.unknownext | ハイライトなしで開いた |
| Theme ボタン | 2つの editor の色が両方変わった |
| 2つの editor が dirty → 左で cmd-s | 左（main.rs）だけ保存された |
| dirty の pane を閉じる → 開き直す → Restore draft → cmd-s | 復元した内容が保存された。**下書きが残った**（下記） |
| editor を開いたまま cmd-q → 起動し直す | 実施者の報告: editor の pane に同じファイルが開いて復元された |
| `bun run uninstall:herdr`（editor の pane だけの space を含む） | space を閉じる確認が出て、承認後に閉じた。layout は `main` に戻り、3つの mod と layout が削除された。標準の `files` は残った。shared の `herdr-app-editor` は null。下書きのある `data/herdr-app-editor/` は残し、場所を表示した |
| `bun run install:herdr` | 3つの mod と layout を入れて、`herdr-app-editor` layout に切り替わった。3つとも `herdr-app check` を通った |

`herdr-app status` の `errors` は、どの時点でも空だった。

## 見つかった問題と修正

- **復元した下書きが、保存した後も残る。** 下書きは pane のキーごとに保存する。保存と破棄で消すのは自分のキーの下書きだけなので、閉じた pane の下書きを別の pane が復元して保存すると、元の下書きが残った。ファイルが後で変わると、古い下書きが再び提示される。
  - 修正: Restore draft のとき、自分のキーで下書きを書き、書けた後で元の下書きを削除する（`src/ui/editor-view.ts` の `act("restore")`）。書けなかった場合は元の下書きを残す。
  - 修正後の実機確認: dirty の pane を閉じ、開き直して Restore draft を押した時点で、下書きは新しい pane のキーの1件だけになった。cmd-s の後、`drafts/` は空になり、ファイルのフォルダも削除された。
- **RECIPE の誤り。** 読み取り専用の帯を「blue」と書いていたが、実装は `info` の帯（`theme().surface`）。カーソルと選択ができることも書き足した。

## 未対応

- 狭い pane では、30 KB の帯の文章が1語ずつ折り返される（見た目の問題）。

## 未確認

- 名前の衝突で install が止まること（実機の app home を汚すため、ユニットテストのみ）。
- Herdr が起動していないときに uninstall が中止されること。
- Linux / Windows。公開時は macOS だけで確認済みと README と RECIPE に明記した。
