# ネイティブファイルエディタ 実装計画

対象Issue: #1 / 調査対象: herdrdev/herdr-app `5216e6f` (2026-11-14)

- 改訂1: Codexレビューの指摘を反映
- 改訂2（2026-11-16）: Codex・Claudeの再レビューを反映。主な変更は、§3の振り分け方式の作り直し、保存キーの扱い、下書き・ポーリング・リモート・アンインストールの設計

引用は上流リポジトリ内のパス。「推定」とある箇所はソースから推論したもので、実機で検証する。

## 0. 実装開始前のゲート（決定済み 2026-11-16）

- **G1: pane close 時の P0 要件**（R1）→ **決定: 要件を変更**。Mod API ではpaneのcloseを止められない。そのため「別ファイルへの切替時は3択。pane/tab/layout/app close では、継続保存している下書きから次回復元する」とする。Issue #1 のP0も同じ内容に更新済み。Herdr側にキャンセル可能なclose APIが追加されたら再検討する。
- **G2: 過大・非UTF-8ファイルの扱い**（R3）→ **決定: 理由を示すエラー画面を出し、開かない**。1 MiB超・非UTF-8・NULを含むファイルが対象。`exec` などで別の読み取り経路を作ることはしない。Issue #1 のP0も同じ内容に更新済み。

## 1. ディレクトリ構成

### 結論

Herdr公式ガイドが規定しているのは最小構成（`mods/<name>/main.js` 必須、`mod.json`、追加モジュール、アセット）だけで、それ以上の推奨構造はない（`defaults/AGENTS.md:873-880`）。ネストしたファイルは禁止されておらず、実装上もサポートされている。

- watcherのテストは `mods/probe/target/output.js` をリロード対象としている（`src/files.rs:642`）。
- 標準の `win98` は `main.js` から `./taskbar.js` などを相対importしている（`defaults/mods/win98/main.js:14-21`）。`fonts/`・`icons/`・`img/` などのサブディレクトリも持っている。

Feature Sliced Designは、レイヤー名はそのまま使わず、**依存方向の一方通行ルールだけ採用**する。

- このModは「1つのView＋少数の機能」なので、FSDの6層は過剰。
- 構造を決める本当の制約は別にある。`herdr`／`gpui-kit`／`gpui-base`／`fs/promises` はHerdrの実行環境でしか解決できない。そのため、テストしたいロジックはこれらをimportしない層に隔離する。

### 配布形式

`layouts/<name>.json` を含むものは、herdr.dev では **layout パッケージ**として共有する（topic は `herdr-layout`。`defaults/AGENTS.md:453-459, 481-485`）。このリポジトリのルートは、アプリのホームフォルダと同じ形の layout パッケージにする。ビルド済みJSはcommitする。

インストール時に名前が衝突した場合、ガイドは mod名と `mods/<name>/` のパスを書き換える手順を示している（`defaults/AGENTS.md:470-472`）。これに耐えられるよう、mod名・sharedキー・コマンド名の接頭辞は**ビルド時の定数1か所**から生成する。

### 構成案

```
herdr-app-editor/
├─ src/                       # TypeScript（開発用。配布されない）
│  ├─ core/                   # 純粋ロジック。外部モジュールも他の内部層もimportしない
│  │  ├─ document/            # 状態遷移: clean/dirty/saving/conflict/error, baseline管理
│  │  ├─ text/                # NUL/U+FFFD判定, EOL/BOM/末尾改行の検出と復元
│  │  ├─ language/            # 拡張子 → syntax名
│  │  ├─ theme/               # エディタテーマJSON検証 → syntax色マップ
│  │  ├─ routing/             # §3 のメッセージ型・宛先選択・registryの検証
│  │  ├─ draft/               # 下書きのシリアライズ・A/Bスロット選択・チェックサム
│  │  └─ extensions/          # onFileOpen / beforeSave 等のフック型とregistry
│  ├─ ports/                  # interface: FileStore, DraftStore, Registry, Clock。core の型のみ参照
│  ├─ adapters/herdr/         # ports の Herdr 実装（readTextFile / writeTextFile / watchFolder / fs / shared）
│  ├─ ui/                     # gpui-kit の描画。ports と core にのみ依存
│  └─ entries/                # Modごとのエントリ。adapter を生成して ui に注入（composition root）
│     ├─ editor.ts
│     └─ editor-files.ts
├─ editor-themes/*.json       # one-dark, dracula, github-light, nord（ビルド時に main.js へ埋め込む）
├─ vendor/herdr-files/        # 上流Files main.js・SVG の原本、LICENSE、LICENSE-Lucide.txt
├─ types/                     # 実機の herdr.d.ts / gpui-kit.d.ts（Herdrバージョンを記録）
├─ tests/
│  ├─ unit/                   # core と ui のロジック（ports はfakeで差し替え）
│  └─ e2e/                    # 隔離 HERDR_APP_HOME での実機手順・スクリプト（§6）
├─ scripts/                   # build, install, uninstall, dev(watch → $HERDR_APP_HOME/mods)
├─ package.json / bun.lock / tsconfig.json
│
├─ mods/                      # ★ビルド成果物（commit）
│  ├─ editor/{main.js, mod.json}
│  └─ editor-files/{main.js, mod.json, *.svg, LICENSE, LICENSE-Lucide.txt}
├─ layouts/editor.json        # main の clone。files → editor-files に差し替え。cloned_from を記録
├─ RECIPE.md / preview.png
```

`keys.json` は配布しない（§4 Step 2 の保存キー参照）。

### 依存ルール

```
entries → ui       → ports → core
entries → adapters → ports → core
          ui → core
```

- `core` は外部のホストモジュール（`herdr` / `gpui-*` / `fs/promises`）も、他の内部層も import しない。
- `ports` が参照してよいのは `core` の型だけ。
- `ui` から `adapters/` への import は禁止する。`FileStore` などは `entries` で生成して `ui` に注入する。これで P2 の「ローカルI/OとUIの分離」を満たす。
- これらのルールは dependency-cruiser で強制する。

### ビルド

- ビルドには Bun（`bun build`）を使う。バージョンは `package.json` の `packageManager` と `bun.lock` で固定する。
- ESM で出力し、`herdr`・`gpui-kit`・`gpui-base`・`fs/promises` を external にする。`mods/<name>/main.js` の1ファイルに出力する。
- 出力後、import specifier が書き換わっていないことを検査する。
- 1ファイルにまとめるのは配布とレビューを単純にするための選択で、ランタイムの制約によるものではない。
- 両方の `mod.json` に `"place": "none"` を明記する。未指定だと既定の `right` になり、個人 layout に props なしで自動配置されてしまう（`src/window.rs:4229-4242`）。editor には `"focusable": true` も付ける（`defaults/AGENTS.md:882`）。
- エディタテーマは `main.js` に埋め込む。Herdr ホームの `themes/<name>.json` はターミナル／アプリ全体のテーマで、スキーマが異なる（`defaults/AGENTS.md:333-338`）。
- CI: clean install → typecheck → unit test → build → specifier 検査 → `git diff --exit-code -- mods/`。
- `herdr-app check mods/editor mods/editor-files` はリリース前のゲートとして実行する（ローカル、またはHerdrを導入できるランナー）。
- `init()` の冒頭で `if (checking()) return;` とし、check 中はタイマー・watch・下書き・shared への書き込みを止める（`defaults/AGENTS.md:928-931`）。

## 2. リスクとAPI制約

| # | 内容 | 根拠 | 対策 |
|---|---|---|---|
| R1 | **paneのcloseを止められない**。`close(cx)` は消えた後の後始末で、最大250ms・未完了の処理はキャンセルされる。非表示のコピーや非アクティブなtabでは呼ばれない | `defaults/AGENTS.md:990-1000` | G1。下書きは `close()` に頼らず継続保存する（§5） |
| R2 | **標準Files Modに拡張ポイントがない** | `defaults/mods/files/main.js` の `show()` | Filesをforkした `editor-files` と、mainをcloneしたlayout。上流の更新は `vendor/` の原本との差分で追従する。layout の clone は `cloned_from` を記録し、上流 main の更新時に差分を見直す |
| R3 | **ローカルの読み書きは1 MiBまで・UTF-8のみ**。不正なUTF-8や1 MiB超では、内容を返さずエラーになる | 読み: `src/mod_files.rs:16-21`、書き: `:28-29`、`defaults/herdr.d.ts:27` | G2のエラー画面。NULの判定は読み込みに成功した後に行う |
| R4 | **リモートの読み込みはローカルと挙動が違う**。`cat` で読み、非UTF-8は U+FFFD に置換して返す。終了コードが0以外なら null を返す（権限エラーと「存在しない」を区別できない）。`writeTextFile`・`watchFolder` はローカルのみ | `src/mods.rs:936-949`、`defaults/AGENTS.md:1114-1116` | リモートは読み取り専用で表示する。U+FFFD を含む場合は G2 のエラー画面にする（本来 U+FFFD を含むファイルも対象になるが、許容する）。null は「読めない（存在しない・権限なし）」と表示する。ポーリングは毎回ファイル全体を転送するので、10秒以上の間隔にする |
| R5 | 振り分けに使える情報が少ない。`PaneInfo` は props を返さない。`run()` は要求をキューに積んで `null` を返すだけで、split した pane の ID は取れない。`pane.focus {pane}` はモデル上のフォーカスを移すだけで、キーボードを mod に渡す保証はない | `defaults/herdr.d.ts:91, 207-223`、`src/mods.rs:1103-1117`、`src/window.rs:3183-3189` | §3 |
| R6 | 標準 `confirm` Modは2択のみ | `defaults/mods/confirm/main.js:1-3` | 3択ダイアログは自作する（editor の role 切り替え） |
| R7 | `watchFolder` に制約が多い。Linux では Git ignored なディレクトリを監視しない。4096ディレクトリ超・保留64フォルダの上限がある。1回変化を返すと完了するので、続けるには再armが必要。ルートが返ったら全件再読込が必要 | `defaults/herdr.d.ts:460-468`、`defaults/mods/files/main.js:49-55` | ポーリングを必須の経路とし、watch は即時性を補うだけにする（§4 Step 2） |
| R8 | `EditorState` には language・syntax を変える API がなく、undo履歴を取得・設定する API もない。State を render 内で生成してはいけない | `vendor/gpui-kit/crates/shell/src/typings.rs:3203-3238` | テーマや言語を切り替えるときは、render 外で State を作り直し、value と selection を移す。古い State は `release()` する。**undo履歴は消える**ことを仕様とし、切り替え時に表示する |
| R9 | `herdr-app check` は最初の描画しか検査しない | `defaults/AGENTS.md:54-57` | §6 の E2E |
| R10 | **mod の `<mod>.<command>` は、その mod の表示中コピー全部に届く**。`mod:editor` のキー割り当ても同じ経路を通る | `src/window.rs:2932-2936`、`src/mods.rs:745-757` | 受信側で宛先を確認する（§3）。保存キーは `on_key_down` で処理する（§4 Step 2） |
| R11 | `setShared` は値が変わるたびに shared.json 全体を書き、全 mod を再描画する。shared はプロセスごとのローカル保存で、クライアント間で同期しない。localStorage は mod名＋props のハッシュ単位 | `src/mods.rs:451-459, 1283-1294` | shared への書き込みは registry の更新（フォーカスが変わったとき）だけに絞る。複数クライアントでは、editor の状態はクライアントごとになる（制約として明記） |
| R12 | 1 MiB 近いファイルでの描画性能を確認していない。syntect は差分更新せず、編集のたびに全体を解析し直す。標準 Files は 400k 文字で切り捨てている | `vendor/gpui-kit/crates/shell/src/syntax.rs:76-79`、`defaults/mods/files/main.js:142` | S8 で入力遅延を測り、しきい値を超えたらハイライトを外す |
| R13 | `fs/promises` には rename・stat がない（readFile / writeFile / readdir / exists / unlink / rmdir / mkdir のみ）。書き込みは app home 配下だけ。`mods/<name>/` 配下に書くと hot reload が起きる | `typings.rs:3877-3889`、`src/mods.rs:1246`、`src/files.rs:640-642` | 下書きは A/B の2スロットで書く（§5）。保存先は `appHome()/data/editor/drafts/` |

### 保存時の競合防止

`writeTextFile(path, text, expected)` は、`expected` とディスク上の内容が一致しない書き込みを拒否する。置き換えは一時ファイル＋rename で行う（`src/mod_files.rs:27-73`）。通常の外部変更や古いスナップショットからの上書きは、これで防げる。

ただし**厳密な compare-and-swap ではない**。

- rename 直前の再確認と rename の間に外部プロセスが書き込むと、その変更を置き換えてしまう（`:69-72`）。
- `expected` が null のとき（新規作成）は `create_new` による書き込みで、アトミックではない（`:39-45`）。
- rename で置き換えるので、保たれるのはパーミッションだけ。ハードリンク・所有者・ACL・xattr は保たれない。

上の隙は残余リスクとして受け入れ、E2E で高頻度の競合テストを行う。metadata の扱いは S4 で OS ごとに確認する。

### 保存失敗の扱い

失敗の原因は正確には分類できない。失敗した後に読み直すのは別の時点の状態だからである。UIでは、読み直した結果として観測した事実を示す。

| 再読込の結果 | 表示 |
|---|---|
| null | 「ファイルが削除されています」 |
| baseline と異なる | 「ディスク上の内容が変わっています」→ 再読込／自分の版を保持／（P1）差分 |
| baseline と同じ | 「保存に失敗しました」＋エラー原文 |
| 再読込自体が失敗 | 「ファイルを読めません」＋両方のエラー原文 |

どの場合も編集内容と下書きは保持する。エラー原文は常に表示し、エラー文字列で処理を分岐させない。

## 3. ファイルを開く依頼の振り分け

方針は次のとおり。**メッセージは非永続の `<mod>.<command>` で送り、shared は「どこに editor があるか」の registry だけに使う。**

### 識別子

- `pane.split` で editor を作るとき、Files は一意な `key` を props に入れる（`{key, file, on}`）。
- props は pane と一緒に保存されるので、`key` は再起動しても変わらない。
- localStorage は props のハッシュ単位なので、**pane ごとの保存領域**として使える（`src/mods.rs:1283-1294`）。props はその pane の初期ファイルで固定されるため、現在開いているファイルは localStorage に保存し、再起動時はそちらを優先する（Claudeレビュー H3 への対策）。

### registry

- editor は自分のキーボードフォーカスを得たとき、`focused().pane` から自分の pane ID を確定する。その pane が `mod === "editor"` で、フォーカスを得たのが自分であれば、自分の pane ID とみなす（推定。S5 で確認）。
- 確定したら shared の `editor.registry` に `{key, pane, tab, lastFocus}` を書く。書くのはフォーカスが変わったときだけで、render ごとには書かない。
- 参照する側は、`panes()` に同じ `pane` の `mod === "editor"` が存在するエントリだけを有効とする。存在しない pane のエントリは、読んだ側が削除する。
- `close()` では自分のエントリを消す（呼ばれない場合もあるので、補助として扱う）。

### 開く依頼

`editor-files` でファイルをクリックしたとき:

1. registry から、現在の tab にある有効なエントリのうち `lastFocus` が最新のものを選ぶ。
2. 見つかれば `run("editor.open:" + JSON.stringify({to: key, req, file, on}))` を送り、続けて `run("pane.focus", {pane})` を送る。
   - アプリのコマンドではない名前は最初の `.` で mod とコマンドに分かれ、`open:{...}` がそのまま `nextCommand()` に届く（`src/window.rs:2914-2936`。推定。S5 で確認）。
   - 表示中の editor コピー全部に届くので、受け取った editor は `to` が自分の `key` のものだけを処理する。
3. 見つからなければ、`pane.split {direction: "right", mod: "editor", props: {key: 新規, file, on}}` を実行する。

editor 側は `nextCommand()` のループ（`cx.spawn` の中）で依頼を処理する。render では処理しない。

- clean なら、そのファイルを開いて自分の `state.focus()` を呼ぶ。
- dirty なら、3択ダイアログを開く: `openOverlay({mod: "editor", props: {role: "dialog", to: key, req}})`。
  - ダイアログの結果は `run("editor.reply:" + JSON.stringify({to, req, choice}))` で返す。
  - 「保存」は保存に**成功したときだけ**次のファイルを開く。失敗したら今の文書を保持し、エラーを表示する。
  - 「破棄」は次のファイルを開く。「キャンセル」は何もしない（受け入れ条件2）。
- ダイアログを表示している間に新しい依頼が来たら、待っている依頼を最新のもので置き換える（最後のクリックを優先）。`req` が一致しない返答は捨てる。

### 制約

- 依頼が届くのは表示中のコピーだけ。Files がクリックされた時点で同じ tab の editor は表示中のはずだが、zoom の裏にある場合は届かない。その場合は `pane.focus` でズームが解除されるかを S5 で確認する。届かなければ新しい pane を開く。
- shared と localStorage はクライアントごとで、pane（と props）はクライアント間で共有される。別のクライアントでは、同じ pane が別のファイルを表示することがある。制約として RECIPE に記載する。

このプロトコルは `core/routing` に純粋関数として実装し、次のケースを unit test で確認する。

- editor が0／1／複数ある場合、別の tab にある場合
- registry に古いエントリが残っている場合、自分の宛先でない依頼を受け取った場合
- dirty の状態で依頼を受け取った場合、ダイアログ中に次の依頼が来た場合
- 保存に失敗した場合、`req` が一致しない返答を受け取った場合

## 4. 実装ステップ（Issueの5ステップに対応）

### Step 1: 検証スパイク

- **S1**: バンドルした `main.js`（external に `fs/promises` を含む）が `herdr-app check` を通り、hot reload されるか
- **S2**: `EditorState.value()` を経由して CRLF・BOM・末尾改行・タブがそのまま保持されるか。正規化される場合は `core/text` で検出と復元を行う。改行コードが混在するファイルは読み取り専用にする
- **S3**: editor のルート要素の `on_key_down` で cmd-s / ctrl-s を受け取れるか（`focusable: true`、EditorState にフォーカスがある状態で）
- **S4**: `writeTextFile` で書ける範囲（ホーム外、読み取り専用ファイル、削除済みファイル）、そのときのエラー原文、OSごとの metadata（symlink・hard link・xattr）の扱い
- **S5**: §3 を実機で確認する
  - `editor.open:{json}` が `nextCommand()` に届くか
  - `focused().pane` から自分の pane ID を確定できるか
  - `pane.focus` の後に `state.focus()` でキーボードが editor に渡るか
  - zoom の裏にある editor に `pane.focus` するとどうなるか
- **S6**: `watchFolder` の即時性と、macOS / Linux / Windows での失敗パターン
- **S7**: EditorState を作り直したときに selection とスクロール位置を移せるか（undo は移せない前提）
- **S8**: 1 MiB と 400 KB のファイルで、入力遅延とハイライトのコスト。しきい値を決める

### Step 2: core と保存の実装

- `core/document`: baseline・現在のテキスト・状態の遷移を実装する。ユニットテストを先に書く
- `adapters/herdr`: FileStore・DraftStore・Registry を実装する。保存失敗後は §2 の表に従って分類する
- **保存キー**
  - editor のルート要素の `on_key_down` で、macOS は cmd-s、それ以外は ctrl-s を処理する。キーボードがその editor にあるときしか発火しないので、宛先を間違えない。
  - keys.json は配布しない。keys.json を一度でも編集するとファイル全体がユーザー所有になるため（`defaults/AGENTS.md:510-512`）、編集を避ける。
  - S3 で `on_key_down` が使えなかった場合だけ、keys.json の `mod:editor` を使う。その場合は R10 のとおり全コピーに届くので、各コピーは自分にフォーカスがあるとき（EditorState の focus/blur で追跡）だけ保存する。
- **外部変更の検知**
  - **ポーリング（必須）**: ローカルは 3秒、リモートは 10秒以上の間隔で `readTextFile` を呼び、baseline と比較する。
    - 前の読み込みが終わるまで次を始めない。
    - 保存中は止める。読んだ内容が保存中のテキストと一致したら、自分の書き込みとして扱う。
    - `window().active` が false の間と、自分の pane が表示中の tab にない間（registry の pane と `panes()`・`spaces()` で判定）は止める。表示状態を直接取得する API はない。
  - **watch（補助・ローカルのみ）**: Files と同じように再armするループにし、各回の handle を保持する。ファイルを切り替えたときと `close()` で `cancel()` する。失敗したらポーリングだけで続ける。保存時の一時ファイル `.herdr-app-write-*` によるイベントは無視する。
  - 外部変更を検知したら、clean なら自動で再読込する。dirty なら帯を表示し、再読込するか自分の版を保持するかを選ばせる。
- `ui`: dirty の表示、保存エラーの帯、外部変更の帯、3択ダイアログ
- `editor-files` の fork と §3 のプロトコル
- 下書き（§5）

### Step 3: 言語対応

- 拡張子から syntax 名へのマップを作る。P0 の拡張子（ts / tsx / js / jsx / mjs / cjs / json / jsonc / rs / py / yaml / yml / toml / md）を unit test で網羅する。
- 既定の syntect には TS・TOML がないので、Files と同じく ts→js、toml→yaml に対応付ける（`defaults/mods/files/main.js:13`）。
- 未知の拡張子は明示的にプレーンテキスト（`"txt"`）にする。
- 開けない場合の画面（R3）と、リモートの場合の画面（R4）を作る。
- S8 で決めたしきい値を超えたら、ハイライトを外す。

### Step 4: テーマ

- `editor-themes/*.json` をスキーマで検証し、syntax マップに変換する。
- syntax のカテゴリは keyword / string / comment / function / type / number / constant / variable / operator / punctuation / boolean / string.escape（`typings.rs:3233-3234`）。
- ダーク／ライトは `settings().dark` で既定値を切り替える。
- 選択したテーマは shared の `editor.theme` に保存する。localStorage は pane ごとに分かれるので使わない。
- テーマを切り替えるときは R8 に従う。

### Step 5: 仕上げ

- 拡張ポイント: `core/extensions` に `onFileOpen` / `beforeSave` を定義する。動的ロードはせず、ビルド時に登録する。
- `scripts/install`:
  - `mods/` と `layouts/` に、既存と重複しない名前でコピーする。名前の衝突は §1 の定数で吸収する。
  - インストールしたファイルの manifest を `data/editor/install.json` に残す。
- `scripts/uninstall`（受け入れ条件5）は次の順に行う。
  1. `layout.switch main`
  2. `panes().filter(p => p.mod === "editor")` の各 pane を `pane.close`（実際には `herdr-app do` 経由で実行する）。mod を消すと、残った pane が空の枠として描画されるため（`src/window.rs:4481`）。
  3. shared の `editor.*` キーを null にする
  4. manifest に記載されたファイルと、`data/editor/` を削除する
- RECIPE.md と preview.png を用意する。複数クライアントの制約（§3）と、undo が消える条件（R8）も RECIPE に書く。

## 5. 下書き（G1）

- **保存先**: `appHome()/data/editor/drafts/<pane key>.{a,b}.json`。`fs/promises` は app home 配下にしか書けない。`mods/` 配下に書くと hot reload が起きる（R13）。
- **キー**: pane の `key` 単位にする。同じファイルを2つの pane で開いても、互いの下書きを上書きしない。中身に正規化したパスと machine を持つ。Windows では区切り文字を `/` にそろえ、比較は大文字小文字を区別しない。
- **書き込み**
  - 変更があるたびに最新のスナップショットをキューに入れ、前の書き込みが終わったらすぐ次を書く（直列化と合成）。debounce はしない。
  - rename がないので、A/B の2スロットに交互に書く。各スロットには `{seq, checksum, path, machine, baselineHash, text, savedAt}` を入れる。
  - 読むときは、チェックサムが正しいスロットのうち seq が大きいほうを採用する。書き込み中にクラッシュしても、1つ前の版が残る。
  - `close()` での flush は補助として扱う。最後の書き込みが終わる前にプロセスが落ちた場合、最新の入力は失われうる。これは残余リスクとして明記する。
- **復元**
  - editor が開いたときに下書きがあれば、帯で「未保存の下書きがあります（日時）」と示し、復元するか破棄するかを選ばせる。
  - 今のディスク内容のハッシュが `baselineHash` と違う場合は、競合として表示する。
- **掃除**
  - 保存に成功したとき、または破棄したときに、その pane の下書きを削除する。
  - 起動時に、registry にも `panes()` にも存在しない key の下書き（孤立した下書き）を一覧にして通知する。
  - 30日を過ぎたものは削除する。

## 6. 検証計画

| 層 | 手段 | 対象 |
|---|---|---|
| unit | Bun test（ports は fake に差し替え） | core 全般、§3 のプロトコル、保存失敗の分類、ポーリングの状態遷移、下書きの A/B 選択、言語マップ |
| static | `herdr-app check` | 両 Mod が最初の描画まで通ること |
| e2e | 隔離した `HERDR_APP_HOME` で実機手順を実行し、`herdr-app shot` で証跡を残す。外部変更・削除・権限変更はスクリプトで起こす | 下記 |

E2E のケース（macOS で全件、Linux / Windows はスモークテストとして ctrl-s・パス・下書き・install / uninstall）:

- Files から開く → 編集 → cmd-s / ctrl-s → ディスクに反映されている
- editor を2つ表示している状態で保存する → フォーカスがある側だけが保存される
- dirty の状態で別ファイルを開く → キャンセル（編集内容が残る）／破棄／保存（失敗した場合は切り替わらない）
- 外部で変更した後に保存する → 拒否されて帯が出る。clean な状態での外部変更は自動で再読込される。外部から高頻度に書き込みながら保存を繰り返す
- 削除されたファイル、権限のないファイル、1 MiB超、不正なUTF-8、NULを含むファイル、未知の拡張子、P0の各拡張子
- リモート space の非UTF-8 ファイルと、読めないファイル
- pane を閉じる → 再び開く → 下書きが復元される
- 再起動後とhot reload後に、編集中のファイルと下書きが復元される
- 1 MiB のファイルで、入力遅延がしきい値以内に収まる
- tab に editor pane を残したまま uninstall する → 空の pane や shared・data が残らず、`layout.switch main` で標準構成に戻る

## 7. ライセンス

- 上流は Apache-2.0。ルートには `LICENSE` と `THIRD-PARTY-NOTICES` があり、`NOTICE` というファイルはない。
- fork する Files の `main.js` については、次を行う。
  - `LICENSE`（Apache-2.0）を同梱する
  - 著作権表示を保持する
  - 変更したファイルに変更した旨を明記する
- Files の SVG アイコンは Lucide のもの。`defaults/icons/LICENSE-Lucide.txt`（ISC）を同梱する。

## 8. 受け入れ条件との対応

| 条件 | 依存 | 見込み |
|---|---|---|
| 1. Filesから開いて編集・保存 | S1, S3, S4, S5, §3 | Filesのforkとcloneしたlayoutが前提 |
| 2. 別ファイルへ移る際の確認 | §3, S5 | 既存のeditorへの振り分けで実現できる。pane closeは下書きの復元で対応（G1、§5） |
| 3. 外部変更を無警告で上書きしない | なし | 通常のケースはAPIが拒否する。rename直前のわずかな隙は残余リスク（§2） |
| 4. .json / .md / .rs を扱える | Step 3, S8, E2E | 可能 |
| 5. 標準Filesを壊さず、削除で元に戻せる | Step 5, E2E | uninstallの手順（pane close → shared・data・ファイルの削除）で戻る |
