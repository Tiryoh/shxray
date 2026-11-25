import { BinCmdOperator, RedirOperator, walk } from "sh-syntax";
import type {
  BinaryCmd,
  CallExpr,
  CaseClause,
  File,
  ForClause,
  IfClause,
  Node,
  Stmt,
  WhileClause,
} from "sh-syntax";

import {
  analyzeScriptMeta,
  formatVarAnnotation,
  type FunctionInfo,
  type ScriptMeta,
  type VarBinding,
} from "./bindings.ts";
import { commandVerifies, unwrapCommand, urlOperands } from "./commands.ts";
import { joinAnd, joinClauses, joinOr } from "./locale.ts";
import { subjectLooksLikePlatform } from "./platforms.ts";
import { oneLine, type SourceMap } from "./source.ts";
import type {
  DownloadFact,
  FlowStep,
  InstallFact,
  IntegrityFact,
  Locale,
} from "./types.ts";
import { argvOf, displayWord, rawArgvOf, unquote } from "./words.ts";

const COMPACT_STEP_BUDGET = 400;
const DETAILED_STEP_BUDGET = 500;
const MAX_CALL_DEPTH = 6;

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

const APPEND_REDIRS = new Set<number>([
  RedirOperator.AppOut,
  RedirOperator.AppClob,
  RedirOperator.AppAll,
  RedirOperator.AppAllClob,
]);

const PRINTERS = new Set([
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

const DOWNLOADERS = new Set(["curl", "wget", "fetch", "aria2c", "axel"]);
const CHECKSUMS = new Set([
  "sha256sum",
  "sha384sum",
  "sha512sum",
  "sha1sum",
  "md5sum",
  "shasum",
  "b2sum",
]);
const SIGNATURES = new Set(["gpg", "gpgv", "cosign", "minisign", "signify"]);
const PACKAGE_MANAGERS = new Set([
  "apt",
  "apt-get",
  "aptitude",
  "yum",
  "dnf",
  "pacman",
  "apk",
  "brew",
  "zypper",
  "snap",
  "flatpak",
  "port",
  "pkg",
  "nix-env",
  "emerge",
]);
const ARCHIVERS = new Set(["tar", "unzip", "gunzip", "gzip"]);
const PLACERS = new Set(["install", "cp", "mv", "ln", "mkdir", "tee"]);
const SHELLS = new Set(["sh", "bash", "dash", "ash", "zsh"]);

const KNOWN_TOOLS = new Set<string>([
  ...DOWNLOADERS,
  ...CHECKSUMS,
  ...SIGNATURES,
  ...PACKAGE_MANAGERS,
  ...ARCHIVERS,
  ...PLACERS,
  ...SHELLS,
  "dpkg",
  "uname",
  "locale-gen",
  "add-apt-repository",
  "chmod",
  "rm",
  "mktemp",
  "sudo",
  "doas",
  "pkexec",
  "env",
  "id",
]);

const RC_PATTERN =
  /\.(bashrc|zshrc|profile|bash_profile|zprofile|bash_login|kshrc|cshrc|zshenv|zlogin)\b/;

export interface BuiltFlow {
  entry: string | null;
  note: string | null;
  steps: FlowStep[];
  detailed: FlowStep[];
  packageManagers: string[];
  installsDeb: boolean;
  bindings: Map<string, VarBinding>;
}

/** Language-independent structural metadata carried during compact coalescing. */
type StepTag =
  | {
    kind: "download";
    tool: string;
    target: string;
    assignedVar: string | null;
  }
  | { kind: "trap"; signals: string[] }
  | { kind: "rm"; tool: string; targets: string[]; tempStderr: boolean }
  | { kind: "mktemp"; assignedVar: string | null; tempStderr: boolean }
  | { kind: "assign-read"; varName: string }
  | { kind: "pure-branch"; subject: string | null; values: string[] }
  | { kind: "options" }
  | { kind: "archive-tar"; target: string | null }
  | { kind: "archive-pipe"; target: string | null }
  | { kind: "branch-group" };

interface DraftStep {
  text: string;
  unresolved: string | null;
  line: number | null;
  children: DraftStep[];
  tag?: StepTag;
}

interface CallScope {
  positional: string[];
  rawPositional: string[];
  aliases: Map<string, string>;
  setParams: string[];
}

export function buildFlow(
  source: SourceMap,
  file: File,
  meta: ScriptMeta = analyzeScriptMeta(source, file),
  locale: Locale = "en",
): BuiltFlow {
  const compact = new FlowBuilder(source, file, meta, "compact", locale)
    .build();
  const detailed = new FlowBuilder(source, file, meta, "detailed", locale)
    .build();
  return {
    entry: compact.entry,
    note: compact.note,
    steps: compact.steps,
    detailed: detailed.steps,
    packageManagers: compact.packageManagers,
    installsDeb: compact.installsDeb,
    bindings: meta.bindings,
  };
}

export function summarySentences(
  facts: {
    installs: InstallFact[];
    privileges: { kind: string }[];
    operatingSystems: string[];
    architectures: string[];
    downloads?: DownloadFact[];
    integrity?: IntegrityFact[];
  },
  observed: {
    packageManagers: string[];
    installsDeb: boolean;
    bindings?: Map<string, VarBinding>;
  },
  locale: Locale = "en",
): string[] {
  const announced = new Set<string>();
  const bindings = observed.bindings ?? new Map<string, VarBinding>();
  const primary = facts.installs.filter((fact) => !isIncidentalWrite(fact));
  const incidental = facts.installs.filter(isIncidentalWrite);
  const managers = [...new Set(observed.packageManagers)].sort();
  const sentences: string[] = [];
  const install = installSentence(
    primary,
    managers,
    observed.installsDeb,
    bindings,
    announced,
    locale,
  );
  if (install) sentences.push(install);
  else {
    sentences.push(
      locale === "ja"
        ? "インストール先やパッケージマネージャの実行は検出されませんでした。"
        : "No install destination or package-manager command was recognized.",
    );
  }
  if (incidental.length > 0) {
    sentences.push(writeSentence(incidental, bindings, announced, locale));
  }
  const network = networkSentence(
    facts.downloads ?? [],
    facts.integrity ?? [],
    bindings,
    locale,
  );
  if (network) sentences.push(network);
  sentences.push(privilegeSentence(facts.privileges, locale));
  sentences.push(
    platformSentence(facts.operatingSystems, facts.architectures, locale),
  );
  return sentences;
}

class FlowBuilder {
  readonly #source: SourceMap;
  readonly #file: File;
  readonly #meta: ScriptMeta;
  readonly #mode: "compact" | "detailed";
  readonly #locale: Locale;
  readonly #expanded = new Set<string>();
  readonly #expandedCalls = new Set<string>();
  readonly #packageManagers = new Set<string>();
  readonly #announcedVars = new Set<string>();
  #installsDeb = false;
  #budget: number;
  #truncated = false;
  #entry: string | null = null;

  constructor(
    source: SourceMap,
    file: File,
    meta: ScriptMeta,
    mode: "compact" | "detailed",
    locale: Locale,
  ) {
    this.#source = source;
    this.#file = file;
    this.#meta = meta;
    this.#mode = mode;
    this.#locale = locale;
    this.#budget = mode === "compact"
      ? COMPACT_STEP_BUDGET
      : DETAILED_STEP_BUDGET;
  }

  get #ja(): boolean {
    return this.#locale === "ja";
  }

  build(): {
    entry: string | null;
    note: string | null;
    steps: FlowStep[];
    packageManagers: string[];
    installsDeb: boolean;
  } {
    const topStmts = unwrapTopLevelStmts(this.#file.stmts);
    if (this.#mode === "compact") {
      this.#entry = detectSingleEntry(this.#source, topStmts, this.#meta);
    }

    const scope = emptyScope();
    let steps = this.#walk(topStmts, [], scope);
    if (this.#mode === "compact") steps = coalesceSteps(steps, this.#locale);

    const definedNonPrinters = [...this.#meta.functions.values()]
      .filter((fn) => !fn.isPrinter)
      .map((fn) => fn.name);
    const uncalled = definedNonPrinters.filter((name) =>
      !this.#expanded.has(name)
    );
    let note: string | null = null;
    if (this.#expanded.size === 0 && uncalled.length > 0) {
      note = this.#ja
        ? `トップレベルから ${
          joinAnd(uncalled, "ja")
        } は呼ばれていません。以下はソース順の関数本体であり、実行が確定した手順ではありません。`
        : `The top level does not call ${
          joinOr(uncalled, "en")
        }. The function bodies below are in source order, not a proven run.`;
      for (const name of uncalled) {
        const body = this.#meta.functions.get(name);
        if (!body) continue;
        this.#expanded.add(name);
        const childSteps = this.#walk(body.stmts, [name], emptyScope());
        const finalized = this.#mode === "compact"
          ? flattenChildren(
            coalesceSteps(childSteps, this.#locale),
            this.#locale,
          )
          : childSteps;
        steps.push({
          text: this.#ja
            ? `関数 ${name} は定義されていますが、トップレベルからは呼ばれていません。`
            : `Function ${name} is defined and not called from the top level.`,
          unresolved: this.#ja
            ? "この本体は入口からのリテラルな呼び出しでは到達しません。"
            : "This body is not reached by a literal call from the entry point.",
          line: null,
          children: finalized,
        });
      }
    }
    if (this.#truncated) {
      steps.push({
        text: this.#ja
          ? "以降のコマンドは展開を省略しました。"
          : "Further commands were not expanded.",
        unresolved: this.#ja
          ? "静的解析の上限ステップ数に達したため展開を打ち切りました。"
          : "The static flow stops after a fixed number of steps.",
        line: null,
        children: [],
      });
    }
    return {
      entry: this.#entry,
      note,
      steps: steps.map(stripDraft),
      packageManagers: [...this.#packageManagers].sort(),
      installsDeb: this.#installsDeb,
    };
  }

  #walk(stmts: Stmt[], stack: string[], scope: CallScope): DraftStep[] {
    const steps: DraftStep[] = [];
    for (const stmt of stmts) {
      if (this.#budget <= 0) {
        this.#truncated = true;
        break;
      }
      steps.push(...this.#visitStmt(stmt, stack, scope));
    }
    return this.#mode === "compact"
      ? coalesceSteps(steps, this.#locale)
      : steps;
  }

  #visitStmt(stmt: Stmt, stack: string[], scope: CallScope): DraftStep[] {
    const cmd = stmt.cmd;
    if (!cmd) return this.#redirectOnly(stmt);
    switch (cmd.type) {
      case "FuncDecl":
        return [];
      case "CallExpr":
        return this.#visitCall(stmt, cmd, stack, scope);
      case "IfClause":
        return this.#visitIf(cmd, stack, scope);
      case "CaseClause":
        return this.#one(this.#visitCase(cmd, stack, scope));
      case "WhileClause":
      case "ForClause":
        return this.#one(this.#visitLoop(cmd, stack, scope));
      case "BinaryCmd":
        return this.#visitBinary(stmt, cmd, stack, scope);
      case "Block":
      case "Subshell":
        return this.#walk(cmd.stmts, stack, scope);
      default:
        return [];
    }
  }

  #visitCall(
    stmt: Stmt,
    call: CallExpr,
    stack: string[],
    scope: CallScope,
  ): DraftStep[] {
    if (call.args.length === 0) {
      return this.#visitAssignments(call, stack, scope);
    }
    const commandWord = this.#source.slice(
      call.args[0]?.start ?? call.start,
      call.args[0]?.end ?? call.start,
    ).trim();
    const forwarded = unquote(commandWord);
    if (forwarded === "$@" || forwarded === "$*") return [];

    const rawOriginal = rawArgvOf(this.#source, call.args);
    const argv = expandScopeArgv(argvOf(this.#source, call.args), scope);
    const raw = expandScopeRawArgv(rawOriginal, scope);
    const unwrapped = unwrapCommand(argv);
    const rawArgs = raw.slice(Math.max(0, raw.length - unwrapped.args.length));
    const line = this.#line(stmt.start);

    if (unwrapped.command === "set" && unwrapped.args[0] === "--") {
      const rest = unwrapped.args.slice(1);
      const next: string[] = [];
      for (const token of rest) {
        if (token === "$@" || token === "$*") next.push(...scope.setParams);
        else next.push(token);
      }
      scope.setParams = next;
      if (this.#mode === "compact") return [];
    }

    if (this.#meta.functions.has(unwrapped.command)) {
      const assigned = this.#visitAssignments(call, stack, scope);
      const called = this.#callFunction(
        unwrapped.command,
        unwrapped.args,
        rawArgs,
        stack,
        line,
      );
      return [...assigned, ...called];
    }

    const assigned = this.#visitAssignments(call, stack, scope);
    const described = this.#describe(
      unwrapped.command,
      unwrapped.args,
      unwrapped.wrappers,
      rawArgs,
    );
    const redirect = this.#redirectSentence(stmt);
    if (!described && !redirect) return assigned;
    this.#budget--;
    const text = [described?.text ?? null, redirect]
      .filter((part) => part !== null)
      .join(this.#ja ? " " : " ");
    return [...assigned, {
      text,
      unresolved: unwrapped.command.includes("$")
        ? (this.#ja
          ? "コマンド名は実行時に展開されます。"
          : "The command word is expanded when the script runs.")
        : null,
      line,
      children: [],
      tag: described?.tag,
    }];
  }

  #visitAssignments(
    call: CallExpr,
    stack: string[],
    scope: CallScope,
  ): DraftStep[] {
    const steps: DraftStep[] = [];
    for (const assign of call.assigns) {
      const name = assign.name?.value;
      if (!name || !assign.value) continue;
      const nested = nestedCalls(assign.value);
      for (const inner of nested) {
        const argv = expandScopeArgv(argvOf(this.#source, inner.args), scope);
        const raw = expandScopeRawArgv(
          rawArgvOf(this.#source, inner.args),
          scope,
        );
        const unwrapped = unwrapCommand(argv);
        const rawArgs = raw.slice(
          Math.max(0, raw.length - unwrapped.args.length),
        );
        if (this.#meta.functions.has(unwrapped.command)) {
          const called = this.#callFunction(
            unwrapped.command,
            unwrapped.args,
            rawArgs,
            stack,
            this.#line(inner.start),
          );
          steps.push(...called);
          continue;
        }
        const described = this.#describe(
          unwrapped.command,
          unwrapped.args,
          unwrapped.wrappers,
          rawArgs,
          name,
        );
        if (!described) continue;
        this.#budget--;
        let tag = described.tag;
        if (tag?.kind === "download") {
          tag = { ...tag, assignedVar: name };
        } else if (
          !tag &&
          (unwrapped.command === "uname" || unwrapped.command === "dpkg")
        ) {
          tag = { kind: "assign-read", varName: name };
        }
        const text = described.text.includes(`$${name}`)
          ? described.text
          : this.#ja
          ? `${described.text.replace(/。$/, "")}（$${name} に格納）。`
          : `Sets $${name}. ${described.text}`;
        steps.push({
          text,
          unresolved: null,
          line: this.#line(assign.start),
          children: [],
          tag,
        });
      }
    }
    return steps;
  }

  #callFunction(
    name: string,
    args: string[],
    rawArgs: string[],
    stack: string[],
    line: number,
  ): DraftStep[] {
    const info = this.#meta.functions.get(name);
    if (!info) return [];

    if (info.isPrinter) {
      if (info.printerCaseSummary) {
        const { subject, patterns } = info.printerCaseSummary;
        this.#expanded.add(name);
        return [{
          text: this.#ja
            ? `[${name}] メッセージを表示（${subject}: ${
              clip(patterns.join(", "), 60)
            }; ファイル書き込みなし）。`
            : `[${name}] Prints messages (by ${subject}: ${
              clip(patterns.join(", "), 60)
            }; no file writes).`,
          unresolved: null,
          line,
          children: [],
        }];
      }
      return [];
    }

    if (info.forwards) {
      this.#expanded.add(name);
      const shiftedArgs = args.slice(info.leadingShifts);
      const shiftedRaw = rawArgs.slice(info.leadingShifts);
      const delegated = this.#delegatedStep(
        shiftedArgs,
        shiftedRaw,
        info.usesPrivilege,
        line,
      );
      if (this.#mode === "compact") {
        // A wrapper that also deletes or writes must keep those actions.
        // Large wrappers are expanded once so repeated calls do not exhaust
        // the step budget; each call still shows the forwarded command.
        const bodyKey = `forward-body:${name}`;
        const showBody = !stack.includes(name) &&
          (info.stmts.length <= 12 || !this.#expanded.has(bodyKey));
        this.#expanded.add(bodyKey);
        const bodySteps = showBody
          ? this.#walk(
            info.stmts,
            [...stack, name],
            buildCallScope(info, args, rawArgs),
          )
          : [];
        if (delegated) bodySteps.push(delegated);
        return bodySteps;
      }
      const already = this.#expanded.has(`detailed:${name}`);
      if (already) {
        return delegated ? [delegated] : [{
          text: this.#ja ? `${name} を再度呼び出し。` : `Calls ${name} again.`,
          unresolved: this.#ja
            ? "関数本体は展開済みのため繰り返しません。"
            : "The function body was already expanded and is not repeated.",
          line,
          children: [],
        }];
      }
      this.#expanded.add(`detailed:${name}`);
      const childScope = buildCallScope(info, args, rawArgs);
      const bodySteps = stack.includes(name)
        ? []
        : this.#walk(info.stmts, [...stack, name], childScope);
      if (delegated) bodySteps.push(delegated);
      return [{
        text: this.#ja ? `${name} を呼び出し。` : `Calls ${name}.`,
        unresolved: null,
        line,
        children: bodySteps,
      }];
    }

    if (stack.includes(name) || stack.length >= MAX_CALL_DEPTH) {
      return [{
        text: this.#ja ? `${name} を再度呼び出し。` : `Calls ${name} again.`,
        unresolved: this.#ja
          ? "再帰呼び出しは展開しません。"
          : "The recursive call is not expanded.",
        line,
        children: [],
      }];
    }

    const childScope = buildCallScope(info, args, rawArgs);

    if (this.#mode === "compact") {
      if (stack.length === 0 && this.#entry === name) {
        this.#expanded.add(name);
        return this.#walk(info.stmts, [name], childScope);
      }

      const isReusableHelper = info.stmts.length <= 25 && args.length > 0;
      const callKey = `${name}\0${args.join("\0")}`;
      if (
        this.#expanded.has(name) &&
        (!isReusableHelper || this.#expandedCalls.has(callKey))
      ) {
        return [];
      }
      this.#expanded.add(name);
      this.#expandedCalls.add(callKey);
      this.#budget--;

      const bodySteps = this.#walk(info.stmts, [...stack, name], childScope);
      if (bodySteps.length === 0) {
        if (info.promptsUser) {
          return [{
            text: this.#ja
              ? `[${name}] ユーザーに確認プロンプトを表示。`
              : `[${name}] Prompts for user confirmation.`,
            unresolved: null,
            line,
            children: [],
          }];
        }
        return [];
      }

      if (bodySteps.length === 1 && bodySteps[0]!.children.length === 0) {
        const only = bodySteps[0]!;
        const text = only.text.startsWith("[")
          ? only.text
          : `[${name}] ${only.text}`;
        return [{ ...only, text }];
      }

      const flat = flattenChildren(bodySteps, this.#locale);
      if (stack.length <= 1) {
        return [{
          text: `[${name}]`,
          unresolved: null,
          line,
          children: flat,
        }];
      }
      return flat.map((step) => ({
        ...step,
        text: step.text.startsWith("[") ? step.text : `[${name}] ${step.text}`,
      }));
    }

    if (this.#expanded.has(name)) {
      return [{
        text: this.#ja ? `${name} を再度呼び出し。` : `Calls ${name} again.`,
        unresolved: this.#ja
          ? "関数本体は展開済みのため繰り返しません。"
          : "The function body was already expanded and is not repeated.",
        line,
        children: [],
      }];
    }
    this.#expanded.add(name);
    this.#budget--;
    const children = this.#walk(info.stmts, [...stack, name], childScope);
    if (children.length === 0 && info.promptsUser) {
      children.push({
        text: this.#ja
          ? "ユーザーに確認プロンプトを表示。"
          : "Prompts for user confirmation.",
        unresolved: null,
        line,
        children: [],
      });
    }
    if (children.length === 0 && info.echoedUrls.length > 0) {
      children.push({
        text: this.#ja
          ? `URL テンプレートを出力: ${clip(info.echoedUrls[0]!, 120)}。`
          : `Echoes URL template: ${clip(info.echoedUrls[0]!, 120)}.`,
        unresolved: null,
        line,
        children: [],
      });
    }
    return [{
      text: this.#ja ? `${name} を呼び出し。` : `Calls ${name}.`,
      unresolved: null,
      line,
      children,
    }];
  }

  #delegatedStep(
    args: string[],
    rawArgs: string[],
    usesPrivilege: boolean,
    line: number,
  ): DraftStep | null {
    const found = delegatedArgv(args, rawArgs);
    if (!found) return null;
    const unwrapped = unwrapCommand(found.argv);
    if (unwrapped.command.includes("$")) return null;
    const wrappers = [...unwrapped.wrappers];
    if (
      usesPrivilege &&
      !wrappers.some((w) =>
        w === "sudo" || w === "doas" || w === "su" || w === "pkexec"
      )
    ) {
      wrappers.unshift("sudo");
    }
    const offset = found.argv.length - unwrapped.args.length;
    const rawSlice = found.raw.slice(Math.max(0, offset));
    const described = this.#describe(
      unwrapped.command,
      unwrapped.args,
      wrappers,
      rawSlice,
    );
    if (!described) return null;
    this.#budget--;
    return {
      text: described.text,
      unresolved: this.#mode === "detailed"
        ? (this.#ja
          ? "引数を転送する関数へ渡されたコマンドです。"
          : "This command is an argument of a function that forwards its arguments.")
        : null,
      line,
      children: [],
      tag: described.tag,
    };
  }

  #describe(
    command: string,
    args: string[],
    wrappers: string[],
    rawArgs: string[] = args,
    assignedVar?: string,
  ): { text: string; tag?: StepTag } | null {
    if (command === "command" || command === "type") return null;
    if (command === "") {
      const privilege = wrappers.find((wrapper) =>
        wrapper === "sudo" || wrapper === "doas" || wrapper === "su" ||
        wrapper === "pkexec"
      );
      if (!privilege) return null;
      return {
        text: this.#ja
          ? `${privilege} で権限を確認。`
          : `Checks privilege with ${privilege}.`,
      };
    }
    if (command.includes("$")) {
      const runnerVar = command.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/)
        ?.[1];
      const runner = runnerVar
        ? this.#meta.shellRunners.get(runnerVar)
        : undefined;
      if (runner) {
        const snippet = args.join(" ").trim();
        for (const pm of PACKAGE_MANAGERS) {
          if (new RegExp(`\\b${pm}\\b`).test(snippet)) {
            this.#packageManagers.add(pm);
          }
        }
        const privs = runner.privileges.length > 0
          ? runner.privileges
          : wrappers.filter((w) =>
            w === "sudo" || w === "doas" || w === "su" || w === "pkexec"
          );
        const body = snippet
          ? (this.#ja
            ? `シェルコマンドを実行 (${command}): ${clip(snippet, 100)}。`
            : `Runs shell command (${command}): ${clip(snippet, 100)}.`)
          : (this.#ja
            ? `シェルコマンドを実行 (${command})。`
            : `Runs shell command (${command}).`);
        if (privs.length === 0) return { text: body };
        return {
          text: this.#ja
            ? `${joinAnd(privs, "ja")} で ${body}`
            : `With ${joinAnd(privs, "en")}, ${lowerFirst(body)}`,
        };
      }
      return {
        text: this.#ja
          ? `動的コマンド ${clip(command, 60)} を実行。`
          : `Runs dynamic command ${clip(command, 60)}.`,
      };
    }
    const built = this.#sentence(command, args, rawArgs, assignedVar);
    if (!built) return null;
    const privilege = wrappers.filter((wrapper) =>
      wrapper === "sudo" || wrapper === "doas" || wrapper === "su" ||
      wrapper === "pkexec"
    );
    if (privilege.length === 0) return built;
    const text = this.#ja
      ? `${joinAnd(privilege, "ja")} で ${
        built.text.replace(/^([^ ]+) で/, "$1 により")
      }`
      : `With ${joinAnd(privilege, "en")}, ${lowerFirst(built.text)}`;
    return { text, tag: built.tag };
  }

  #sentence(
    command: string,
    args: string[],
    rawArgs: string[] = args,
    assignedVar?: string,
  ): { text: string; tag?: StepTag } | null {
    if (PRINTERS.has(command)) return null;
    if (DOWNLOADERS.has(command)) {
      const targets = urlOperands(command, rawArgs);
      const annotated = targets.map((target) =>
        this.#annotateTarget(clip(target))
      );
      const shown = annotated.length > 0
        ? joinAnd(annotated, this.#locale)
        : (this.#ja ? "URL" : "a URL");
      return {
        text: this.#ja
          ? `${command} で ${shown} をダウンロード。`
          : `Downloads ${shown} with ${command}.`,
        tag: {
          kind: "download",
          tool: command,
          target: shown,
          assignedVar: assignedVar ?? null,
        },
      };
    }
    if (CHECKSUMS.has(command)) {
      const target = lastOperand(args);
      const annotated = target ? this.#annotateTarget(clip(target, 80)) : null;
      const verifies = commandVerifies(command, args);
      if (this.#ja) {
        if (verifies) {
          return {
            text: annotated
              ? `${command} で ${annotated} のチェックサムを検証。`
              : `${command} でチェックサムを検証。`,
          };
        }
        return {
          text: annotated
            ? `${command} で ${annotated} を実行。`
            : `${command} を実行。`,
        };
      }
      if (verifies) {
        return {
          text: annotated
            ? `Checks a checksum with ${command} on ${annotated}.`
            : `Checks a checksum with ${command}.`,
        };
      }
      return {
        text: annotated
          ? `Runs ${command} on ${annotated}.`
          : `Runs ${command}.`,
      };
    }
    if (SIGNATURES.has(command)) {
      const operands = args.filter((arg) => !arg.startsWith("-"));
      const first = operands[0] ? clip(operands[0], 80) : null;
      const verifies = commandVerifies(command, args);
      if (this.#ja) {
        if (verifies) {
          return {
            text: first
              ? `${command} で ${first} の署名を検証。`
              : `${command} で署名を検証。`,
          };
        }
        return {
          text: first
            ? `${command} で ${first} を実行。`
            : `${command} を実行。`,
        };
      }
      if (verifies) {
        return {
          text: first
            ? `Verifies a signature with ${command} on ${first}.`
            : `Verifies a signature with ${command}.`,
        };
      }
      return {
        text: first ? `Runs ${command} on ${first}.` : `Runs ${command}.`,
      };
    }
    if (command === "tar" || command === "unzip" || command === "gunzip") {
      const archive = extractArchiveOperand(command, args);
      const annotated = archive
        ? this.#annotateTarget(clip(archive, 80))
        : null;
      return {
        text: this.#ja
          ? (annotated
            ? `${command} で ${annotated} を展開。`
            : `${command} でアーカイブを展開。`)
          : (annotated
            ? `Extracts ${annotated} with ${command}.`
            : `Extracts an archive with ${command}.`),
        tag: command === "tar"
          ? { kind: "archive-tar", target: archive }
          : undefined,
      };
    }
    if (
      command === "install" || command === "cp" || command === "mv" ||
      command === "ln"
    ) {
      const dest = lastOperand(args);
      const annotated = dest ? this.#annotateTarget(clip(dest)) : null;
      if (this.#ja) {
        const verb = command === "install"
          ? "へインストール"
          : command === "cp"
          ? "へファイルをコピー"
          : command === "ln"
          ? "へリンクを作成"
          : "へファイルを移動";
        return {
          text: annotated
            ? `${annotated} ${verb}。`
            : `${command} でファイルを配置。`,
        };
      }
      const verb = command === "install"
        ? "Installs"
        : command === "cp"
        ? "Copies a file"
        : command === "ln"
        ? "Links a file"
        : "Moves a file";
      return {
        text: annotated
          ? `${verb} to ${annotated}.`
          : `${verb} with ${command}.`,
      };
    }
    if (command === "mkdir") {
      const dest = lastOperand(args);
      const annotated = dest ? this.#annotateTarget(clip(dest)) : null;
      return {
        text: this.#ja
          ? (annotated ? `${annotated} を作成。` : "ディレクトリを作成。")
          : (annotated ? `Creates ${annotated}.` : "Creates a directory."),
      };
    }
    if (command === "tee") {
      const dest = args.filter((arg) => !arg.startsWith("-")).map((item) =>
        this.#annotateTarget(clip(item))
      );
      return {
        text: this.#ja
          ? (dest.length > 0
            ? `tee で ${joinAnd(dest, "ja")} へ書き込み。`
            : "tee で書き込み。")
          : (dest.length > 0
            ? `Writes ${joinAnd(dest, "en")} with tee.`
            : "Writes with tee."),
      };
    }
    if (PACKAGE_MANAGERS.has(command)) {
      this.#packageManagers.add(command);
      if (args.includes("update")) {
        return {
          text: this.#ja
            ? `${command} でパッケージ一覧を更新。`
            : `Updates package indexes with ${command}.`,
        };
      }
      if (args.includes("install") || args.includes("add")) {
        const pkgs = extractPackageNames(args);
        if (this.#ja) {
          return {
            text: pkgs.length > 0
              ? `${command} でパッケージをインストール: ${
                clip(pkgs.join(", "), 100)
              }。`
              : `${command} でパッケージをインストール。`,
          };
        }
        return {
          text: pkgs.length > 0
            ? `Installs packages with ${command}: ${
              clip(pkgs.join(", "), 100)
            }.`
            : `Installs packages with ${command}.`,
        };
      }
      return {
        text: this.#ja ? `${command} を実行。` : `Runs ${command}.`,
      };
    }
    if (
      command === "dpkg" && (args.includes("--install") || args.includes("-i"))
    ) {
      this.#installsDeb = true;
      const deb = lastOperand(args);
      const annotated = deb ? this.#annotateTarget(clip(deb, 80)) : null;
      return {
        text: this.#ja
          ? (annotated
            ? `dpkg でパッケージ ${annotated} をインストール。`
            : "dpkg でパッケージをインストール。")
          : (annotated
            ? `Installs package ${annotated} with dpkg.`
            : "Installs a package with dpkg."),
      };
    }
    if (command === "uname") {
      return { text: unameSentence(args, this.#locale) };
    }
    if (command === "dpkg" && args.includes("--print-architecture")) {
      return {
        text: this.#ja
          ? "dpkg --print-architecture でパッケージアーキテクチャを取得。"
          : "Reads the package architecture with dpkg --print-architecture.",
      };
    }
    if (command === "id") {
      const flag = args.includes("-u") || args.includes("--user")
        ? "id -u"
        : "id";
      return {
        text: this.#ja
          ? `${flag} でユーザー ID を確認。`
          : `Checks the user id with ${flag}.`,
      };
    }
    if (command === "sudo" || command === "doas" || command === "pkexec") {
      return {
        text: this.#ja
          ? `${command} で権限を確認。`
          : `Checks privilege with ${command}.`,
      };
    }
    if (command === "locale-gen") {
      const operands = args.filter((arg) => !arg.startsWith("-"));
      return {
        text: this.#ja
          ? (operands.length > 0
            ? `locale-gen でロケールを生成（${operands.join(", ")}）。`
            : "locale-gen でロケールを生成。")
          : (operands.length > 0
            ? `Generates locales with locale-gen (${operands.join(", ")}).`
            : "Generates locales with locale-gen."),
      };
    }
    if (command === "add-apt-repository") {
      const operands = args.filter((arg) => !arg.startsWith("-"));
      return {
        text: this.#ja
          ? (operands.length > 0
            ? `add-apt-repository でリポジトリ ${
              clip(operands.join(" "), 80)
            } を追加。`
            : "add-apt-repository でリポジトリを追加。")
          : (operands.length > 0
            ? `Adds repository ${
              clip(operands.join(" "), 80)
            } with add-apt-repository.`
            : "Adds a repository with add-apt-repository."),
      };
    }
    if (command === "rm") {
      const operands = args.filter((arg) =>
        !arg.startsWith("-") && arg !== "--"
      );
      const recursive = args.some((arg) =>
        arg === "--recursive" ||
        (arg.startsWith("-") && !arg.startsWith("--") && /[rR]/.test(arg))
      );
      const force = args.some((arg) =>
        arg === "--force" ||
        (arg.startsWith("-") && !arg.startsWith("--") && arg.includes("f"))
      );
      const tool = recursive && force ? "rm -rf" : recursive ? "rm -r" : "rm";
      const targets = operands.map((item) =>
        this.#annotateTarget(clip(item, 60))
      );
      const tempStderr = operands.length === 1 &&
        /^\$\{?stderr\}?$/.test(operands[0] ?? "");
      return {
        text: formatRmStep(tool, targets, this.#locale),
        tag: { kind: "rm", tool, targets, tempStderr },
      };
    }
    if (command === "chmod") {
      const operands = args.filter((arg) =>
        !arg.startsWith("-") && arg !== "--"
      );
      if (operands.length >= 2) {
        const mode = operands[0]!;
        const targets = operands.slice(1).map((item) =>
          this.#annotateTarget(clip(item, 60))
        );
        return {
          text: this.#ja
            ? `${joinAnd(targets, "ja")} の権限を変更 (chmod ${mode})。`
            : `Changes permissions on ${
              joinAnd(targets, "en")
            } (chmod ${mode}).`,
        };
      }
      return {
        text: this.#ja
          ? "chmod で権限を変更。"
          : "Changes permissions with chmod.",
      };
    }
    if (command === "eval") {
      return {
        text: this.#ja
          ? "eval でシェル文字列を評価・実行。"
          : "Evaluates shell text with eval.",
      };
    }
    if (command === "mktemp") {
      const isDir = args.includes("-d") || args.includes("--directory");
      const template = args.find((arg) => !arg.startsWith("-"));
      const tempStderr = assignedVar === "stderr";
      if (this.#ja) {
        const kind = isDir ? "一時ディレクトリ" : "一時ファイル／ディレクトリ";
        const target = assignedVar ? ` ($${assignedVar}) ` : "";
        const tpl = template ? `（${clip(template, 60)}）` : "";
        return {
          text: `mktemp で${kind}${target}を作成${tpl}。`,
          tag: {
            kind: "mktemp",
            assignedVar: assignedVar ?? null,
            tempStderr,
          },
        };
      }
      const kind = isDir
        ? "a temporary directory"
        : "a temporary file or directory";
      const target = assignedVar ? ` ($${assignedVar})` : "";
      const tpl = template ? ` (${clip(template, 60)})` : "";
      return {
        text: `Creates ${kind}${target} with mktemp${tpl}.`,
        tag: { kind: "mktemp", assignedVar: assignedVar ?? null, tempStderr },
      };
    }
    if (command === "source" || command === ".") {
      const file = args.find((arg) => !arg.startsWith("-"));
      return {
        text: this.#ja
          ? (file
            ? `${clip(file)} を読み込み (source)。`
            : "別ファイルを読み込み。")
          : (file ? `Sources ${clip(file)}.` : "Sources another file."),
      };
    }
    if (command === "set") {
      if (args[0] === "--") {
        return {
          text: this.#ja
            ? "位置パラメータを設定。"
            : "Sets positional parameters.",
        };
      }
      return {
        text: this.#ja
          ? (args.length > 0
            ? `シェルオプションを設定 (set ${args.join(" ")})。`
            : "シェルオプションを設定。")
          : (args.length > 0
            ? `Sets shell options (set ${args.join(" ")}).`
            : "Sets shell options."),
      };
    }
    if (command === "export") {
      if (this.#mode === "compact") return null;
      const names = args.filter((arg) => !arg.startsWith("-"));
      return {
        text: this.#ja
          ? (names.length > 0
            ? `${
              joinAnd(names.map((n) => clip(n)), "ja")
            } を環境変数にエクスポート。`
            : "環境変数をエクスポート。")
          : (names.length > 0
            ? `Exports ${joinAnd(names.map((n) => clip(n)), "en")}.`
            : "Exports variables."),
      };
    }
    if (command === "trap") {
      const signals = args.slice(1).filter((arg) => !arg.startsWith("-"));
      return {
        text: formatTrapStep(signals, this.#locale),
        tag: { kind: "trap", signals },
      };
    }
    if (SHELLS.has(command)) {
      const cmdIdx = args.findIndex((arg) =>
        arg === "-c" || arg === "--command"
      );
      if (cmdIdx !== -1) {
        const trailing = args.slice(cmdIdx + 2).filter((arg) =>
          !SHELLS.has(arg) && !arg.startsWith("-")
        );
        return {
          text: this.#ja
            ? (trailing.length > 0
              ? `シェルコマンド文字列を実行 (${command} -c, 引数: ${
                clip(trailing.join(" "), 60)
              })。`
              : `シェルコマンド文字列を実行 (${command} -c)。`)
            : (trailing.length > 0
              ? `Runs a shell command string (${command} -c, arg: ${
                clip(trailing.join(" "), 60)
              }).`
              : `Runs a shell command string (${command} -c).`),
        };
      }
    }
    return null;
  }

  #visitIf(clause: IfClause, stack: string[], scope: CallScope): DraftStep[] {
    if (this.#mode === "compact") {
      const collapsedDownload = this.#tryCollapseDownloaderBranch(
        clause,
        stack,
        scope,
      );
      if (collapsedDownload) {
        this.#budget--;
        return [collapsedDownload];
      }
    }

    if (
      this.#mode === "compact" && clause.cond.length === 1 &&
      clause.cond[0]?.negated === true && !clause.else
    ) {
      const primary = this.#walkConditionActions(clause.cond, stack, scope);
      if (primary.length > 0) {
        const fallback = this.#walk(clause.then, stack, scope).filter((step) =>
          !isTempStderrStep(step)
        );
        if (fallback.length === 0) return primary;
        const onFail: DraftStep = fallback.length === 1 &&
            fallback[0]!.children.length === 0
          ? {
            text: this.#ja
              ? `失敗時: ${fallback[0]!.text}`
              : `On failure: ${lowerFirst(fallback[0]!.text)}`,
            unresolved: null,
            line: fallback[0]!.line,
            children: [],
          }
          : {
            text: this.#ja ? "失敗時:" : "On failure:",
            unresolved: null,
            line: this.#line(clause.start),
            children: flattenChildren(fallback, this.#locale),
          };
        return [...primary, onFail];
      }
    }

    const arms: {
      label: string;
      cond: string;
      steps: DraftStep[];
      condOnly: boolean;
    }[] = [];
    let current: IfClause | null = clause;
    while (current) {
      const cond = current.cond.length === 0
        ? ""
        : condText(this.#source, current.cond);
      const label = cond === ""
        ? (this.#ja ? "それ以外" : "Otherwise")
        : (this.#ja ? `${cond} の場合` : `When ${cond}`);
      const condSteps = this.#walkConditionActions(current.cond, stack, scope);
      const bodySteps = this.#walk(current.then, stack, scope);
      arms.push({
        label,
        cond,
        steps: [...condSteps, ...bodySteps],
        condOnly: condSteps.length > 0 && bodySteps.length === 0,
      });
      current = current.else;
    }

    if (this.#mode === "compact") {
      const collapsedArchive = tryCollapseArchiveBranch(
        arms,
        this.#line(clause.start),
        this.#locale,
      );
      if (collapsedArchive) {
        this.#budget--;
        return [collapsedArchive];
      }
    }

    const nonEmptyArms = arms.filter((arm) => arm.steps.length > 0);
    const hasPlatformCond = arms.some((arm) => condIsPlatform(arm.cond));

    if (nonEmptyArms.length === 0) {
      if (!hasPlatformCond) return [];
      const values = extractPlatformValuesFromArms(arms);
      this.#budget--;
      if (this.#mode === "compact" && values.length > 0) {
        const subject = extractConditionSubject(arms[0]?.cond ?? "");
        return [{
          text: this.#ja
            ? (subject
              ? `${subject} で分岐（${clip(values.join(", "), 80)}）。`
              : `プラットフォームで分岐（${clip(values.join(", "), 80)}）。`)
            : (subject
              ? `Branches on ${subject} (${clip(values.join(", "), 80)}).`
              : `Branches on platform (${clip(values.join(", "), 80)}).`),
          unresolved: null,
          line: this.#line(clause.start),
          children: [],
          tag: { kind: "pure-branch", subject, values },
        }];
      }
      const fallbackArms = arms.map((arm) =>
        arm.cond || (this.#ja ? "その他" : "the other path")
      ).join(" / ");
      return [{
        text: this.#ja
          ? `${clip(fallbackArms, 140)} で分岐。`
          : `Branches on ${clip(fallbackArms, 140)}.`,
        unresolved: this.#mode === "detailed"
          ? (this.#ja
            ? "どの経路が実行されるかは静的には決まりません。"
            : "Which path runs is not known statically.")
          : null,
        line: this.#line(clause.start),
        children: [],
        tag: { kind: "pure-branch", subject: null, values },
      }];
    }

    if (this.#mode === "compact") {
      if (nonEmptyArms.length === 1) {
        const onlyArm = nonEmptyArms[0]!;
        if (onlyArm.condOnly) {
          this.#budget--;
          return onlyArm.steps;
        }
        const condPhrase = formatCondPrefix(
          onlyArm.cond,
          this.#meta.bindings,
          this.#announcedVars,
          this.#locale,
        );
        if (
          onlyArm.steps.length === 1 && onlyArm.steps[0]!.children.length === 0
        ) {
          this.#budget--;
          const child = onlyArm.steps[0]!;
          const tag = child.tag?.kind === "pure-branch" ? child.tag : undefined;
          return [{
            text: this.#ja
              ? `${condPhrase}: ${child.text}`
              : `${condPhrase}: ${lowerFirst(child.text)}`,
            unresolved: null,
            line: child.line ?? this.#line(clause.start),
            children: [],
            tag,
          }];
        }
        this.#budget--;
        return [{
          text: `${condPhrase}:`,
          unresolved: null,
          line: this.#line(clause.start),
          children: flattenChildren(onlyArm.steps, this.#locale),
        }];
      }

      if (nonEmptyArms.length > 8) {
        this.#budget--;
        return [{
          text: this.#ja
            ? `${arms.length} 個の条件で分岐。`
            : `Branches across ${arms.length} conditions.`,
          unresolved: null,
          line: this.#line(clause.start),
          children: [],
        }];
      }
      this.#budget--;
      return [{
        text: this.#ja ? "分岐:" : "Branches:",
        unresolved: null,
        line: this.#line(clause.start),
        tag: { kind: "branch-group" },
        children: nonEmptyArms.flatMap((arm) => {
          const prefix = formatCondPrefix(
            arm.cond,
            this.#meta.bindings,
            this.#announcedVars,
            this.#locale,
          );
          const flat = flattenChildren(arm.steps, this.#locale);
          if (flat.every((step) => step.tag?.kind === "pure-branch")) {
            const subjects = collectBranchSubjects(flat);
            const detail = this.#ja
              ? (subjects.length > 0
                ? `${subjects.join(", ")} に応じて値を選択。`
                : "外部コマンドを実行せず分岐。")
              : (subjects.length > 0
                ? `selects value by ${subjects.join(", ")}.`
                : "branches without running external commands.");
            return [{
              text: `${prefix}: ${detail}`,
              unresolved: null,
              line: flat[0]?.line ?? this.#line(clause.start),
              children: [],
              tag: { kind: "pure-branch", subject: null, values: [] },
            }];
          }
          if (flat.length === 1) {
            return [{
              text: this.#ja
                ? `${prefix}: ${flat[0]!.text}`
                : `${prefix}: ${lowerFirst(flat[0]!.text)}`,
              unresolved: null,
              line: flat[0]!.line,
              children: [],
              tag: flat[0]!.tag,
            }];
          }
          const contLabel = this.#ja
            ? `${prefix}（続き）`
            : `${prefix} (cont.)`;
          return flat.map((step, idx) => ({
            text: this.#ja
              ? `${idx === 0 ? prefix : contLabel}: ${step.text}`
              : `${idx === 0 ? prefix : contLabel}: ${lowerFirst(step.text)}`,
            unresolved: null,
            line: step.line,
            children: [],
          }));
        }),
      }];
    }

    if (arms.length > 8) {
      this.#budget--;
      return [{
        text: this.#ja
          ? `${arms.length} 個の条件で分岐。`
          : `Branches across ${arms.length} conditions.`,
        unresolved: this.#ja
          ? "どの経路が実行されるかは静的には決まりません。"
          : "Which path runs is not known statically.",
        line: this.#line(clause.start),
        children: [],
      }];
    }
    this.#budget--;
    return [{
      text: this.#ja ? "分岐。" : "Branches.",
      unresolved: this.#ja
        ? "どの経路が実行されるかは静的には決まりません。"
        : "Which path runs is not known statically.",
      line: this.#line(clause.start),
      children: nonEmptyArms.map((arm) => ({
        text: this.#ja
          ? `${clip(arm.label, 120)}。`
          : `${clip(arm.label, 120)}.`,
        unresolved: null,
        line: null,
        children: arm.steps,
      })),
    }];
  }

  #walkConditionActions(
    condStmts: Stmt[],
    stack: string[],
    scope: CallScope,
  ): DraftStep[] {
    const steps: DraftStep[] = [];
    for (const stmt of condStmts) {
      const cmd = stmt.cmd;
      if (!cmd) continue;
      if (cmd.type === "BinaryCmd") {
        if (
          cmd.op === BinCmdOperator.Pipe || cmd.op === BinCmdOperator.PipeAll
        ) {
          const right = rightmostCommandName(this.#source, cmd.y);
          if (right === "grep" || right === "egrep" || right === "fgrep") {
            continue;
          }
        }
        if (
          cmd.op === BinCmdOperator.AndStmt || cmd.op === BinCmdOperator.OrStmt
        ) {
          if (cmd.x) {
            steps.push(...this.#walkConditionActions([cmd.x], stack, scope));
          }
          if (cmd.y) {
            steps.push(...this.#walkConditionActions([cmd.y], stack, scope));
          }
          continue;
        }
      }
      if (cmd.type === "CallExpr") {
        if (cmd.args.length === 0) {
          steps.push(...this.#visitAssignments(cmd, stack, scope));
          continue;
        }
        const argv = expandScopeArgv(argvOf(this.#source, cmd.args), scope);
        const unwrapped = unwrapCommand(argv);
        const name = unwrapped.command;
        if (
          name === "[" || name === "test" || name === "[[" ||
          name === "command" || name === "type" || name === "which" ||
          name === ":" || name === "true" || name === "false"
        ) {
          continue;
        }
        if (
          DOWNLOADERS.has(name) || PACKAGE_MANAGERS.has(name) ||
          PLACERS.has(name) || name === "sudo" || name === "doas" ||
          name === "pkexec" || unwrapped.wrappers.includes("sudo") ||
          this.#meta.functions.has(name)
        ) {
          steps.push(...this.#visitCall(stmt, cmd, stack, scope));
        }
      }
    }
    return steps;
  }

  #tryCollapseDownloaderBranch(
    clause: IfClause,
    stack: string[],
    scope: CallScope,
  ): DraftStep | null {
    const flattenedArms = flattenToolAvailabilityIf(this.#source, clause);
    if (
      !flattenedArms ||
      flattenedArms.filter((arm) => arm.tool !== "").length < 2
    ) {
      return null;
    }

    const tools: string[] = [];
    const targets: string[] = [];
    const assignedVars: string[] = [];

    for (const arm of flattenedArms) {
      const armSteps = this.#walk(arm.stmts, stack, scope).filter((step) =>
        !isTempStderrStep(step)
      );
      if (armSteps.length === 0) continue;
      const downloadSteps = armSteps.flatMap(collectDownloadTags);
      if (
        downloadSteps.length === 0 ||
        downloadSteps.length !== countLeafSteps(armSteps)
      ) {
        return null;
      }
      for (const ds of downloadSteps) {
        if (!tools.includes(ds.tool)) tools.push(ds.tool);
        const baseTarget = stripTrailingAnnotation(ds.target);
        const existingIdx = targets.findIndex((t) =>
          stripTrailingAnnotation(t) === baseTarget
        );
        if (existingIdx === -1) {
          targets.push(ds.target);
        } else if (ds.target.length > targets[existingIdx]!.length) {
          targets[existingIdx] = ds.target;
        }
        if (ds.assignedVar && !assignedVars.includes(ds.assignedVar)) {
          assignedVars.push(ds.assignedVar);
        }
      }
    }

    if (tools.length < 2 || targets.length === 0) return null;
    const text = this.#ja
      ? (assignedVars.length === 1
        ? `${joinOr(tools, "ja")} で ${
          joinAnd(targets, "ja")
        } をダウンロード（$${assignedVars[0]} に格納）。`
        : `${joinOr(tools, "ja")} で ${
          joinAnd(targets, "ja")
        } をダウンロード。`)
      : (assignedVars.length === 1
        ? `Sets $${assignedVars[0]}. Downloads ${joinAnd(targets, "en")} with ${
          joinOr(tools, "en")
        }.`
        : `Downloads ${joinAnd(targets, "en")} with ${joinOr(tools, "en")}.`);
    return {
      text,
      unresolved: null,
      line: this.#line(clause.start),
      children: [],
    };
  }

  #visitCase(
    clause: CaseClause,
    stack: string[],
    scope: CallScope,
  ): DraftStep | null {
    const subject = clause.word
      ? displayWord(this.#source, clause.word)
      : (this.#ja ? "対象" : "the subject");
    const patterns = clause.items.flatMap((item) =>
      item.patterns.map((pattern) => displayWord(this.#source, pattern))
    ).filter((pattern) => pattern !== "" && pattern !== "''");
    const children: DraftStep[] = [];
    for (const item of clause.items) {
      const steps = this.#walk(item.stmts, stack, scope);
      if (steps.length === 0) continue;
      const label = item.patterns.map((pattern) =>
        displayWord(this.#source, pattern)
      ).join(" | ") || "*";
      children.push({
        text: this.#ja
          ? `${clip(label, 80)} の場合。`
          : `When ${clip(label, 80)}.`,
        unresolved: null,
        line: this.#line(item.start),
        children: steps,
      });
    }
    const options = looksLikeOptions(subject, patterns);
    const platform = subjectLooksLikePlatform(subject) ||
      patterns.some((pattern) => subjectLooksLikePlatform(pattern));
    if (!options && !platform && children.length === 0) return null;

    const nonWild = patterns.filter((p) => p !== "*");
    const shown = nonWild.slice(0, 8).join(", ");
    const more = nonWild.length > 8
      ? (this.#ja
        ? ` ほか ${nonWild.length - 8} 件`
        : `, and ${nonWild.length - 8} more`)
      : "";

    if (this.#mode === "compact") {
      if (options) {
        return {
          text: this.#ja
            ? (shown
              ? `CLI オプションを解析（${clip(shown + more, 90)}）。`
              : "CLI オプションを解析。")
            : (shown
              ? `Parses CLI options (${clip(shown + more, 90)}).`
              : "Parses CLI options."),
          unresolved: null,
          line: this.#line(clause.start),
          children: [],
          tag: { kind: "options" },
        };
      }
      if (children.length === 0) {
        return {
          text: this.#ja
            ? `${subject} で分岐${
              shown ? `（${clip(shown + more, 80)}）` : ""
            }。`
            : `Branches on ${subject}${
              shown ? ` (${clip(shown + more, 80)})` : ""
            }.`,
          unresolved: null,
          line: this.#line(clause.start),
          children: [],
          tag: {
            kind: "pure-branch",
            subject: extractConditionSubject(subject),
            values: nonWild.slice(0, 8),
          },
        };
      }
      if (children.length > 8) {
        return {
          text: this.#ja
            ? `${subject} で ${clause.items.length} 通りに分岐。`
            : `Branches on ${subject} across ${clause.items.length} arms.`,
          unresolved: null,
          line: this.#line(clause.start),
          children: [],
        };
      }
      return {
        text: this.#ja
          ? `${subject} で分岐${shown ? `（${clip(shown + more, 80)}）` : ""}:`
          : `Branches on ${subject}${
            shown ? ` (${clip(shown + more, 80)})` : ""
          }:`,
        unresolved: null,
        line: this.#line(clause.start),
        children: children.flatMap((child) => {
          const flat = flattenChildren(child.children, this.#locale);
          if (flat.length === 1) {
            return [{
              text: this.#ja
                ? `${child.text.replace(/。$/, "")}: ${flat[0]!.text}`
                : `${child.text.replace(/\.$/, "")}: ${
                  lowerFirst(flat[0]!.text)
                }`,
              unresolved: null,
              line: flat[0]!.line,
              children: [],
            }];
          }
          return [child];
        }),
      };
    }

    if (children.length > 8) {
      return {
        text: this.#ja
          ? `${subject} で ${clause.items.length} 通りに分岐。`
          : `Branches on ${subject} across ${clause.items.length} arms.`,
        unresolved: this.#ja
          ? "どの分岐が実行されるかは静的には決まりません。"
          : "Which arm runs is not known statically.",
        line: this.#line(clause.start),
        children: [],
      };
    }
    return {
      text: options && children.length === 0
        ? (this.#ja
          ? "コマンドラインオプションを読み込み。"
          : "Reads command-line options.")
        : this.#ja
        ? `${subject} で分岐${shown ? `（${clip(shown + more, 80)}）` : ""}。`
        : `Branches on ${subject}${
          shown ? ` (${clip(shown + more, 80)})` : ""
        }.`,
      unresolved: options
        ? (this.#ja
          ? "どのオプションが指定されるかは静的には決まりません。"
          : "Which options are present is not known statically.")
        : (this.#ja
          ? "どの分岐が実行されるかは静的には決まりません。"
          : "Which arm runs is not known statically."),
      line: this.#line(clause.start),
      children,
    };
  }

  #visitLoop(
    clause: WhileClause | ForClause,
    stack: string[],
    scope: CallScope,
  ): DraftStep | null {
    const body = this.#walk(clause.do, stack, scope);
    const cond = clause.type === "WhileClause"
      ? condText(this.#source, clause.cond)
      : (this.#ja ? "要素一覧" : "the loop list");
    if (
      this.#mode === "compact" && body.length === 1 &&
      body[0]!.tag?.kind === "options"
    ) {
      return body[0]!;
    }
    if (body.length === 0) {
      const raw = oneLine(this.#source, clause.start, clause.end);
      if (/case\b/.test(raw) && /(^|[\s"])(--|[+]?\-[A-Za-z])/.test(raw)) {
        return {
          text: this.#mode === "compact"
            ? (this.#ja ? "CLI オプションを解析。" : "Parses CLI options.")
            : (this.#ja
              ? "ループ内でコマンドラインオプションを読み込み。"
              : "Reads command-line options in a loop."),
          unresolved: this.#mode === "detailed"
            ? (this.#ja
              ? "どのオプションが指定されるかは静的には決まりません。"
              : "Which options are present is not known statically.")
            : null,
          line: this.#line(clause.start),
          children: [],
          tag: { kind: "options" },
        };
      }
      return null;
    }
    const kind = clause.type === "WhileClause"
      ? (clause.until ? "until" : "while")
      : "for";
    return {
      text: this.#ja
        ? `${kind} ループ (${clip(cond, 100)})。`
        : `Loops ${kind} ${clip(cond, 100)}.`,
      unresolved: this.#mode === "detailed"
        ? (this.#ja
          ? "反復回数は静的には決まりません。"
          : "How many iterations run is not known statically.")
        : null,
      line: this.#line(clause.start),
      children: body,
    };
  }

  #visitBinary(
    stmt: Stmt,
    cmd: BinaryCmd,
    stack: string[],
    scope: CallScope,
  ): DraftStep[] {
    if (!cmd.x || !cmd.y) return [];
    if (cmd.op === BinCmdOperator.Pipe || cmd.op === BinCmdOperator.PipeAll) {
      const line = oneLine(this.#source, stmt.start, stmt.end);
      const right = rightmostCommandName(this.#source, cmd.y);
      if (this.#mode === "compact") {
        if (
          (right === "grep" || right === "egrep" || right === "fgrep") &&
          !/\b(curl|wget|fetch|sha\d+sum|shasum)\b/.test(line)
        ) {
          return [];
        }
        this.#budget--;
        const archivePipe = right === "tar" &&
          /\b(zstd|gzip|xz|bzip2)\b/.test(line);
        const archiveTarget = archivePipe
          ? (line.match(/"?(\$[A-Za-z_][A-Za-z0-9_]*)"?/)?.[1] ?? null)
          : null;
        return [{
          text: describePipeline(line, right, this.#locale),
          unresolved: null,
          line: this.#line(stmt.start),
          children: [],
          tag: archivePipe
            ? { kind: "archive-pipe", target: archiveTarget }
            : undefined,
        }];
      }
      this.#budget--;
      return [{
        text: this.#ja
          ? `パイプラインを実行: ${clip(line, 140)}。`
          : `Runs a pipeline: ${clip(line, 140)}.`,
        unresolved: null,
        line: this.#line(stmt.start),
        children: [],
      }];
    }
    const left = this.#visitStmt(cmd.x, stack, scope);
    const right = this.#visitStmt(cmd.y, stack, scope);
    if (cmd.op !== BinCmdOperator.AndStmt && cmd.op !== BinCmdOperator.OrStmt) {
      return [...left, ...right];
    }
    if (left.length === 0) {
      return this.#mode === "compact"
        ? right
        : markGuarded(right, this.#locale);
    }
    if (right.length === 0) return left;
    if (this.#mode === "compact") return [...left, ...right];
    return [{
      text: cmd.op === BinCmdOperator.AndStmt
        ? (this.#ja
          ? "前のコマンドが成功したとき次を実行。"
          : "Runs the next command when the previous one succeeds.")
        : (this.#ja
          ? "前のコマンドが失敗したとき次を実行。"
          : "Runs the next command when the previous one fails."),
      unresolved: this.#ja
        ? "これらのうちどれが実行されるかは静的には決まりません。"
        : "Which of these commands run is not known statically.",
      line: this.#line(stmt.start),
      children: [...left, ...right],
    }];
  }

  #redirectOnly(stmt: Stmt): DraftStep[] {
    const sentence = this.#redirectSentence(stmt);
    if (!sentence) return [];
    this.#budget--;
    return [{
      text: sentence,
      unresolved: null,
      line: this.#line(stmt.start),
      children: [],
    }];
  }

  #redirectSentence(stmt: Stmt): string | null {
    const destinations: string[] = [];
    let append = false;
    for (const redir of stmt.redirs) {
      if (!WRITE_REDIRS.has(redir.op) || !redir.word) continue;
      const dest = this.#source.slice(redir.word.start, redir.word.end).trim();
      if (isStream(dest)) continue;
      destinations.push(unquote(dest));
      if (APPEND_REDIRS.has(redir.op)) append = true;
    }
    if (destinations.length === 0) return null;
    const target = joinAnd(
      destinations.map((dest) => this.#annotateTarget(clip(dest, 120))),
      this.#locale,
    );
    if (this.#ja) {
      return append ? `${target} へ追記。` : `${target} へ書き込み。`;
    }
    return append ? `Appends ${target}.` : `Writes ${target}.`;
  }

  #annotateTarget(target: string): string {
    const hint = formatVarAnnotation(
      target,
      this.#meta.bindings,
      this.#announcedVars,
      this.#locale,
    );
    return hint ? `${target} ${hint}` : target;
  }

  #line(offset: number): number {
    return this.#source.location(offset).line;
  }

  #one(step: DraftStep | null): DraftStep[] {
    if (!step) return [];
    this.#budget--;
    return [step];
  }
}

function stripDraft(step: DraftStep): FlowStep {
  return {
    text: step.text,
    unresolved: step.unresolved,
    line: step.line,
    children: step.children.map(stripDraft),
  };
}

function unwrapTopLevelStmts(stmts: Stmt[]): Stmt[] {
  let current = stmts;
  while (
    current.length === 1 && current[0]?.cmd &&
    (current[0].cmd.type === "Block" || current[0].cmd.type === "Subshell")
  ) {
    current = current[0].cmd.stmts;
  }
  return current;
}

function detectSingleEntry(
  source: SourceMap,
  topStmts: Stmt[],
  meta: ScriptMeta,
): string | null {
  const calledNonPrinters: string[] = [];
  for (const stmt of topStmts) {
    if (stmt.cmd?.type !== "CallExpr" || stmt.cmd.args.length === 0) continue;
    const unwrapped = unwrapCommand(argvOf(source, stmt.cmd.args));
    const fn = meta.functions.get(unwrapped.command);
    if (fn && !fn.isPrinter && !fn.forwards) {
      calledNonPrinters.push(fn.name);
    }
  }
  return calledNonPrinters.length === 1 ? calledNonPrinters[0]! : null;
}

function emptyScope(): CallScope {
  return {
    positional: [],
    rawPositional: [],
    aliases: new Map(),
    setParams: [],
  };
}

function buildCallScope(
  info: FunctionInfo,
  args: string[],
  rawArgs: string[],
): CallScope {
  const aliases = new Map<string, string>();
  for (const [varName, pos] of info.paramAliases) {
    const val = args[pos - 1];
    if (val !== undefined) aliases.set(varName, val);
  }
  return {
    positional: args,
    rawPositional: rawArgs,
    aliases,
    setParams: args.slice(info.leadingShifts),
  };
}

function expandScopeArgv(argv: string[], scope: CallScope): string[] {
  const out: string[] = [];
  for (const arg of argv) {
    if (arg === "$@" || arg === "$*") {
      if (scope.setParams.length > 0) out.push(...scope.setParams);
      else out.push(arg);
      continue;
    }
    const posMatch = arg.match(/^\$\{?([1-9])\}?$/);
    if (posMatch?.[1]) {
      const val = scope.positional[Number(posMatch[1]) - 1];
      out.push(val ?? arg);
      continue;
    }
    const varMatch = arg.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/);
    if (varMatch?.[1] && scope.aliases.has(varMatch[1])) {
      out.push(scope.aliases.get(varMatch[1])!);
      continue;
    }
    out.push(arg);
  }
  return out;
}

function expandScopeRawArgv(raw: string[], scope: CallScope): string[] {
  const out: string[] = [];
  for (const token of raw) {
    const inner = unquote(token);
    if (inner === "$@" || inner === "$*") {
      if (scope.setParams.length > 0) out.push(...scope.setParams);
      else out.push(token);
      continue;
    }
    const posMatch = inner.match(/^\$\{?([1-9])\}?$/);
    if (posMatch?.[1]) {
      const val = scope.rawPositional[Number(posMatch[1]) - 1];
      out.push(val ?? token);
      continue;
    }
    const varMatch = inner.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/);
    if (varMatch?.[1] && scope.aliases.has(varMatch[1])) {
      const mapped = scope.aliases.get(varMatch[1])!;
      out.push(token.startsWith('"') ? `"${mapped}"` : mapped);
      continue;
    }
    out.push(token);
  }
  return out;
}

function flattenChildren(steps: DraftStep[], locale: Locale): DraftStep[] {
  const out: DraftStep[] = [];
  for (const step of steps) {
    if (step.children.length === 0) {
      out.push(step);
      continue;
    }
    if (step.tag?.kind === "branch-group") {
      out.push(...flattenChildren(step.children, locale));
      continue;
    }
    const nested = flattenChildren(step.children, locale);
    if (nested.length === 1 && step.text.endsWith(":")) {
      out.push({
        text: locale === "ja"
          ? `${step.text} ${nested[0]!.text}`
          : `${step.text} ${lowerFirst(nested[0]!.text)}`,
        unresolved: step.unresolved ?? nested[0]!.unresolved,
        line: nested[0]!.line ?? step.line,
        children: [],
        tag: nested[0]!.tag,
      });
      continue;
    }
    if (step.text.startsWith("[") && step.text.endsWith("]")) {
      for (const child of nested) {
        out.push({
          ...child,
          text: child.text.startsWith("[")
            ? child.text
            : `${step.text} ${child.text}`,
          children: [],
        });
      }
      continue;
    }
    out.push({ ...step, children: [] });
    for (const child of nested) out.push(child);
  }
  return out;
}

function coalesceSteps(steps: DraftStep[], locale: Locale): DraftStep[] {
  const result: DraftStep[] = [];
  for (const step of steps) {
    const prev = result[result.length - 1];

    // 1. Merge consecutive `trap` registrations.
    if (
      prev?.tag?.kind === "trap" && step.tag?.kind === "trap" &&
      prev.tag.signals.length > 0 && step.tag.signals.length > 0
    ) {
      const merged = unique([...prev.tag.signals, ...step.tag.signals]);
      prev.tag = { kind: "trap", signals: merged };
      prev.text = formatTrapStep(merged, locale);
      continue;
    }

    // 2. Merge consecutive `rm` steps with the same tool (`rm` / `rm -rf`).
    if (
      prev?.tag?.kind === "rm" && step.tag?.kind === "rm" &&
      prev.tag.tool === step.tag.tool &&
      prev.tag.targets.length > 0 && step.tag.targets.length > 0
    ) {
      const merged = [...prev.tag.targets, ...step.tag.targets];
      prev.tag = { ...prev.tag, targets: merged };
      prev.text = formatRmStep(prev.tag.tool, merged, locale);
      continue;
    }

    // 3. Merge `Sets $VAR. Reads ...` immediately followed by `Branches on $VAR (...)`.
    if (
      prev?.tag?.kind === "assign-read" &&
      step.tag?.kind === "pure-branch" &&
      step.children.length === 0 &&
      step.tag.subject === `$${prev.tag.varName}` &&
      step.tag.values.length > 0
    ) {
      const values = step.tag.values.join(", ");
      prev.text = locale === "ja"
        ? `${prev.text.replace(/。$/, "")}（${values}）。`
        : `${prev.text.replace(/\.$/, "")} (${values}).`;
      continue;
    }

    // 4. Deduplicate consecutive identical leaf lines.
    if (
      prev && prev.text === step.text && prev.children.length === 0 &&
      step.children.length === 0
    ) {
      continue;
    }

    result.push(step);
  }
  return result;
}

function formatTrapStep(signals: string[], locale: Locale): string {
  if (locale === "ja") {
    return signals.length > 0
      ? `シグナルトラップを登録（${signals.join(", ")}）。`
      : "シグナルトラップを登録。";
  }
  if (signals.length === 0) return "Registers a signal trap.";
  return signals.length > 1
    ? `Registers signal traps (${signals.join(", ")}).`
    : `Registers a signal trap (${signals[0]}).`;
}

function formatRmStep(
  tool: string,
  targets: string[],
  locale: Locale,
): string {
  if (locale === "ja") {
    return targets.length > 0
      ? `${tool} で ${joinAnd(targets, "ja")} を削除。`
      : `${tool} でファイルを削除。`;
  }
  return targets.length > 0
    ? `Removes ${joinAnd(targets, "en")} with ${tool}.`
    : `Removes files with ${tool}.`;
}

function flattenToolAvailabilityIf(
  source: SourceMap,
  clause: IfClause,
): { tool: string; stmts: Stmt[] }[] | null {
  const arms: { tool: string; stmts: Stmt[] }[] = [];
  let current: IfClause | null = clause;
  while (current) {
    if (current.cond.length === 0) {
      if (
        current.then.length === 1 && current.then[0]?.cmd?.type === "IfClause"
      ) {
        const nested = flattenToolAvailabilityIf(source, current.then[0].cmd);
        if (!nested) return null;
        arms.push(...nested);
        break;
      }
      arms.push({ tool: "", stmts: current.then });
      break;
    }
    const cond = condText(source, current.cond);
    const toolMatch = cond.match(
      /^(?:command\s+-v|type|which|[A-Za-z0-9_]+(?:_has|_exists)|check_cmd|command_exists)\s+["']?([a-z0-9_-]+)["']?/,
    ) ??
      cond.match(
        /^\[\s+["']?\$\{?[A-Za-z_][A-Za-z0-9_]*\}?["']?\s*=\s*["']?([a-z0-9_-]+)["']?\s*\]$/,
      );
    if (!toolMatch?.[1] || !DOWNLOADERS.has(toolMatch[1])) return null;
    arms.push({ tool: toolMatch[1], stmts: current.then });
    current = current.else;
  }
  return arms.some((arm) => arm.tool !== "") ? arms : null;
}

function collectDownloadTags(
  step: DraftStep,
): { tool: string; target: string; assignedVar: string | null }[] {
  if (step.children.length > 0) {
    return step.children.flatMap(collectDownloadTags);
  }
  if (step.tag?.kind === "download") {
    return [{
      tool: step.tag.tool,
      target: step.tag.target,
      assignedVar: step.tag.assignedVar,
    }];
  }
  return [];
}

function leafDrafts(steps: DraftStep[]): DraftStep[] {
  const leaves: DraftStep[] = [];
  for (const step of steps) {
    if (step.children.length === 0) leaves.push(step);
    else leaves.push(...leafDrafts(step.children));
  }
  return leaves;
}

function countLeafSteps(steps: DraftStep[]): number {
  let total = 0;
  for (const step of steps) {
    if (step.children.length === 0) total++;
    else total += countLeafSteps(step.children);
  }
  return total;
}

function tryCollapseArchiveBranch(
  arms: { label: string; cond: string; steps: DraftStep[] }[],
  line: number,
  locale: Locale,
): DraftStep | null {
  const nonEmpty = arms.filter((arm) => arm.steps.length > 0);
  if (nonEmpty.length !== 2) return null;
  const armLeaves = nonEmpty.map((arm) => leafDrafts(arm.steps));
  if (armLeaves.some((leaves) => leaves.length !== 1)) return null;
  const tags = armLeaves.map((leaves) => leaves[0]?.tag);
  if (
    tags.some((tag) =>
      tag?.kind !== "archive-pipe" && tag?.kind !== "archive-tar"
    )
  ) {
    return null;
  }
  const pipeTag = armLeaves.find((leaves) =>
    leaves[0]?.tag?.kind === "archive-pipe"
  )?.[0]?.tag;
  const tarTag = armLeaves.find((leaves) =>
    leaves[0]?.tag?.kind === "archive-tar"
  )?.[0]?.tag;
  if (pipeTag?.kind !== "archive-pipe" || tarTag?.kind !== "archive-tar") {
    return null;
  }
  const target = pipeTag.target ?? tarTag.target ??
    (locale === "ja" ? "アーカイブ" : "archive");
  return {
    text: locale === "ja"
      ? `tar（または zstd | tar）で ${target} を展開。`
      : `Extracts ${target} with tar (or zstd | tar).`,
    unresolved: null,
    line,
    children: [],
  };
}

function describePipeline(
  line: string,
  rightCmd: string | null,
  locale: Locale,
): string {
  if (rightCmd && SHELLS.has(rightCmd)) {
    return locale === "ja"
      ? `${rightCmd} へパイプ実行: ${clip(line, 120)}。`
      : `Pipes into ${rightCmd}: ${clip(line, 120)}.`;
  }
  if (
    /\b(sha\d+sum|shasum|shasum_bin|md5sum|b2sum)\b/.test(line) &&
    /(?:^|\s)-[a-z]*c\b|--check/.test(line)
  ) {
    return locale === "ja"
      ? `パイプラインでチェックサムを検証: ${clip(line, 120)}。`
      : `Verifies checksum via pipeline: ${clip(line, 120)}.`;
  }
  if (rightCmd === "tar") {
    return locale === "ja"
      ? `パイプラインでアーカイブを展開: ${clip(line, 120)}。`
      : `Extracts archive via pipeline: ${clip(line, 120)}.`;
  }
  return locale === "ja"
    ? `パイプラインを実行: ${clip(line, 120)}。`
    : `Runs a pipeline: ${clip(line, 120)}.`;
}

function rightmostCommandName(
  source: SourceMap,
  stmt: Stmt | null | undefined,
): string | null {
  if (!stmt?.cmd) return null;
  if (stmt.cmd.type === "BinaryCmd") {
    return rightmostCommandName(source, stmt.cmd.y);
  }
  if (stmt.cmd.type === "CallExpr" && stmt.cmd.args.length > 0) {
    return unwrapCommand(argvOf(source, stmt.cmd.args)).command;
  }
  return null;
}

function collectBranchSubjects(steps: DraftStep[]): string[] {
  const subjects: string[] = [];
  for (const step of steps) {
    for (
      const match of step.text.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)
    ) {
      const name = `$${match[1]}`;
      if (!subjects.includes(name)) subjects.push(name);
    }
  }
  return subjects.slice(0, 6);
}

function stripTrailingAnnotation(target: string): string {
  return target.replace(/\s+\([^()]+\)$/, "");
}

function isTempStderrStep(step: DraftStep): boolean {
  if (step.tag?.kind === "rm" && step.tag.tempStderr) return true;
  if (step.tag?.kind === "mktemp" && step.tag.tempStderr) return true;
  return false;
}

function formatCondPrefix(
  raw: string,
  bindings: Map<string, VarBinding>,
  announced: Set<string>,
  locale: Locale,
): string {
  if (raw === "") return locale === "ja" ? "それ以外" : "Otherwise";
  const pretty = prettifyCond(raw, bindings, announced, locale);
  return locale === "ja" ? `${pretty} の場合` : `If ${pretty}`;
}

function prettifyCond(
  raw: string,
  bindings: Map<string, VarBinding>,
  announced: Set<string>,
  locale: Locale,
): string {
  const trimmed = raw.trim();
  if (/^\[\s*"?\$\(id -u\)"?\s*=\s*"?0"?\s*\]$/.test(trimmed)) {
    return "root (id -u = 0)";
  }
  if (/^\[\s*"?\$\(id -u\)"?\s*(?:-ne|!=)\s*"?0"?\s*\]$/.test(trimmed)) {
    return locale === "ja" ? "非 root (id -u != 0)" : "non-root (id -u != 0)";
  }
  const simple = trimmed
    .replace(/\[\[\s+([^\]]+?)\s+\]\]/g, "$1")
    .replace(/\[\s+([^\]]+?)\s+\]/g, "$1")
    .replace(/"/g, "")
    .replace(/\s+-eq\s+/g, " = ")
    .replace(/\s+-ne\s+/g, " != ");
  const hint = formatVarAnnotation(simple, bindings, announced, locale);
  const display = clip(simple, 80);
  return hint ? `${display} ${hint}` : display;
}

function extractPlatformValuesFromArms(arms: { cond: string }[]): string[] {
  const values: string[] = [];
  for (const arm of arms) {
    for (
      const match of arm.cond.matchAll(/=\s*["']?([A-Za-z0-9_.*-]+)["']?/g)
    ) {
      const val = match[1];
      if (!val || val.startsWith("$") || values.includes(val)) continue;
      values.push(val);
    }
  }
  return values;
}

function extractConditionSubject(cond: string): string | null {
  const match = cond.match(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/);
  return match?.[1] ? `$${match[1]}` : null;
}

function nestedCalls(node: Node): CallExpr[] {
  const found: CallExpr[] = [];
  walk(node, (child) => {
    if (child.type === "CallExpr" && child.args.length > 0) found.push(child);
  });
  return found;
}

function delegatedArgv(
  args: string[],
  rawArgs: string[],
): { argv: string[]; raw: string[] } | null {
  for (let index = 0; index < args.length; index++) {
    const raw = unquote(args[index] ?? "");
    if (
      raw === "" || raw.startsWith("-") || raw.startsWith("$") ||
      raw.includes(" ")
    ) {
      continue;
    }
    const base = raw.split("/").pop() ?? raw;
    if (!KNOWN_TOOLS.has(base)) continue;
    if (
      base === "fetch" &&
      args.slice(0, index).some((prev) => /(?:^|[\/_{])git\b/i.test(prev))
    ) {
      continue;
    }
    if (DOWNLOADERS.has(base) || CHECKSUMS.has(base)) {
      const next = unquote(args[index + 1] ?? "");
      const invocation = next.startsWith("-") || next.startsWith("$") ||
        /^https?:/.test(next);
      if (!invocation) continue;
    }
    return {
      argv: args.slice(index).map(unquote),
      raw: rawArgs.slice(index),
    };
  }
  return null;
}

function extractArchiveOperand(command: string, args: string[]): string | null {
  if (command === "tar") {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] ?? "";
      if (arg === "-f" || arg === "--file") return args[i + 1] ?? null;
      if (arg.startsWith("--file=")) return arg.slice("--file=".length);
      if (arg.startsWith("-") && !arg.startsWith("--") && arg.includes("f")) {
        const idx = arg.indexOf("f");
        const rest = arg.slice(idx + 1);
        return rest.length > 0 ? rest : (args[i + 1] ?? null);
      }
    }
  }
  return args.find((arg) => !arg.startsWith("-")) ?? null;
}

function extractPackageNames(args: string[]): string[] {
  const actionIdx = args.findIndex((arg) => arg === "install" || arg === "add");
  if (actionIdx === -1) return [];
  const rest = args.slice(actionIdx + 1);
  const pkgs: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] ?? "";
    if (arg === "--") {
      pkgs.push(...rest.slice(i + 1));
      break;
    }
    if (arg === "-o" || arg === "-t" || arg === "--target-release") {
      i++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    pkgs.push(arg);
  }
  return pkgs;
}

function lastOperand(args: string[]): string | null {
  const operands = args.filter((arg) => !arg.startsWith("-"));
  return operands.length > 0 ? operands[operands.length - 1] ?? null : null;
}

function unameSentence(args: string[], locale: Locale): string {
  const flags = args.filter((arg) => arg.startsWith("-")).join(" ");
  const cmd = flags ? `uname ${flags}` : "uname";
  if (flags.includes("m") || flags.includes("machine")) {
    return locale === "ja"
      ? `${cmd} でマシンアーキテクチャを取得。`
      : `Reads the machine hardware with ${cmd}.`;
  }
  if (flags.includes("o") || flags.includes("operating-system")) {
    return locale === "ja"
      ? `${cmd} で OS 名を取得。`
      : `Reads the operating system with ${cmd}.`;
  }
  if (flags.includes("s") || flags.includes("kernel-name") || flags === "") {
    return locale === "ja"
      ? `${cmd} でカーネル名を取得。`
      : `Reads the kernel name with ${cmd}.`;
  }
  return locale === "ja"
    ? `${cmd} でシステム情報を取得。`
    : `Reads system information with ${cmd}.`;
}

function condText(source: SourceMap, stmts: Stmt[]): string {
  return clip(
    stmts.map((stmt) => oneLine(source, stmt.start, stmt.end).replace(/;$/, ""))
      .join("; "),
    100,
  );
}

function condIsPlatform(label: string): boolean {
  return /uname|OSTYPE|\$\{?os\b|\$\{?OS\b|\$\{?arch\b|\$\{?ARCH\b|\$\{?KERNEL\b/
    .test(label);
}

function looksLikeOptions(subject: string, patterns: string[]): boolean {
  if (/\$\{?[#@*]\}?|\$\{?[0-9]/.test(subject)) return true;
  return patterns.some((pattern) =>
    pattern.startsWith("-") || pattern.includes(" --")
  );
}

function isStream(dest: string): boolean {
  const text = unquote(dest).replace(/\s+/g, "");
  return text === "/dev/null" ||
    text === "/dev/stderr" ||
    text === "/dev/stdout" ||
    text === "/dev/tty" ||
    text === "&1" ||
    text === "&2" ||
    /^\/dev\/fd\/\d+$/.test(text) ||
    /^\$\{?stderr\}?$/.test(text) ||
    /^\$\{?stdout\}?$/.test(text) ||
    /^\$\{?stdin\}?$/.test(text);
}

function isIncidentalWrite(fact: InstallFact): boolean {
  if (fact.action !== "write" && fact.action !== "append") return false;
  if (RC_PATTERN.test(fact.destination)) return false;
  return true;
}

function installSentence(
  places: InstallFact[],
  managers: string[],
  installsDeb: boolean,
  bindings: Map<string, VarBinding>,
  announced: Set<string>,
  locale: Locale,
): string | null {
  const parts: string[] = [];
  const grouped = new Map<string, string[]>();
  for (const fact of places) {
    const list = grouped.get(fact.action) ?? [];
    list.push(fact.destination);
    grouped.set(fact.action, list);
  }
  const order = ["install", "copy", "move", "link", "mkdir", "append", "write"];
  for (const action of order) {
    const destinations = unique(grouped.get(action) ?? []).map((dest) => {
      const hint = formatVarAnnotation(dest, bindings, announced, locale);
      return hint ? `${dest} ${hint}` : dest;
    });
    if (destinations.length === 0) continue;
    parts.push(placeClause(action, destinations, locale));
  }
  if (managers.length > 0) {
    parts.push(
      locale === "ja"
        ? `${joinAnd(managers, "ja")} を実行`
        : `runs ${joinAnd(managers, "en")}`,
    );
  }
  if (installsDeb) {
    parts.push(
      locale === "ja"
        ? "dpkg でパッケージをインストール"
        : "installs a package with dpkg",
    );
  }
  if (parts.length === 0) return null;
  if (locale === "ja") return `${joinClauses(parts, "ja")}します。`;
  return capitalize(joinAnd(parts, "en")) + ".";
}

function placeClause(
  action: string,
  destinations: string[],
  locale: Locale,
): string {
  const target = joinAnd(destinations, locale);
  if (locale === "ja") {
    switch (action) {
      case "mkdir":
        return `${target} を作成`;
      case "install":
        return `${target} へインストール`;
      case "copy":
        return `${target} へファイルをコピー`;
      case "move":
        return `${target} へファイルを移動`;
      case "link":
        return `${target} へリンクを作成`;
      case "append":
        return `${target} へ追記`;
      case "write":
      default:
        return `${target} へ書き込み`;
    }
  }
  switch (action) {
    case "mkdir":
      return `creates ${target}`;
    case "install":
      return `installs to ${target}`;
    case "copy":
      return `copies a file to ${target}`;
    case "move":
      return `moves a file to ${target}`;
    case "link":
      return `links a file to ${target}`;
    case "append":
      return `appends ${target}`;
    case "write":
    default:
      return `writes ${target}`;
  }
}

function writeSentence(
  facts: InstallFact[],
  bindings: Map<string, VarBinding>,
  announced: Set<string>,
  locale: Locale,
): string {
  const destinations = unique(facts.map((fact) => fact.destination)).map(
    (dest) => {
      const hint = formatVarAnnotation(dest, bindings, announced, locale);
      return hint ? `${dest} ${hint}` : dest;
    },
  );
  if (locale === "ja") {
    return `その他、${joinAnd(destinations, "ja")} へ書き込みます。`;
  }
  return capitalize(`also writes ${joinAnd(destinations, "en")}.`);
}

function referencedBindingNames(downloads: DownloadFact[]): Set<string> {
  const names = new Set<string>();
  for (const download of downloads) {
    for (const operand of download.references) {
      const bare = unquote(operand).trim();
      const match = bare.match(
        /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$|^\$([A-Za-z_][A-Za-z0-9_]*)$/,
      );
      const name = match?.[1] ?? match?.[2];
      if (name) names.add(name);
    }
  }
  return names;
}

function networkSentence(
  downloads: DownloadFact[],
  integrity: IntegrityFact[],
  bindings: Map<string, VarBinding>,
  locale: Locale,
): string | null {
  if (downloads.length === 0 && integrity.length === 0) return null;
  const tools = unique(downloads.map((d) => d.tool)).sort();
  const hosts = new Set<string>();
  const extractHost = (url: string) => {
    const match = url.match(/^https?:\/\/([^/\s"'`$]+)/);
    if (match?.[1]) hosts.add(match[1]);
  };
  const referenced = referencedBindingNames(downloads);
  for (const d of downloads) {
    for (const url of d.urls) extractHost(url);
  }
  for (const binding of bindings.values()) {
    if (!referenced.has(binding.name)) continue;
    if (binding.kind === "url-helper" || binding.kind === "value") {
      extractHost(binding.value);
    }
  }
  const hostList = [...hosts].sort();
  const verifyingTools = unique(
    integrity.filter((fact) => fact.verifies).map((fact) => fact.tool),
  ).sort();
  const otherTools = unique(
    integrity.filter((fact) => !verifyingTools.includes(fact.tool)).map((
      fact,
    ) => fact.tool),
  ).sort();

  if (locale === "ja") {
    const parts: string[] = [];
    if (tools.length > 0) {
      parts.push(
        hostList.length > 0
          ? `${joinOr(tools, "ja")} で ${
            joinAnd(hostList, "ja")
          } からダウンロード`
          : `${joinOr(tools, "ja")} でファイルをダウンロード`,
      );
    }
    if (verifyingTools.length > 0) {
      parts.push(`${joinAnd(verifyingTools, "ja")} で整合性を検証`);
    }
    if (otherTools.length > 0) {
      parts.push(`${joinAnd(otherTools, "ja")} を実行`);
    }
    return parts.length > 0 ? `${joinClauses(parts, "ja")}します。` : null;
  }

  const parts: string[] = [];
  if (tools.length > 0) {
    parts.push(
      hostList.length > 0
        ? `downloads from ${joinAnd(hostList, "en")} with ${
          joinOr(tools, "en")
        }`
        : `downloads files with ${joinOr(tools, "en")}`,
    );
  }
  if (verifyingTools.length > 0) {
    parts.push(`verifies integrity with ${joinAnd(verifyingTools, "en")}`);
  }
  if (otherTools.length > 0) {
    parts.push(`runs ${joinAnd(otherTools, "en")}`);
  }
  return parts.length > 0 ? capitalize(joinAnd(parts, "en")) + "." : null;
}

function privilegeSentence(
  privileges: { kind: string }[],
  locale: Locale,
): string {
  const kinds = new Set(privileges.map((fact) => fact.kind));
  const escalate = ["sudo", "doas", "su", "pkexec"].filter((kind) =>
    kinds.has(kind)
  );
  if (locale === "ja") {
    if (escalate.length > 0 && kinds.has("root-check")) {
      return `root かどうかを確認し、${
        joinAnd(escalate, "ja")
      } でコマンドを実行する場合があります。`;
    }
    if (escalate.length > 0) {
      return `${joinAnd(escalate, "ja")} でコマンドを実行する場合があります。`;
    }
    if (kinds.has("root-check")) return "root かどうかを確認します。";
    return "sudo / doas / su / pkexec の使用は検出されませんでした。";
  }
  if (escalate.length > 0 && kinds.has("root-check")) {
    return `Checks whether it is root and may run commands with ${
      joinAnd(escalate, "en")
    }.`;
  }
  if (escalate.length > 0) {
    return `May run commands with ${joinAnd(escalate, "en")}.`;
  }
  if (kinds.has("root-check")) return "Checks whether it is root.";
  return "No sudo, doas, su, or pkexec use was found.";
}

function platformSentence(
  operatingSystems: string[],
  architectures: string[],
  locale: Locale,
): string {
  if (operatingSystems.length === 0 && architectures.length === 0) {
    return locale === "ja"
      ? "OS やアーキテクチャの分岐は検出されませんでした。"
      : "No operating-system or architecture branch was recognized.";
  }
  if (locale === "ja") {
    const os = operatingSystems.length > 0
      ? operatingSystems.join(", ")
      : "なし";
    const arch = architectures.length > 0 ? architectures.join(", ") : "なし";
    return `認識した OS: ${os} / アーキテクチャ: ${arch}。`;
  }
  const os = operatingSystems.length > 0
    ? `operating systems ${joinAnd(operatingSystems, "en")}`
    : "no operating-system branch";
  const arch = architectures.length > 0
    ? `architectures ${joinAnd(architectures, "en")}`
    : "no architecture branch";
  return `Recognizes ${os}, and ${arch}.`;
}

function markGuarded(steps: DraftStep[], locale: Locale): DraftStep[] {
  return steps.map((step, index) =>
    index === 0 && step.unresolved === null
      ? {
        ...step,
        unresolved: locale === "ja"
          ? "&& または || で保護されているため、実行されない場合があります。"
          : "This step is guarded by && or ||, so it may not run.",
      }
      : step
  );
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function capitalize(text: string): string {
  if (text.length === 0) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lowerFirst(text: string): string {
  if (text.length === 0) return text;
  if (text.startsWith("[")) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function clip(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 3) + "...";
}
