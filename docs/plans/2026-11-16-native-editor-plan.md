# ネイティブファイルエディタ 実装計画

対象Issue: #1 / 調査対象: herdrdev/herdr-app `5216e6f` (2026-11-14)

## 1. ディレクトリ構成

### 結論

Herdr公式のMod構成ルールは `mods/<name>/main.js`（必須）・`mod.json`・同じフォルダ内の `*.js`／`*.svg` だけです。それ以上の推奨構造はありません。複数ファイルの公式例は `win98` だけで、これも同じ階層にファイルを並べ、`./kit.js` を相対importする形です。

Feature Sliced Designは、レイヤー名（pages/widgets/features…）はそのまま使わず、**依存方向の一方通行ルールだけ採用**します。理由は次の2点です。

1. このModは「1つのView＋少数の機能」なので、FSDの6層は過剰です。中身のない層が増えるだけになります。
2. 構造を決める本当の制約は別にあります。`herdr`／`gpui-kit`／`gpui-base` のimportはHerdrの実行環境でしか解決できません。そのため、テストしたいロジック（dirty／競合の状態遷移、改行コード処理、言語マップ、テーマ検証）は、これらをimportしない層に隔離する必要があります。この分離は、P2の「I/OとUIの分離」をそのまま満たします。

もう1つ、構成に効く事実があります。herdr.dev/mods での共有形式は「アプリのホームフォルダと同じ形のフォルダを公開リポジトリに置く」ことです（`mods/<name>/`、任意で `keys.json`、`layouts/<name>.json`、`RECIPE.md`、`preview.png`、topic `herdr-mod`）。つまり**ビルド済みJSをこの形でリポジトリにcommitする**前提になります。

### 構成案

```
herdr-app-editor/
├─ src/                       # TypeScript（開発用。配布されない）
│  ├─ core/                   # 純粋ロジック。herdr/gpui-* の import 禁止
│  │  ├─ document/            # 状態遷移: clean/dirty/saving/conflict/error, baseline管理
│  │  ├─ text/                # バイナリ判定, サイズ判定, EOL/BOM/末尾改行の検出と復元
│  │  ├─ language/            # 拡張子 → syntax名
│  │  ├─ theme/               # テーマJSON検証 → syntax色マップ
│  │  └─ extensions/          # onFileOpen / beforeSave 等のフック型とregistry
│  ├─ ports/                  # interface: FileStore(read/write/watch), Notifier
│  ├─ adapters/herdr/         # readTextFile / writeTextFile / watchFolder の実装
│  ├─ ui/                     # gpui-kit の描画（editor pane, toolbar, 3択dialog）
│  └─ entries/                # Modごとのエントリ（DIの組み立てのみ）
│     ├─ editor.ts
│     └─ editor-files.ts
├─ vendor/herdr-files/        # 上流Files main.js の原本 + LICENSE/NOTICE（差分追従用）
├─ themes/*.json              # one-dark, dracula, github-light, nord
├─ types/                     # 実機の herdr.d.ts / gpui-kit.d.ts をコピー（Herdrバージョン記録付き）
├─ tests/                     # core/ のユニットテスト（Bun or Vitest）
├─ scripts/                   # build, install, uninstall, dev(watch → ~/.config/herdr-app)
│
├─ mods/                      # ★ビルド成果物（commit）。herdr.dev共有形式
│  ├─ editor/{main.js, mod.json, themes/}
│  └─ editor-files/{main.js, mod.json, *.svg, LICENSE, NOTICE}
├─ layouts/editor.json        # main の clone。files → editor-files に差し替え
├─ keys.json                  # mod:editor 用の断片
├─ RECIPE.md / preview.png
```

- 依存方向は `entries → ui → adapters → ports → core` の一方向です。dependency-cruiser か eslint-plugin-boundaries で機械的に強制します。
- `src/` からは esbuild か `bun build` で `mods/<name>/main.js` を1ファイルに出力し、`herdr`・`gpui-kit`・`gpui-base` はexternalにします。こうすると、サブディレクトリからのimportが動くかどうかという未検証の問題を回避できます。
- CIでは、ビルド結果と `mods/` に差分がないことを確認します。

## 2. リスク（要件と衝突するもの）

| # | 内容 | 根拠 | 影響・対策 |
|---|---|---|---|
| R1 | **paneを閉じる操作は止められない**。`close(cx)` は後始末専用で最大250msしかなく、閉じるのを拒否できない | `defaults/AGENTS.md`「Cleanup」節 | P0「閉じる際に保存・破棄・キャンセル」は、pane closeについては実現できない見込みが高い。確認ダイアログが出せるのはエディタ内でファイルを切り替えるときだけ。緩和策として下書きを `~/.config/herdr-app/data/` に保存し、次に開いたとき復元する。解決ではなく緩和 |
| R2 | **標準Files Modに拡張ポイントがない**。クリックすると読み取り専用プレビューを直接表示するだけ | `defaults/mods/files/main.js` の `show()` | Filesのfork（`editor-files`）と、mainをcloneしたレイアウトが必須。上流の更新は自動では入らないので、`vendor/` に原本を置き、差分パッチで追従する。ライセンスはApache-2.0なので、NOTICEの保持と変更箇所の明記が必要。iconのパス `mods/files/*.svg` も書き換える |
| R3 | 読み書きとも**上限1 MiB・UTF-8のみ** | `src/mod_files.rs` `LIMIT` / `read_to_string` | 「エンコーディングを変えない」は「UTF-8以外は開かない（読めない）」と読み替える。1 MiBを超えるファイルも開かない |
| R4 | `writeTextFile` と `watchFolder` は**ローカル専用** | `herdr.d.ts` / AGENTS.md「Files」節 | リモートspaceのファイルは読み取り専用にする（Issueの対象外とも一致） |
| R5 | `panes()` は mod名を返すがpropsは返さない | `herdr.d.ts` `PaneInfo` | どのeditor paneがどのファイルを開いているかは外から分からない。開く依頼の受け渡し方式を検証する必要がある（S5） |
| R6 | 標準 `confirm` Modは2択（実行／キャンセル）のみ | `defaults/mods/confirm/main.js` | 保存・破棄・キャンセルの3択ダイアログは自作する。`editor` Mod内で props の role によって描画を切り替える（win98と同じ「1 Modで複数の役割」方式） |

### 有利な事実

`writeTextFile(path, text, expected)` は、`expected` とディスク上の内容が一致しない書き込みを拒否します。置き換えは一時ファイル＋rename によるアトミック置換で、パーミッションを保持し、symlinkは解決して実体を書き換えます（`src/mod_files.rs`）。そのため、**保存時の競合検出は実質APIが提供**しています。

失敗理由の判別はエラー文字列に頼らず、失敗後に読み直して判定します。結果がnullなら削除済み、baselineと違えば競合、それ以外は権限などのI/Oエラーです。

シンタックスハイライトはsyntectベースで、色のカテゴリは keyword / string / comment / function / type / number / constant / variable / operator / punctuation / boolean / string.escape に固定されています（`vendor/gpui-kit/crates/shell/src/syntax.rs`）。テーマJSONは、このカテゴリ名から色へのマップとして定義すれば足ります。

## 3. 実装ステップ（Issueの5ステップに対応）

### Step 1: 検証スパイク

実機（macOS）で確かめないと設計が確定しない項目です。

- **S1**: 1ファイルにバンドルした `main.js`（externalに `herdr` / `gpui-*`）が `herdr-app check` を通り、ホットリロードもされるか。開発用のsymlinkをリロードが追従するか
- **S2**: `EditorState.value()` を経由して CRLF・BOM・末尾改行・タブがそのまま保持されるか。正規化される場合は `core/text` で検出と復元を行う。改行コードが混在するファイルは読み取り専用にする
- **S3**: `keys.json` の `"mod:editor": {"cmd-s": "editor.save"}` が `nextCommand()` に届くか。代替案として、ルート要素の `on_key_down` で直接処理できるか。keys.json に手を入れるとファイル全体がユーザー所有扱いになり、以後デフォルトのショートカットが自動更新されなくなる。この影響をインストール手順に明記する
- **S4**: `writeTextFile` が実際に書ける範囲（ホーム外のパス、読み取り専用ファイル、削除済みファイル）と、そのときのエラー内容
- **S5**: 実行中のeditor paneに「このファイルを開いて」を届ける方式。候補は `setShared("editor.open", {file, nonce})` を監視する方式と、`pane.split {mod:"editor", props:{file}}` で毎回新しいpaneを開く方式。paneのpropsを変更したときにコピーが再起動されるかも確認する
- **S6**: `watchFolder(親ディレクトリ)` だけで外部変更を検知できるか。タイマーでのポーリング（`readTextFile` の結果をbaselineと比較）を併用すべきか

### Step 2: core と保存の実装

- `core/document`: baseline・現在のテキスト・状態の遷移を実装する。ユニットテストを先に書く
- `adapters/herdr`: FileStoreを実装し、失敗後の読み直しでエラーを分類する
- `ui`: dirtyの表示、保存エラーの帯（編集内容は保持）、外部変更の帯（再読み込み／自分の版を保持）、3択ダイアログ
- `editor-files` のfork: 変更はクリック時の処理だけに留める
- 下書きの退避（R1の緩和策）

### Step 3: 言語対応

拡張子から言語へのマップを作ります（Filesの `LANG` を拡張）。未知の拡張子はプレーンテキストとして扱います。開く前に、NULバイトを含むか、1 MiBを超えるか、リモートかを判定し、該当すれば読み取り専用にします。

### Step 4: テーマ

`themes/*.json` をスキーマで検証し、syntaxマップに変換します。ダーク／ライトは `settings().dark` で既定値を切り替えます。選択したテーマは `localStorage` か shared に保存します。

### Step 5: 仕上げ

- 拡張ポイント：`core/extensions` に `onFileOpen` / `beforeSave` を定義する。動的ロードはせず、ビルド時に登録する
- `scripts/install` / `uninstall`：`mods/` と `layouts/` に、既存と重複しない名前でコピーする。keys.json は差分をマージする
- RECIPE.md と preview.png を用意する

## 4. 受け入れ条件との対応

| 条件 | 依存する検証 | 見込み |
|---|---|---|
| 1. Filesから開いて編集・保存 | S1, S4, S5 | Filesのforkとcloneしたレイアウトが前提 |
| 2. 別ファイルへ移る際の確認 | S5 | エディタ内での切り替えなら可能。pane closeは不可（R1） |
| 3. 外部変更を無警告で上書きしない | なし | APIが保証している |
| 4. .json / .md / .rs を扱える | S2 | 可能 |
| 5. 標準Filesを壊さず、削除で元に戻せる | なし | fork＋cloneしたレイアウトなので、削除と `layout.switch main` で戻る |

## 5. 要判断

- R1：pane close時の要件を「下書きの自動退避と復元」に修正するか
