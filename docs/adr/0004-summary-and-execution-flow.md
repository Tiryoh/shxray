# ADR: Summary and execution flow

- Status: Accepted
- Date: 2026-11-26

## Context

既定のターミナル出力は、カテゴリごとの抜粋だった。何をどこへ置くか、どの順で進むかは、節を横断して読まないと分からない。ADR 0003 は、その節順を既定表示としていた。stdin がスクリプトなので、フルスクリーンの対話 UI にはしない、という判断は変えない。

また、AST の分岐や関数呼び出しをそのまま逐語的に展開すると、`mise.run` などの実インストーラではログ関数やルックアップ分岐、繰り返される注記が本処理を埋めてしまい、結局スクリプト本体を読む必要が生じる。

## Decision

既定の人間向け表示は、短い要約のあとに、副作用と主要処理に絞った浅い実行フロー（最大 2 階層）を出す。詳細な呼び出し・分岐ツリーとカテゴリ別の詳細は `--verbose` の `Details` に置く。TTY のカラー表示では `sudo` / `doas` / `su` / `pkexec` を使う権限昇格箇所を強調色にする。`--json` は同じ `AnalysisReport` を出し、`summary.sentences` と `flow`（`entry` / `steps` / `detailed`）を持つ。既存フィールドの意味は変えない。`version` は 1 のまま。

## Decision Details

- `summary.sentences` は、インストール先、ダウンロード元と整合性検証、パッケージマネージャ、権限、認識した OS とアーキテクチャを平文の文にする。単一代入や `${VAR:-default}` が静的に取れる変数は括弧で併記する。
- `flow.steps` は既定表示向けの簡潔な流れ（最大 2 階層、副作用・重要処理中心）にする。単一のトップレベル入口関数（`main` や `install_*`）は `flow.entry` に記録してトップレベルへ展開する。純粋なログ関数（`info` / `debug` / `say` 等）は固定点解析で自動判定して省き、`curl` / `wget` フォールバックや連続する `trap` / `rm` 等を畳み込む。
- `flow.detailed` は詳細な呼び出し・分岐ツリーを保持し、`--verbose` の `Details` 内で表示する。`if` / `case` / `&&` / `||` の実行経路は静的に決めない。
- カラー有効時（stdout が TTY で `--plain` / `NO_COLOR` でないとき）は、Summary・Flow・Details の `sudo` / `doas` / `su` / `pkexec` による権限昇格箇所を赤太字＋黄文字で強調する（「No sudo, ...」や日本語の否定文は強調しない）。
- 表示言語は英語（`en`）と日本語（`ja`）に対応する。CLI の `--lang` フラグ、無指定時は `LC_ALL` → `LC_MESSAGES` → `LANG`（いずれも空のときのみ `LANGUAGE`）の順に解決し、`ja*` なら日本語、それ以外は英語とする。環境変数参照は `src/cli.ts` に閉じ込め、`src/analyze` は引数 `locale` のみを受け取る純粋関数のまま保つ。`AnalysisReport` には追加フィールド `locale` を持たせる（`version` は 1 のまま）。
- トップレベルが定義済み関数を一度も呼ばないとき、`flow.note` にその旨を書き、各関数本体を「呼ばれていない」と印してソース順に出す。呼ばれたことにはしない。
- 表示はレポートから描く。解析器は Deno の I/O をしない。
- `--verbose` が無い既定表示には `Details`（詳細フローとカテゴリ一覧）を出さない。JSON には従来の配列を残し、`flow.entry` と `flow.detailed` を追加フィールドとして持つ（`version` は 1 のまま）。

## Alternatives Considered

- 詳細を既定の末尾に常時出す案。流れのあとに長い抜粋が続き、カテゴリ抜粋が主表示のままになるため不採用。
- AST の全分岐・全関数呼び出しを既定の Flow にそのまま展開する案。実インストーラで 100 行超・深いネストになり、流れが追えないため `--verbose` の `detailed flow` へ分離した。
- 分岐を実行されそうな一方だけに絞る案。静的には決まらないので、推測になるため不採用。
- `version` を 2 にする案。フィールドの削除や意味の変更ではないため、ADR 0003 の追加規則に合わせて 1 のまま。

## Consequences

- 既定のターミナルは、先頭で何をどこに置くかと、実行順の主要ステップ・権限昇格箇所が一目で読める。
- 分岐の中の手順は候補であり、実行順の確定ではない。
- 関数を呼ばない抜粋では、本体を「未呼び出し」として示す。
- HTML は同じ `flow` と `sentences` を使える。

## Verification / Guardrails

1. `tests/fixtures/installer.sh`、`mise.run.sh`、`get-ros2-install.sh` はローカルファイルだけで flow を検証する。ネットワーク取得はしない。
2. `--json` に `summary.sentences` と `flow`（`steps` / `detailed`）があり、従来の `platforms` などが残る。
3. 非 TTY の既定出力に ANSI エスケープや Details の節名 `platforms` が無く、`--verbose` には `detailed flow` と `platforms` がある。
4. カラー有効時のみ権限昇格ステップ（`sudo` 等）が強調され、否定文（`No sudo, ...`）は強調されない。
