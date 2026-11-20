# 実機での動作確認 6回目（RECIPE だけで導入できるか）

実施日: 2026-11-20 / 環境: macOS、Herdr Desktop 0.1.16 / 対象: main `a38a75d`（herdr.dev に掲載中の版）

## 目的

herdr.dev の利用者は、ページの一文（`Read ~/.config/herdr-app/AGENTS.md, then add this mod: <URL>`）をエージェントに渡して導入する。RECIPE を書いた本人ではないエージェントが、この一文と RECIPE だけで導入できるかを確かめる。

## 手順

1. `~/herdr-recipe-trial/home` を app home にして、Herdr を `HERDR_APP_HOME` 付きでもう1つ起動した。起動時に `AGENTS.md`、`keys.json`、同梱の layout と mod が書き出された。
2. 実際の app home（`~/.config/herdr-app`）の `mods/`、`layouts/`、`keys.json`、`settings.json` のハッシュを記録した。
3. この会話の経緯を渡さない別のエージェントに、上の一文を `editor` と `files` の2つ分だけ渡した。制約として、次を加えた。
   - app home の場所
   - pane・tab・space を操作しないこと
   - 人に聞く場面では、質問を書き留めて cmd-o と `main` を選ぶこと
4. 結果をこちらで確かめ、試験用のウィンドウを `app.quit` で閉じて、試験用のフォルダを消した。

## 分かったこと: 2つ目のウィンドウは space と端末を共有する

試験用のウィンドウの `herdr-app ls` には、実際のウィンドウと同じ space と端末（実行中の Claude Code を含む）が並んだ。端末は herdr-core が持っているからである。そのため、試験用のウィンドウで pane を分割したり閉じたりすると、実際の作業に影響する。この試験では pane の操作をしなかった。分かれるのは layout、keys、mods、shared など app home の中身だけである。

## 結果

| 確かめたこと | 結果 |
|---|---|
| コピーした3つの mod | リポジトリのビルドと一致。差は Herdr が置く `gpui-kit.d.ts` と `jsconfig.json` だけ |
| `herdr-app check` | 3つとも通過 |
| `keys.json` | `global` に `"cmd-o": "mod.open:herdr-app-editor-open"` の1行が増えただけ |
| layout | `main` を `main-editor` に複製して切り替えた。解析した JSON の差は、Files ブロックの `content.mod`（`files` から `herdr-app-editor-files`）と `cloned_from` だけ。`main.json` は変わっていない |
| `herdr-app status` の `errors` | 空 |
| 実際の app home | ハッシュが一致し、変更なし |

pane とクリックが必要な項目（ファイル検索で開く、保存、Files のクリックなど）はこの試験では確かめていない。同じビルドで、実際の app home で確認済み（`2026-11-19-trial5-mod-split.md`）。

## エージェントがつまずいた点と対応

| 指摘 | 対応 |
|---|---|
| 複製した layout の名前を決める手順がない | files RECIPE: 名前を聞き、`<layout>-editor` を提案する |
| Files ブロックの見つけ方が書かれていない。stack の `"active": "files"` を変えてはいけないことも書かれていない | files RECIPE: `content` が `{ "mod": "files" }` のブロックを探す（`main` では `panel-body` の中の `id: "files"`）。変えるのは `content` だけ |
| `main` では Files を含む右側のパネルが最初は隠れている | files RECIPE: タブバーの Files ボタンで表示すると書いた |
| `layout.clone` が JSON のキーを並べ替えるので、テキストの差分が読めない | files RECIPE: 比べるときは JSON を解析してから |
| 複製すると layout が切り替わり、以後の `main` の変更が入らない。これは README にしか書かれていない | files RECIPE: 事前に人へ伝える、と書いた |
| editor の Done when の「In a layout other than `main`」の意図が分からない | 「In the person's layout」に直した |
| README には、`keys.json` が利用者のファイル扱いになることと、複製に名前を聞くことが書かれていない | README に書き足した |
| バージョンを確かめる手順がない | 両方の RECIPE: 先に `herdr-app --version` を確かめる |
| AGENTS.md が求める「ネットワーク・プログラムの実行・フォルダ外の読み取り」の説明を、Built from から拾う必要がある | 両方の RECIPE: Watch out の先頭に1行でまとめた |

## 対応しなかった点

- **`herdr-app check` で Files の mod の `init()` が `git` と `sh` を実行する。** `checking()` での抑止がない。Herdr の `files` mod から引き継いだ動きで、読み取りだけなので、そのままにした。
- **名前が重なったときの指示が食い違う。** AGENTS.md は名前を変えて入れるよう書いているが、RECIPE は名前を変えずに `src/core/names.ts` を直してビルドし直すよう書いている。RECIPE のほうが具体的なので、そのままにした。
- **Linux / Windows。** この Mac では確かめられない。

## レビューでの修正（PR #32）

Claude と Codex のレビューを受けて、次を直した。

- アクセスの説明を、実装に合わせて書き直した（`sh` / PowerShell での一覧、`git` での状態の取得、フォルダの監視、shared への記録、別のマシンでの実行）。files RECIPE では Watch out の先頭に移した。
- 複製のコマンドを `main` 固定から、使っている layout の名前を入れる形にした。使っている layout は `herdr-app status` の `layout` で分かる、と書いた。
- Files ボタンの場所を「ヘッダー」から「タブバーの右」に直した。
