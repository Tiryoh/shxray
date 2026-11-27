import { ParExpOperator, walk } from "sh-syntax";
import type {
  Assign,
  CaseClause,
  CaseItem,
  File,
  ParamExp,
  Word,
} from "sh-syntax";

import { extractVarRefs, type VarBinding } from "./bindings.ts";
import { optionFlag } from "./commands.ts";
import { joinOr } from "./locale.ts";
import type { SourceMap } from "./source.ts";
import type { InstallControl, Locale } from "./types.ts";
import { displayWord, staticText } from "./words.ts";

/** Stable JSON token. Prose is localized; this field is not. */
export const UNKNOWN_DEFAULT_REASON = "unknown default";

const DEFAULT_OPS = new Set<number>([
  ParExpOperator.DefaultUnset,
  ParExpOperator.DefaultUnsetOrNull,
  ParExpOperator.AssignUnset,
  ParExpOperator.AssignUnsetOrNull,
]);

/**
 * Shell and platform parameters. They are not installer configuration, matching
 * the names `interface.environment` already ignores. A path that only mentions
 * `$HOME` stays as written instead of gaining an "unknown default" clause.
 */
const IGNORED_INSTALL_VARS = new Set([
  "PATH",
  "HOME",
  "PWD",
  "OLDPWD",
  "IFS",
  "PS1",
  "PS2",
  "PS3",
  "PS4",
  "RANDOM",
  "SECONDS",
  "LINENO",
  "BASH_SOURCE",
  "BASH_VERSION",
  "BASHOPTS",
  "SHELLOPTS",
  "OPTIND",
  "OPTARG",
  "REPLY",
  "UID",
  "EUID",
  "PPID",
  "HOSTNAME",
  "HOSTTYPE",
  "MACHTYPE",
  "OSTYPE",
  "SHLVL",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "OS",
  "ARCH",
  "TMPDIR",
]);

interface ParamDefault {
  value: string;
  dynamic: boolean;
}

interface AssignmentFact {
  text: string;
  word: Word | null;
}

interface VarFacts {
  paramDefault: ParamDefault | null;
  assignments: AssignmentFact[];
}

export interface InstallControlContext {
  vars: Map<string, VarFacts>;
  optionsByVar: Map<string, string[]>;
  bindings: ReadonlyMap<string, VarBinding>;
}

interface ResolvedVar {
  defaultValue: string | null;
  defaultReason: string | null;
  envOverride: string | null;
}

export function buildInstallControlContext(
  source: SourceMap,
  file: File,
  bindings: ReadonlyMap<string, VarBinding>,
): InstallControlContext {
  const vars = new Map<string, VarFacts>();
  const optionsByVar = new Map<string, string[]>();
  walk(file, (node) => {
    if (node.type === "ParamExp") recordParamDefault(source, node, vars);
    else if (node.type === "Assign") recordAssignment(source, node, vars);
    else if (node.type === "CaseClause") {
      recordOptionAssignments(source, node, optionsByVar);
    }
  });
  return { vars, optionsByVar, bindings };
}

export function controlsForDestination(
  destination: string,
  ctx: InstallControlContext,
): InstallControl[] {
  const controls: InstallControl[] = [];
  const seen = new Set<string>();
  for (const name of extractVarRefs(destination)) {
    if (IGNORED_INSTALL_VARS.has(name) || seen.has(`environment:${name}`)) {
      continue;
    }
    const resolved = resolveVar(name, ctx);
    controls.push({
      kind: "environment",
      name,
      defaultValue: resolved.defaultValue,
      defaultReason: resolved.defaultReason,
      envOverride: resolved.envOverride,
      assigns: null,
    });
    seen.add(`environment:${name}`);
    for (const flag of ctx.optionsByVar.get(name) ?? []) {
      if (seen.has(`option:${flag}`)) continue;
      seen.add(`option:${flag}`);
      controls.push({
        kind: "option",
        name: flag,
        defaultValue: null,
        defaultReason: UNKNOWN_DEFAULT_REASON,
        envOverride: null,
        assigns: name,
      });
    }
    const override = resolved.envOverride;
    if (
      override &&
      override !== name &&
      !IGNORED_INSTALL_VARS.has(override) &&
      !seen.has(`environment:${override}`)
    ) {
      seen.add(`environment:${override}`);
      controls.push({
        kind: "environment",
        name: override,
        defaultValue: resolved.defaultValue,
        defaultReason: resolved.defaultReason,
        envOverride: override,
        assigns: null,
      });
    }
  }
  return controls;
}

/**
 * Parenthetical used by Summary and Flow.
 * Variables already described are skipped via `announced`.
 */
export function formatInstallControls(
  destination: string,
  controls: readonly InstallControl[],
  announced: Set<string>,
  locale: Locale,
): string | null {
  const referenced = new Set(extractVarRefs(destination));
  const parts: string[] = [];
  for (const control of controls) {
    if (control.kind !== "environment") continue;
    if (!referenced.has(control.name) || announced.has(control.name)) continue;
    announced.add(control.name);
    const options = controls.filter((item) =>
      item.kind === "option" && item.assigns === control.name
    ).map((item) => item.name);
    parts.push(describeControl(control, options, locale));
  }
  if (parts.length === 0) return null;
  return `(${parts.join(locale === "ja" ? "、" : "; ")})`;
}

function describeControl(
  control: InstallControl,
  options: string[],
  locale: Locale,
): string {
  const overrides: string[] = [];
  if (control.envOverride) overrides.push(`${control.envOverride}=...`);
  overrides.push(...options);
  const override = overrides.length === 0
    ? null
    : locale === "ja"
    ? `上書きは ${joinOr(overrides, "ja")}`
    : `override with ${joinOr(overrides, "en")}`;

  const reason = control.defaultReason;
  if (reason?.startsWith("dirname of ")) {
    const target = reason.slice("dirname of ".length);
    const head = locale === "ja"
      ? `${control.name} は ${target} の親ディレクトリ`
      : `${control.name} dirname of ${target}`;
    return joinHead(head, override, locale);
  }
  if (reason?.startsWith("via ")) {
    const target = reason.slice("via ".length);
    const head = locale === "ja"
      ? `${control.name} の参照先は ${target}`
      : `${control.name} via ${target}`;
    return joinHead(head, override, locale);
  }
  if (control.defaultValue !== null && control.envOverride) {
    const shown = showValue(control.defaultValue);
    const head = locale === "ja"
      ? `${control.name} の既定値は ${shown}`
      : `${control.name} defaults to ${shown}`;
    return joinHead(head, override, locale);
  }
  if (control.defaultValue !== null) {
    const shown = showValue(control.defaultValue);
    const head = locale === "ja"
      ? `${control.name} は ${shown}`
      : `${control.name} is ${shown}`;
    return joinHead(head, override, locale);
  }
  const head = locale === "ja"
    ? `${control.name} の既定値は不明`
    : `${control.name} unknown default`;
  return joinHead(head, override, locale);
}

function joinHead(
  head: string,
  override: string | null,
  locale: Locale,
): string {
  if (!override) return head;
  return locale === "ja" ? `${head}。${override}` : `${head}; ${override}`;
}

function showValue(value: string): string {
  return value === "" ? '""' : value;
}

function resolveVar(name: string, ctx: InstallControlContext): ResolvedVar {
  const facts = ctx.vars.get(name);
  const param = facts?.paramDefault ?? null;
  if (param) {
    if (param.dynamic) return unknown(name);
    return {
      defaultValue: clipValue(param.value),
      defaultReason: null,
      envOverride: name,
    };
  }
  if ((facts?.assignments.length ?? 0) > 1) return unknown(null);
  if (facts?.assignments.length === 1) {
    return resolveSingleAssignment(name, facts.assignments[0]!, ctx.bindings);
  }
  const binding = ctx.bindings.get(name);
  if (binding) return fromBinding(binding);
  return unknown(name);
}

function resolveSingleAssignment(
  name: string,
  assignment: AssignmentFact,
  bindings: ReadonlyMap<string, VarBinding>,
): ResolvedVar {
  const param = singleParamDefault(assignment);
  if (param) {
    if (param.dynamic) return unknown(param.name);
    return {
      defaultValue: clipValue(param.value),
      defaultReason: null,
      envOverride: param.name,
    };
  }
  const binding = bindings.get(name);
  if (binding?.kind === "dirname" || binding?.kind === "url-helper") {
    return fromBinding(binding);
  }
  if (
    binding?.kind === "value" &&
    !binding.value.includes("$(") &&
    !binding.value.includes("`") &&
    !/^\$\{?[0-9@*#]/.test(binding.value)
  ) {
    // `$OPTARG` or `$OTHER` is not a static default. A template such as
    // `$WORK_DIR/status` is kept because that text is written in the script.
    if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(binding.value)) {
      return unknown(null);
    }
    return {
      defaultValue: clipValue(binding.value),
      defaultReason: null,
      envOverride: null,
    };
  }
  const literal = staticText(assignment.word);
  if (literal !== null && !literal.includes("$(") && !literal.includes("`")) {
    return {
      defaultValue: clipValue(literal),
      defaultReason: null,
      envOverride: null,
    };
  }
  return unknown(null);
}

function fromBinding(binding: VarBinding): ResolvedVar {
  if (binding.kind === "dirname") {
    return {
      defaultValue: null,
      defaultReason: `dirname of ${clipValue(binding.value)}`,
      envOverride: null,
    };
  }
  if (binding.kind === "url-helper") {
    return {
      defaultValue: null,
      defaultReason: `via ${clipValue(binding.value)}`,
      envOverride: null,
    };
  }
  if (binding.kind === "default") {
    return {
      defaultValue: clipValue(binding.value),
      defaultReason: null,
      envOverride: binding.name,
    };
  }
  if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(binding.value)) {
    return unknown(null);
  }
  return {
    defaultValue: clipValue(binding.value),
    defaultReason: null,
    envOverride: null,
  };
}

function unknown(envOverride: string | null): ResolvedVar {
  return {
    defaultValue: null,
    defaultReason: UNKNOWN_DEFAULT_REASON,
    envOverride,
  };
}

function ensureVar(vars: Map<string, VarFacts>, name: string): VarFacts {
  const existing = vars.get(name);
  if (existing) return existing;
  const created: VarFacts = { paramDefault: null, assignments: [] };
  vars.set(name, created);
  return created;
}

function recordParamDefault(
  source: SourceMap,
  node: ParamExp,
  vars: Map<string, VarFacts>,
): void {
  const name = node.param?.value;
  if (!name || !node.exp || !DEFAULT_OPS.has(node.exp.op)) return;
  const facts = ensureVar(vars, name);
  if (facts.paramDefault) return;
  const word = node.exp.word;
  if (!word) {
    facts.paramDefault = { value: "", dynamic: false };
    return;
  }
  const text = displayWord(source, word).trim();
  const dynamic = text.includes("$(") || text.includes("`");
  facts.paramDefault = { value: dynamic ? "" : text, dynamic };
}

function recordAssignment(
  source: SourceMap,
  node: Assign,
  vars: Map<string, VarFacts>,
): void {
  const name = node.name?.value;
  if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
  const facts = ensureVar(vars, name);
  facts.assignments.push({
    text: node.value ? displayWord(source, node.value).trim() : "",
    word: node.value,
  });
}

function recordOptionAssignments(
  source: SourceMap,
  clause: CaseClause,
  optionsByVar: Map<string, string[]>,
): void {
  const subject = clause.word ? displayWord(source, clause.word) : "";
  const positional = isPositionalSubject(subject);
  const getopts = isGetoptsSubject(subject);
  if (!positional && !getopts) return;
  for (const item of clause.items) {
    const flags = flagsOfItem(source, item, getopts && !positional);
    if (flags.length === 0) continue;
    for (const name of variablesSetByOption(source, item)) {
      if (IGNORED_INSTALL_VARS.has(name)) continue;
      const list = optionsByVar.get(name) ?? [];
      for (const flag of flags) {
        if (!list.includes(flag)) list.push(flag);
      }
      optionsByVar.set(name, list);
    }
  }
}

function flagsOfItem(
  source: SourceMap,
  item: CaseItem,
  getoptsLetters: boolean,
): string[] {
  const flags: string[] = [];
  for (const pattern of item.patterns) {
    const text = displayWord(source, pattern).trim();
    const parsed = optionFlag(text);
    if (parsed) {
      if (!flags.includes(parsed.flag)) flags.push(parsed.flag);
      continue;
    }
    if (getoptsLetters && /^[A-Za-z0-9]$/.test(text)) {
      const flag = `-${text}`;
      if (!flags.includes(flag)) flags.push(flag);
    }
  }
  return flags;
}

function variablesSetByOption(source: SourceMap, item: CaseItem): string[] {
  const names: string[] = [];
  const body = source.slice(item.start, item.end);
  walk(item, (node) => {
    if (node.type !== "Assign") return;
    const name = node.name?.value;
    if (!name || names.includes(name)) return;
    if (!assignmentComesFromOption(source, node, body)) return;
    names.push(name);
  });
  return names;
}

function assignmentComesFromOption(
  source: SourceMap,
  node: Assign,
  body: string,
): boolean {
  if (!node.value) return false;
  const text = displayWord(source, node.value).trim();
  if (text.includes("$(") || text.includes("`")) return false;
  if (/^\$\{?2\}?$/.test(text)) return true;
  if (/^\$\{?OPTARG\}?$/i.test(text)) return true;
  if (/^\$\{1#[^}]+\}$/.test(text)) return true;
  if (/^\$\{?1\}?$/.test(text)) return /\bshift\b/.test(body);
  return staticText(node.value) !== null;
}

function singleParamDefault(
  assignment: AssignmentFact,
): { name: string; value: string; dynamic: boolean } | null {
  const word = assignment.word;
  if (!word) return null;
  const param = soleDefaultParam(word);
  if (!param) return null;
  const name = param.param?.value;
  if (!name) return null;
  const operand = defaultOperand(assignment.text.trim());
  if (operand === null || param.param?.value !== operandName(assignment.text)) {
    return null;
  }
  let command = false;
  walk(word, (child) => {
    if (child.type === "CmdSubst" || child.type === "ProcSubst") command = true;
  });
  const dynamic = command || operand.includes("$(") || operand.includes("`");
  return { name, value: dynamic ? "" : operand, dynamic };
}

function soleDefaultParam(word: Word): ParamExp | null {
  if (word.parts.length !== 1) return null;
  const only = word.parts[0];
  if (!only) return null;
  if (only.type === "ParamExp") return defaultParam(only);
  if (only.type !== "DblQuoted" || only.parts.length !== 1) return null;
  const inner = only.parts[0];
  if (!inner || inner.type !== "ParamExp") return null;
  return defaultParam(inner);
}

function defaultParam(node: ParamExp): ParamExp | null {
  if (!node.exp || !DEFAULT_OPS.has(node.exp.op)) return null;
  return node;
}

function operandName(text: string): string | null {
  const match = text.trim().match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::[-=])/);
  return match?.[1] ?? null;
}

function defaultOperand(expansion: string): string | null {
  const match = expansion.match(
    /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::[-=])([\s\S]*)\}$/,
  );
  if (!match) return null;
  return (match[2] ?? "").trim();
}

function isPositionalSubject(subject: string): boolean {
  const text = subject.trim().replace(/^['"]|['"]$/g, "");
  return text === "$1" || text === "${1}";
}

function isGetoptsSubject(subject: string): boolean {
  const text = subject.trim().replace(/^['"]|['"]$/g, "");
  return /^\$\{?(opt|option|flag|flags|arg)[A-Za-z0-9_]*\}?$/i.test(text);
}

function clipValue(value: string, max = 96): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 3) + "...";
}
