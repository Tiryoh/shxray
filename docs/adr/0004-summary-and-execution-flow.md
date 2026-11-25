# ADR: Summary and execution flow

- Status: Accepted
- Date: 2026-11-25

## Context

既定のターミナル出力は、カテゴリごとの抜粋だった。何をどこへ置くか、どの順で進むかは、節を横断して読まないと分からない。ADR 0003 は、その節順を既定表示としていた。stdin がスクリプトなので、フルスクリーンの対話 UI にはしない、という判断は変えない。

## Decision

既定の人間向け表示は、短い要約のあとに、入口から辿った実行順の流れを出す。カテゴリ別の詳細は `--verbose` の Details に置く。`--json` は同じ `AnalysisReport` を出し、`summary.sentences` と `flow` を足す。既存フィールドの意味は変えない。`version` は 1 のまま。

## Decision Details

- `summary.sentences` は、インストール先、パッケージマネージャ、権限、認識した OS とアーキテクチャを平文の文にする。
- `flow.steps` はトップレベルの文をソース順に歩く。リテラルな関数呼び出しは、その本体を子ステップにする。再帰と、一度展開した関数の再訪は展開しない。
- `if` / `case` / `&&` / `||` は、どの道が選ばれるかを決めない。`unresolved` にその旨を書く。
- トップレベルが定義済み関数を一度も呼ばないとき、`flow.note` にその旨を書き、各関数本体を「呼ばれていない」と印してソース順に出す。呼ばれたことにはしない。
- 表示はレポートから描く。解析器は Deno の I/O をしない。
- `--verbose` が無い既定表示には Details を出さない。JSON には従来の配列を残す。カテゴリ一覧は長いので、流れのあとに常時出すと今回の読みにくさが残る。

## Alternatives Considered

- 詳細を既定の末尾に常時出す案。流れのあとに長い抜粋が続き、カテゴリ抜粋が主表示のままになるため不採用。
- 分岐を実行されそうな一方だけに絞る案。静的には決まらないので、推測になるため不採用。
- `version` を 2 にする案。フィールドの削除や意味の変更ではないため、ADR 0003 の追加規則に合わせて 1 のまま。

## Consequences

- 既定のターミナルは、先頭で何を置くかと、どの順で進むかが読める。
- 分岐の中の手順は候補であり、実行順の確定ではない。
- 関数を呼ばない抜粋では、本体を「未呼び出し」として示す。
- HTML は同じ `flow` と `sentences` を使える。

## Verification / Guardrails

1. `tests/fixtures/installer.sh`、`mise.run.sh`、`get-ros2-install.sh` はローカルファイルだけで flow を検証する。ネットワーク取得はしない。
2. `--json` に `summary.sentences` と `flow` があり、従来の `platforms` などが残る。
3. 非 TTY の既定出力に Details の節名 `platforms` が無く、`--verbose` にはある。
