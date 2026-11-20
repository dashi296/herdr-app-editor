# Files フォークが上流から遅れたことを CI で検知する（#36）

作成日: 2026-11-21 / 状態: 承認済み / 関連: #36, #35

## 目的と理由

`vendor/herdr-files/` は上流（herdrdev/herdr-app `defaults/mods/files/`）の写しで、`src/entries/editor-files.js` はそのフォーク。上流が変わっても気づく仕組みがなく、#35 では写しを取った4日後の修正が入っていなかった。

## 目標

- 上流の `defaults/mods/files/` が変わったら、1週間以内に気づく。
- 上流でのファイルの追加と削除も検知する。

## 目標としないこと

- 上流の変更の自動取り込み。取り込むかどうかは人が決める。
- issue の自動作成。
- `LICENSE-Lucide.txt` の比較。上流 `THIRD-PARTY-NOTICES` からの抜粋で、同名のファイルが上流にない。

## してはいけないこと

- PR ごとの `ci` に入れる。上流の変更で無関係な PR が落ちる。

## 方式

検討した方式は3つ。

| 方式 | 得失 |
|---|---|
| 上流を sparse checkout して `diff -r` | 追加と削除も分かり、差分がログに出る。採用。 |
| GitHub API で blob ハッシュを比べる | checkout が要らないが、差分の中身が出ない。 |
| 最新のリリースタグと比べる | リリース前の変更を拾わないが、今は使えない。写しは master の `317e673` で、v0.1.16 の `main.js` とは別物（#35）。次のリリースまで落ち続ける。 |

## 設計

- `.github/workflows/upstream-drift.yml`: 起動は `schedule`（月曜 00:17 UTC）と `workflow_dispatch`。権限は `contents: read`。このリポジトリと、上流 master（`defaults/mods/files` とルートのファイルだけ）を checkout し、上流のコミット ID をログに出してから比較スクリプトを呼ぶ。
- `scripts/check-upstream-drift.sh <上流の checkout>`: 比較の本体。手元でも動く。
  - `vendor/herdr-files/` から `README.md`、`LICENSE`、`LICENSE-Lucide.txt` を除いた写しを作り、上流の `defaults/mods/files/` と `diff -ru` で比べる。`diff -x` で除外しないのは、上流に同名のファイルが足されたときに見逃すため。
  - `vendor/herdr-files/LICENSE` を上流ルートの `LICENSE` と比べる。
  - 2つの比較は片方が失敗しても両方走らせる。差があれば終了コード 1。
  - 上流に `defaults/mods/files/main.js` かルートの `LICENSE` がなければ、終了コード 2 とメッセージで止める。上流がディレクトリを動かした場合に、ただの差分と区別するため。
- `vendor/herdr-files/README.md`: ジョブが落ちたときにやることを足す。

## 分かっている制約

- 失敗の通知は GitHub の既定のメールで、届くのはワークフローを最後に編集した人。
- 公開リポジトリで60日間コミットがないと、`schedule` は自動で無効になる。
- master と比べるので、リリース前の変更でも落ちる。
