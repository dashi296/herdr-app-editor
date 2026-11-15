# ネイティブファイルエディタ 実装計画

対象Issue: #1 / 調査対象: herdrdev/herdr-app `5216e6f` (2026-11-14)

- 改訂1: Codexレビューを反映
- 改訂2: Codex・Claudeの再レビューを反映
- 改訂3（2026-11-16）: Codex・Claudeの3回目のレビューを反映。主な変更は以下。
  - §3: 依頼を送る順序、確認応答（ack）、ダイアログの扱い
  - §5: 下書きをパス索引で見つけられるようにした
  - アンインストール用Modの追加、世代トークン、S5を実装前の必須ゲートにした

引用は上流リポジトリ内のパス。「推定」とある箇所はソースから推論したもので、実機で検証する。

## 0. ゲート

### 決定済み（2026-11-16）

- **G1: pane close 時の P0 要件**（R1）→ **要件を変更**
  - 別ファイルへの切替時は3択を出す。
  - pane/tab/layout/app close では、継続保存している下書きから次回復元する。
  - Issue #1 のP0も同じ内容に更新済み。
- **G2: 過大・非UTF-8ファイル**（R3）→ **理由を示すエラー画面を出し、開かない**。Issue #1 のP0も更新済み。

### 要判断

- **G3: 受け入れ条件3の文言**（§2「保存時の競合防止」）
  - 現在のAPIでは、rename直前のわずかな隙での外部書き込みを防げない。
  - 推奨: Issueの条件3を「APIが検出できる外部変更を無警告で上書きしない」に改める。
  - あわせて、原子的なCAS保存APIを Herdr 上流に提案する。
  - 改めるまでは、条件3を達成済みとして扱わない。

### 実装前の必須ゲート

- **S5（§3 の振り分け）が実機で通るまで、Step 2 以降に進まない。**

## 1. ディレクトリ構成

### 結論

Herdr公式ガイドが規定しているのは最小構成（`mods/<name>/main.js` 必須、`mod.json`、追加モジュール、アセット）だけ（`defaults/AGENTS.md:873-880`）。ネストしたファイルは禁止されておらず、実装上もサポートされている。

- watcherのテストは `mods/probe/target/output.js` をリロード対象としている（`src/files.rs:642`）。
- `win98` は `./taskbar.js` などを相対importし（`defaults/mods/win98/main.js:14-21`）、`fonts/` などのサブディレクトリも持つ。

Feature Sliced Designは、レイヤー名はそのまま使わず、**依存方向の一方通行ルールだけ採用**する。

- このModは「1つのView＋少数の機能」で、6層は過剰。
- 決め手は別の制約にある。`herdr`／`gpui-kit`／`gpui-base`／`fs/promises` はHerdrの実行環境でしか解決できない。テストしたいロジックは、これらをimportしない層に隔離する。

### 配布形式

`layouts/<name>.json` を含むものは **layout パッケージ**として共有する（topic `herdr-layout`。`defaults/AGENTS.md:453-459, 481-485`）。ビルド済みJSはcommitする。

名前は次のように扱う。

- mod名・sharedキー・コマンド名・`data/` のディレクトリ名は、**ビルド時の定数1か所**から生成する。
- mod名には `.` と `:` を含めない。コマンドのパースが壊れるため（`src/window.rs:2914, 2933`）。ビルド時に検証する。
- **インストール時に名前が衝突したら停止する。** 成果物に名前が埋め込まれているので、自動で名前を変えると壊れる。名前を変えたい場合は、定数を変えて再ビルドする手順を README に書く。

### 構成案

```
herdr-app-editor/
├─ src/                       # TypeScript（開発用。配布されない）
│  ├─ core/                   # 純粋ロジック。外部モジュールも他の内部層もimportしない
│  │  ├─ document/            # 状態遷移、baseline、世代トークン
│  │  ├─ text/                # NUL/U+FFFD判定, EOL/BOM/末尾改行の検出と復元
│  │  ├─ language/            # 拡張子 → syntax名
│  │  ├─ theme/               # エディタテーマJSON検証 → syntax色マップ
│  │  ├─ routing/             # §3 のメッセージ型・宛先選択・ack・ダイアログの状態機械
│  │  ├─ draft/               # 下書きのシリアライズ・A/B選択・tombstone・パス索引
│  │  ├─ view-model/          # UIの表示状態（帯・ダイアログ・ボタン可否）を作る純粋関数
│  │  └─ extensions/          # onFileOpen / beforeSave 等のフック型とregistry
│  ├─ ports/                  # interface: FileStore, DraftStore, PaneStore, Registry, Clock。core の型のみ参照
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
- `ui` は描画だけを担い、判断はすべて `core/view-model` に置く。gpui の UI は Bun ではテストできないため、`herdr-app check` と E2E で確認する。
- これらのルールは dependency-cruiser で強制する。

### ビルド

- `bun build` を使う。
- **Bun 本体のバージョンは `mise.toml` で固定する**（CIでは `setup-bun` に同じバージョンを渡す）。`bun.lock` が固定するのは依存だけ。CIで `bun --version` を検査する。
- ESM で出力し、`herdr`・`gpui-kit`・`gpui-base`・`fs/promises` を external にする。出力後に specifier が書き換わっていないことを検査する。1ファイルにまとめるのは配布を単純にするための選択。
- `mod.json` の設定:
  - 全 Mod に `"place": "none"` を明記する。未指定だと `right` として自動配置されるため（`src/window.rs:4229-4242`）。
  - editor には `"focusable": true` を付ける（`defaults/AGENTS.md:882-885`）。
- エディタテーマは `main.js` に埋め込む。ホームの `themes/<name>.json` は別スキーマ（`defaults/AGENTS.md:333-338`）。
- CI: clean install → typecheck → unit test → build → specifier・名前定数の検査 → `git diff --exit-code -- mods/`。
- リリース前のゲート: `herdr-app check` を全 Mod に実行する。
- `init()` の冒頭で `if (checking()) return;` とする（`defaults/AGENTS.md:928-931`）。

## 2. リスクとAPI制約

| # | 内容 | 根拠 | 対策 |
|---|---|---|---|
| R1 | **paneのcloseを止められない**。`close(cx)` は消えた後の後始末で、最大250ms。非表示のコピーでは呼ばれず、アプリ終了時には呼ばれる | `defaults/AGENTS.md:990-1000` | G1、§5 |
| R2 | **標準Filesに拡張ポイントがない** | `defaults/mods/files/main.js` の `show()` | Filesをforkした `editor-files` と、cloneしたlayout。`vendor/` の原本との差分で追従する。`cloned_from` を記録する |
| R3 | **ローカルの読み書きは1 MiBまで・UTF-8のみ** | 読み `src/mod_files.rs:16-21`、書き `:26-29` | G2のエラー画面。NULの判定は読み込み成功後に行う。**編集の結果、保存する本文が1 MiBを超えた場合**は保存失敗として扱い、編集内容と下書きを保持する |
| R4 | **リモートの読み込みは非UTF-8をU+FFFDに置換し、失敗時は null を返す**。書き込み・watchはローカルのみ | `src/mods.rs:936-949`、`defaults/AGENTS.md:1114-1116` | リモートの**編集は初期リリースの対象外**。読み取り専用で表示する。U+FFFDを含む場合は「元のバイトが失われている可能性」を帯で示す（非UTF-8とは断定しない）。null は「読めない」と表示する。ポーリングは10秒以上 |
| R5 | `PaneInfo` は props を返さない。`run()` は常に null を返し、配送結果も返らない。mod pane への `pane.focus` はキーボードをウィンドウに戻す | `defaults/herdr.d.ts:91, 207-223`、`src/mods.rs:1103-1117`、`src/window.rs:1595-1599` | §3（ack とタイムアウト） |
| R6 | `<mod>.<command>` は**表示中のコピーにしか届かず**、そのすべてに届く（ダイアログ overlay のコピーも含む）。届かないと、コマンド名入りのエラートーストが出る | `src/mods.rs:745-757`、`src/window.rs:1285-1288, 2936-2939` | §3。宛先を確認し、role で処理を分ける |
| R7 | `watchFolder` の制約: Linuxでは ignored を監視しない、上限がある、1回で完了するので再armが要る、cancel すると `[]` で resolve する | `defaults/herdr.d.ts:460-479` | ポーリングを必須の経路にする。watch のループは世代で止める（§4 Step 2） |
| R8 | `EditorState` には language・syntax・scroll・undo を取得・設定する API がない。State を render 内で生成してはいけない | `typings.rs:3203-3238` | テーマや言語を切り替えるときは、render 外で作り直し、value と selection だけを移して、古いものは `release()` する。**undo とスクロール位置は失われる**ことを仕様とし、切り替え時に表示する |
| R9 | `herdr-app check` は最初の描画しか検査しない | `defaults/AGENTS.md:54-57` | §6 の E2E |
| R10 | `setShared` は値が変わるたびに shared.json 全体を書き、全 mod を再描画する。`null` を設定してもキーは削除されない。shared はクライアントごと | `src/mods.rs:451-459, 507-518` | shared のキーは名前空間ごとに1つ（`<ns>`）にまとめ、`null` を「未設定」とみなす。書き込みは registry の更新時だけ |
| R11 | localStorage のファイル名は、ビルドごとに安定しないハッシュで決まる（上流自身が FNV-1a と対比して注記している） | `src/mods.rs:326, 1289-1293` | 再起動後も残す必要がある状態（今開いているファイル）は localStorage に置かない（§5） |
| R12 | 1 MiB 近いファイルでの描画性能を確認していない。syntect は差分更新しない | `syntax.rs:76-79`、`defaults/mods/files/main.js:140-143`（標準 Files は `text.length > 400000` で切り捨てている） | S8 |
| R13 | `fs/promises` には rename・stat がない。`writeFile` は truncate してから書くのでアトミックではない。上限は 8 MiB。**読み取りは `home()` 配下だけ**、書き込みは app home 配下だけ | `typings.rs:3877-3889`、`engine/quickjs/host.rs:183-221`、`src/mods.rs:1243-1247` | 下書きは A/B 方式＋tombstone（§5）。`HERDR_APP_HOME` が `$HOME` の外にあると下書きを読めないので、起動時に自己テストし、失敗したら警告する |
| R14 | 非同期の読み書きの結果が、ファイル切替や編集の後に届く | `defaults/herdr.d.ts:27-32` | load / save / poll / watch / draft のすべてに**世代トークン**を持たせる。結果を適用する直前に、世代・パス・baseline・dirty を再確認する |
| R15 | ターミナルのレイアウトブロックにフォーカスがある状態で、pane を指定せずに split するとエラーになる | `src/window.rs:2944-2950`、`defaults/herdr.d.ts:259-261` | `pane.split` には常に `pane` を明示する |

### 保存時の競合防止

`writeTextFile(path, text, expected)` は、`expected` とディスク上の内容が一致しない書き込みを拒否する（`src/mod_files.rs:27-73`）。通常の外部変更や古いスナップショットからの上書きは、これで防げる。ただし次の制約がある。

- **厳密な CAS ではない。** rename 直前の再確認と rename の間に外部プロセスが書き込むと、その変更を置き換えてしまう（`:69-72`）。新規作成（`expected` が null）はアトミックではない（`:39-45`）。→ G3。
- **ソース上、保たれるのはパーミッションだけ**（`:47-72`）。所有者・ACL・xattr・hard link がどうなるかは S4 の実機結果で確定するまで未保証として扱う。
- 一時ファイルは対象と同じディレクトリに作られる（`:47-60`）。ディレクトリに書き込めないと、ファイル自体が書き込み可能でも失敗する。

### 保存失敗の扱い

失敗の原因は正確には分類できない。UIでは、読み直した結果として観測した事実を示す。

| 再読込の結果 | 表示 |
|---|---|
| null | 「ファイルが削除されています」 |
| baseline と異なる | 「ディスク上の内容が変わっています」→ 再読込／自分の版を保持／（P1）差分 |
| baseline と同じ | 「保存に失敗しました」＋エラー原文 |
| 再読込自体が失敗 | 「ファイルを読めません」＋両方のエラー原文 |

どの場合も、編集内容と下書きは保持する。エラー原文は常に表示する。

## 3. ファイルを開く依頼の振り分け

方針は次のとおり。

- メッセージは非永続の `<mod>.<command>` で送る。
- shared は「どこに editor があるか」の registry だけに使う。
- 配送の結果が分からないので、**ack とタイムアウト**で確認する。

### 配送経路（確認済み）

`run("editor.open:" + JSON)` は次の経路で処理される。

1. mod の `run()` から `Request::Run` を経て `run_as` に入る（`src/mods.rs:1103-1117`、`src/window.rs:2895-2900, 3910`）。
2. `split_once(':')` で切った `editor.open` はアプリのコマンドではないので、`split_once('.')` で `("editor", "open:{json}")` に分かれる（`src/window.rs:2914-2936`）。
3. JSON 内の `.` や `:` は影響しない。チャネルは unbounded（`src/mods.rs:982`）。

### 識別子と registry

- Files は `pane.split` のときに一意な `key` を props に入れる（`{key, file, on}`）。props は pane とともに保存される。
- editor は次のタイミングで `focused().pane` から自分の pane ID を確定する。
  - split 直後の `init`。新しい pane にフォーカスが移るため（`src/model.rs:345-346`）。
  - nextCommand で `"focus"` を受け取ったとき（`defaults/AGENTS.md:882-885`、`src/window.rs:3643-3659`）。
  - クリックしたとき（`src/window.rs:4446-4456`）。
- 確定した pane ID は registry `{key, pane, tab, lastFocus}` に書く。書くのはフォーカスが変わったときだけ。
- `close()` では registry から削除しない。終了時にも呼ばれ、再起動後の registry が空になってしまうため。参照する側が `panes()` で pane の存在を確かめ、存在しないエントリを削除する。

### 開く依頼

`editor-files` でファイルをクリックしたとき:

1. registry から、現在の tab にある有効なエントリのうち `lastFocus` が最新のものを選ぶ。
2. 見つかった場合:
   1. **まず** `run("pane.focus", {pane})` を送る。zoom 中であれば、zoom がその pane に移る（`src/model.rs:128-133`）。
   2. 次の描画で、その pane が表示中になってから `run("editor.open:" + JSON.stringify({to: key, req, file, on}))` を送る（`editor-files` の次の `cx.spawn` 内で行う）。
   3. editor は受け取ったら、すぐに `run("editor-files.ack:" + JSON.stringify({req}))` を返す。editor-files はレイアウトのブロックで表示中なので、ack は届く。
   4. **500ms 以内に ack が来なければ**、3 にフォールバックする。
3. 見つからない、または ack が来なかった場合: `pane.split {pane: 現在のpane, direction: "right", mod: "editor", props: {key: 新規, file, on}}` を送る。
4. `req` は一意にし、editor は処理済みの `req` を無視する（重複の排除）。

### editor 側の処理

- `init()` の冒頭で role によって分岐する。
  - role が `dialog` のコピーは、ポーリング・下書き・registry・open の処理を一切起動せず、`open` を無視する。
  - role が editor のコピーは、`nextCommand()` のループ（`cx.spawn` の中）で `focus` / `open` / `reply` を処理する。render では処理しない。
- `open` を受け取り、`to` が自分の場合:
  - clean なら、そのファイルを開いて `state.focus()` を呼ぶ。
  - dirty なら、3択ダイアログを開く。
    - `openOverlay({mod: "editor", kind: "dialog", modal: true, props: {role: "dialog", to: key, req}})`。返り値の overlay ID を保持する。
- ダイアログの結果は `run("editor.reply:" + JSON.stringify({to, req, choice}))` で返す。
  - 「保存」は、保存に**成功したときだけ**次のファイルを開く。
  - 「破棄」は次のファイルを開く。
  - 「キャンセル」は何もしない。
- ダイアログが返答せずに閉じた場合（Esc など）は、ダイアログの `close()` が `cancel` を返す。届かなかった場合に備え、editor 側もダイアログの overlay が消えたことを検知したら cancel として扱う。
- **ダイアログを表示中に次の依頼が来た場合**は、既存のダイアログを `closeOverlay(id)` で閉じ、新しい `req` でダイアログを開き直す。古い `req` の返答は捨てる。

### 制約

- shared と下書きはクライアントごと、pane（と props）はクライアント間で共有される。そのため、別のクライアントでは同じ pane が別の状態を表示することがある。RECIPE に記載する。
- ユーザーが keys.json の global に cmd-s を割り当てた場合は、そちらが優先される（gpui はキーバインドを `on_key_down` より先に処理する）。

このプロトコルは `core/routing` に状態機械として実装し、次のケースを unit test で確認する。

- editor が0／1／複数ある場合、別の tab、zoom の裏にある場合
- ack がタイムアウトした場合、`req` が重複した場合、registry に古いエントリが残っている場合
- dirty の状態で依頼が来た場合、ダイアログ中に次の依頼が来た場合、ダイアログが返答なしで閉じた場合
- 保存に失敗した場合、ダイアログのコピーが `open` を受け取った場合

## 4. 実装ステップ（Issueの5ステップに対応）

### Step 1: 検証スパイク

- **S1**: バンドルした `main.js` が `herdr-app check` を通り、hot reload されるか
- **S2**: `EditorState.value()` を経由して CRLF・BOM・末尾改行・タブがそのまま保持されるか。正規化される場合は `core/text` で復元する。改行コードが混在するファイルは読み取り専用にする
- **S3**: ルート要素の `on_key_down` で cmd-s / ctrl-s を受け取れるか
  - cmd-s / ctrl-s には既定のバインドがない（`defaults/keys.json`、`keys.macos.json`）。成立する見込み（推定）。
- **S4**: `writeTextFile` の動作を確認する。
  - 対象: ホーム外のパス、読み取り専用ファイル、ディレクトリに書き込めないケース、削除済みファイル、1 MiB を超える保存
  - 確認内容: エラー原文と、OSごとの metadata（所有者・ACL・xattr・symlink・hard link）
- **S5（必須ゲート）**: §3 を実機で確認する。
  - 配送、ack、タイムアウト
  - zoom、複数の editor、連続クリック、ダイアログ中の依頼、hot reload 直後
  - `focused().pane` による pane ID の確定
  - `pane.focus` の後に `state.focus()` でキーボードが editor に渡るか
- **S6**: `watchFolder` の即時性と、macOS / Linux / Windows での失敗パターン
- **S7**: EditorState を作り直したときに selection を移せるか（undo とスクロール位置は失われる前提）
- **S8**: 1 MiB と 400 KB のファイルで、入力遅延とハイライトのコスト。しきい値を決める

### Step 2: core と保存の実装

- `core/document`: 状態遷移と世代トークン（R14）。ユニットテストを先に書く
- `adapters/herdr`: FileStore・DraftStore・PaneStore・Registry を実装する
- **保存キー**
  - ルート要素の `on_key_down` で、macOS は cmd-s、それ以外は ctrl-s を処理する。keys.json は配布しない（`defaults/AGENTS.md:510-512`）。
  - S3 が成立しなかった場合だけ、keys.json の `mod:editor` を使う。その場合は全コピーに届くので、フォーカスがあるコピーだけが保存する。
- **外部変更の検知**
  - **ポーリング（必須）**: ローカルは3秒、リモートは10秒以上の間隔。
    - 前の読み込みが終わるまで次を始めない。保存中は止める。
    - 読んだ内容が保存中のテキストと一致したら、自分の書き込みとして扱う。
    - 結果を適用する前に世代を確認する。
  - **停止条件**: `window().active` が false の間と、自分の pane が非表示の間は止める。
    - 「表示中」とは、自分の pane の tab が active space の active tab で、かつその tab が zoom 中なら自分が `zoomed === true` であること（`defaults/herdr.d.ts:223-224`、`src/model.rs:149-152`）。
  - **watch（補助・ローカルのみ）**: 親ディレクトリを監視し、再armするループにする。
    - ループの条件に watch の世代を入れる。resolve の後に、現在のパスと世代を確認してから再armする（cancel 後に古いループが再armしないように）。
    - 失敗したらポーリングだけで続ける。`.herdr-app-write-*` のイベントは無視する。
  - 外部変更を検知した場合: clean なら自動で再読込する。dirty なら帯を出し、選ばせる。
- `ui`: view-model の出力を描画する
- `editor-files` の fork と §3
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
  - 名前が衝突したら停止する（§1）。
  - コピーしたファイルと、**インストール前に表示していた layout 名**を manifest（`data/<ns>/install.json`）に記録する。
- **`scripts/uninstall`**（受け入れ条件5）。`herdr-app ls` には mod pane が出てこず、CLI では shared を変更できない（`src/window.rs:3967-4006`、`src/control.rs:73-97`）。そのため、同梱する `editor-uninstall` Mod に処理を任せる。
  1. `herdr-app do mod.open '{"name":"editor-uninstall"}'` で起動する（overlay）。
  2. その Mod が `panes()` から editor の pane をすべて `pane.close` し、shared の名前空間キーを null にする。
     - space の最後の pane の場合は、`space.close` に `confirmed: true` が必要になる（`src/window.rs:3027-3029, 3084-3087`）。この場合はユーザーに確認する。
     - 未接続のマシンにある pane は閉じられない（`src/window.rs:2479-2487, 2966-2972`）。残った pane は一覧で示す。
  3. 結果を `data/<ns>/uninstall-result.json` に書き、スクリプトがそれを読む。失敗があれば、ファイルの削除を中止する。
  4. `layout.switch` で manifest に記録した元の layout に戻す。
  5. `mods/<各mod>/` を**フォルダごと**削除する。ロード時に `jsconfig.json` などが追加で書かれるため（`src/mods.rs:317-319`）。`layouts/editor.json` も削除する。
  6. `data/<ns>/` は、未保存の下書きがなければ削除する。あれば残し、その場所を表示する。
- RECIPE.md と preview.png を用意する。複数クライアントの制約・undo とスクロールが失われる条件・未接続マシンの pane が残ることを書く。

## 5. 下書きと pane の状態（G1）

### 保存先

- `appHome()/data/<ns>/` 配下に置く。
  - `drafts/<draftId>.{a,b}.json`
  - `drafts/index.json`（パス索引）
  - `panes/<key>.json`（pane ごとの「今開いているファイル」）
- localStorage は使わない（R11）。
- `data/<ns>/` は localStorage のディレクトリと同じ場所になるが、共存できる。

### 識別

- 下書きは `draftId` で保存し、内容に `{machine, path, ownerKey}` を持たせる。
- 索引 `index.json` は `(machine, path)` から `draftId` の一覧を引けるようにする。
- パスは、保存した正確な文字列で比較する。Windows で大文字小文字を同一視するのは、正確な比較で一致しなかった場合の補助検索に限る。

### 書き込み

- 変更があるたびに、最新のスナップショットで待ち行列を置き換える（合成）。
- 書き込みは直列化し、間隔は最低 250ms、最大 1秒に1回とする。**入力から最大およそ1秒以内に永続化される**ことを仕様とし、E2E で測る。
- rename がないので、A/B の2スロットに交互に書く。各スロットには `{schema, seq, checksum, machine, path, ownerKey, baselineHash, text, savedAt}` を入れる。
  - checksum は、`checksum` 以外のフィールドを正規化した JSON にかける。
  - seq は、2つのスロットの最大値＋1にする。
- 読むときは、チェックサムが正しいスロットのうち seq が大きいほうを採用する。
- 1スロットのサイズは、上限（本文 1 MiB＋metadata）を超えないことを検査する。`fs.writeFile` の上限は 8 MiB。
- 書き込みに失敗した場合は、編集内容を保持したまま帯で警告する。
- `close()` での flush は補助として扱う。

### 保存・破棄

- 保存に成功したとき、または破棄したときは、まず高い seq で **tombstone**（`{deleted: true}`）を書く。その後、両方のスロットを削除する（失敗してもよい）。
- tombstone が残っても、復元の候補にはならない。

### 復元

- ファイルを開くとき、索引から同じ `(machine, path)` の下書きを探す。所有者の pane が存在しないか、自分のものであれば、復元の候補として帯で示す。この照合は、新しい pane で開いた場合にも行う。
- ディスクの内容のハッシュが `baselineHash` と違う場合は、競合として示す。
- editor の起動時に、どのファイルにも結びつかない下書きを一覧にし、「開く／復元／削除」を選べるようにする。
- 30日を過ぎたものは削除する。

### pane の状態

- 「今開いているファイル」は `panes/<key>.json` に保存する。
- 再起動したときは、props の初期ファイルよりこちらを優先する。

## 6. 検証計画

| 層 | 手段 | 対象 |
|---|---|---|
| unit | Bun test（ports は fake） | core 全般（routing の状態機械、世代、保存失敗の分類、ポーリング、下書きの A/B・tombstone・索引、言語マップ、view-model） |
| static | `herdr-app check` | 全 Mod |
| e2e | `$HOME` 配下の隔離した `HERDR_APP_HOME` で実機手順を実行し、`herdr-app shot` で証跡を残す | 下記 |

E2E のケース。macOS では全件を行う。Linux / Windows では最低限、保存・保存の競合・外部変更・1 MiB の境界・権限エラー・pane close からの復元・install / uninstall を行う。

- Files から開く → 編集 → cmd-s / ctrl-s → ディスクに反映されている
- editor を2つ表示している状態で保存する → フォーカスがある側だけが保存される
- zoom の裏にある editor に向けて Files で開く。連続クリック。hot reload 直後に開く
- dirty の状態で別ファイルを開く → キャンセル／破棄／保存（失敗した場合は切り替わらない）／Esc でダイアログを閉じる
- 外部で変更した後に保存する → 拒否される。clean な状態での外部変更は自動で再読込される。外部から高頻度に書き込みながら保存を繰り返す
- 削除されたファイル、権限のないファイル、ディレクトリに書き込めないケース、1 MiB超、**編集して1 MiBを超えた状態での保存**、不正なUTF-8、NUL、未知の拡張子、P0の各拡張子
- リモートの非UTF-8ファイルと、読めないファイル
- **pane を閉じる → Files から同じファイルを開く → 下書きの復元が提示される**
- 再起動後と hot reload 後に、編集中のファイルと下書きが復元される。Herdr を更新した後も復元される
- 1 MiB のファイルで、入力遅延がしきい値以内に収まる
- tab に editor pane を残したまま uninstall する → pane・shared・mod フォルダが残らず、元の layout に戻る

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
| 3. 外部変更を無警告で上書きしない | G3 | 通常のケースはAPIが拒否する。rename直前の隙は残るので、G3が決まるまで達成扱いにしない |
| 4. .json / .md / .rs を扱える | Step 3, S8, E2E | 可能 |
| 5. 標準Filesを壊さず、削除で元に戻せる | Step 5, E2E | `editor-uninstall` を使い、元の layout に戻す。未接続マシンの pane だけが残余リスク |
