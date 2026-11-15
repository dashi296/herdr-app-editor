# ネイティブファイルエディタ 実装計画

対象Issue: #1 / 調査対象: herdrdev/herdr-app `5216e6f` (2026-11-14)

- 改訂1: Codexレビューを反映
- 改訂2: Codex・Claudeの再レビューを反映
- 改訂3: Codex・Claudeの3回目のレビューを反映。G3を決定
- 改訂5（2026-11-16）: スパイク S1〜S6 の結果を反映。R17（読み取り専用ファイルの上書き）と、CRLF のファイルの保存前変換（S2b）を追加。§3 の ack とタイムアウトによるフォールバックをやめ、registry は Files が split の前後の差分で登録する方式にした。対象バージョンを決定
- 改訂4（2026-11-16）: Codex・Claudeの4回目のレビューを反映。主な変更は以下。
  - §3: ack の期限付き処理で editor の重複を防ぐ。依頼を送る順序の根拠を訂正。ダイアログの返答経路を `close()` に一本化
  - §5: 共有の索引ファイルをやめ、ディレクトリ構造で引く方式にした
  - uninstall: request / result の nonce 照合、閉じ方の分岐、layout の復元をスクリプト側に移した
  - 世代トークンの条件を明文化した

引用は上流リポジトリ内のパス（`syntax.rs`・`typings.rs`・`host.rs` は `vendor/gpui-kit/crates/shell/src/` 配下）。「推定」とある箇所はソースから推論したもので、実機で検証する。

## 0. ゲート

### 決定済み（2026-11-16）

G1〜G3 はいずれも決定済み。

- **G1: pane close 時の P0 要件**（R1）→ **要件を変更**
  - 別ファイルへの切替時は3択を出す。
  - pane/tab/layout/app close では、継続保存している下書きから次回復元する。
  - Issue #1 のP0も同じ内容に更新済み。
- **G2: 過大・非UTF-8ファイル**（R3）→ **理由を示すエラー画面を出し、開かない**。Issue #1 のP0も更新済み。
- **G3: 受け入れ条件3の文言**（§2「保存時の競合防止」）→ **条件を改めた**
  - 現在のAPIでは、rename直前のわずかな隙での外部書き込みを防げない。
  - Issue #1 の条件3を「`writeTextFile` が検出できる外部変更を無警告で上書きしない」に更新済み。rename直前の隙は残余リスクとして扱う。

### 残作業

- 次のAPIを Herdr 上流（herdrdev/herdr-app）に提案する（未実施）。
  - 原子的なCAS保存
  - shared キーの削除（`deleteShared`）

### 対象バージョン（決定 2026-11-16）

- **次のリリース（0.1.16 以降）を対象にする。** 計画が前提にしている `EditorState.focus()` / `selected_range()`、`checking()`、`watchFolder` の `cancel()` は master にしかなく、最新リリースの 0.1.15 にはない（`docs/spikes/2026-11-16-step0-s1.md`）。
- スパイクは 0.1.15 で行い、master 固有の API に依存する項目は、次のリリースの後にもう一度確認する。

### 実装前の必須ゲート

- **S5（§3 の振り分け）が実機で通るまで、`editor-files` の fork と §3 の adapter の実装に進まない。**
- `core/document` などの純粋ロジックは S5 に依存しないので、並行して進めてよい。

## 1. ディレクトリ構成

### 結論

Herdr公式ガイドが規定しているのは最小構成（`mods/<name>/main.js` 必須、`mod.json`、追加モジュール、アセット）だけ（`defaults/AGENTS.md:873-880`）。ネストしたファイルは実装上サポートされている。

- watcherのテストは `mods/probe/target/output.js` をリロード対象としている（`src/files.rs:642`）。
- `win98` は `./taskbar.js` などを相対importし（`defaults/mods/win98/main.js:14-21`）、`fonts/` などのサブディレクトリも持つ。

Feature Sliced Designは、レイヤー名はそのまま使わず、**依存方向の一方通行ルールだけ採用**する。

- このModは「1つのView＋少数の機能」で、6層は過剰。
- 決め手は別の制約にある。`herdr`／`gpui-kit`／`gpui-base`／`fs/promises` はHerdrの実行環境でしか解決できない。テストしたいロジックは、これらをimportしない層に隔離する。

### 配布形式

`layouts/<name>.json` を含むものは **layout パッケージ**として共有する（topic `herdr-layout`。`defaults/AGENTS.md:453-459, 481-485`）。ビルド済みJSはcommitする。

名前は次のように扱う。

- mod名・sharedキー・コマンド名・`data/` のディレクトリ名は、**ビルド時の定数1か所**から生成する。
- mod名に使える文字は、ホストが英数字・`-`・`_` に制限している（`src/mods.rs:219-221`）。
  - `.` は `<mod>.<command>` の区切りになる（`src/window.rs:2931`）。
  - `:` はアプリコマンドの shorthand に使われる（`:2914`）。
  - ビルド時の検証は、この制限の補助として行う。
- **インストール時に名前が衝突したら停止する。** 名前を変えたい場合は、定数を変えて再ビルドする手順を README に書く。

### 構成案

```
herdr-app-editor/
├─ src/                       # TypeScript（開発用。配布されない）
│  ├─ core/                   # 純粋ロジック。外部モジュールも他の内部層もimportしない
│  │  ├─ document/            # 状態遷移、revision、I/O世代
│  │  ├─ text/                # NUL/U+FFFD判定、改行コードの判定、CRLF のみのファイルの保存前変換
│  │  ├─ language/            # 拡張子 → syntax名
│  │  ├─ theme/               # エディタテーマJSON検証 → syntax色マップ
│  │  ├─ routing/             # §3 のメッセージ型・期限・split差分による登録・ダイアログの状態機械
│  │  ├─ store/               # A/Bスロット・tombstone・FNV-1aハッシュ（下書きとpane状態で共用）
│  │  ├─ view-model/          # UIの表示状態（dirty表示・帯・ダイアログ・ボタン可否）
│  │  └─ extensions/          # onFileOpen / beforeSave 等のフック型とregistry
│  ├─ ports/                  # interface: FileStore, SlotStore, Registry, Clock。core の型のみ参照
│  ├─ adapters/herdr/         # ports の Herdr 実装
│  ├─ ui/                     # gpui-kit の描画のみ。view-model の出力を描く
│  └─ entries/                # Modごとのエントリ（composition root）
│     ├─ editor.ts
│     ├─ editor-files.ts
│     └─ editor-uninstall.ts
├─ editor-themes/*.json       # ビルド時に main.js へ埋め込む
├─ vendor/herdr-files/        # 上流Files main.js・SVG の原本、LICENSE、THIRD-PARTY-NOTICES の該当部分
├─ types/                     # 実機の herdr.d.ts / gpui-kit.d.ts（Herdrバージョンを記録）
├─ tests/
│  ├─ unit/                   # core（view-model を含む）。ports は fake
│  └─ e2e/                    # $HOME 配下の隔離 HERDR_APP_HOME での実機手順（§6）
├─ scripts/                   # build, install, uninstall, dev
├─ package.json / bun.lock / tsconfig.json / mise.toml
│
├─ mods/                      # ★ビルド成果物（commit）
│  ├─ editor/
│  ├─ editor-files/
│  └─ editor-uninstall/
├─ layouts/editor.json        # main の clone。files → editor-files。cloned_from を記録
├─ RECIPE.md / preview.png
```

`keys.json` は配布しない（§4 Step 2 の保存キー）。

### 依存ルール

```
entries → ui       → ports → core
entries → adapters → ports → core
          ui → core
```

- `core` は外部のホストモジュールも、他の内部層も import しない。
- `ports` が参照してよいのは `core` の型だけ。
- `ui` から `adapters/` への import は禁止する。
- `ui` は描画だけを担い、判断は `core/view-model` に置く。
- これらのルールは dependency-cruiser で強制する。

### ビルド

- `bun build` を使う。
  - Bun 本体のバージョンは `mise.toml` で固定する（CIは `setup-bun` に同じバージョンを渡し、`bun --version` を検査する）。
  - **`--target node --format esm`** に固定する。`--target browser` では `--external fs/promises` を指定しても空のスタブに置き換えられ、しかも `herdr-app check` が通ってしまう（`docs/spikes/2026-11-16-step0-s1.md` S1-2）。minify の方針も build script で固定する。
- ESM で出力し、`herdr`・`gpui-kit`・`gpui-base`・`fs/promises` を external にする。
- 出力後に次を検査する。
  - external の specifier が書き換わっていないこと
  - 禁止されたグローバル（`setTimeout` / `setInterval`）を使っていないこと
  - dynamic import がないこと
  - 名前定数
- `mod.json` の設定:
  - 全 Mod に `"place": "none"` を明記する。個人 layout の表示中に初めて見つかった Mod は、未指定だと `right` に自動配置されるため（`src/window.rs:4229-4242`。標準の layout の表示中は配置されない）。
  - editor には `"focusable": true` を付ける（`defaults/AGENTS.md:882-885`）。
  - `editor-uninstall` には overlay の spec を付ける（`src/window.rs:4982-4985`）。
- エディタテーマは `main.js` に埋め込む。ホームの `themes/<name>.json` は別スキーマ（`defaults/AGENTS.md:333-338`）。
- check 中の fs 呼び出しは、app home の外にある mod フォルダでは**同期的に例外を投げる**（S1-3）。fs の呼び出しは、すべて同期の例外と reject の両方を捕まえる。
- `checking()` の扱い（`defaults/AGENTS.md:928-931`）:
  - check 中も、render に必要な状態（EditorState など）は初期化する。
  - 止めるのは副作用だけ（ポーリング・watch・書き込み・registry の更新・shared への書き込み）。
- CI: clean install → typecheck → unit test → build → 出力の検査 → `git diff --exit-code -- mods/`。
- リリース前のゲート: `herdr-app check` を全 Mod に実行する。editor は通常の props と `role: "dialog"` の props の両方で行う。

## 2. リスクとAPI制約

| # | 内容 | 根拠 | 対策 |
|---|---|---|---|
| R1 | **paneのcloseを止められない**。`close(cx)` は消えた後の後始末で、最大250ms。非表示のコピーでは呼ばれず、アプリ終了時には呼ばれる | `defaults/AGENTS.md:990-1000` | G1、§5 |
| R2 | **標準Filesに拡張ポイントがない** | `defaults/mods/files/main.js` の `show()` | Filesをforkした `editor-files` と、cloneしたlayout。`vendor/` の原本との差分で追従する。`cloned_from` を記録する |
| R3 | **ローカルの読み書きは1 MiBまで・UTF-8のみ** | 読み `src/mod_files.rs:16-21`、書き `:26-29` | G2のエラー画面。NULの判定は読み込み成功後に行う。編集の結果、保存する本文が1 MiBを超えた場合は保存失敗として扱い、編集内容と下書きを保持する |
| R4 | **リモートの読み込みは非UTF-8をU+FFFDに置換し、失敗時は null を返す**。書き込み・watchはローカルのみ | `src/mods.rs:936-949`、`defaults/AGENTS.md:1114-1116` | リモートの編集は初期リリースの対象外。読み取り専用で表示し、U+FFFDを含む場合は「元のバイトが失われている可能性」を帯で示す。null は「読めない」と表示する。ポーリングは10秒以上の間隔 |
| R5 | `PaneInfo` は props を返さない。`run()` は常に null を返し、配送結果も返らない。mod pane への `pane.focus` はキーボードをウィンドウに戻す | `defaults/herdr.d.ts:91, 207-223`、`src/mods.rs:1103-1117`、`src/window.rs:1595-1599, 1754-1755` | §3（Files が registry に登録し、focus → open を送る）。editor はフォーカスを得たいときに自分で `state.focus()` を呼ぶ（0.1.15 にはない。§0 対象バージョン） |
| R6 | `<mod>.<command>` は**表示中のコピーにしか届かず**、そのすべてに届く（overlay のコピーも含む）。届かないと、コマンド名入りのエラートーストがユーザーに表示される（mod の `run` は `person=true` で処理されるため） | `src/mods.rs:745-757`、`src/window.rs:1285-1288, 2896-2908` | §3。宛先を確認し、role で処理を分ける。診断用の ack が届かない場合のトーストは RECIPE に記載する |
| R7 | `watchFolder` の制約: Linuxでは ignored を監視しない、保留は最大64フォルダ、1回で完了するので再armが要る、cancel すると `[]` で resolve する | `defaults/herdr.d.ts:460-479` | ポーリングを必須の経路にする（§4 Step 2） |
| R8 | `EditorState` には language・syntax・scroll・undo を取得・設定する API がない。State を render 内で生成してはいけない | `typings.rs:3203-3238` | テーマや言語を切り替えるときは、render 外で作り直し、value と selection だけを移して、古いものは `release()` する。undo とスクロール位置は失われることを仕様とし、切り替え時に表示する |
| R9 | `herdr-app check` は最初の描画しか検査しない | `defaults/AGENTS.md:54-57` | §6 の E2E |
| R10 | `setShared` は値が変わるたびに shared.json 全体を書き、全 mod を再描画する。`null` を設定してもキーは削除されない（削除するAPIはない）。shared はクライアントごと | `src/mods.rs:451-459, 507-518` | shared のキーは名前空間ごとに1つ（`<ns>`）にまとめ、`null` を「未設定」とみなす。書き込みは registry の更新時だけ |
| R11 | localStorage のファイル名は props を `DefaultHasher` でハッシュしたもので、永続形式として安定する保証がない | `src/mods.rs:1285-1293` | 再起動後も残す必要がある状態は localStorage に置かない（§5） |
| R12 | 1 MiB 近いファイルでの描画性能を確認していない。syntect は差分更新せず全文を再解析する | `syntax.rs:70-79`、`defaults/mods/files/main.js:140-143`（標準 Files は `text.length > 400000` で切り捨てている） | S8 |
| R13 | `fs/promises` には rename・stat がない。`writeFile` はファイルを直接書く（`dir.write`）ので、1ファイルの更新についてクラッシュ時の安全性を保証できない。上限は書き込み 8 MiB、読み込み 64 MiB。**読み取りは `home()` 配下だけ**、書き込みは app home 配下だけ。app home は `HERDR_APP_HOME`、次に `XDG_CONFIG_HOME/herdr-app` | `typings.rs:3877-3889`、`host.rs:183-221, 441`、`src/mods.rs:62-64, 1243-1247` | 下書きと pane の状態は A/B 方式（§5）。起動時に読み書きを自己テストし、失敗したら警告する |
| R14 | 非同期の読み書きの結果が、ファイル切替や編集・保存の後に届く | `defaults/herdr.d.ts:27-32`、`src/mod_files.rs:78` | §4 Step 2「I/O世代」 |
| R15 | ターミナルのレイアウトブロックにフォーカスがある状態で、pane を指定せずに split するとエラーになる | `src/window.rs:2944-2950`、`defaults/herdr.d.ts:259-261` | `pane.split` には常に `pane` を明示する |
| R16 | `pane.focus` は対象 pane の space と tab を選び、zoom 中なら zoom を対象 pane に移す | `src/model.rs:128-133, 507-512` | zoom 中に Files から開くと、zoom が editor に移り、zoom していた terminal が隠れる。RECIPE に記載する |
| R17 | **読み取り専用のファイル（444）でも、ディレクトリが書き込み可能なら `writeTextFile` が上書きしてしまう**（rename で置き換わる） | S4（`docs/spikes/2026-11-16-s2-s4.md`） | mod API には stat がない。ファイルを開くときと保存の前に、ローカルでは `exec("test", ["-w", path])` で書き込み権限を確かめる。書けなければ読み取り専用で表示し、保存も止める。Windows の手段は Windows で確認する |

### 保存時の競合防止

`writeTextFile(path, text, expected)` は、`expected` とディスク上の内容が一致しない書き込みを拒否する（`src/mod_files.rs:27-73`）。ただし次の制約がある。

- 厳密な CAS ではない（rename 直前の隙。`:69-72`）。新規作成はアトミックではない（`:39-45`）。→ G3。
- 保たれるのはパーミッションだけ（`:62`）。**macOS の実機（S4）では、hard link は切れ、独自の xattr は消えた。** symlink は保たれ、リンク先が更新される。所有者と ACL は未確認。RECIPE に記載する。
- 一時ファイルは対象と同じディレクトリに作られる（`:47-60`）。

### 保存失敗の扱い

| 再読込の結果 | 表示 |
|---|---|
| null | 「ファイルが削除されています」 |
| baseline と異なる | 「ディスク上の内容が変わっています」→ 再読込／自分の版を保持／（P1）差分 |
| baseline と同じ | 「保存に失敗しました」＋エラー原文 |
| 再読込自体が失敗 | 「ファイルを読めません」＋両方のエラー原文 |

どの場合も、編集内容と下書きは保持する。エラー原文は常に表示する。

### dirty の表示と外部変更（P0）

- **dirty の表示**: editor のヘッダーで、ファイル名の前に `●` を付け、色を `theme().accent` にする。保存に成功し、baseline と現在のテキストが一致したら消す。保存に失敗した場合は残す。
- **dirty の状態で外部変更があった場合**は、独立した状態 `dirtyExternal` として扱う。
  - 自動では再読込しない。
  - 帯で次の3つを選ばせる。
    - 再読込（自分の編集を破棄し、下書きは残す）
    - 自分の版を保持する。baseline は更新しないので、次に保存すると競合として拒否される。
    - （P1）差分
  - 編集はそのまま続けられる。

## 3. ファイルを開く依頼の振り分け

方針は次のとおり。

- メッセージは非永続の `<mod>.<command>` で送る。
- shared は「どこに editor があるか」の registry だけに使う。
- 配送結果は返ってこない。`panes()` で存在を確かめた pane に focus してから送ることで、配送を確定させる（S5 で確認済み）。

### 配送経路（確認済み）

- `run("editor.open:" + JSON)` は、mod の `run()` から `Request::Run`、`run_as` の順に処理される（`src/mods.rs:1103-1117`、`src/window.rs:2895-2900, 3910`）。
- `editor.open` はアプリのコマンドではないので、`split_once('.')` で `("editor", "open:{json}")` に分かれて届く（`src/window.rs:2914-2936`）。
- **mod の `run()` は FIFO のチャネルを通る**（`src/mods.rs:551-554, 1270`、`src/window.rs:650-675`）。
- `pane.focus` の処理は、最後に同期的に `sync` を呼ぶ。`sync` の中で表示中のコピーの一覧が更新される（`src/window.rs:1550, 3602`）。
- そのため、**`pane.focus` と `editor.open` を同じ処理の中で続けて送れば**、open を配送する時点で対象の editor は表示中になっている（S5 で確認する）。

### 識別子と registry

- Files は `pane.split` のときに一意な `key` を props に入れる（`{key, file, on}`）。
- **registry `{key, pane, tab, lastFocus}` には Files が書く。** split の前後で `panes()` を比べ、新しい `mod === "editor"` の pane を特定する（S5 結果7）。
  - editor の `init` 時点の `focused().pane` は split 元の pane を指すので、使わない（S5 結果6）。
- editor は、nextCommand で `"focus"` を受け取ったときと、クリックされたときに、補助として `lastFocus` を更新する。このとき、`focused().pane` が `mod === "editor"` の pane であることを確かめる。
- 書くのはフォーカスが変わったときだけ。`close()` では registry から削除しない。参照する側が `panes()` で pane の存在を確かめ、存在しないエントリを削除する。

### 開く依頼

`editor-files` でファイルをクリックしたとき:

1. registry から、現在の tab にある有効なエントリのうち `lastFocus` が最新のものを選ぶ。
   - 別の tab の editor も技術的には対象にできる（R16）。ただし、現在の tab に限るのは仕様上の選択とする。
2. 見つかった場合は、同じコールバックの中で続けて送る。
   1. `run("pane.focus", {pane})`
   2. `run("editor.open:" + JSON.stringify({to: key, req, file, on, sentAt: Date.now()}))`
   - `panes()` に存在する pane へ focus してから送れば、FIFO により open の配送時点で editor は表示中になっている（S5 結果1）。そのため、**ack を待ったフォールバックはしない。**
   - ack を待つ方式は、`pane.focus` の zoom の移動で送り主が非表示になると ack が届かず、editor が重複するので採らない（S5 結果5）。
3. editor は、`to` が自分で、かつ `Date.now() - sentAt` が 2000ms 以内のときだけ、依頼を受理する。期限は、hot reload やコピーの再起動の後に古い依頼を処理しないための安全策。
   - 受理したら `run("editor-files.ack:…")` を返す。これは診断ログ用で、Files の動作には使わない。
4. 見つからない場合: `pane.split {pane: 現在のpane, direction: "right", mod: "editor", props: {key: 新規, file, on}}` の後、前後の `panes()` を比べて registry に登録する。
5. `req` は一意にする。editor は、処理済みの `req` を無視する。

### editor 側の処理

- `init()` の冒頭で role によって分岐する。
  - role が `dialog` のコピーは、ポーリング・下書き・registry・open の処理を一切起動しない。
- 通常の editor は、`nextCommand()` のループで `focus` / `open` / `reply` を受け取る。
  - **ループの中では await しない。** 受け取った処理は別の `cx.spawn` に回し、ack の遅れを防ぐ。
  - render では処理しない。
- `open` を受理した場合:
  - clean なら、そのファイルを開いて `state.focus()` を呼ぶ。
  - dirty なら、3択ダイアログを開く。
    - `openOverlay({mod: "editor", kind: "dialog", modal: true, props: {role: "dialog", to: key, req}})`
    - 返り値の overlay ID を保持する。
- ダイアログの返答:
  - **返答は `close()` の1か所から送る。** ボタンを押したときは選択を記録して自分を閉じ、Esc で閉じられたときは cancel とする。どちらも `close()` から `run("editor.reply:" + JSON.stringify({to, req, choice}))` を送る（Esc でも `close()` は呼ばれる。`src/window.rs:1372-1377, 3864-3870`）。
  - editor は、**`req` ごとに最初の返答だけを採用する。**
  - 「保存」は、保存に成功したときだけ次のファイルを開く。「破棄」は次のファイルを開く。「キャンセル」は何もしない。
  - 返答を処理したら、editor は自分で `state.focus()` を呼ぶ。キーボードは自動では戻らない。
- 回復規則: ダイアログの返答を待っている状態で、ユーザーが editor に入力やクリックをした場合は、返答が失われたとみなして cancel として扱う（modal のダイアログが出ている間は、editor を操作できないため）。overlay が消えたことを直接検知する API はない。
- ダイアログの表示中に次の依頼が来た場合は、既存のダイアログを `closeOverlay(id)` で閉じ、新しい `req` でダイアログを開き直す。閉じたダイアログの `close()` が返す cancel は古い `req` の返答なので捨てる。

### 制約

- shared と下書きはクライアントごと、pane（と props）はクライアント間で共有される。RECIPE に記載する。
- 診断用の ack を返す前に、Files を含む stack の子や layout が切り替わる、または zoom の移動で Files が隠れると、ack が届かずにエラートーストが出る（R6、S5 結果5）。RECIPE に記載する。トーストを避けたい場合は ack を省く。
- ユーザーが keys.json の global に cmd-s を割り当てた場合、そちらが優先される（推定。S3 で確認する）。

このプロトコルは `core/routing` に状態機械として実装し、次のケースを unit test で確認する。

- editor が0／1／複数ある場合、別の tab、zoom の裏にある場合
- 期限切れの依頼、`req` が重複した場合、registry に古いエントリが残っている場合、split 前後の差分で pane を特定する場合
- dirty の状態で依頼が来た場合、ダイアログ中に次の依頼が来た場合、返答が2回来た場合、返答が失われた場合の回復
- 保存に失敗した場合、ダイアログのコピーが `open` を受け取った場合

## 4. 実装ステップ（Issueの5ステップに対応）

### Step 1: 検証スパイク

- **S1**: バンドルした `main.js` が `herdr-app check` を通り、hot reload されるか
- **S2**: `EditorState.value()` を経由して CRLF・BOM・末尾改行・タブがそのまま保持されるか → **保持される**（混在や単独の CR も同じ）。復元処理と、改行コードが混在するファイルを読み取り専用にする規則は不要。
  - **S2b**: CRLF のファイルで Enter を押すと **`\n` が挿入される**。CRLF のみだったファイルは、保存の直前に単独の `\n` を `\r\n` に変換する（`core/text`。`docs/spikes/2026-11-16-s2b-esc.md`）
- **S3**: ルート要素の `on_key_down` で cmd-s / ctrl-s を受け取れるか。keys.json の global に割り当てた場合との優先順位も確かめる
  - cmd-s / ctrl-s には既定のバインドがない（`defaults/keys.json`、`keys.macos.json`）。
  - gpui はキーバインドを `on_key_down` より先に処理する（推定）。
- **S4**: `writeTextFile` の動作を確認する。
  - 対象: ホーム外のパス、読み取り専用ファイル、ディレクトリに書き込めないケース、削除済みファイル、1 MiB を超える保存
  - 確認内容: エラー原文と、OSごとの metadata の扱い
- **S5（必須ゲート）**: §3 を実機で確認する。→ **0.1.15 で確認済み**（`docs/spikes/2026-11-16-s5-routing.md`、Esc は `docs/spikes/2026-11-16-s2b-esc.md`）。次のリリースでの `state.focus()` の確認だけが残っている。
  - FIFO による配送順、期限と待ち時間の実測値
  - hot reload 直後に古い依頼を処理しないこと
  - zoom、複数の editor、連続クリック、ダイアログ中の依頼
  - `focused().pane` で自分の pane ID を確定できるか
  - `state.focus()` でキーボードが editor に渡るか
- **S6**: `watchFolder` の即時性と、macOS / Linux / Windows での失敗パターン → **macOS は確認済み**（約160ms、再帰的に通知される。1 MiB の `readTextFile` は約1ms。`docs/spikes/2026-11-16-s6-watch.md`）。Linux / Windows は未確認
- **S7**: EditorState を作り直したときに selection を移せるか
- **S8**: 1 MiB と 400 KB のファイルで、入力遅延とハイライトのコスト。しきい値を決める → **確認済み**。主な原因はハイライト。100 KB を超えるファイルはハイライトを切る（`docs/spikes/2026-11-16-trial2.md`）

### Step 2: core と保存の実装

- `core/document`: 状態遷移、revision、I/O世代。ユニットテストを先に書く
- `adapters/herdr`: FileStore・SlotStore・Registry を実装する
- **保存キー**
  - ルート要素の `on_key_down` で、macOS は cmd-s、それ以外は ctrl-s を処理する。keys.json は配布しない（`defaults/AGENTS.md:510-512`）。Editor にフォーカスがあるときに届くことは S3 で確認済み。Editor の外側をクリックしたときは、`on_mouse_down` でルートの handle にフォーカスを移す。
  - S3 が成立しなかった場合だけ、keys.json の `mod:editor` を使う。その場合は全コピーに届くので、フォーカスがあるコピーだけが保存する。
- **I/O世代**（R14）
  - 文書の内容を表す `revision`（編集のたびに増える）と、非同期 I/O の `generation` を分けて持つ。
  - `generation` は次のときに失効させる: 保存の開始時・成功時、ファイルの切替、再読込、破棄、下書きの復元。
  - poll の結果を適用するのは、`{path, machine, generation, baselineHash}` が一致し、かつ読み込み開始時から `revision` が変わっていない場合だけ。
- **外部変更の検知**
  - **ポーリング（必須）**: ローカルは3秒、リモートは10秒以上の間隔。
    - 前の読み込みが終わるまで次を始めない。保存中は止める。
    - 読んだ内容が保存中のテキストと一致したら、自分の書き込みとして扱う。
  - **表示中の判定**: 次をすべて満たすときだけポーリングする。
    - `window().active` が true
    - 自分の pane の space が `SpaceInfo.active`
    - 自分の pane の tab がその space の active tab
    - その tab が zoom 中（`TabInfo.zoomed`）なら、自分が `PaneInfo.zoomed === true`
    - layout が tab を表示しているかは API で取れない。誤って「表示中」と判定しても、ポーリングが余分に走るだけで済む。
  - **watch（補助・ローカルのみ）**: 親ディレクトリを監視する。
    - 現在の `FolderWatch` を `activeWatch` として保持する。
    - 次のときに必ず `cancel()` する: パスの変更、非表示になったとき、`window().active` が false になったとき、`close()`。保留中の watch が64の上限を占有し続けないようにするため。
    - resolve の後は、watch の世代とパスが現在と一致するときだけ再armする。
    - 失敗したらポーリングだけで続ける。`.herdr-app-write-*` のイベントは無視する。
    - 通知は親ディレクトリ以下のすべての変更で届く（S6）。返ったパスに自分のファイルが含まれる場合と、ルートが返った場合だけ再読込する。
  - 外部変更を検知した場合、clean なら自動で再読込する。dirty なら `dirtyExternal` にする（§2）。
- `ui`: view-model の出力を描画する
- `editor-files` の fork と §3（S5 の後）
- 下書き（§5）

### Step 3: 言語対応

- P0 の拡張子（ts / tsx / js / jsx / mjs / cjs / json / jsonc / rs / py / yaml / yml / toml / md）のマップを、unit test で網羅する。
- ts→js、toml→yaml に対応付ける（`defaults/mods/files/main.js:13`）。未知の拡張子は `"txt"` にする。
- 開けない場合（R3）とリモートの場合（R4）の画面を作る。
- S8 で決めたしきい値を超えたら、ハイライトを外す。

### Step 4: テーマ

- `editor-themes/*.json` を検証し、syntax マップに変換する。
  - カテゴリは keyword / string / comment / function / type / number / constant / variable / operator / punctuation / boolean / string.escape（`typings.rs:3233-3234`）。
- ダーク／ライトは `settings().dark` で切り替える。
- 選択したテーマは shared の名前空間キーに保存する。
- 切り替えるときは R8 に従う。

### Step 5: 仕上げ

- **拡張ポイント**: `core/extensions` に `onFileOpen` / `beforeSave` を定義する。ビルド時に登録する。
- **`scripts/install`**
  - Herdr が起動していなければ中止する（`herdr-app status` で確認）。
  - 名前が衝突したら停止する（§1）。
  - コピーしたファイルと、インストール前に表示していた layout 名（`herdr-app status` の `layout`。`src/window.rs:3954-3956`）を manifest（`data/<ns>/install.json`）に記録する。
- **`scripts/uninstall`**（受け入れ条件5）。CLI では mod pane を列挙できず、shared も変更できない（`src/window.rs:3967-4006`、`src/control.rs:73-97`）。そのため、同梱する `editor-uninstall` Mod に処理を任せる。
  1. Herdr が起動していなければ中止し、起動するよう促す。起動していない状態で mod を消すと、保存済みの layout に残った editor pane が次回 "no mod folder" と表示されるため（`src/window.rs:1760-1762`）。
  2. 古い `uninstall-result.json` を削除し、nonce を含む `data/<ns>/uninstall-request.json` を書く。
  3. `herdr-app do mod.open '{"name":"editor-uninstall"}'` で起動する。
     - `mod.open` は props を渡せず、開いていれば閉じる toggle になっている（`src/commands.rs:87`、`src/window.rs:3476-3487`）。
     - そのため Mod は、request ファイルがあるときだけ処理を実行する。手動で開いた場合は何もしない。
  4. Mod は `spaces()` と `panes()` から構造を調べ、editor の pane ごとに閉じ方を決める。
     - tab 内に他の pane がある場合: `pane.close {pane}`
     - tab の最後の pane だが、space に他の tab がある場合: `tab.close {id}`
     - space の最後の tab の場合: Mod 自身のダイアログでユーザーに確認し、承認されたら `space.close {id, confirmed: true}` を直接送る。`tab.close` から転送された `space.close` は `confirmed` を引き継がず、ホストの確認ダイアログが出るため（`src/window.rs:3027-3034, 3083-3087, 3154-3156`）。
     - 未接続のマシンにある pane は閉じられない（`src/window.rs:2479-2487, 2966-2972`）。一覧で示す。
     - 閉じるたびに、`panes()` から消えたことを確認する。
  5. editor の `close()` が下書きを書き終えるのを待つ（最大250msに余裕を見て1秒）。
  6. Mod は shared の名前空間キーを null にする。
  7. Mod は結果を A/B 方式で `uninstall-result` に書く。結果には nonce、`status: "complete"`、checksum を含める。
  8. スクリプトは、nonce が一致し、状態が complete で、checksum が正しいことを、タイムアウト付きでポーリングして確認する。失敗があればファイルの削除を中止する。
  9. スクリプトが `herdr-app do layout.switch '{"name":"<元のlayout>"}'` を実行し、`herdr-app status` の `layout` で切り替わったことを確認する。
     - Mod 側では行わない。`layout.switch` は overlay をすべて閉じるので、Mod の処理が打ち切られるため（`src/window.rs:1058-1062`）。
     - 存在しない layout 名を指定してもエラーにならない（`:1039-1042`）ので、切り替え後の確認が必要。
  10. `mods/<各mod>/` をフォルダごと削除する（ロード時に `jsconfig.json` などが追加で書かれるため。`src/mods.rs:317-319`）。`layouts/editor.json` も削除する。
  11. `data/editor-files/` と `data/editor-uninstall/` を削除する（ロードしたコピーごとに作られるため。`src/mods.rs:1285-1286`）。`data/<ns>/` は、未保存の下書きがなければ削除する。残す場合は、その場所を表示する。
- RECIPE.md と preview.png を用意する。次の点を書く。
  - 複数クライアントの制約
  - undo とスクロール位置が失われる条件
  - zoom が editor に移ること（R16）
  - 診断用の ack が届かない場合のトースト
  - 未接続マシンの pane が残ること

## 5. 下書きと pane の状態（G1）

### ストア（下書きと pane の状態で共用）

- `core/store` に A/B スロットのストアを実装する。
- 各スロットは `{schema, seq, checksum, deleted, payload}` の形にする。
  - checksum は、`checksum` 以外のフィールドを正規化した JSON にかける。
  - seq は、2つのスロットの最大値＋1にする。
- 読むときは、チェックサムが正しいスロットのうち seq が大きいほうを採用する。`deleted: true`（tombstone）なら「無い」とみなす。
- 削除は次の順に行う。
  1. 次のスロットに、高い seq の tombstone を書く。
  2. 古い**有効なスロットを先に** unlink する。
  3. 最後に tombstone を unlink する。
  - どの段階でクラッシュしても、古い下書きは復活しない。この全順序を unit test で確認する。
- ストアへの書き込みは、プロセス内で単一の writer キューに集約する（module scope は同じソースの版のコピー間で共有される。`defaults/AGENTS.md:976-978`）。
- 1スロットのサイズを検査する（本文 1 MiB＋metadata。`fs.writeFile` の上限は 8 MiB）。書き込みに失敗した場合は、編集内容を保持したまま帯で警告する。

### 配置

- `appHome()/data/<ns>/` 配下に置く。localStorage は使わない（R11）。
  - `drafts/<fnv1a(machine + "\0" + path)>/<ownerKey>.{a,b}.json`（下書き）
  - `panes/<key>.{a,b}.json`（pane ごとの「今開いているファイル」）
- **共有して書き換える索引ファイルは持たない。** `(machine, path)` から下書きを探すときは、ディレクトリを `readdir` すればよい。複数の editor が同時に書いても、更新が失われることはない。
- ハッシュには FNV-1a を `core/store` で実装し、ビルドをまたいでも同じ値になるようにする。
- 下書きの payload には `{machine, path, ownerKey, baselineHash, text, savedAt}` を入れる。ディレクトリ名のハッシュが衝突した場合に備え、読むときに `machine` と `path` を照合する。
- パスは、保存した正確な文字列で比較する。Windows で大文字小文字を同一視するのは、正確な比較で一致しなかった場合の補助検索に限る。

### 書き込みの間隔

- 単一の writer で、**trailing debounce 250ms、まだ保存していない最初の変更からの最大待ち 1秒**とする。
- 書き込みが終わったとき、さらに新しいスナップショットがあれば、もう一度書く。
- 仕様: **どの編集も、行ってから1秒以内に、いずれかの有効なスロットに書き込まれる。** E2E では平均ではなく、各 revision について確かめる。
- `close()` での flush は補助として扱う。

### 保存・破棄

- 保存に成功したとき、または破棄したときは、その pane の下書きをストアの手順で削除する。

### 復元

- ファイルを開くときは、`drafts/<hash>/` を `readdir` し、同じ `(machine, path)` の下書きを探す。所有者の pane が存在しないか、自分のものであれば、復元の候補として帯で示す。新しい pane で開いた場合も同じように探す。
- ディスクの内容のハッシュが `baselineHash` と違う場合は、競合として示す。
- editor の起動時に、どのファイルにも結びつかない下書きを一覧にし、「開く／復元／削除」を選べるようにする。
- 30日を過ぎたものは削除する。

### pane の状態

- 「今開いているファイル」は `panes/<key>` に保存する。再起動したときは、props の初期ファイルよりこちらを優先する。

## 6. 検証計画

| 層 | 手段 | 対象 |
|---|---|---|
| unit | Bun test（ports は fake） | core 全般: routing の状態機械（期限・返答の一意性・回復・split 差分による登録）、revision と I/O世代、保存失敗の分類、ポーリングと watch の世代、ストア（A/B・tombstone の全クラッシュ順序・同時書き込み）、言語マップ、view-model |
| static | `herdr-app check` | 全 Mod（editor は通常の props と dialog の props の両方） |
| e2e | `$HOME` 配下の隔離した `HERDR_APP_HOME` で実機手順を実行し、`herdr-app shot` で証跡を残す | 下記 |

E2E のケース。macOS では全件を行う。Linux / Windows では最低限、保存・保存の競合・外部変更・1 MiB の境界・権限エラー・pane close からの復元・install / uninstall を行う。

- Files から開く → 編集すると dirty の表示が出る → cmd-s / ctrl-s → ディスクに反映され、dirty の表示が消える。保存に失敗した場合は dirty の表示が残る
- editor を2つ表示している状態で保存する → フォーカスがある側だけが保存される
- zoom の裏にある editor に向けて Files で開く。連続クリック。hot reload 直後や高負荷の状態で開く → editor が重複しない
- dirty の状態で別ファイルを開く → キャンセル／破棄／保存（失敗した場合は切り替わらない）／Esc でダイアログを閉じる
- 外部で変更した後に保存する → 拒否される。clean な状態の外部変更は自動で再読込される。dirty な状態の外部変更では帯が出て、編集内容は保たれる。外部から高頻度に書き込みながら保存を繰り返す
- 削除されたファイル、権限のないファイル、ディレクトリに書き込めないケース、1 MiB超、編集して1 MiBを超えた状態での保存、不正なUTF-8、NUL、未知の拡張子、P0の各拡張子
- リモートの非UTF-8ファイルと、読めないファイル
- pane を閉じる → Files から同じファイルを開く → 下書きの復元が提示される
- 再起動後、hot reload 後、Herdr の更新後に、編集中のファイルと下書きが復元される
- 入力のたびに、1秒以内に下書きが書き込まれる
- 1 MiB のファイルで、入力遅延がしきい値以内に収まる
- Files を含む stack の子を切り替える、zoom の裏の editor に向けて開く → editor が重複せず、トーストが出る場合は RECIPE の記述と一致すること
- tab に editor pane を残したまま uninstall する（space の最後の pane の場合も含む）→ pane と mod フォルダが残らず、shared の名前空間キーが null で editor が状態なしとして扱い、元の layout に戻る
- Herdr が起動していない状態で uninstall する → 中止される

## 7. ライセンス

- 上流は Apache-2.0（`LICENSE`、`THIRD-PARTY-NOTICES`。`NOTICE` ファイルはない）。
- fork する Files の `main.js` については、次を行う。
  - `LICENSE` を同梱する
  - 著作権表示を保持する
  - 変更した旨を明記する
- Files の SVG アイコンは、出典を上流の履歴で確認する。`defaults/icons/LICENSE-Lucide.txt` はあるが、`defaults/mods/files/*.svg` 自体に出典の記載はない。確認できない場合は、`THIRD-PARTY-NOTICES` の該当部分と Lucide のライセンスを保守的に同梱する。

## 8. 受け入れ条件との対応

| 条件 | 依存 | 見込み |
|---|---|---|
| 1. Filesから開いて編集・保存 | S1, S3, S4, **S5（ゲート）** | S5が通れば実現できる |
| 2. 別ファイルへ移る際の確認 | **S5（ゲート）**, §3 | 同上。pane close は §5 の復元で対応 |
| 3. APIが検出できる外部変更を無警告で上書きしない | G3（決定済み） | APIが拒否する。rename直前の隙は残余リスク |
| 4. .json / .md / .rs を扱える | Step 3, S8, E2E | 可能 |
| 5. 標準Filesを壊さず、削除で元に戻せる | Step 5, E2E | `editor-uninstall` で戻す。shared の名前空間キーは null として残る（削除するAPIがないため）。未接続マシンの pane は残余リスク |
