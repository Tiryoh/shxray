import type { Locale } from "./types.ts";

/**
 * Resolve a POSIX locale string (e.g. `ja_JP.UTF-8`, `ja`, `en_US.UTF-8`, `C`)
 * into a supported shxray locale (`"ja"` or `"en"`). Returns `null` for empty
 * strings.
 */
export function parseLocale(raw: string | undefined | null): Locale | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (
    trimmed === "ja" || trimmed.startsWith("ja_") || trimmed.startsWith("ja-")
  ) {
    return "ja";
  }
  return "en";
}

export function joinAnd(items: string[], locale: Locale = "en"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  if (locale === "ja") return items.join("・");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function joinOr(items: string[], locale: Locale = "en"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  if (locale === "ja") return items.join(" または ");
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

export function joinClauses(items: string[], locale: Locale = "en"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  if (locale === "ja") return items.join("、");
  return joinAnd(items, "en");
}

export function analysisNotes(locale: Locale): string[] {
  if (locale === "ja") {
    return [
      "静的解析のみです（スクリプトは実行していません）。",
      "すべての分岐と関数本体を検査します。到達可能性は計算しません。",
      "動的な値（ダウンロード URL 引数など）は記述どおり表示します。単一代入や ${VAR:-default} / ${VAR:=default} のデフォルトは併記します。",
      "OS とアーキテクチャ名は正規化しています（amd64 -> x86_64、arm64 -> aarch64）。",
      "処理の流れはトップレベルからのリテラル関数呼び出しを辿り、分岐の候補を列挙します。どの分岐が実行されるかは決めません。",
    ];
  }
  return [
    "Static analysis only; the script was not executed.",
    "Every branch and function body is inspected. Reachability is not computed.",
    "Dynamic values are shown as written, including download URL arguments. Defaults are reported for literals and for ${VAR:-default} / ${VAR:=default}.",
    "Operating system and architecture names are normalized (amd64 -> x86_64, arm64 -> aarch64).",
    "The flow follows literal function calls from the top level and lists every branch. It does not decide which branch runs.",
  ];
}
