import { ParExpOperator, RedirOperator, walk } from "sh-syntax";
import type {
  Assign,
  File,
  FuncDecl,
  Node,
  ParamExp,
  Stmt,
  Word,
} from "sh-syntax";

import { unwrapCommand } from "./commands.ts";
import { type SourceMap } from "./source.ts";
import type { Locale } from "./types.ts";
import { argvOf, displayWord, unquote } from "./words.ts";

const DEFAULT_OPS = new Set<number>([
  ParExpOperator.DefaultUnset,
  ParExpOperator.DefaultUnsetOrNull,
  ParExpOperator.AssignUnset,
  ParExpOperator.AssignUnsetOrNull,
]);

const WRITE_REDIRS = new Set<number>([
  RedirOperator.RdrOut,
  RedirOperator.ClbOut,
  RedirOperator.AppOut,
  RedirOperator.AppClob,
  RedirOperator.RdrAll,
  RedirOperator.RdrAllClob,
  RedirOperator.AppAll,
  RedirOperator.AppAllClob,
]);

const BUILTIN_PRINTERS = new Set([
  "echo",
  "printf",
  "tput",
  "logger",
]);

const KNOWN_PRINTER_NAMES = new Set([
  "echo",
  "printf",
  "warn",
  "error",
  "die",
  "say",
  "usage",
  "info",
  "debug",
  "log",
  "msg",
  "notice",
  "trace",
]);

const PURE_CONTROL_COMMANDS = new Set([
  ":",
  "true",
  "false",
  "return",
  "exit",
  "shift",
  "break",
  "continue",
  "[",
  "test",
  "[[",
  "local",
  "readonly",
  "declare",
  "typeset",
  "unset",
  "command",
  "type",
]);

const IGNORED_BINDING_VARS = new Set([
  "PATH",
  "HOME",
  "PWD",
  "OLDPWD",
  "IFS",
  "SHELL",
  "USER",
  "LOGNAME",
  "TERM",
  "LANG",
  "LC_ALL",
  "OSTYPE",
  "UID",
  "EUID",
  "TMPDIR",
]);

const URL_PATTERN = /https?:\/\/[^\s"'`<>|;)]+/g;
const VAR_REF_PATTERN =
  /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:[:\-=?+][^}]*)?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

export interface VarBinding {
  name: string;
  kind: "default" | "value" | "dirname" | "url-helper";
  /** Display value (e.g. default path, URL template, or dirname target). */
  value: string;
}

export interface FunctionInfo {
  name: string;
  stmts: Stmt[];
  /** True when the function only prints/checks/returns with no side effects. */
  isPrinter: boolean;
  /** True when the function executes `"$@"` / `"$*"` as a command (or delegates to one). */
  forwards: boolean;
  /** True when the function wraps its delegated command with sudo/doas/pkexec. */
  usesPrivilege: boolean;
  /** Number of leading `shift` statements before forwarding `"$@"`. */
  leadingShifts: number;
  /** Literal `http(s)://...` URL templates echoed/printed by the function. */
  echoedUrls: string[];
  /** True when the function reads interactive input (`read` from tty/stdin). */
  promptsUser: boolean;
  /** Simple variable aliases assigned from positional params, e.g. `url="$1"`. */
  paramAliases: Map<string, number>;
  /** For printer functions that branch on a single case subject (e.g. after_finish_help). */
  printerCaseSummary: { subject: string; patterns: string[] } | null;
}

export interface ShellRunnerInfo {
  name: string;
  privileges: string[];
}

export interface ScriptMeta {
  functions: Map<string, FunctionInfo>;
  bindings: Map<string, VarBinding>;
  /** Variables assigned shell-c / privilege-runner strings (e.g. `sh_c='sudo -E sh -c'`). */
  shellRunners: Map<string, ShellRunnerInfo>;
}

/**
 * Inspect all function declarations and variable bindings in a single static
 * pass (no execution, no Deno I/O).
 */
export function analyzeScriptMeta(source: SourceMap, file: File): ScriptMeta {
  const functions = analyzeFunctions(source, file);
  const bindings = collectBindings(source, file, functions);
  const shellRunners = collectShellRunners(source, file);
  return { functions, bindings, shellRunners };
}

export function bodyStmtsOf(decl: FuncDecl): Stmt[] {
  const body = decl.body;
  if (!body?.cmd) return body ? [body] : [];
  if (body.cmd.type === "Block" || body.cmd.type === "Subshell") {
    return body.cmd.stmts;
  }
  return [body];
}

function analyzeFunctions(
  source: SourceMap,
  file: File,
): Map<string, FunctionInfo> {
  const raw = new Map<string, Stmt[]>();
  walk(file, (node) => {
    if (node.type !== "FuncDecl") return;
    const name = node.name?.value;
    if (!name || raw.has(name)) return;
    raw.set(name, bodyStmtsOf(node));
  });

  // Fixed-point pass 1: identify pure printer/logger functions.
  const isPrinter = new Map<string, boolean>();
  for (const name of raw.keys()) isPrinter.set(name, true);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, stmts] of raw) {
      if (!isPrinter.get(name)) continue;
      if (!bodyIsPurePrinter(source, stmts, isPrinter, raw)) {
        isPrinter.set(name, false);
        changed = true;
      }
    }
  }

  // Fixed-point pass 2: identify command-forwarding wrappers (never printers!).
  const forwards = new Map<string, boolean>();
  const usesPrivilege = new Map<string, boolean>();
  for (const [name, stmts] of raw) {
    if (isPrinter.get(name)) {
      forwards.set(name, false);
      usesPrivilege.set(name, false);
      continue;
    }
    const direct = directForwarding(source, stmts);
    forwards.set(name, direct.forwards);
    usesPrivilege.set(name, direct.usesPrivilege);
  }
  changed = true;
  while (changed) {
    changed = false;
    for (const [name, stmts] of raw) {
      if (isPrinter.get(name)) continue;
      // Large orchestrator functions (e.g. `main`) that pass CLI flags `"$@"`
      // to a downloaded binary via `ignore "$_file" "$@"` are not generic
      // command-forwarding wrappers.
      if (name === "main" || stmts.length > 12) continue;
      const delegated = delegatedForwarding(
        source,
        stmts,
        forwards,
        usesPrivilege,
      );
      if (delegated.forwards && !forwards.get(name)) {
        forwards.set(name, true);
        changed = true;
      }
      if (delegated.usesPrivilege && !usesPrivilege.get(name)) {
        usesPrivilege.set(name, true);
        changed = true;
      }
    }
  }

  const infos = new Map<string, FunctionInfo>();
  for (const [name, stmts] of raw) {
    const printer = isPrinter.get(name) === true;
    infos.set(name, {
      name,
      stmts,
      isPrinter: printer,
      forwards: forwards.get(name) === true,
      usesPrivilege: usesPrivilege.get(name) === true,
      leadingShifts: countLeadingShifts(source, stmts),
      echoedUrls: extractEchoedUrls(source, stmts),
      promptsUser: detectsInteractivePrompt(source, stmts),
      paramAliases: extractParamAliases(source, stmts),
      printerCaseSummary: printer ? extractPrinterCase(source, stmts) : null,
    });
  }
  return infos;
}

function bodyIsPurePrinter(
  source: SourceMap,
  stmts: Stmt[],
  isPrinter: Map<string, boolean>,
  defined: Map<string, Stmt[]>,
): boolean {
  let pure = true;
  let sawPrinterCall = false;
  for (const stmt of stmts) {
    walk(stmt, (node) => {
      if (!pure) return;
      if (node.type === "Assign") {
        // Functions that mutate variables (e.g. parse_args setting DISTRO=$2)
        // are not pure printers.
        pure = false;
        return;
      }
      if (node.type === "CaseClause") {
        const subject = node.word ? displayWord(source, node.word) : "";
        const patterns = node.items.flatMap((item) =>
          item.patterns.map((p) => displayWord(source, p))
        );
        if (
          /\$\{?[#@*]\}?|\$\{?[0-9]/.test(subject) ||
          patterns.some((p) => p.startsWith("-"))
        ) {
          pure = false;
          return;
        }
      }
      if (node.type === "Stmt") {
        for (const redir of node.redirs) {
          if (!WRITE_REDIRS.has(redir.op) || !redir.word) continue;
          const dest = unquote(
            source.slice(redir.word.start, redir.word.end).trim(),
          );
          if (!isBenignStream(dest)) pure = false;
        }
      }
      if (node.type !== "CallExpr" || node.args.length === 0) return;
      const firstRaw = unquote(
        source.slice(node.args[0]!.start, node.args[0]!.end).trim(),
      );
      if (firstRaw === "$@" || firstRaw === "$*") {
        pure = false;
        return;
      }
      const unwrapped = unwrapCommand(argvOf(source, node.args));
      if (
        unwrapped.wrappers.some((w) =>
          w === "sudo" || w === "doas" || w === "su" || w === "pkexec"
        )
      ) {
        pure = false;
        return;
      }
      const cmd = unwrapped.command;
      if (!cmd) return;
      if (BUILTIN_PRINTERS.has(cmd)) {
        sawPrinterCall = true;
        return;
      }
      if (cmd === "cat" && unwrapped.args.length === 0) {
        sawPrinterCall = true;
        return;
      }
      if (PURE_CONTROL_COMMANDS.has(cmd)) return;
      if (defined.has(cmd)) {
        if (isPrinter.get(cmd) === true) {
          sawPrinterCall = true;
          return;
        }
        pure = false;
        return;
      }
      if (KNOWN_PRINTER_NAMES.has(cmd)) {
        sawPrinterCall = true;
        return;
      }
      pure = false;
    });
    if (!pure) return false;
  }
  return pure && sawPrinterCall;
}

function directForwarding(
  source: SourceMap,
  stmts: Stmt[],
): { forwards: boolean; usesPrivilege: boolean } {
  let found = false;
  let priv = false;
  for (const stmt of stmts) {
    walk(stmt, (node) => {
      if (node.type !== "CallExpr" || node.args.length === 0) return;
      const argv = argvOf(source, node.args);
      const unwrapped = unwrapCommand(argv);
      const first = unwrapped.command;
      const hasPriv = unwrapped.wrappers.some((w) =>
        w === "sudo" || w === "doas" || w === "su" || w === "pkexec"
      );
      if (first === "$@" || first === "$*") {
        found = true;
        if (hasPriv) priv = true;
      }
    });
  }
  return { forwards: found, usesPrivilege: priv };
}

function delegatedForwarding(
  source: SourceMap,
  stmts: Stmt[],
  forwards: Map<string, boolean>,
  usesPrivilege: Map<string, boolean>,
): { forwards: boolean; usesPrivilege: boolean } {
  let found = false;
  let priv = false;
  for (const stmt of stmts) {
    walk(stmt, (node) => {
      if (node.type !== "CallExpr" || node.args.length === 0) return;
      const argv = argvOf(source, node.args);
      const unwrapped = unwrapCommand(argv);
      const target = unwrapped.command;
      if (!forwards.get(target)) return;
      const passesAt = unwrapped.args.some((arg) =>
        arg === "$@" || arg === "$*"
      );
      if (!passesAt) return;
      // Only treat as a generic command forwarder if `$@` is passed without a
      // fixed command already before it (e.g. `run "$STEP" sudo ... "$@"`).
      // Specialized wrappers like `apt_install` (`run_root "$STEP" apt-get ... install "$@"`)
      // execute a fixed command and are instantiated normally instead of treated
      // as generic runners.
      const beforeAt = unwrapped.args.slice(
        0,
        unwrapped.args.findIndex((arg) => arg === "$@" || arg === "$*"),
      );
      const hasSudoBefore = beforeAt.some((arg) =>
        arg === "sudo" || arg === "doas" || arg === "pkexec"
      );
      const hasFixedCommand = beforeAt.some((arg) =>
        arg === "apt-get" || arg === "apt" || arg === "dpkg" ||
        arg === "curl" || arg === "wget" || arg === "yum" || arg === "dnf" ||
        arg === "brew" || arg === "pacman" || arg === "apk"
      );
      if (hasFixedCommand) return;
      found = true;
      if (hasSudoBefore || usesPrivilege.get(target)) priv = true;
    });
  }
  return { forwards: found, usesPrivilege: priv };
}

function countLeadingShifts(source: SourceMap, stmts: Stmt[]): number {
  let count = 0;
  for (const stmt of stmts) {
    if (!stmt.cmd) continue;
    if (stmt.cmd.type !== "CallExpr") break;
    if (stmt.cmd.args.length === 0) continue; // assignment like STEP_NAME=$1
    const argv = argvOf(source, stmt.cmd.args);
    const cmd = argv[0] ?? "";
    if (cmd === "shift") {
      const n = Number(argv[1] ?? "1");
      count += Number.isFinite(n) && n > 0 ? n : 1;
      continue;
    }
    if (BUILTIN_PRINTERS.has(cmd) || KNOWN_PRINTER_NAMES.has(cmd)) continue;
    break;
  }
  return count;
}

function extractEchoedUrls(source: SourceMap, stmts: Stmt[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const stmt of stmts) {
    walk(stmt, (node) => {
      if (node.type !== "CallExpr" || node.args.length === 0) return;
      const argv = argvOf(source, node.args);
      const cmd = argv[0] ?? "";
      if (cmd !== "echo" && cmd !== "printf") return;
      const text = source.slice(node.start, node.end);
      for (const match of text.matchAll(URL_PATTERN)) {
        const url = match[0];
        if (!url || seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
      }
    });
  }
  return urls;
}

function detectsInteractivePrompt(source: SourceMap, stmts: Stmt[]): boolean {
  let found = false;
  for (const stmt of stmts) {
    walk(stmt, (node) => {
      if (found) return;
      if (node.type === "CallExpr" && node.args.length > 0) {
        const cmd = argvOf(source, node.args)[0];
        if (cmd === "read") found = true;
      }
    });
  }
  return found;
}

function extractParamAliases(
  source: SourceMap,
  stmts: Stmt[],
): Map<string, number> {
  const aliases = new Map<string, number>();
  for (const stmt of stmts) {
    if (stmt.cmd?.type !== "CallExpr" || stmt.cmd.args.length > 0) continue;
    for (const assign of stmt.cmd.assigns) {
      const name = assign.name?.value;
      if (!name || !assign.value) continue;
      const raw = unquote(
        source.slice(assign.value.start, assign.value.end).trim(),
      );
      const match = raw.match(/^\$\{?([1-9])\}?$/);
      if (match?.[1]) aliases.set(name, Number(match[1]));
    }
  }
  return aliases;
}

function extractPrinterCase(
  source: SourceMap,
  stmts: Stmt[],
): { subject: string; patterns: string[] } | null {
  for (const stmt of stmts) {
    if (stmt.cmd?.type === "CaseClause") {
      const subject = stmt.cmd.word
        ? displayWord(source, stmt.cmd.word)
        : "value";
      const patterns = stmt.cmd.items.flatMap((item) =>
        item.patterns.map((p) => displayWord(source, p))
      ).filter((p) => p !== "" && p !== "*");
      if (patterns.length >= 2) return { subject, patterns };
    }
  }
  return null;
}

function collectShellRunners(
  source: SourceMap,
  file: File,
): Map<string, ShellRunnerInfo> {
  const runners = new Map<string, Set<string>>();
  walk(file, (node) => {
    if (node.type !== "Assign") return;
    const name = node.name?.value;
    if (!name || !node.value) return;
    const text = displayWord(source, node.value).trim();
    const match = text.match(
      /^(?:(sudo|doas|pkexec|su)\b.*?\s+)?(?:(?:sh|bash|dash)\s+-c|-c)\b/,
    );
    if (!match) return;
    const privs = runners.get(name) ?? new Set<string>();
    if (match[1]) privs.add(match[1]);
    runners.set(name, privs);
  });
  const out = new Map<string, ShellRunnerInfo>();
  for (const [name, privs] of runners) {
    out.set(name, { name, privileges: [...privs].sort() });
  }
  return out;
}

function collectBindings(
  source: SourceMap,
  file: File,
  functions: Map<string, FunctionInfo>,
): Map<string, VarBinding> {
  const assignValues = new Map<
    string,
    { value: string; node: Word | null }[]
  >();
  const paramDefaults = new Map<string, string>();

  walk(file, (node: Node) => {
    if (node.type === "Assign") {
      recordAssign(source, node, assignValues);
    } else if (node.type === "ParamExp") {
      recordParamDefault(source, node, paramDefaults);
    }
  });

  const bindings = new Map<string, VarBinding>();

  // 1. Direct `${VAR:-default}` / `${VAR:=default}` reads (e.g. PREFIX).
  for (const [name, def] of paramDefaults) {
    if (IGNORED_BINDING_VARS.has(name) || def === "") continue;
    bindings.set(name, { name, kind: "default", value: def });
  }

  // 2. One assignment only. A later positional copy (`url="$1"`) or an
  // empty reset (`url=`) means the earlier literal is not the value.
  for (const [name, entries] of assignValues) {
    if (IGNORED_BINDING_VARS.has(name)) continue;
    if (entries.length !== 1) continue;
    const entry = entries[0]!;
    const val = entry.value;
    if (!entry.node || val === "" || /^\$\{?[0-9@*#]\}?$/.test(val)) continue;

    // Ignore numeric flags (`0`/`1`) or empty-default parameter guards (`${VAR:-}`).
    if (/^[01]$/.test(val)) continue;
    if (/^\$\{[A-Za-z_][A-Za-z0-9_]*:?-\}$/.test(val)) continue;

    // Case A: RHS is `${OTHER:-default}` or `${OTHER:=default}` (possibly quoted).
    const defaultFromParam = extractSingleDefaultParam(source, entry.node);
    if (defaultFromParam) {
      bindings.set(name, {
        name,
        kind: "default",
        value: defaultFromParam,
      });
      continue;
    }

    // Case B: RHS is `$(dirname "$other")`.
    const dirnameTarget = extractDirnameTarget(source, entry.node);
    if (dirnameTarget) {
      bindings.set(name, {
        name,
        kind: "dirname",
        value: dirnameTarget,
      });
      continue;
    }

    // Case C: RHS calls a pure URL-building helper function (e.g. `$(github_release_url ...)`).
    const helperUrl = extractHelperUrl(source, entry.node, functions);
    if (helperUrl) {
      bindings.set(name, {
        name,
        kind: "url-helper",
        value: helperUrl,
      });
      continue;
    }

    // Case D: Literal or simple variable-template string (no command substitution).
    if (!val.includes("$(") && !val.includes("`")) {
      bindings.set(name, { name, kind: "value", value: val });
    }
  }

  // 3. One pass of simple literal substitution inside URL templates
  //    (e.g. `BOOTSTRAP_VERSION=1.3.0` inside `BOOTSTRAP_URL=.../$BOOTSTRAP_VERSION/...`).
  const pureLiterals = new Map<string, string>();
  for (const [name, binding] of bindings) {
    if (binding.kind === "value" && !binding.value.includes("$")) {
      pureLiterals.set(name, binding.value);
    }
  }
  for (const [name, binding] of bindings) {
    if (binding.kind !== "value" || !binding.value.includes("$")) continue;
    const resolved = binding.value.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
      (full, braced?: string, plain?: string) => {
        const ref = braced ?? plain ?? "";
        return pureLiterals.get(ref) ?? full;
      },
    );
    if (resolved !== binding.value) {
      bindings.set(name, { ...binding, value: resolved });
    }
  }

  return bindings;
}

function recordAssign(
  source: SourceMap,
  node: Assign,
  map: Map<string, { value: string; node: Word | null }[]>,
): void {
  const name = node.name?.value;
  if (!name) return;
  const list = map.get(name) ?? [];
  if (!node.value) {
    list.push({ value: "", node: null });
  } else {
    list.push({
      value: displayWord(source, node.value).trim(),
      node: node.value,
    });
  }
  map.set(name, list);
}

function recordParamDefault(
  source: SourceMap,
  node: ParamExp,
  map: Map<string, string>,
): void {
  const name = node.param?.value;
  if (!name || !node.exp || !DEFAULT_OPS.has(node.exp.op)) return;
  if (map.has(name)) return;
  const word = node.exp.word;
  if (!word) return;
  const text = displayWord(source, word).trim();
  if (!text || text.includes("$(") || text.includes("`")) return;
  map.set(name, text);
}

function extractSingleDefaultParam(
  source: SourceMap,
  word: Word,
): string | null {
  let param: ParamExp | null = null;
  let nonDefaultPart = false;
  walk(word, (child) => {
    if (
      child.type === "ParamExp" && child.exp && DEFAULT_OPS.has(child.exp.op)
    ) {
      if (!param) param = child;
    } else if (child.type === "CmdSubst") {
      nonDefaultPart = true;
    }
  });
  if (!param || nonDefaultPart) return null;
  const found = param as ParamExp;
  const whole = displayWord(source, word).trim();
  const paramSlice = source.slice(found.start, found.end).trim();
  if (whole !== paramSlice) return null;
  const defWord = found.exp?.word;
  if (!defWord) return null;
  const def = displayWord(source, defWord).trim();
  return def.length > 0 ? def : null;
}

function extractDirnameTarget(source: SourceMap, word: Word): string | null {
  let target: string | null = null;
  walk(word, (child) => {
    if (target) return;
    if (child.type !== "CallExpr" || child.args.length < 2) return;
    const argv = argvOf(source, child.args);
    if (argv[0] === "dirname" && argv[1]) target = argv[1];
  });
  return target;
}

function extractHelperUrl(
  source: SourceMap,
  word: Word,
  functions: Map<string, FunctionInfo>,
): string | null {
  let found: string | null = null;
  walk(word, (child) => {
    if (found) return;
    if (child.type !== "CallExpr" || child.args.length === 0) return;
    const cmd = argvOf(source, child.args)[0] ?? "";
    const info = functions.get(cmd);
    if (info && info.echoedUrls.length > 0) found = info.echoedUrls[0] ?? null;
  });
  return found;
}

function isBenignStream(dest: string): boolean {
  const text = dest.replace(/\s+/g, "");
  return text === "/dev/null" ||
    text === "/dev/stderr" ||
    text === "/dev/stdout" ||
    text === "/dev/tty" ||
    text === "&1" ||
    text === "&2" ||
    /^\/dev\/fd\/\d+$/.test(text);
}

/**
 * Produce a short inline hint for variables referenced in `text` (e.g.
 * `(default: $HOME/.local/bin/mise)`), skipping variables already annotated
 * in `announced`.
 */
export function formatVarAnnotation(
  text: string,
  bindings: Map<string, VarBinding>,
  announced: Set<string>,
  locale: Locale = "en",
): string | null {
  const refs = extractVarRefs(text);
  const hints: string[] = [];
  for (const name of refs) {
    if (announced.has(name)) continue;
    const binding = bindings.get(name);
    if (!binding) continue;
    if (binding.value === text || text.includes(binding.value)) continue;
    announced.add(name);
    const wholeVar = text === `$${name}` || text === `\${${name}}` ||
      text === `"$${name}"` || text === `"\${${name}}"`;
    const prefix = wholeVar ? "" : `${name} `;
    if (binding.kind === "default") {
      hints.push(
        locale === "ja"
          ? `${prefix}既定: ${clipValue(binding.value)}`
          : `${prefix}default: ${clipValue(binding.value)}`,
      );
    } else if (binding.kind === "dirname") {
      hints.push(
        locale === "ja"
          ? `${prefix}${clipValue(binding.value)} の親ディレクトリ`
          : `${prefix}dirname of ${clipValue(binding.value)}`,
      );
    } else if (binding.kind === "url-helper") {
      hints.push(
        locale === "ja"
          ? `${prefix}参照先: ${clipValue(binding.value)}`
          : `${prefix}via ${clipValue(binding.value)}`,
      );
    } else {
      hints.push(`${prefix}= ${clipValue(binding.value)}`);
    }
    if (hints.length >= 2) break;
  }
  return hints.length > 0 ? `(${hints.join("; ")})` : null;
}

export function extractVarRefs(text: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(VAR_REF_PATTERN)) {
    const name = match[1] ?? match[2];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function clipValue(value: string, max = 96): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 3) + "...";
}
