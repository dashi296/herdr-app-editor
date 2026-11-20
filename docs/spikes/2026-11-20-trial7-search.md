# 実機での動作確認 7回目（行を指定して開く・文字列検索）

実施日: 2026-11-21 / 環境: macOS、Herdr Desktop 0.1.16 / 対象: `feat/search` `f36f3bb` のビルド

`editor/mods/` の3つの mod と `files/mods/herdr-app-editor-files` を `~/.config/herdr-app/mods/` に入れ、`keys.json` に `cmd-shift-f` を足した。4つとも `herdr-app check` を通った。

## 結果

| 確かめたこと | 方法 | 結果 |
|---|---|---|
| cmd-shift-f で検索して開く、同じファイルの別の結果へ移る、cmd-Enter、`~` での検索 | 利用者がキーで操作 | 利用者の報告: 問題なし |
| 新しい pane を `at` 付きで開く | `herdr-app do pane.split`（props に `at: {line:700,col:3,len:7}`、979 行のファイル）と `herdr-app shot` | 700 行目が見える位置まで表示が動き、3 文字目から 7 文字が選択された。描画後の選択のやり直しは不要 |
| 開いているファイルへ `at` 付きの `open` を送る | `herdr-app do 'herdr-app-editor.open:<json>'`（`at: {line:120,col:1,len:5}`） | 読み直さずに 120 行目へ移動し、5 文字が選択された。保存の確認は出なかった |
| `exec` の時間切れ | 使い捨ての mod で `sh -c "echo one; sleep 5; echo two"` を `timeout: 1000` で実行 | **例外を投げる**（「`herdr.exec`: sh took longer than 1 s and was stopped」）。途中の出力は受け取れない |
| `exec` の出力の上限 | 同じ mod で 12 MB を出力 | 終了コード 0、`stdout` はちょうど 8,388,608 文字で切れ、最後の行は途中で終わる |

`herdr-app status` の `errors` は、どの時点でも空だった。

## 分かったことと対応

- **時間切れでは途中の結果を出せない。** 設計では「得られた分を表示する」としていたが、`exec` が例外を投げるので「Cannot search this folder: …」になる。RECIPE と設計書をその内容に直した。
- **出力の上限で切れても終了コードは 0。** 途中で切れた最後の行は捨てている。8 MiB の出力は 500 件を大きく超えるので、「Showing the first 500 matches」が出る。追加の対応はしていない。

## 未確認

- 未保存の編集がある状態で同じファイルの別の行へ移る動作を、コマンドからは確かめていない（編集にはキー入力が要る）。利用者の操作での確認と、UI テストに頼っている。
- Linux / Windows。

## 片付け

確認用の pane を閉じ、使い捨ての mod と pane の記録（`zzverify1`）を消した。`shared.json` の `zz-exec-probe` キーは残っている（削除する API がない）。
