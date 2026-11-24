# ADR: sh-syntax parser

- Status: Accepted
- Date: 2026-11-24

## Context

インストールスクリプトの挙動を知るには、引用、`case`、パイプ、パラメータ展開の境界が要る。行に対する正規表現では、文字列の中の `curl` と実際のコマンドを取り違える。対象言語は POSIX sh と Bash が中心である。

## Decision

`sh-syntax` 0.8.7（`mvdan/sh` の Wasm ビルド）で AST を作り、抽出はその木のウォークで行う。

## Decision Details

- 既定の言語は Bash。`--posix` で POSIX sh を選ぶ。
- 実行時はパッケージの `parse` を使う。Node 向けエントリは、モジュール相対の `main.wasm` を `node:fs` で読む。
- Deno 2.9.8 の `deno compile`（`--bundle` なし）は、npm パッケージの仮想ファイルシステムごと Wasm を同梱する。`--include` は不要だった。
- `--bundle` は JavaScript だけを埋め、実行時に `main.wasm` を見つけられず `ENOENT` になる。公式手順では使わない。
- 構文エラーは最初の 1 件で例外になる。部分 AST は返さない。終了コードは 2 とし、レポートの `parse.ok` を false にする。
- Zsh は対象外とする。

## Alternatives Considered

- 正規表現と行スキャン。実装は短いが、引用やヒアドキュメントで誤検知が多いため不採用。
- tree-sitter-bash。増分パースには向くが、POSIX sh のカバーと `mvdan/sh` の実績を優先した。
- ネイティブの `mvdan/sh` をサブプロセスで呼ぶ案。外部バイナリが増え、`deno compile` 一本に収まらないため不採用。
- `sh-syntax` の Wasm を `--unstable-raw-imports` でバイト列として import する案。通常の `deno compile` が既に Wasm を同梱できるため、不安定フラグは採用しない。

## Consequences

- 抽出は構文に沿う。コマンド名の意味付け（`curl` はダウンロード、など）は AST の外側のヒューリスティックとして残る。
- Wasm の起動コストがプロセスごとにかかる。
- 演算子は `sh-syntax` の数値 enum に依存する。パッケージは 0.8.7 に固定する。

## Verification / Guardrails

1. ユニットテストが、OS / arch、オプション、環境変数、インストール先、sudo、ダウンロード、危険なパターンを AST から取る。
2. コンパイル済みバイナリが、Wasm をディスク上の隣接ファイルとして要求せずにパースできる。
3. `--bundle` を `deno task compile` に含めない。
