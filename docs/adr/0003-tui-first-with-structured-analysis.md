# ADR: TUI first with structured analysis

- Status: Accepted
- Date: 2026-11-24

## Context

主操作は `curl | shxray` である。stdin はスクリプトなので、キー入力を stdin から読むフルスクリーン TUI は衝突する。stdout がパイプや CI のときは、色や制御シーケンスがノイズになる。将来の HTML 共有は、同じ事実を別の見た目で出す必要がある。

## Decision

既定の出力は、実行せずに読めるターミナル要約とする。stdout が TTY のときだけ色を付ける。TTY でないとき、または `--plain` / 空でない `NO_COLOR` のときはプレーンテキストにする。`--json` はバージョン付きレポートをそのまま出す。解析関数は表示を知らない。

## Decision Details

- レポート型は `AnalysisReport`（`version: 1`）。JSON にできる値だけを持つ。
- `src/analyze` は文字列を受け取りレポートを返す。ファイル I/O と stdout は `src/cli.ts` に置く。
- 要約の節は platforms、options、environment、install paths、privilege、network、side effects、notes とする。
- 代替画面（alternate screen）を使う対話 UI は採用しない。stdin をスクリプトのために残す。
- HTML レンダラは後から `AnalysisReport` を入力として追加する。解析器の入出力は変えない。
- フィールドの追加は version 1 のままにする。削除や意味の変更では `version` を上げる。

## Alternatives Considered

- 最初から対話的なフルスクリーン UI にする案。ファイル入力だけなら可能だが、パイプが主経路なので既定表示には向かない。
- JSON だけを出す案。CI には向くが、人が `curl | shxray` したときの可読性が落ちるため不採用。
- HTML を先に作る案。共有には向くが、ローカルでパイプする体験が遅れるため不採用。

## Consequences

- ターミナル要約と JSON は、同じ事実の二つの投影になる。
- 対話的な絞り込みは v1 にはない。
- 表示を足しても解析テストを書き直さなくてよい。

## Verification / Guardrails

1. E2E が、ファイル引数と stdin パイプの両方を `--json` とターミナル出力で確認する。
2. 非 TTY の出力に ANSI エスケープが無いことをテストする。
3. `src/analyze` が `Deno.*` を参照しないことをテストする。
