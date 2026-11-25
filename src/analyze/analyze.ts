import { LangVariant, parse } from "sh-syntax";

import { extractFacts } from "./extract.ts";
import { shebangOf, SourceMap } from "./source.ts";
import type { AnalysisReport, Severity, ShellVariant } from "./types.ts";
import { REPORT_VERSION } from "./types.ts";
import { VERSION } from "../version.ts";

export interface AnalyzeOptions {
  /** Display name for the input. Defaults to `<script>`. */
  name?: string;
  /** Shell language. Defaults to bash. */
  variant?: ShellVariant;
}

const NOTES = [
  "Static analysis only; the script was not executed.",
  "Every branch and function body is inspected. Reachability is not computed.",
  "Dynamic values are shown as written, including download URL arguments. Defaults are reported for literals and for ${VAR:-default} / ${VAR:=default}.",
  "Operating system and architecture names are normalized (amd64 -> x86_64, arm64 -> aarch64).",
];

export async function analyze(
  sourceText: string,
  options: AnalyzeOptions = {},
): Promise<AnalysisReport> {
  const variant = options.variant ?? "bash";
  const source = new SourceMap(sourceText);
  const parsed = await parseScript(sourceText, variant);
  const facts = parsed.file ? extractFacts(source, parsed.file) : emptyFacts();
  const summary = summarize(facts);
  const notes = [...NOTES];
  if (!parsed.ok) {
    notes.unshift("The script did not parse, so no facts were extracted.");
  }
  if (sourceText.length === 0) notes.push("Input is empty.");

  return {
    version: REPORT_VERSION,
    tool: { name: "shxray", version: VERSION },
    source: {
      name: options.name ?? "<script>",
      bytes: source.bytes.length,
      lines: source.lineCount(),
      shebang: shebangOf(sourceText),
    },
    parse: {
      ok: parsed.ok,
      variant,
      error: parsed.error,
    },
    summary,
    platforms: {
      operatingSystems: facts.operatingSystems,
      architectures: facts.architectures,
      detections: facts.detections,
    },
    interface: {
      options: facts.options,
      environment: facts.environment,
    },
    installs: facts.installs,
    privileges: facts.privileges,
    network: {
      downloads: facts.downloads,
      integrity: facts.integrity,
    },
    sideEffects: facts.sideEffects,
    notes,
  };
}

interface ParseOutcome {
  ok: boolean;
  file: Awaited<ReturnType<typeof parse>> | null;
  error: AnalysisReport["parse"]["error"];
}

async function parseScript(
  sourceText: string,
  variant: ShellVariant,
): Promise<ParseOutcome> {
  try {
    const file = await parse(sourceText, {
      variant: variant === "posix"
        ? LangVariant.LangPOSIX
        : LangVariant.LangBash,
      keepComments: true,
    });
    return { ok: true, file, error: null };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "The script could not be parsed.";
    const position = readPosition(error);
    return {
      ok: false,
      file: null,
      error: {
        message,
        line: position?.line ?? null,
        column: position?.column ?? null,
      },
    };
  }
}

function readPosition(error: unknown): { line: number; column: number } | null {
  if (typeof error !== "object" || error === null || !("pos" in error)) {
    return null;
  }
  const pos = (error as { pos?: { line?: number; column?: number } }).pos;
  if (!pos || typeof pos.line !== "number" || pos.line < 1) return null;
  const column = typeof pos.column === "number" ? pos.column + 1 : 1;
  return { line: pos.line, column };
}

function emptyFacts(): ReturnType<typeof extractFacts> {
  return {
    operatingSystems: [],
    architectures: [],
    detections: [],
    options: [],
    environment: [],
    installs: [],
    privileges: [],
    downloads: [],
    integrity: [],
    sideEffects: [],
  };
}

function summarize(
  facts: ReturnType<typeof extractFacts>,
): AnalysisReport["summary"] {
  let risk: Severity = "info";
  const bump = (severity: Severity) => {
    if (rank(severity) > rank(risk)) risk = severity;
  };
  for (const effect of facts.sideEffects) bump(effect.severity);
  const escalates = facts.privileges.some((fact) => fact.kind !== "root-check");
  if (escalates) bump("medium");
  if (facts.downloads.length > 0) bump("medium");
  if (risk === "info" && facts.installs.length > 0) bump("low");

  const kinds = new Set(facts.sideEffects.map((effect) => effect.kind));
  const other = facts.sideEffects.some((effect) =>
    effect.kind !== "pipe-to-shell" &&
    effect.kind !== "eval" &&
    effect.kind !== "shell-command-string"
  );
  const parts: string[] = [];
  if (kinds.has("pipe-to-shell")) parts.push("pipes input into a shell");
  if (kinds.has("eval")) parts.push("evaluates shell text");
  if (kinds.has("shell-command-string")) parts.push("runs a shell -c string");
  if (facts.downloads.length > 0) parts.push("downloads remote files");
  if (facts.installs.length > 0) parts.push("writes install paths");
  if (escalates) parts.push("uses privilege escalation");
  if (other) parts.push("has other notable side effects");
  const headline = parts.length === 0
    ? "No installer actions matched the current heuristics."
    : capitalize(parts.join("; ")) + ".";

  return {
    risk,
    headline,
    counts: {
      options: facts.options.length,
      environment: facts.environment.length,
      installs: facts.installs.length,
      privileges: facts.privileges.length,
      downloads: facts.downloads.length,
      integrity: facts.integrity.length,
      sideEffects: facts.sideEffects.length,
    },
  };
}

function rank(severity: Severity): number {
  switch (severity) {
    case "info":
      return 0;
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
  }
}

function capitalize(text: string): string {
  if (text.length === 0) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
