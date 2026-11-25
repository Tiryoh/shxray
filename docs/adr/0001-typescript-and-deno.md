# ADR: TypeScript and Deno

- Status: Accepted
- Date: 2026-11-24

## Context

shxray は `curl | bash` のシェルを置き換える CLI である。配布形態としては単一バイナリが望ましい。同時に、同じ解析結果を後から HTML で共有したい。解析と表示で言語が分かれると、レポートの型とテストが二重になる。

## Decision

TypeScript と Deno で実装する。単一バイナリは `deno compile` で作る。解析コアはランタイム API に依存させず、CLI と将来の Web ビューアが同じモジュールを使う。

## Decision Details

- エントリは `src/main.ts`。解析は `src/analyze`、表示は `src/render` に分ける。
- 依存関係は `deno.json` の import map と `deno.lock` で固定する。
- 実行時権限は、ファイル読み取りの `--allow-read` と `NO_COLOR` 参照の `--allow-env` だけとする。ネットワーク権限は与えない。
- 公式のビルドは次のとおり。

```bash
deno compile --allow-read --allow-env --output dist/shxray src/main.ts
```

## Alternatives Considered

- Go で `mvdan/sh` を直接使う案。単一バイナリは小さく作れる。将来の HTML ビューアと型を共有できないため不採用。
- Rust に Wasm バインディングを足す案。配布物は小さいが、Web と CLI の共有には別の TypeScript 境界が必要になるため不採用。
- Node.js と pkg、または bun compile。単一バイナリは可能だが、テストと `deno compile` の検証を同じツールチェーンに置ける Deno を選んだ。
- Python。試作は速いが、単一バイナリとブラウザ共有の両方には向かないため不採用。

## Consequences

- CLI と将来の HTML が同じレポート型を使える。
- `deno compile` の成果物は Deno ランタイムを含む。Deno 2.9.8 の Linux x86_64 では約 105MiB になる。埋め込みファイルは約 4.3MiB で、そのほとんどは Wasm である。
- 開発、テスト、ビルドの手順が Deno に揃う。

## Verification / Guardrails

1. `deno check`、`deno lint`、`deno fmt --check` を通す。
2. `deno task compile` で生成したバイナリを、別ディレクトリからサンプルスクリプトに対して実行する。
3. `tests/e2e/compile_test.ts` が同じスモークテストを毎回実行する。
