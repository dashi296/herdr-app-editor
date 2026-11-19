# editor と Files 連携を独立した mod として公開する（#29）

作成日: 2026-11-19 / 状態: 設計（承認待ち） / 関連: #29, #1

## 目的と理由

今は `main` を複製して Files ブロックを差し替えた layout（`layouts/herdr-app-editor.json`）として herdr.dev/layouts に公開している。このため、自分用の layout を使っている人は、editor を使うには `main` ベースの layout へ乗り換えるしかなく、自分の layout と editor を両立できない。

Herdr の考え方では、mod は「利用者のウィンドウに組み込む部品」で、layout は「ウィンドウ全体」。標準の Files も特別なものではなく、複製して作り替えるのが正規の方法（`~/.config/herdr-app/AGENTS.md`）。先行例の Preview Plus（editor）と Files Plus（Files の作り替え）は、別々の mod として公開し、Files Plus は Preview Plus を同梱せず「入っていれば使う」ゆるい依存にしている。

この形に合わせ、editor と Files 連携を別々の mod の公開物にし、layout は廃止する。

## 目標

- 自分用の layout を使っている人が、その layout のまま editor を使える。
- 導入手順が利用者によって分かれない。どちらの公開物も「フォルダをコピーする（＋ `keys.json` をマージする）」だけで、herdr.dev の標準の導入手順（AGENTS.md の Layouts and mods other people made）に従う。
- ファイルを開く方法は2つ。キーで開くファイル検索（editor の公開物だけで使える）と、Files のクリック（Files 連携を入れた場合）。
- 2つの公開物が mods ギャラリーに載る。

## 目標としないこと

- 見本の layout の提供。廃止する。
- 標準の Files に割り込む仕組み。設計上できない（他の mod のコードは実行中に読み書きできない）。
- Herdr 本体への提案。必須ではない。必要になったら別の issue にする。
- Linux / Windows での実機確認。引き続き macOS だけで確認し、そう明記する。
- 既存の利用者向けの移行手順。公開から約1日、スター 0 のため扱わない。

## してはいけないこと（失敗とみなす）

- 利用者の layout やファイルを、利用者が頼んでいないのに書き換える。
- editor の公開物だけを入れた人が、ファイルを開く手段を持たない。
- Files 連携だけを入れた人の Files パネルが、標準の Files より劣る（クリックしても何も開かない、など）。
- 2つの公開物で、同じ mod のコードが食い違う。

## 制約

- Herdr Desktop 0.1.16。mod は `mods/<name>/` に `main.js` と `mod.json`。1つの mod は pane かオーバーレイのどちらか1つの表示形式を持つ。
- herdr.dev は、`layouts/*.json` を含む RECIPE のフォルダを layouts にだけ載せる。mods に載せるフォルダに `layouts/` を置かない。1フォルダ＝1公開物＝1 RECIPE。
- mod のフォルダ名は変えない（`herdr-app-editor`, `herdr-app-editor-files`）。名前は `src/core/names.ts` からビルドに埋め込まれている。
- editor は今、`props.key` がないと開かない（`src/ui/editor-view.ts:200`）。開いた pane の登録は Files のフォーク側が行っている（`src/entries/editor-files.js:262-317`）。editor は起動時に自分の pane を知れない（spike S5 結果6）。
- Files のフォークは Apache-2.0。改変表示を `main.js` の先頭に残す（`keepHeader`）。
- ビルドは Bun（`--target node`、`minify: false`）。`bun run ci` が通ること。

## 検討した案

| 案 | 内容 | 結果 |
|---|---|---|
| **A. editor の公開物にファイル検索のオーバーレイを同梱** | `editor/` に editor、検索オーバーレイ、`keys.json`。`files/` に Files のフォーク | **採用**。editor だけでもキーで開ける。Files 連携でクリックでも開ける |
| B. オーバーレイなし | editor と Files 連携だけ | 不採用。editor だけでは開く手段がなく、単独の公開物として成り立たない |
| C. オーバーレイを3つ目の公開物に | editor、検索、Files 連携を別々に公開 | 不採用。検索は editor なしでは意味がなく、公開物と RECIPE が増えるだけ |

あわせて決めたこと（利用者の決定）:
- 見本の layout はやめる（`main` の複製は Herdr の更新に追従しない。layout としての独自性がない。保守が3組になる）。

## 構成

```
README.md                  # リポジトリの説明。2つの公開物への案内。ルートに RECIPE.md は置かない
editor/                    # 公開物1: herdr.dev/mods（名前: Herdr Editor）
  RECIPE.md
  preview.png
  keys.json                # { "global": { "cmd-o": "mod.open:herdr-app-editor-open" } }（既定。導入時に選び直せる）
  mods/herdr-app-editor/        # editor の pane（今と同じ）
  mods/herdr-app-editor-open/   # 新規: ファイル名で検索して開くオーバーレイ
files/                     # 公開物2: herdr.dev/mods（名前は RECIPE で決める。例: Herdr Editor Files）
  RECIPE.md
  preview.png
  mods/herdr-app-editor-files/  # Files のフォーク
```

削除するもの: `layouts/`、ルートの `RECIPE.md` と `preview.png`、ルートの `mods/`、`mods/herdr-app-editor-uninstall` とそのソース（`src/entries/editor-uninstall.ts`, `src/ui/uninstall-view.ts`, `src/core/uninstall/`）、`scripts/install.ts`, `scripts/uninstall.ts`, `scripts/lib/ownership.ts` と関連テスト、`package.json` の `install:herdr` / `uninstall:herdr`、`names.ts` の `MOD_UNINSTALL` と `LAYOUT_NAME`。

ビルド（`scripts/build.ts`）は各 mod を所属する公開物のフォルダへ出力する。`ci` の差分チェックを `git diff --exit-code -- editor/ files/` に変える。

## 各部の動作

### 1. editor（`herdr-app-editor`）の変更

- **`props.key` なしでも開く。** `props.file` があれば、そのファイルを開く。key はメモリ上で新しく作る（下書きは key ごとに保存され、復元候補はファイル単位で探すので、閉じた後の下書きの復元は今どおり働く）。失うのは「再起動後に、途中で切り替えたファイルを覚えていること」だけで、再起動後は `props.file` のファイルを開く。これはエージェントや他の mod が `pane.split {mod: "herdr-app-editor", props: {file, on?}}` で開いた場合のため。
- **ファイルなしで開かれたとき。** 今の「Open a file from the Files panel.」の代わりに、「Open file…」ボタンと、割り当てられているキー（`keys()` で探す。なければ表示しない）を出す。ボタンは `run("mod.open", {name: "herdr-app-editor-open"})`。
- それ以外の動作（保存、下書き、外部変更、テーマ、読み取り専用など）は変えない。

### 2. 開く処理の共通部品

Files のフォークにある「開く」処理（既存 pane の選択 `pickTarget`、なければ `pane.split`、新しい pane の登録 `newPaneAfterSplit`、連続クリックの待ち行列）を、`src/` の共通モジュールに移す。オーバーレイと Files のフォークの両方が、ビルド時にこれを取り込む（mod 間でコードを共有する仕組みはないので、それぞれの `main.js` に入る）。

渡す情報は今と同じ `{file, on, tab, newPane}`。新しい pane には今どおり `props: {key, file, on}` を渡す。

### 3. ファイル検索のオーバーレイ（`herdr-app-editor-open`、新規）

- `mod.json`: `{ "place": "none", "focusable": true, "overlay": { "kind": "popup", "at": "top", "offset": 40, "width": 640, "height": 0.6 } }`（Herdr の picker と同じ形）。
- 対象フォルダ: Files のフォークの `location()` と同じ決め方（フォーカスしている pane の cwd。editor の pane なら同じタブの端末の cwd。なければ space のフォルダ）。リモートのマシンも `on` で扱う。
- 一覧: Git の管理下なら `git ls-files -co --exclude-standard -z`。そうでなければ再帰的な一覧に戻る（`.git` と `node_modules` を除く）。件数に上限を設け、超えたら「一部だけ表示」と出す。
- 見た目:

  ```
  ┌──────────────────────────────────────┐
  │ > mainrs                             │
  ├──────────────────────────────────────┤
  │ ▸ src/main.rs                        │
  │   src/bin/main_rs_helper.rs          │
  │   tests/main.rs                      │
  └──────────────────────────────────────┘
  ```

- 入力した文字を順に含むパス（部分列一致）に絞り込み、ファイル名での一致を上位にする。
- ↑/↓ で選び、Enter で開く。cmd-Enter（他 OS は ctrl-Enter）は新しい editor の pane で開く。クリックでも開く。Esc で閉じる。開いたら閉じる。
- 開く先は、オーバーレイを開く直前にフォーカスしていたタブ。開くときは共通部品（2）を使う。

### 4. Files 連携（`herdr-app-editor-files`）の変更

- 開く処理を共通部品（2）に置き換える。
- **editor がないときはプレビューに戻る。** クリックの時点で `appHome()/mods/herdr-app-editor/mod.json` を読めるかで判定する（短時間キャッシュしてよい）。なければ、フォーク元と同じく Files パネルの中に読み取り専用のプレビューを出す（今もある `show()` を使う）。
- 改変表示（先頭のコメント）を、変更に合わせて更新する。

### 5. キー

- 既定は `cmd-o`。`editor/keys.json` で `mod.open:herdr-app-editor-open` に割り当てる。macOS 全体で「開く」を意味し、どのエディタに慣れた人にも推測できる。Herdr の標準の `keys.json` では空いている。
- **導入時に利用者が選べる。** プログラムは追加せず、`editor/RECIPE.md` の導入手順で、エージェントに `keys.json` をマージする前の確認を指示する:
  - 既定は `cmd-o`。
  - 候補 `cmd-p`: VS Code・Zed・Sublime Text・Cursor と同じ。Herdr のタブピッカー（`mod.open:picker`）を置き換えるので、選んだ場合はそのことを伝え、ピッカーを別のキーに移すか利用者に聞く。
  - 候補 `cmd-shift-o`: JetBrains（Go to File）・Xcode（Open Quickly）と同じ。VS Code 系ではシンボル検索のキーなので、その旨を伝える。
  - ほかのキーでもよい。既存の割り当てと重なる場合は、置き換える前に確認する（AGENTS.md の導入手順4）。
  - `cmd-p` は Herdr のタブピッカー、`cmd-shift-p` は Herdr のコマンドパレットが使っている。
- 手でコピーする人には質問が出ず、同梱の `keys.json`（`cmd-o`）が入る。導入後も `keys.json` の編集やエージェントへの依頼で変えられることを RECIPE に書く。
- editor の空の画面は、実際に割り当てられたキーを `keys()` で探して表示するので、どのキーを選んでも表示が合う。

### 6. RECIPE と README

- `editor/RECIPE.md`: editor とオーバーレイの見た目と動作。Built from。Watch out（削除の手順: pane を閉じてから2つの mod フォルダを消す、`keys.json` の割り当てを外す、下書きの場所 `data/herdr-app-editor/`）。Done when。最後に「This is a piece you add to your layout, not a whole window.」と同じ趣旨を書く。Files 連携の公開物への案内。
- `files/RECIPE.md`: Files パネルの見た目と動作。組み込み方（利用者の layout の Files ブロックの `mod` を差し替える。`main` を使っている場合は `layout.clone` で複製してから差し替える。Files ブロックがない layout では、置き場所を利用者に聞く）。editor があれば editor で開き、なければプレビューになること。editor の公開物への案内。Apache-2.0 の扱い。
- README: 2つの公開物の説明、ライセンス、macOS だけで確認済みであること、開発手順。
- preview.png を2枚撮る（editor 公開物: オーバーレイと editor の pane。Files 連携公開物: Files パネルから editor が開いた画面）。個人情報を写さない。

### 7. 公開

- `herdr-layout` トピックを外し、`herdr-mod` を付ける。
- 2つの公開物が mods の一覧（`assets.herdr.dev/mods/index.json`）に載ることを確認する。layouts の一覧から消えることを確認する。

## 確認が必要なこと（実装の最初に spike で確かめる）

1. オーバーレイの mod から、裏にあるタブへ `pane.split {mod, props}` で pane を開けるか。オーバーレイが開いている間に `focused()` が何を返すか（裏のタブと pane が分かるか）。分からなければ、オーバーレイを開く前のフォーカスをどう得るか。
2. `keys.json` の `cmd-` が Linux / Windows でどう扱われるか（ctrl に読み替えられるか）。分からなければ、RECIPE に macOS の割り当てとして書く。
3. エージェントが RECIPE だけで、利用者の layout（`main` の複製を含む）の Files ブロックを差し替えられるか。実機で一度、Claude Code に RECIPE を渡して試す。editor の公開物では、キーの確認の質問が出ることも確かめる。

## 実装者に任せること

- 共通部品のモジュール名と置き場所（依存関係のルール `.dependency-cruiser.cjs` に従う）。
- 一覧の件数の上限、絞り込みの順位づけの細部、オーバーレイの行の高さや色（Herdr の picker と Files に合わせる）。
- editor の有無の判定結果をキャッシュする時間。
- ビルドの出力先の指定方法（`ModSpec` に公開物のフォルダを持たせる、など）。

## 完了の条件

- `bun run ci` が通る。
- 実機（macOS、Herdr 0.1.16）で:
  - editor の公開物だけを、`main` 以外の layout の環境に入れ、`cmd-o` からファイルを開き、編集して保存できる。
  - `cmd-o` 以外のキー（例: `cmd-shift-o`）を選んで導入しても、そのキーでオーバーレイが開き、editor の空の画面にそのキーが表示される。
  - editor の空の pane の「Open file…」からも開ける。
  - Files 連携だけを入れると、クリックで読み取り専用のプレビューになる。
  - 両方入れると、クリックで editor が開く。cmd-click で新しい pane に開く。
  - 3つの mod が `herdr-app check` を通る。`herdr-app status` の `errors` が空。
- 2つの公開物が herdr.dev の mods に載る。
