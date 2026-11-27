# ADR: Summary and execution flow

- Status: Accepted
- Date: 2026-11-26

## Context

既定のターミナル出力は、カテゴリごとの抜粋だった。何をどこへ置くか、どの順で進むかは、節を横断して読まないと分からない。ADR
0003 は、その節順を既定表示としていた。stdin
がスクリプトなので、フルスクリーンの対話 UI にはしない、という判断は変えない。

また、AST の分岐や関数呼び出しをそのまま逐語的に展開すると、`mise.run`
などの実インストーラではログ関数やルックアップ分岐、繰り返される注記が本処理を埋めてしまい、結局スクリプト本体を読む必要が生じる。

## Decision

既定の人間向け表示は、短い要約のあとに、副作用と主要処理に絞った浅い実行フロー（最大
2 階層）を出す。詳細な呼び出し・分岐ツリーとカテゴリ別の詳細は `--verbose` の
`Details` に置く。TTY のカラー表示では `sudo` / `doas` / `su` / `pkexec`
を使う権限昇格箇所を強調色にする。`--json` は同じ `AnalysisReport`
を出し、`summary.sentences` と `flow`（`entry` / `steps` /
`detailed`）を持つ。既存フィールドの意味は変えない。`version` は 1 のまま。

## Decision Details

- `summary.sentences`
  は、インストール先、ダウンロード元、整合性、パッケージマネージャ、権限、認識した
  OS
  とアーキテクチャを平文の文にする。ダウンロード元のホストは、記録したダウンロード
  URL と、URL
  オペランドとして参照される束縛だけから取る。ヘッダ値のような束縛はホストにしない。整合性は、`sha256sum -c`
  / `--check`、`gpg --verify`、`gpgv`、`cosign verify`、`minisign -V`
  のように検証と分かるときだけ「検証」と書く。ダイジェスト計算や `gpg --dearmor`
  は実行として書く。変数の併記は、代入がちょうど 1 回のときと `${VAR:-default}`
  に限る。後から `$1` を代入したり空にしたりした名前は、古いリテラルを残さない。
- `flow.steps` は既定表示向けの簡潔な流れ（最大 2
  階層、副作用・重要処理中心）にする。単一のトップレベル入口関数（`main` や
  `install_*`）は `flow.entry`
  に記録してトップレベルへ展開する。純粋なログ関数は固定点解析で純粋と証明できたときだけ省く。名前が
  `die` や `info` でも、本体に `rm` などの処理があれば省かない。`"$@"`
  を転送する関数でも、それ以外の処理は既定の流れに残す。`curl` / `wget`
  フォールバックや、各分岐が展開だけからなるアーカイブ分岐、連続する `trap` /
  `rm`
  は畳み込む。同じ分岐に削除などの別処理があるときは畳まない。条件式の中の関数呼び出しは、試しに本体を歩かず、通常の再帰ガード付きの呼び出しとして一度だけ処理する。
- `flow.detailed` は詳細な呼び出し・分岐ツリーを保持し、`--verbose` の `Details`
  内で表示する。`if` / `case` / `&&` / `||` の実行経路は静的に決めない。
- カラー有効時（stdout が TTY で `--plain` / `NO_COLOR`
  でないとき）は、Summary・Flow・Details の `sudo` / `doas` / `su` / `pkexec`
  による権限昇格箇所を赤太字＋黄文字で強調する（「No sudo,
  ...」や日本語の否定文は強調しない）。
- 表示言語は英語（`en`）と日本語（`ja`）に対応する。CLI の `--lang`
  フラグ、無指定時は `LC_ALL` → `LC_MESSAGES` → `LANG`（いずれも空のときのみ
  `LANGUAGE`）の順に解決し、`ja*`
  なら日本語、それ以外は英語とする。環境変数参照は `src/cli.ts`
  に閉じ込め、`src/analyze` は引数 `locale`
  のみを受け取る純粋関数のまま保つ。`AnalysisReport` には追加フィールド `locale`
  を持たせる（`version` は 1 のまま）。
- トップレベルが定義済み関数を一度も呼ばないとき、`flow.note`
  にその旨を書き、各関数本体を「呼ばれていない」と印してソース順に出す。呼ばれたことにはしない。
- 表示はレポートから描く。解析器は Deno の I/O をしない。
- `--verbose` が無い既定表示には
  `Details`（詳細フローとカテゴリ一覧）を出さない。JSON
  には従来の配列を残し、`flow.entry` と `flow.detailed`
  を追加フィールドとして持つ（`version` は 1 のまま）。

## Alternatives Considered

- 詳細を既定の末尾に常時出す案。流れのあとに長い抜粋が続き、カテゴリ抜粋が主表示のままになるため不採用。
- AST の全分岐・全関数呼び出しを既定の Flow
  にそのまま展開する案。実インストーラで 100
  行超・深いネストになり、流れが追えないため `--verbose` の `detailed flow`
  へ分離した。
- 分岐を実行されそうな一方だけに絞る案。静的には決まらないので、推測になるため不採用。
- `version` を 2 にする案。フィールドの削除や意味の変更ではないため、ADR 0003
  の追加規則に合わせて 1 のまま。

## Consequences

- 既定のターミナルは、先頭で何をどこに置くかと、実行順の主要ステップ・権限昇格箇所が一目で読める。
- 分岐の中の手順は候補であり、実行順の確定ではない。
- 関数を呼ばない抜粋では、本体を「未呼び出し」として示す。
- HTML は同じ `flow` と `sentences` を使える。

## Verification / Guardrails

1. `tests/fixtures/installer.sh`、`mise.run.sh`、`get-ros2-install.sh`
   はローカルファイルだけで flow を検証する。ネットワーク取得はしない。
2. `--json` に `summary.sentences` と `flow`（`steps` /
   `detailed`）があり、従来の `platforms` などが残る。
3. 非 TTY の既定出力に ANSI エスケープや Details の節名 `platforms`
   が無く、`--verbose` には `detailed flow` と `platforms` がある。
4. カラー有効時のみ権限昇格ステップ（`sudo`
   等）が強調され、否定文（`No sudo, ...`）は強調されない。

## Additional Decision

- Date: 2026-11-27

### Context

Summary と Flow はインストール先を記述どおり出していた（`$PREFIX/bin/tool`）。同じスクリプトの `interface` は、環境変数とフラグを別の配列で、既定値があるときだけ持っていた。読む人は、どの変数やオプションを変えれば行き先が変わるのかを自分で突き合わせる必要があった。

実インストーラでは、ログへの追記（`$LOG_FILE` や `install.log`）が `installs[]` と Summary の "Also writes" に混ざり、インストール先に見えた。また `run_root "$STEP" apt-get ...` のように引数を転送する関数経由の `apt-get` は、Flow では見えても `sideEffects` の `package-manager` には残らなかった。

PR #1 では、オプション値を TLS フラグと誤認する件、`curl --version` をダウンロードと数える件、`cp -t` の行き先を Flow が最後の非オプション引数にしてしまう件を、フォローアップに残していた。

### Decision

インストール先ごとに、それを決める変数とオプション、および静的に分かる既定値を結び付ける。ログファイルへの書き込みはインストール先から外す。引数を実行する関数に渡された `apt-get` などはパッケージマネージャの副作用として数える。上の 3 件は、フラグとその値が消費する引数を区別して直す。

`AnalysisReport.version` は 1 のままとする。追加したのは `installs[].controls` であり、既存フィールドの意味は変えない（ADR 0003）。

### Decision Details

- `installs[].controls` は、行き先の文字列が参照する変数（`kind: "environment"`）と、その変数へ代入する CLI オプション（`kind: "option"`）である。シェルの組み込みパラメータ（`HOME` や `PATH` など、`interface.environment` が元から無視している名前）は制御元にしない。
- 既定値は、スクリプトに書かれているときだけ `defaultValue` に入れる。`${VAR:-default}` / `${VAR:=default}` は、その変数を環境変数で上書きできる（`envOverride` がその名前）。単一の静的代入は値として示すが、環境変数では上書きできないので `envOverride` は null にする。`dirname` や URL ヘルパは `defaultReason`（例: `dirname of $install_path`）に書き、経路を推測しない。
- 既定値が静的に決まらないときは `defaultValue: null` かつ `defaultReason: "unknown default"` とする。`$OPTARG` や他の単一変数への代入も既定値にしない。このトークンはロケールにかかわらず英語のままにし、機械が照合できるようにする。要約と Flow の文はロケールに合わせる。英語の例は `Installs to $PREFIX/bin/tool (PREFIX defaults to /usr/local; override with PREFIX=... or --prefix)`。オプション自体の既定値はスクリプトに無いので、オプションの `defaultReason` は `unknown default` のままにする。
- 同じ変数の説明は、Summary と Flow では最初の一度だけ括弧に出す。JSON の各 `installs[]` 要素には毎回 `controls` を入れる。
- ログファイルへの `write` / `append`（リダイレクトと `tee`）は `installs[]` に入れない。したがって Summary の "Also writes" にも出ない。判定は記述どおりの経路に対して行い、変数は解決しない。次のいずれかに当たるときログとする。basename が `.log` で終わる、または `log` / `logs` / `logfile` / `logdir` / `logpath` である。それより前のパス要素が `log` または `logs` である。参照している変数名を `_`、`-`、camelCase 境界で割った要素が同じ語である（`LOG_FILE`、`STEP_LOG`、`stepLog`、`logfile`）。`CATALOG`、`LOGICAL`、`LOGNAME` は含めない。`install` / `cp` / `mv` / `ln` / `mkdir` にはこの除外を適用しない。Flow はコマンドをそのまま説明するため、ログへの書き込みが残ることがある。
- パッケージマネージャは、コマンド名そのものに加えて、引数を実行する関数（`forwards`。例: `run` や `run_root`）の呼び出しで、実際に実行されるコマンドが `apt-get` などのときも `package-manager` とする。先頭の `$var` や空白を含む手順名はコマンドではない。`run echo apt-get` のように、別コマンドの引数として現れるだけの名前は数えない。
- `curl -k` / `--insecure` と `wget --no-check-certificate` は、そのツール自身のフラグであるときだけ非検証ダウンロードとする。値を取るオプションが消費した残り（`curl -o/tmp/sdk` の `k`、`curl -H --insecure` の `--insecure`）と、`--` より後の引数はフラグにしない。
- `curl --version` / `--help` / `--manual`、`wget --version` / `--help`、および `fetch` / `aria2c` / `axel` の対応するヘルプ・版表示はダウンロードにしない。`aria2c -v` は版表示であり、`curl -v` は詳細表示なのでダウンロードのままにする。`-o --version` のように値として現れるものはダウンロードのままにする。
- `cp` / `mv` / `ln` / `install` の Flow は、`parseArgv` で `-t` / `--target-directory` を行き先にし、無いときだけ最後のオペランドに戻す。`install -d` は単一のオペランドもディレクトリ先として残す。

### Alternatives Considered

- `version` を 2 にする案。フィールドの削除や意味の変更ではなく、`controls` の追加なので不採用。
- `$HOME` にも `unknown default` を付ける案。インストーラの設定ではなく、要約が毎回長くなるため不採用。
- ログ書き込みを Flow からも消す案。Flow は実行されるコマンドの説明であり、インストール先の一覧とは役割が違うため、今回は `installs[]` と "Also writes" に限った。
- オプションの `defaultValue` に、そのオプションが代入する変数の既定値をコピーする案。オプション自体の既定値はスクリプトに書かれていないので、推測になるため不採用。

### Consequences

- Summary と Flow で、行き先を変える変数・オプションと既定値が同じ括弧で読める。
- 既定値が分からない経路は、値を埋めずに `unknown default` と出る。
- ログファイルはインストール先の件数と "Also writes" から外れる。
- `run_root apt-get` は `sideEffects` に残る。
- `curl --version` だけのスクリプトは、ダウンロードによる medium リスクにならない。

### Verification / Guardrails

1. テストはインラインのスクリプトと `tests/fixtures/` のローカルファイルだけを使う。インストーラのネットワーク取得はしない。
2. `tests/fixtures/installer.sh` の `$PREFIX/bin/tool` は、`PREFIX` の既定値 `/usr/local` と `--prefix` を `controls` に持つ。
3. `get-ros2-install.sh` の `$LOG_FILE` と `$STEP_LOG` は `installs[]` と要約に出ず、`run_root ... apt-get` は `package-manager` になる。
4. `curl -o/tmp/sdk` と `curl -H --insecure` は insecure-download にならず、`curl -k` はなる。`curl --version` はダウンロードにならない。`cp -t /usr/local/bin ./tool` の Flow は `/usr/local/bin` を行き先にする。
