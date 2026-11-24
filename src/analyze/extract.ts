import { BinCmdOperator, ParExpOperator, RedirOperator, walk } from "sh-syntax";
import type {
  Assign,
  BinaryCmd,
  BinaryTest,
  CallExpr,
  CaseClause,
  CaseItem,
  File,
  Node,
  ParamExp,
  Redirect,
  Stmt,
} from "sh-syntax";

import {
  flagsFromOptstring,
  optionFlag,
  parseArgv,
  unwrapCommand,
} from "./commands.ts";
import {
  normalizeArchToken,
  normalizeOsToken,
  type PlatformCategory,
  platformCategoryFromSubject,
  subjectLooksLikePlatform,
} from "./platforms.ts";
import { oneLine, type SourceMap } from "./source.ts";
import type {
  DownloadFact,
  EnvFact,
  Evidence,
  InstallAction,
  InstallFact,
  IntegrityFact,
  OptionFact,
  PlatformDetection,
  PrivilegeFact,
  PrivilegeKind,
  Severity,
  SideEffectFact,
  SideEffectKind,
} from "./types.ts";
import { argvOf, displayWord, staticText } from "./words.ts";

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

const APPEND_REDIRS = new Set<number>([
  RedirOperator.AppOut,
  RedirOperator.AppClob,
  RedirOperator.AppAll,
  RedirOperator.AppAllClob,
]);

const SHELLS = new Set(["sh", "bash", "dash", "ash", "zsh", "ksh", "mksh"]);
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
const PRIVILEGE_WRAPPERS = new Set<PrivilegeKind>([
  "sudo",
  "doas",
  "su",
  "pkexec",
]);

/** Shell and platform parameters. Plain reads are not installer configuration. */
const IGNORED_READS = new Set([
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
]);

const RC_BASENAMES = new Set([
  ".bashrc",
  ".zshrc",
  ".profile",
  ".bash_profile",
  ".zprofile",
  ".bash_login",
  ".kshrc",
  ".cshrc",
  ".zshenv",
  ".zlogin",
]);

const URL_PATTERN = /https?:\/\/[^\s"'`<>|]+/g;
const NAME_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)|\$([A-Za-z_][A-Za-z0-9_]*)/g;

interface AssignmentRecord {
  literal: string | null;
  text: string;
  count: number;
  evidence: Evidence;
}

interface EnvRead {
  name: string;
  evidence: Evidence;
}

export interface ExtractedFacts {
  operatingSystems: string[];
  architectures: string[];
  detections: PlatformDetection[];
  options: OptionFact[];
  environment: EnvFact[];
  installs: InstallFact[];
  privileges: PrivilegeFact[];
  downloads: DownloadFact[];
  integrity: IntegrityFact[];
  sideEffects: SideEffectFact[];
}

export function extractFacts(source: SourceMap, file: File): ExtractedFacts {
  const collector = new Collector(source);
  walk(file, (node) => {
    collector.visit(node);
  });
  return collector.finish();
}

class Collector {
  readonly #source: SourceMap;
  readonly #os = new Set<string>();
  readonly #arch = new Set<string>();
  readonly #detections: PlatformDetection[] = [];
  readonly #options: OptionFact[] = [];
  readonly #env = new Map<string, EnvFact>();
  readonly #reads: EnvRead[] = [];
  readonly #assignments = new Map<string, AssignmentRecord>();
  readonly #installs: InstallFact[] = [];
  readonly #privileges: PrivilegeFact[] = [];
  readonly #downloads: DownloadFact[] = [];
  readonly #integrity: IntegrityFact[] = [];
  readonly #sideEffects: SideEffectFact[] = [];
  readonly #seen = new Set<string>();

  constructor(source: SourceMap) {
    this.#source = source;
  }

  visit(node: Node): void {
    switch (node.type) {
      case "Assign":
        this.#onAssign(node);
        break;
      case "ParamExp":
        this.#onParam(node);
        break;
      case "CaseClause":
        this.#onCase(node);
        break;
      case "BinaryTest":
        this.#onTest(node);
        break;
      case "BinaryCmd":
        this.#onBinary(node);
        break;
      case "Stmt":
        this.#onRedirects(node);
        break;
      case "CallExpr":
        this.#onCall(node);
        break;
      default:
        break;
    }
  }

  finish(): ExtractedFacts {
    for (const read of this.#reads) {
      if (this.#env.has(read.name)) continue;
      if (!/^[A-Z][A-Z0-9_]+$/.test(read.name)) continue;
      if (IGNORED_READS.has(read.name)) continue;
      const assignment = this.#assignments.get(read.name);
      if (assignment && assignment.literal === null) continue;
      const useLiteral = assignment !== undefined &&
        assignment.literal !== null;
      this.#env.set(read.name, {
        name: read.name,
        defaultValue: useLiteral ? assignment.literal : null,
        origin: useLiteral ? "assignment" : "read",
        evidence: useLiteral ? assignment.evidence : read.evidence,
      });
    }

    const environment = [...this.#env.values()].sort((left, right) =>
      left.evidence.line - right.evidence.line ||
      left.name.localeCompare(right.name)
    );

    return {
      operatingSystems: [...this.#os].sort(),
      architectures: [...this.#arch].sort(),
      detections: this.#detections,
      options: this.#options,
      environment,
      installs: this.#installs,
      privileges: this.#privileges,
      downloads: this.#downloads,
      integrity: this.#integrity,
      sideEffects: this.#sideEffects,
    };
  }

  #onAssign(node: Assign): void {
    const name = node.name?.value;
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
    const text = node.value ? displayWord(this.#source, node.value) : "";
    const literal = staticText(node.value);
    const evidence = this.#evidence(node.start);
    const existing = this.#assignments.get(name);
    if (!existing) {
      this.#assignments.set(name, { literal, text, count: 1, evidence });
      return;
    }
    existing.count++;
    if (
      existing.literal === null || literal === null ||
      existing.literal !== literal
    ) {
      existing.literal = null;
    }
  }

  #onParam(node: ParamExp): void {
    const name = node.param?.value;
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
    const evidence = this.#evidence(node.start);
    if (name === "EUID" || name === "UID") {
      this.#addPrivilege(
        "root-check",
        oneLine(this.#source, node.start, node.end),
        node.start,
      );
    }
    if (node.exp && DEFAULT_OPS.has(node.exp.op)) {
      if (!this.#env.has(name)) {
        const word = node.exp.word;
        this.#env.set(name, {
          name,
          defaultValue: word ? displayWord(this.#source, word) : "",
          origin: "parameter-default",
          evidence,
        });
      }
      return;
    }
    this.#reads.push({ name, evidence });
  }

  #onCase(node: CaseClause): void {
    const subject = node.word ? displayWord(this.#source, node.word) : "";
    const rawValues: string[] = [];
    const osValues: string[] = [];
    const archValues: string[] = [];
    for (const item of node.items) {
      this.#onCaseItem(item, subject);
      for (const pattern of item.patterns) {
        const text = displayWord(this.#source, pattern).trim();
        if (text === "*" || text === "") continue;
        rawValues.push(text);
        const os = normalizeOsToken(text);
        const arch = normalizeArchToken(text);
        if (os) osValues.push(os);
        if (arch) archValues.push(arch);
      }
    }
    if (isPositionalSubject(subject)) return;
    if (
      osValues.length === 0 && archValues.length === 0 &&
      !subjectLooksLikePlatform(subject)
    ) {
      return;
    }
    for (const value of osValues) this.#os.add(value);
    for (const value of archValues) this.#arch.add(value);
    const hinted = platformCategoryFromSubject(subject);
    const category = hinted !== "unknown"
      ? hinted
      : categoryFromValues(osValues, archValues);
    this.#addDetection({
      kind: "case",
      category,
      subject,
      values: rawValues.filter((value) =>
        normalizeOsToken(value) || normalizeArchToken(value)
      ),
      evidence: this.#evidence(node.start),
    });
  }

  #onCaseItem(item: CaseItem, subject: string): void {
    if (!isPositionalSubject(subject)) return;
    const flags: string[] = [];
    let takesValue = false;
    for (const pattern of item.patterns) {
      const parsed = optionFlag(displayWord(this.#source, pattern));
      if (!parsed) continue;
      flags.push(parsed.flag);
      if (parsed.inlineValue) takesValue = true;
    }
    if (flags.length === 0) return;
    const body = this.#source.slice(item.start, item.end);
    if (/\$\{?2\b/.test(body) || /\bshift\s+2\b/.test(body)) takesValue = true;
    this.#addOption(flags, takesValue, item.start);
  }

  #onTest(node: BinaryTest): void {
    const left = node.x ? this.#source.slice(node.x.start, node.x.end) : "";
    const right = node.y ? this.#source.slice(node.y.start, node.y.end) : "";
    const combined = `${left} ${right}`;
    if (!/OSTYPE|uname/i.test(combined)) return;
    this.#collectPlatformTokens("ostype", combined, node.start);
  }

  #onBinary(node: BinaryCmd): void {
    if (node.op !== BinCmdOperator.Pipe && node.op !== BinCmdOperator.PipeAll) {
      return;
    }
    const command = rightmostCall(node.y);
    if (!command) return;
    const argv = argvOf(this.#source, command.args);
    const unwrapped = unwrapCommand(argv);
    if (!SHELLS.has(unwrapped.command)) return;
    this.#addSideEffect(
      "pipe-to-shell",
      "high",
      oneLine(this.#source, node.start, node.end),
      node.start,
    );
  }

  #onRedirects(node: Stmt): void {
    for (const redir of node.redirs) this.#onRedirect(redir);
  }

  #onRedirect(node: Redirect): void {
    if (!WRITE_REDIRS.has(node.op) || !node.word) return;
    const destination = displayWord(this.#source, node.word);
    if (destination === "/dev/null" || destination.startsWith("&")) return;
    const action: InstallAction = APPEND_REDIRS.has(node.op)
      ? "append"
      : "write";
    this.#addInstall(action, destination, null, node.start);
  }

  #onCall(node: CallExpr): void {
    if (node.args.length === 0) return;
    const argv = argvOf(this.#source, node.args);
    const unwrapped = unwrapCommand(argv);
    const detail = oneLine(this.#source, node.start, node.end);
    for (const wrapper of unwrapped.wrappers) {
      if (isPrivilegeKind(wrapper)) {
        this.#addPrivilege(wrapper, detail, node.start);
      }
    }
    if (unwrapped.shellString !== null) {
      this.#addSideEffect(
        "shell-command-string",
        dynamicSeverity(unwrapped.shellString),
        detail,
        node.start,
      );
    }

    const command = unwrapped.command;
    const args = unwrapped.args;
    if (!command) return;

    if (command === "uname") this.#onUname(node, args);
    if (
      command === "id" &&
      (args.length === 0 ||
        args.some((arg) => arg === "-u" || arg === "--user"))
    ) {
      this.#addPrivilege("root-check", detail, node.start);
    }
    if (command === "getopts" && args[0]) {
      for (const flag of flagsFromOptstring(args[0])) {
        this.#addOption([flag.flag], flag.takesValue, node.start);
      }
    }
    if (DOWNLOADERS.has(command)) {
      this.#onDownload(command, node.start, node.end);
    }
    if (CHECKSUMS.has(command) || SIGNATURES.has(command)) {
      this.#addIntegrity(command, detail, node.start);
    }
    if (
      command === "openssl" &&
      args.some((arg) => arg === "dgst" || arg.startsWith("-sha"))
    ) {
      this.#addIntegrity("openssl", detail, node.start);
    }
    if (command === "eval") {
      this.#addSideEffect("eval", dynamicSeverity(detail), detail, node.start);
    }
    if (
      SHELLS.has(command) &&
      args.some((arg) => arg === "-c" || arg === "--command")
    ) {
      this.#addSideEffect(
        "shell-command-string",
        dynamicSeverity(detail),
        detail,
        node.start,
      );
    }
    if (command === "rm") this.#onRm(args, detail, node.start);
    if (PACKAGE_MANAGERS.has(command)) {
      this.#addSideEffect("package-manager", "medium", detail, node.start);
    }
    if (
      command === "chmod" &&
      args.some((arg) => /^(777|a\+rwx|o\+w|\+s|u\+s|4755|4777)$/.test(arg))
    ) {
      this.#addSideEffect("chmod-permissive", "high", detail, node.start);
    }
    if (
      (command === "curl" || command === "wget") &&
      args.some((arg) =>
        arg === "-k" || arg === "--insecure" || arg === "--no-check-certificate"
      )
    ) {
      this.#addSideEffect("insecure-download", "medium", detail, node.start);
    }
    this.#onInstallCommand(command, args, node.start);
    this.#onBracket(command, args, detail, node.start);
  }

  #onUname(node: CallExpr, args: string[]): void {
    const subject = oneLine(this.#source, node.start, node.end);
    const arch = args.some((arg) =>
      arg === "--machine" || /^-[a-zA-Z]*m[a-zA-Z]*$/.test(arg)
    );
    const os = args.some((arg) =>
      arg === "--kernel-name" || arg === "--operating-system" ||
      /^-[a-zA-Z]*s[a-zA-Z]*$/.test(arg)
    );
    const all = args.some((arg) => arg === "-a" || arg === "--all");
    let category: PlatformCategory = "os";
    if (all || (arch && os)) category = "unknown";
    else if (arch) category = "arch";
    this.#addDetection({
      kind: "uname",
      category,
      subject,
      values: [],
      evidence: this.#evidence(node.start),
    });
  }

  #onDownload(tool: string, start: number, end: number): void {
    const region = this.#source.slice(start, end);
    const urls = collectUrls(region, this.#assignments);
    const key = `download|${this.#evidence(start).line}|${tool}|${
      urls.join(" ")
    }`;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    this.#downloads.push({
      tool,
      urls,
      evidence: this.#evidence(start),
    });
  }

  #onRm(args: string[], detail: string, offset: number): void {
    let recursive = false;
    let force = false;
    const targets: string[] = [];
    for (const arg of args) {
      if (arg === "--") continue;
      if (arg === "--recursive" || arg === "-r" || arg === "-R") {
        recursive = true;
        continue;
      }
      if (arg === "--force" || arg === "-f") {
        force = true;
        continue;
      }
      if (arg.startsWith("-") && !arg.startsWith("--")) {
        const letters = arg.slice(1);
        if (/[rR]/.test(letters)) recursive = true;
        if (letters.includes("f")) force = true;
        continue;
      }
      targets.push(arg);
    }
    if (!recursive) return;
    const rootish = targets.some((target) => {
      const text = target.trim();
      return text === "/" || text === "/*" || text === "~" || text === "~/" ||
        text === "$HOME" || text === "${HOME}" || text === "/usr" ||
        text === "/bin" ||
        text === "/etc";
    });
    const severity: Severity = rootish ? "high" : force ? "medium" : "low";
    this.#addSideEffect("rm-recursive", severity, detail, offset);
  }

  #onInstallCommand(command: string, args: string[], offset: number): void {
    const known = new Set(["install", "cp", "mv", "ln", "mkdir", "tee"]);
    if (!known.has(command)) return;
    const parsed = parseArgv(command, args);
    const mode = parsed.values.get("-m") ?? parsed.values.get("--mode") ?? null;
    const target = parsed.values.get("-t") ??
      parsed.values.get("--target-directory") ?? null;
    const directoryMode = command === "install" &&
      parsed.flags.some((flag) => flag === "-d" || flag === "--directory");

    if (command === "mkdir" || directoryMode) {
      for (const destination of parsed.operands) {
        this.#addInstall("mkdir", destination, mode, offset);
      }
      return;
    }
    if (command === "tee") {
      const append = parsed.flags.some((flag) =>
        flag === "-a" || flag === "--append"
      );
      for (const destination of parsed.operands) {
        this.#addInstall(
          append ? "append" : "write",
          destination,
          null,
          offset,
        );
      }
      return;
    }
    if (target) {
      this.#addInstall(installAction(command), target, mode, offset);
      return;
    }
    if (parsed.operands.length < 2) return;
    const destination = parsed.operands[parsed.operands.length - 1];
    if (!destination) return;
    this.#addInstall(installAction(command), destination, mode, offset);
  }

  #onBracket(
    command: string,
    args: string[],
    detail: string,
    offset: number,
  ): void {
    if (command !== "[" && command !== "test") return;
    const joined = args.join(" ");
    if (/\bEUID\b|\bUID\b/.test(joined)) {
      this.#addPrivilege("root-check", detail, offset);
    }
    if (/OSTYPE|uname/.test(joined)) {
      this.#collectPlatformTokens("test", joined, offset);
    }
  }

  #collectPlatformTokens(
    kind: PlatformDetection["kind"],
    text: string,
    offset: number,
  ): void {
    const tokens = text.split(/[^A-Za-z0-9_*.?-]+/).filter((token) =>
      token.length > 0
    );
    const values: string[] = [];
    const osValues: string[] = [];
    const archValues: string[] = [];
    for (const token of tokens) {
      const os = normalizeOsToken(token);
      const arch = normalizeArchToken(token);
      if (!os && !arch) continue;
      values.push(token);
      if (os) osValues.push(os);
      if (arch) archValues.push(arch);
    }
    for (const value of osValues) this.#os.add(value);
    for (const value of archValues) this.#arch.add(value);
    if (values.length === 0 && kind !== "uname") return;
    this.#addDetection({
      kind,
      category: categoryFromValues(osValues, archValues),
      subject: clipSubject(text),
      values,
      evidence: this.#evidence(offset),
    });
  }

  #addDetection(detection: PlatformDetection): void {
    const key =
      `detect|${detection.kind}|${detection.evidence.line}|${detection.subject}`;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    this.#detections.push(detection);
  }

  #addOption(flags: string[], takesValue: boolean, offset: number): void {
    const existing = this.#options.find((option) =>
      option.flags.some((flag) => flags.includes(flag))
    );
    if (existing) {
      for (const flag of flags) {
        if (!existing.flags.includes(flag)) existing.flags.push(flag);
      }
      existing.takesValue = existing.takesValue || takesValue;
      return;
    }
    this.#options.push({
      flags: [...flags],
      takesValue,
      evidence: this.#evidence(offset),
    });
  }

  #addInstall(
    action: InstallAction,
    destination: string,
    mode: string | null,
    offset: number,
  ): void {
    const evidence = this.#evidence(offset);
    const key = `install|${action}|${destination}|${evidence.line}`;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    this.#installs.push({ action, destination, mode, evidence });
    if (isShellRc(destination)) {
      this.#addSideEffect("shell-rc", "medium", destination, offset);
    }
  }

  #addPrivilege(kind: PrivilegeKind, detail: string, offset: number): void {
    const evidence = this.#evidence(offset);
    const key = `priv|${kind}|${evidence.line}`;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    this.#privileges.push({ kind, detail, evidence });
  }

  #addIntegrity(tool: string, detail: string, offset: number): void {
    const evidence = this.#evidence(offset);
    const key = `sum|${tool}|${evidence.line}`;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    this.#integrity.push({ tool, detail, evidence });
  }

  #addSideEffect(
    kind: SideEffectKind,
    severity: Severity,
    detail: string,
    offset: number,
  ): void {
    const evidence = this.#evidence(offset);
    const key = `fx|${kind}|${evidence.line}`;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    this.#sideEffects.push({ kind, severity, detail, evidence });
  }

  #evidence(offset: number): Evidence {
    const location = this.#source.location(offset);
    return {
      line: location.line,
      column: location.column,
      snippet: this.#source.lineText(location.line),
    };
  }
}

function isPositionalSubject(subject: string): boolean {
  const text = subject.trim().replace(/^['"]|['"]$/g, "");
  return text === "$1" || text === "${1}";
}

function rightmostCall(stmt: Stmt | null): CallExpr | null {
  const command = stmt?.cmd;
  if (!command) return null;
  if (command.type === "CallExpr") return command;
  if (command.type === "BinaryCmd") return rightmostCall(command.y);
  return null;
}

function categoryFromValues(os: string[], arch: string[]): PlatformCategory {
  if (os.length > 0 && arch.length === 0) return "os";
  if (arch.length > 0 && os.length === 0) return "arch";
  return "unknown";
}

function installAction(command: string): InstallAction {
  switch (command) {
    case "cp":
      return "copy";
    case "mv":
      return "move";
    case "ln":
      return "link";
    case "mkdir":
      return "mkdir";
    default:
      return "install";
  }
}

function isPrivilegeKind(value: string): value is PrivilegeKind {
  return PRIVILEGE_WRAPPERS.has(value as PrivilegeKind);
}

function isShellRc(path: string): boolean {
  const trimmed = path.trim().replace(/\/+$/, "");
  const base = trimmed.split("/").pop() ?? trimmed;
  if (RC_BASENAMES.has(base)) return true;
  return trimmed.endsWith("/etc/profile") ||
    trimmed.endsWith("/etc/shells") ||
    trimmed.endsWith("/etc/sudoers") ||
    trimmed.includes("/etc/profile.d/");
}

function dynamicSeverity(text: string): Severity {
  return /curl|wget|https?:\/\//.test(text) ? "high" : "medium";
}

function collectUrls(
  root: string,
  assignments: Map<string, AssignmentRecord>,
): string[] {
  const found: string[] = [];
  const seenUrls = new Set<string>();
  const seenNames = new Set<string>();
  const visit = (text: string, depth: number) => {
    for (const match of text.matchAll(URL_PATTERN)) {
      const url = trimUrl(match[0] ?? "");
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      found.push(url);
    }
    if (depth >= 3) return;
    for (const name of referencedNames(text)) {
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      const assigned = assignments.get(name);
      if (assigned) visit(assigned.text, depth + 1);
    }
  };
  visit(root, 0);
  return found;
}

function referencedNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(NAME_PATTERN)) {
    const name = match[1] ?? match[2];
    if (name) names.push(name);
  }
  return names;
}

function trimUrl(url: string): string {
  return url.replace(/[),.;]+$/g, "");
}

function clipSubject(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 160 ? collapsed.slice(0, 157) + "..." : collapsed;
}
