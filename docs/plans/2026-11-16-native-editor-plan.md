# ネイティブファイルエディタ 実装計画

対象Issue: #1 / 調査対象: herdrdev/herdr-app `5216e6f` (2026-11-14)
改訂: Codexレビュー（2026-11-16）の指摘を反映

## 0. 実装開始前のゲート（要判断）

以下が決まるまで Step 2 以降に進まない。

- **G1: pane close 時の P0 要件**（R1）。Mod API ではpaneのcloseを止められないため、次のどちらかに決める。
  - (a) 要件を「別ファイルへの切替時は3択。pane/tab/layout/app close では、編集のたびに保存している下書きから次回復元する」に変更する（推奨）。
  - (b) Herdr側にキャンセル可能なclose APIが追加されるまで、P0の該当項目は未達と明記する。
- **G2: 過大・非UTF-8ファイルの扱い**（R3）。API制約上、内容を表示できない。「理由を示すエラー画面を出し、開かない」とするか、別の読み取り経路を新たに設計するかを決める（推奨は前者）。

## 1. ディレクトリ構成

### 結論

Herdr公式ガイドが規定しているのは最小構成（`mods/<name>/main.js` 必須、`mod.json`、追加モジュール、アセット）だけで、それ以上の推奨構造はない（`defaults/AGENTS.md:873-880`）。ネストしたファイルは禁止されておらず、実装上もサポートされている。

- watcherのテストは `mods/probe/target/output.js` をリロード対象としている（`src/files.rs:642`）。
- 標準の `win98` は `main.js` から `./taskbar.js` などを相対importしている（`defaults/mods/win98/main.js:14-20`）。`fonts/`・`icons/`・`img/` などのサブディレクトリも持っている。

Feature Sliced Designは、レイヤー名（pages/widgets/features…）はそのまま使わず、**依存方向の一方通行ルールだけ採用**する。理由は次の2点。

1. このModは「1つのView＋少数の機能」なので、FSDの6層は過剰。中身のない層が増えるだけになる。
2. 構造を決める本当の制約は別にある。`herdr`／`gpui-kit`／`gpui-base` のimportはHerdrの実行環境でしか解決できない。そのため、テストしたいロジック（dirty／競合の状態遷移、改行コード処理、言語マップ、テーマ検証）は、これらをimportしない層に隔離する必要がある。

配布形式も構成を左右する。herdr.dev/mods の共有形式は、アプリのホームフォルダと同じ形のフォルダを公開リポジトリに置くもの（`mods/<name>/`、任意で `keys.json`、`layouts/<name>.json`、`RECIPE.md`、`preview.png`、topic `herdr-mod`。`defaults/AGENTS.md:453-482`）。そのため、**ビルド済みJSをこの形でリポジトリにcommitする**。

### 構成案

```
herdr-app-editor/
├─ src/                       # TypeScript（開発用。配布されない）
│  ├─ core/                   # 純粋ロジック。herdr/gpui-* の import 禁止
│  │  ├─ document/            # 状態遷移: clean/dirty/saving/conflict/error, baseline管理
│  │  ├─ text/                # NUL判定, EOL/BOM/末尾改行の検出と復元
│  │  ├─ language/            # 拡張子 → syntax名
│  │  ├─ theme/               # エディタテーマJSON検証 → syntax色マップ
│  │  ├─ routing/             # open request / editor registry のプロトコル（§3）
│  │  └─ extensions/          # onFileOpen / beforeSave 等のフック型とregistry
│  ├─ ports/                  # interface: FileStore(read/write/watch), DraftStore, Notifier
│  ├─ adapters/herdr/         # ports の Herdr 実装（readTextFile / writeTextFile / watchFolder / fs）
│  ├─ ui/                     # gpui-kit の描画（editor pane, toolbar, 3択dialog）。ports にのみ依存
│  └─ entries/                # Modごとのエントリ。adapter を生成して ui に注入（composition root）
│     ├─ editor.ts
│     └─ editor-files.ts
├─ editor-themes/*.json       # one-dark, dracula, github-light, nord（ビルド時に main.js へ埋め込む）
├─ vendor/herdr-files/        # 上流Files main.js・SVG の原本と upstream LICENSE（差分追従用）
├─ types/                     # 実機の herdr.d.ts / gpui-kit.d.ts（Herdrバージョンを記録）
├─ tests/
│  ├─ unit/                   # core/ と ui のロジック（ports はfakeで差し替え）
│  └─ e2e/                    # 隔離 HERDR_APP_HOME での実機手順・スクリプト（§5）
├─ scripts/                   # build, install, uninstall, dev(watch → $HERDR_APP_HOME/mods)
├─ package.json / bun.lock / tsconfig.json
│
├─ mods/                      # ★ビルド成果物（commit）。herdr.dev共有形式
│  ├─ editor/{main.js, mod.json}
│  └─ editor-files/{main.js, mod.json, *.svg, LICENSE}
├─ layouts/editor.json        # main の clone。files → editor-files に差し替え
├─ keys.json                  # mod:editor 用の断片
├─ RECIPE.md / preview.png
```

### 依存ルール

```
entries → ui       → ports → core
entries → adapters → ports → core
```

- `ui` から `adapters/` へのimportを禁止する。`FileStore` などは `entries` で生成して `ui` に注入する。これでP2の「ローカルI/OとUIの分離」を満たし、テスト用のfakeや将来のリモート用adapterと差し替えられる。
- `core` は `herdr` / `gpui-*` / `ports` 以外の層をimportしない。
- この依存ルールは dependency-cruiser で強制する。

### ビルド

- ビルドには Bun（`bun build`）を使う。バージョンは `package.json` の `packageManager` と `bun.lock` で固定する。
- ESMで、`herdr`・`gpui-kit`・`gpui-base` はexternalにする。`mods/<name>/main.js` の1ファイルに出力する。
- 1ファイルにまとめるのは配布とレビューを単純にするための選択であり、ランタイムの制約によるものではない。
- エディタテーマのJSONは `main.js` に埋め込む。Herdr ホームの `themes/<name>.json` はターミナル／アプリ全体のテーマで、スキーマが異なる（`defaults/AGENTS.md:333-338`）。混同を避けるため `editor-themes/` と命名し、ホームの `themes/` には書き込まない。
- CI: clean install → typecheck → unit test → build → `git diff --exit-code -- mods/`。
- `herdr-app check mods/editor mods/editor-files` はローカル（またはHerdrを導入できるランナー）で実行する。

## 2. リスクとAPI制約

| # | 内容 | 根拠 | 対策 |
|---|---|---|---|
| R1 | **paneのcloseを止められない**。`close(cx)` は消えた後の後始末で、最大250ms・未完了の処理はキャンセルされる。拒否する手段はない | `defaults/AGENTS.md:990-1002` | G1で要件を確定する。下書きは `close()` に頼らず、**編集のたびにdebounceして継続保存**する（`DraftStore`。`fs/promises` で `~/.config/herdr-app/data/` 配下に書く。`defaults/AGENTS.md:1142`）。自作のpaneヘッダーのボタンにだけ確認を付ける案は、キー操作・tab close・layout切替・アプリ終了を網羅できないので採らない |
| R2 | **標準Files Modに拡張ポイントがない** | `defaults/mods/files/main.js` の `show()` | Filesをforkした `editor-files` と、mainをcloneしたレイアウトが必須。上流の更新は自動では入らないので、`vendor/` に原本を置いて差分で追従する。iconのパス `mods/files/*.svg` も書き換える。ライセンスは §6 |
| R3 | **読み書きとも1 MiBまで・UTF-8のみ**。不正なUTF-8や1 MiB超では、内容を返さずエラーになる | `defaults/herdr.d.ts:27`, `src/mod_files.rs:16-21` | 「読み取り専用で表示」はできない。G2に従い、理由を示すエラー画面にする。NULバイトの判定は読み込みに成功した後でしかできない。NULを含むファイルは表示せずにエラー画面にする |
| R4 | `writeTextFile`・`watchFolder` は**ローカルのみ** | `defaults/AGENTS.md:1114-1116` | リモートspaceのファイルは読み取り専用で表示する（`readTextFile` は `on` 指定で読める） |
| R5 | 開くファイルの振り分けに使える情報が少ない。`PaneInfo` はpropsを返さず、`run()` の戻り値は常に `null`（split後のpane IDが取れない）。`setShared` は全Modを再描画する | `defaults/herdr.d.ts:207-212`, `:91`, `:445-448` | §3のプロトコルで、宛先を明示した依頼として送る |
| R6 | 標準 `confirm` Modは2択（実行／キャンセル）のみ | `defaults/mods/confirm/main.js:1-3` | 3択ダイアログは自作する。`editor` Mod内で props の role によって描画を切り替える |
| R7 | `watchFolder` に制約が多い。Linuxでは Git ignored なディレクトリと Git objects を監視しない。4096ディレクトリを超えると拒否する。保留中のwatchは最大64フォルダで、idleなwatchは回収される。ルートが返ってきたら全件再読込が必要。不要になったら `cancel()` が必要 | `defaults/herdr.d.ts:460-468` | **ポーリングを必須の経路とし、watchは即時性を補うだけ**にする（§4 Step 2） |
| R8 | `EditorState` には `set_language` / `set_syntax` がない（languageとsyntaxは生成時のオプションのみ） | `vendor/gpui-kit/crates/shell/src/typings.rs:3203-3238` | テーマや言語を切り替えるときは EditorState を作り直し、value・selection・dirty/baselineを移す。undo履歴は失われる可能性が高い（S7で確認） |
| R9 | `herdr-app check` は最初の描画しか検査しない（layout・遅延行・後続のasync状態は対象外） | `defaults/AGENTS.md:54-57` | unit test と check に加えて、実機でのE2E手順を §5 で定義する |

### 保存失敗の扱い

`writeTextFile(path, text, expected)` は、`expected` とディスク上の内容が一致しない書き込みを拒否する。置き換えは一時ファイル＋renameによるアトミック置換で、パーミッションを保持し、symlinkは解決して実体を書き換える（`src/mod_files.rs:27-73`）。**無警告での上書きはAPIが防ぐ**。

失敗の原因を正確に分類することはできない（失敗した後に読み直すのは別の時点の状態だから）。UIでは、再読込で観測した事実を示す。

| 再読込の結果 | 表示 |
|---|---|
| null | 「ファイルが削除されています」 |
| baselineと異なる | 「ディスク上の内容が変わっています」→ 再読込／自分の版を保持／（P1）差分 |
| baselineと同じ | 「保存に失敗しました」＋エラー原文（権限・容量など） |

どの場合も編集内容は保持し、エラー原文は診断のために常に表示する。エラー文字列で処理を分岐させない。

## 3. ファイルを開く依頼の振り分け（R5の方式）

1. editor の各コピーは、`init` で一意な `instanceId` を作る。
2. editor はフォーカスを得たときと、ファイルを開いたときに、shared の `editor.registry` に `{instanceId, tab, focusedAt}` を書き込む。`close()` では自分のエントリを削除する。削除できなかった場合に備え、残ったエントリは参照する側で `panes()` の `mod === "editor"` の数と突き合わせて除外する。
3. `editor-files` でファイルをクリックしたとき:
   - 同じtabに有効なeditorがあれば、`focusedAt` が最新のものを宛先にして、shared の `editor.request` に `{target: instanceId, file, on, nonce}` を書き込む。続けてそのpaneを `pane.focus` でフォーカスする。
   - 無ければ `pane.split {direction:"right", mod:"editor", props:{file, on}}`。
4. editor は `render` で `editor.request` を確認し、`target` が自分で、まだ処理していない `nonce` のときだけ処理する。
   - clean ならそのまま開く。
   - dirty なら3択ダイアログを出す。キャンセルなら現在の編集を保持する（受け入れ条件2）。
5. このプロトコルは `core/routing` に純粋関数として実装し、次のケースをunit testで確認する: editorが0／1／複数、別tab、dirty、registryに古いエントリが残っている、同じnonceを2回受け取る。

S5では、このプロトコルが実機で動くことと、registryのエントリが `shared.json` に残り続けても問題が起きないことを確認する。

## 4. 実装ステップ（Issueの5ステップに対応）

### Step 1: 検証スパイク

- **S1**: バンドルした `main.js` が `herdr-app check` を通り、ホットリロードされるか。dev scriptから `$HERDR_APP_HOME/mods/` へ出力したときの挙動
- **S2**: `EditorState.value()` を経由して CRLF・BOM・末尾改行・タブがそのまま保持されるか。正規化される場合は `core/text` で検出と復元を行う。改行コードが混在するファイルは読み取り専用にする
- **S3**: `keys.json` の `"mod:editor": {"cmd-s": "editor.save", "ctrl-s": ...}` が `nextCommand()` に届くか。代替案として、ルート要素の `on_key_down` で処理できるか。keys.jsonを編集するとファイル全体がユーザー所有扱いになることをインストール手順に明記する
- **S4**: `writeTextFile` で書ける範囲（ホーム外のパス、読み取り専用ファイル、削除済みファイル）と、そのときのエラー原文
- **S5**: §3のプロトコルを実機で確認する（複数のeditor pane、tab切替、再起動後）
- **S6**: `watchFolder(親ディレクトリ)` の即時性と、macOS / Linux / Windows での失敗パターン
- **S7**: EditorStateを作り直したときに selection とundo履歴を保持できるか

### Step 2: core と保存の実装

- `core/document`: baseline・現在のテキスト・状態の遷移を実装する。ユニットテストを先に書く
- `adapters/herdr`: FileStore・DraftStoreを実装する。保存失敗後は §2 の表に従って分類する
- 外部変更の検知
  - **ポーリング（必須）**: 表示中は数秒間隔で `readTextFile` を呼び、baselineと比較する。非表示の間は止める。読み込み中は次のreadを始めない
  - **watch（補助）**: 失敗したらポーリングだけで続ける。ルートが返ったら再読込する。ファイルやディレクトリを切り替えたときと `close()` で `cancel()` する
  - 外部変更を検知した場合、clean なら自動で再読込する。dirty なら帯を表示し、再読込するか自分の版を保持するかを選ばせる
- `ui`: dirtyの表示、保存エラーの帯、外部変更の帯、3択ダイアログ
- `editor-files` のfork と §3 のプロトコル
- 下書きの継続保存と、起動時の復元（G1）

### Step 3: 言語対応

拡張子から言語へのマップを作る（Filesの `LANG` を拡張）。未知の拡張子はプレーンテキストとして扱う。開けない場合（R3）とリモートの場合（R4）の画面も作る。

### Step 4: テーマ

`editor-themes/*.json` をスキーマで検証し、syntaxマップに変換する。syntaxのカテゴリは keyword / string / comment / function / type / number / constant / variable / operator / punctuation / boolean / string.escape（`typings.rs:3230-3232`）。ダーク／ライトは `settings().dark` で既定値を切り替える。テーマを切り替えるときは R8 に従って EditorState を作り直す。選択したテーマは `localStorage` に保存する。

### Step 5: 仕上げ

- 拡張ポイント：`core/extensions` に `onFileOpen` / `beforeSave` を定義する。動的ロードはせず、ビルド時に登録する
- `scripts/install` / `uninstall`：`mods/` と `layouts/` に、既存と重複しない名前でコピーする。keys.json は差分をマージし、既存のキーと衝突する場合は確認する。uninstallは追加したものだけを削除する
- RECIPE.md と preview.png を用意する

## 5. 検証計画

| 層 | 手段 | 対象 |
|---|---|---|
| unit | Bun test（portsはfakeに差し替え） | core全般、§3のプロトコル、保存失敗の分類、ポーリングの状態遷移 |
| static | `herdr-app check` | 両Modが最初の描画まで通ること |
| e2e | 隔離した `HERDR_APP_HOME` で実機手順を実行し、`herdr-app shot` で証跡を残す。外部変更・削除・権限変更はスクリプトで起こす | 下記 |

e2eのケース:

- Filesから開く → 編集 → Cmd+S（macOS）／Ctrl+S（Linux/Windows）→ ディスクに反映されている
- dirtyな状態で別ファイルを開く → キャンセル → 編集内容が残っている／破棄／保存
- 外部で変更した後に保存 → 拒否されて帯が出る。clean な状態での外部変更は自動で再読込される
- 削除されたファイル・権限のないファイル・1 MiB超・不正なUTF-8・NULを含むファイル・未知の拡張子
- paneを閉じる → 再度開く → 下書きが復元される（G1が(a)の場合）
- install → uninstall → `layout.switch main` で標準構成に戻る

## 6. ライセンス

上流は Apache-2.0。ルートには `LICENSE` と `THIRD-PARTY-NOTICES` があり、`NOTICE` というファイルはない。fork する Files の `main.js` と SVG について、次を作業項目として確認する。

- Apache-2.0 Section 4 に沿って `LICENSE` を同梱する
- 著作権表示を保持する
- 変更したファイルに変更した旨を明記する
- SVGアイコンの出典が `THIRD-PARTY-NOTICES` の対象かどうか

`NOTICE` ファイルを新たに作る前提にはしない。

## 7. 受け入れ条件との対応

| 条件 | 依存 | 見込み |
|---|---|---|
| 1. Filesから開いて編集・保存 | S1, S3, S4, §3 | Filesのforkとcloneしたレイアウトが前提 |
| 2. 別ファイルへ移る際の確認 | §3, S5 | 既存のeditorへの振り分けで実現できる。pane closeについてはG1次第 |
| 3. 外部変更を無警告で上書きしない | なし | APIが保証している |
| 4. .json / .md / .rs を扱える | Step 3, e2e | 可能 |
| 5. 標準Filesを壊さず、削除で元に戻せる | Step 5, e2e | fork＋cloneしたレイアウトなので、削除と `layout.switch main` で戻る |
