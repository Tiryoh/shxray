import { BinCmdOperator, RedirOperator, walk } from "sh-syntax";
import type {
  BinaryCmd,
  CallExpr,
  CaseClause,
  File,
  ForClause,
  FuncDecl,
  IfClause,
  Node,
  Stmt,
  WhileClause,
} from "sh-syntax";

import { unwrapCommand, urlOperands } from "./commands.ts";
import { subjectLooksLikePlatform } from "./platforms.ts";
import { oneLine, type SourceMap } from "./source.ts";
import type { FlowStep, InstallFact } from "./types.ts";
import { argvOf, displayWord, rawArgvOf, unquote } from "./words.ts";

const STEP_BUDGET = 120;

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

const KNOWN_TOOLS = new Set<string>([
  ...DOWNLOADERS,
  ...CHECKSUMS,
  ...SIGNATURES,
  ...PACKAGE_MANAGERS,
  ...ARCHIVERS,
  ...PLACERS,
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
  "id",
]);

const RC_PATTERN =
  /\.(bashrc|zshrc|profile|bash_profile|zprofile|bash_login|kshrc|cshrc|zshenv|zlogin)\b/;

export interface BuiltFlow {
  note: string | null;
  steps: FlowStep[];
  packageManagers: string[];
  installsDeb: boolean;
}

interface FunctionBody {
  name: string;
  stmts: Stmt[];
  forwards: boolean;
}

export function buildFlow(source: SourceMap, file: File): BuiltFlow {
  const builder = new FlowBuilder(source, file);
  return builder.build();
}

export function summarySentences(
  facts: {
    installs: InstallFact[];
    privileges: { kind: string }[];
    operatingSystems: string[];
    architectures: string[];
  },
  observed: { packageManagers: string[]; installsDeb: boolean },
): string[] {
  const primary = facts.installs.filter((fact) => !isIncidentalWrite(fact));
  const incidental = facts.installs.filter(isIncidentalWrite);
  const managers = [...new Set(observed.packageManagers)].sort();
  const sentences: string[] = [];
  const install = installSentence(primary, managers, observed.installsDeb);
  if (install) sentences.push(install);
  else {
    sentences.push(
      "No install destination or package-manager command was recognized.",
    );
  }
  if (incidental.length > 0) sentences.push(writeSentence(incidental));
  sentences.push(privilegeSentence(facts.privileges));
  sentences.push(
    platformSentence(facts.operatingSystems, facts.architectures),
  );
  return sentences;
}

class FlowBuilder {
  readonly #source: SourceMap;
  readonly #file: File;
  readonly #functions = new Map<string, FunctionBody>();
  readonly #expanded = new Set<string>();
  readonly #packageManagers = new Set<string>();
  #installsDeb = false;
  #budget = STEP_BUDGET;
  #truncated = false;

  constructor(source: SourceMap, file: File) {
    this.#source = source;
    this.#file = file;
    walk(file, (node) => {
      if (node.type !== "FuncDecl") return;
      const name = node.name?.value;
      if (!name || this.#functions.has(name)) return;
      const stmts = bodyStmts(node);
      this.#functions.set(name, {
        name,
        stmts,
        forwards: forwardsArguments(source, stmts),
      });
    });
  }

  build(): BuiltFlow {
    const steps = this.#walk(this.#file.stmts, []);
    const uncalled = [...this.#functions.keys()].filter((name) =>
      !this.#expanded.has(name)
    );
    let note: string | null = null;
    if (this.#expanded.size === 0 && uncalled.length > 0) {
      note = `The top level does not call ${
        joinOr(uncalled)
      }. The function bodies below are in source order, not a proven run.`;
      for (const name of uncalled) {
        const body = this.#functions.get(name);
        if (!body) continue;
        this.#expanded.add(name);
        steps.push({
          text:
            `Function ${name} is defined and not called from the top level.`,
          unresolved:
            "This body is not reached by a literal call from the entry point.",
          line: null,
          children: this.#walk(body.stmts, [name]),
        });
      }
    }
    if (this.#truncated) {
      steps.push({
        text: "Further commands were not expanded.",
        unresolved: "The static flow stops after a fixed number of steps.",
        line: null,
        children: [],
      });
    }
    return {
      note,
      steps,
      packageManagers: [...this.#packageManagers].sort(),
      installsDeb: this.#installsDeb,
    };
  }

  #walk(stmts: Stmt[], stack: string[]): FlowStep[] {
    const steps: FlowStep[] = [];
    for (const stmt of stmts) {
      if (this.#budget <= 0) {
        this.#truncated = true;
        break;
      }
      steps.push(...this.#visitStmt(stmt, stack));
    }
    return steps;
  }

  #visitStmt(stmt: Stmt, stack: string[]): FlowStep[] {
    const cmd = stmt.cmd;
    if (!cmd) return this.#redirectOnly(stmt);
    switch (cmd.type) {
      case "FuncDecl":
        return [];
      case "CallExpr":
        return this.#visitCall(stmt, cmd, stack);
      case "IfClause":
        return this.#one(this.#visitIf(cmd, stack));
      case "CaseClause":
        return this.#one(this.#visitCase(cmd, stack));
      case "WhileClause":
      case "ForClause":
        return this.#one(this.#visitLoop(cmd, stack));
      case "BinaryCmd":
        return this.#visitBinary(stmt, cmd, stack);
      case "Block":
      case "Subshell":
        return this.#walk(cmd.stmts, stack);
      default:
        return [];
    }
  }

  #visitCall(stmt: Stmt, call: CallExpr, stack: string[]): FlowStep[] {
    if (call.args.length === 0) return this.#visitAssignments(call, stack);
    const commandWord = this.#source.slice(
      call.args[0]?.start ?? call.start,
      call.args[0]?.end ?? call.start,
    ).trim();
    const forwarded = unquote(commandWord);
    if (forwarded === "$@" || forwarded === "$*") return [];

    const argv = argvOf(this.#source, call.args);
    const raw = rawArgvOf(this.#source, call.args);
    const unwrapped = unwrapCommand(argv);
    const rawArgs = raw.slice(raw.length - unwrapped.args.length);
    const line = this.#line(stmt.start);
    if (this.#functions.has(unwrapped.command)) {
      const assigned = this.#visitAssignments(call, stack);
      const called = this.#callFunction(
        unwrapped.command,
        unwrapped.args,
        stack,
        line,
      );
      return called ? [...assigned, called] : assigned;
    }
    const assigned = this.#visitAssignments(call, stack);
    const sentence = this.#describe(
      unwrapped.command,
      unwrapped.args,
      unwrapped.wrappers,
      rawArgs,
    );
    const redirect = this.#redirectSentence(stmt);
    if (!sentence && !redirect) return assigned;
    this.#budget--;
    const text = [sentence, redirect].filter((part) => part !== null).join(" ");
    return [...assigned, {
      text,
      unresolved: unwrapped.command.includes("$")
        ? "The command word is expanded when the script runs."
        : null,
      line,
      children: [],
    }];
  }

  #visitAssignments(call: CallExpr, stack: string[]): FlowStep[] {
    const steps: FlowStep[] = [];
    for (const assign of call.assigns) {
      const name = assign.name?.value;
      if (!name || !assign.value) continue;
      const nested = nestedCalls(assign.value);
      for (const inner of nested) {
        const argv = argvOf(this.#source, inner.args);
        const unwrapped = unwrapCommand(argv);
        if (this.#functions.has(unwrapped.command)) {
          const called = this.#callFunction(
            unwrapped.command,
            unwrapped.args,
            stack,
            this.#line(inner.start),
          );
          if (called) steps.push(called);
          continue;
        }
        const sentence = this.#describe(
          unwrapped.command,
          unwrapped.args,
          unwrapped.wrappers,
          rawArgvOf(this.#source, inner.args).slice(
            rawArgvOf(this.#source, inner.args).length - unwrapped.args.length,
          ),
        );
        if (!sentence) continue;
        this.#budget--;
        steps.push({
          text: `Sets $${name}. ${sentence}`,
          unresolved: null,
          line: this.#line(assign.start),
          children: [],
        });
      }
    }
    return steps;
  }

  #callFunction(
    name: string,
    args: string[],
    stack: string[],
    line: number,
  ): FlowStep | null {
    if (PRINTERS.has(name)) return null;
    const body = this.#functions.get(name);
    const delegated = body?.forwards ? this.#delegatedStep(args, line) : null;
    if (stack.includes(name)) {
      return {
        text: `Calls ${name} again.`,
        unresolved: "The recursive call is not expanded.",
        line,
        children: delegated ? [delegated] : [],
      };
    }
    if (this.#expanded.has(name)) {
      return {
        text: `Calls ${name} again.`,
        unresolved:
          "The function body was already expanded and is not repeated.",
        line,
        children: delegated ? [delegated] : [],
      };
    }
    this.#expanded.add(name);
    this.#budget--;
    const children = body ? this.#walk(body.stmts, [...stack, name]) : [];
    if (delegated) children.push(delegated);
    return {
      text: `Calls ${name}.`,
      unresolved: null,
      line,
      children,
    };
  }

  #delegatedStep(args: string[], line: number): FlowStep | null {
    const found = delegatedArgv(args);
    if (!found) return null;
    const unwrapped = unwrapCommand(found);
    if (unwrapped.command.includes("$")) return null;
    const sentence = this.#describe(
      unwrapped.command,
      unwrapped.args,
      unwrapped.wrappers,
    );
    if (!sentence) return null;
    this.#budget--;
    return {
      text: sentence,
      unresolved:
        "This command is an argument of a function that forwards its arguments.",
      line,
      children: [],
    };
  }

  #describe(
    command: string,
    args: string[],
    wrappers: string[],
    rawArgs: string[] = args,
  ): string | null {
    if (command === "command") return null;
    if (command === "") {
      const privilege = wrappers.find((wrapper) =>
        wrapper === "sudo" || wrapper === "doas" || wrapper === "su" ||
        wrapper === "pkexec"
      );
      return privilege ? `Checks privilege with ${privilege}.` : null;
    }
    if (command.includes("$")) {
      return "Runs a command whose name is not a fixed literal.";
    }
    const sentence = this.#sentence(command, args, rawArgs);
    if (!sentence) return null;
    const privilege = wrappers.filter((wrapper) =>
      wrapper === "sudo" || wrapper === "doas" || wrapper === "su" ||
      wrapper === "pkexec"
    );
    if (privilege.length === 0) return sentence;
    return `With ${joinAnd(privilege)}, ${lowerFirst(sentence)}`;
  }

  #sentence(
    command: string,
    args: string[],
    rawArgs: string[] = args,
  ): string | null {
    if (PRINTERS.has(command)) return null;
    if (DOWNLOADERS.has(command)) {
      const targets = urlOperands(command, rawArgs);
      const shown = targets.length > 0
        ? joinAnd(targets.map((target) => clip(target)))
        : "a URL";
      return `Downloads ${shown} with ${command}.`;
    }
    if (CHECKSUMS.has(command)) return `Checks a checksum with ${command}.`;
    if (SIGNATURES.has(command)) return `Verifies a signature with ${command}.`;
    if (command === "tar" || command === "unzip" || command === "gunzip") {
      return `Extracts an archive with ${command}.`;
    }
    if (
      command === "install" || command === "cp" || command === "mv" ||
      command === "ln"
    ) {
      const dest = lastOperand(args);
      const verb = command === "install"
        ? "Installs"
        : command === "cp"
        ? "Copies a file"
        : command === "ln"
        ? "Links a file"
        : "Moves a file";
      return dest ? `${verb} to ${clip(dest)}.` : `${verb} with ${command}.`;
    }
    if (command === "mkdir") {
      const dest = lastOperand(args);
      return dest ? `Creates ${clip(dest)}.` : "Creates a directory.";
    }
    if (command === "tee") {
      const dest = args.filter((arg) => !arg.startsWith("-"));
      return dest.length > 0
        ? `Writes ${joinAnd(dest.map((item) => clip(item)))} with tee.`
        : "Writes with tee.";
    }
    if (PACKAGE_MANAGERS.has(command)) {
      this.#packageManagers.add(command);
      if (args.includes("update")) {
        return `Updates package indexes with ${command}.`;
      }
      if (args.includes("install")) return `Installs packages with ${command}.`;
      return `Runs ${command}.`;
    }
    if (
      command === "dpkg" && (args.includes("--install") || args.includes("-i"))
    ) {
      this.#installsDeb = true;
      const deb = lastOperand(args);
      return deb
        ? `Installs a package with dpkg (${clip(deb)}).`
        : "Installs a package with dpkg.";
    }
    if (command === "uname") return unameSentence(args);
    if (command === "dpkg" && args.includes("--print-architecture")) {
      return "Reads the package architecture with dpkg --print-architecture.";
    }
    if (command === "id") return "Checks the user id with id.";
    if (command === "sudo" || command === "doas" || command === "pkexec") {
      return `Checks privilege with ${command}.`;
    }
    if (command === "locale-gen") return "Generates locales with locale-gen.";
    if (command === "add-apt-repository") {
      return "Adds a repository with add-apt-repository.";
    }
    if (command === "rm") return "Removes files with rm.";
    if (command === "chmod") return "Changes permissions with chmod.";
    if (command === "eval") return "Evaluates shell text with eval.";
    if (command === "mktemp") {
      return "Creates a temporary file or directory with mktemp.";
    }
    if (command === "source" || command === ".") {
      const file = args.find((arg) => !arg.startsWith("-"));
      return file ? `Sources ${clip(file)}.` : "Sources another file.";
    }
    if (command === "set") {
      if (args[0] === "--") return "Sets positional parameters.";
      return args.length > 0
        ? `Sets shell options (set ${args.join(" ")}).`
        : "Sets shell options.";
    }
    if (command === "export") {
      const names = args.filter((arg) => !arg.startsWith("-"));
      return names.length > 0
        ? `Exports ${joinAnd(names.map((name) => clip(name)))}.`
        : "Exports variables.";
    }
    if (command === "trap") return "Registers a signal trap.";
    if (command === "sh" || command === "bash" || command === "dash") {
      if (args.includes("-c") || args.includes("--command")) {
        return "Runs a shell command string.";
      }
    }
    return null;
  }

  #visitIf(clause: IfClause, stack: string[]): FlowStep | null {
    const arms: { label: string; cond: string; steps: FlowStep[] }[] = [];
    let current: IfClause | null = clause;
    while (current) {
      const cond = current.cond.length === 0
        ? ""
        : condText(this.#source, current.cond);
      const label = cond === "" ? "Otherwise" : `When ${cond}`;
      const steps = [
        ...this.#walk(current.cond, stack),
        ...this.#walk(current.then, stack),
      ];
      arms.push({ label, cond, steps });
      current = current.else;
    }
    const interesting = arms.some((arm) => arm.steps.length > 0) ||
      arms.some((arm) => condIsPlatform(arm.label));
    if (!interesting) return null;
    if (arms.length > 8) {
      return {
        text: `Branches across ${arms.length} conditions.`,
        unresolved: "Which path runs is not known statically.",
        line: this.#line(clause.start),
        children: [],
      };
    }
    const children = arms.filter((arm) => arm.steps.length > 0).map((arm) => ({
      text: `${clip(arm.label, 120)}.`,
      unresolved: null,
      line: null,
      children: arm.steps,
    }));
    return {
      text: children.length > 0
        ? "Branches."
        : `Branches on ${
          clip(arms.map((arm) => arm.cond || "the other path").join(" / "), 140)
        }.`,
      unresolved: "Which path runs is not known statically.",
      line: this.#line(clause.start),
      children,
    };
  }

  #visitCase(clause: CaseClause, stack: string[]): FlowStep | null {
    const subject = clause.word
      ? displayWord(this.#source, clause.word)
      : "the subject";
    const patterns = clause.items.flatMap((item) =>
      item.patterns.map((pattern) => displayWord(this.#source, pattern))
    ).filter((pattern) => pattern !== "" && pattern !== "''");
    const children: FlowStep[] = [];
    for (const item of clause.items) {
      const steps = this.#walk(item.stmts, stack);
      if (steps.length === 0) continue;
      const label = item.patterns.map((pattern) =>
        displayWord(this.#source, pattern)
      ).join(" | ") || "*";
      children.push({
        text: `When ${clip(label, 80)}.`,
        unresolved: null,
        line: this.#line(item.start),
        children: steps,
      });
    }
    const options = looksLikeOptions(subject, patterns);
    const platform = subjectLooksLikePlatform(subject) ||
      patterns.some((pattern) => subjectLooksLikePlatform(pattern));
    if (!options && !platform && children.length === 0) return null;
    if (children.length > 8) {
      return {
        text: `Branches on ${subject} across ${clause.items.length} arms.`,
        unresolved: "Which arm runs is not known statically.",
        line: this.#line(clause.start),
        children: [],
      };
    }
    const shown = patterns.slice(0, 6).join(", ");
    const more = patterns.length > 6 ? `, and ${patterns.length - 6} more` : "";
    return {
      text: options && children.length === 0
        ? "Reads command-line options."
        : `Branches on ${subject}${
          shown ? ` (${clip(shown + more, 80)})` : ""
        }.`,
      unresolved: options
        ? "Which options are present is not known statically."
        : "Which arm runs is not known statically.",
      line: this.#line(clause.start),
      children,
    };
  }

  #visitLoop(
    clause: WhileClause | ForClause,
    stack: string[],
  ): FlowStep | null {
    const body = this.#walk(clause.do, stack);
    const cond = clause.type === "WhileClause"
      ? condText(this.#source, clause.cond)
      : "the loop list";
    if (body.length === 0) {
      const raw = oneLine(this.#source, clause.start, clause.end);
      if (/case\b/.test(raw) && /(^|[\s"])(--|[+]?\-[A-Za-z])/.test(raw)) {
        return {
          text: "Reads command-line options in a loop.",
          unresolved: "Which options are present is not known statically.",
          line: this.#line(clause.start),
          children: [],
        };
      }
      return null;
    }
    const kind = clause.type === "WhileClause"
      ? (clause.until ? "until" : "while")
      : "for";
    return {
      text: `Loops ${kind} ${clip(cond, 100)}.`,
      unresolved: "How many iterations run is not known statically.",
      line: this.#line(clause.start),
      children: body,
    };
  }

  #visitBinary(
    stmt: Stmt,
    cmd: BinaryCmd,
    stack: string[],
  ): FlowStep[] {
    if (!cmd.x || !cmd.y) return [];
    if (cmd.op === BinCmdOperator.Pipe || cmd.op === BinCmdOperator.PipeAll) {
      const line = oneLine(this.#source, stmt.start, stmt.end);
      this.#budget--;
      return [{
        text: `Runs a pipeline: ${clip(line, 140)}.`,
        unresolved: null,
        line: this.#line(stmt.start),
        children: [],
      }];
    }
    const left = this.#visitStmt(cmd.x, stack);
    const right = this.#visitStmt(cmd.y, stack);
    if (cmd.op !== BinCmdOperator.AndStmt && cmd.op !== BinCmdOperator.OrStmt) {
      return [...left, ...right];
    }
    if (left.length === 0) return markGuarded(right);
    if (right.length === 0) return left;
    return [{
      text: cmd.op === BinCmdOperator.AndStmt
        ? "Runs the next command when the previous one succeeds."
        : "Runs the next command when the previous one fails.",
      unresolved: "Which of these commands run is not known statically.",
      line: this.#line(stmt.start),
      children: [...left, ...right],
    }];
  }

  #redirectOnly(stmt: Stmt): FlowStep[] {
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
    const target = joinAnd(destinations.map((dest) => clip(dest, 120)));
    return append ? `Appends ${target}.` : `Writes ${target}.`;
  }

  #line(offset: number): number {
    return this.#source.location(offset).line;
  }

  #one(step: FlowStep | null): FlowStep[] {
    if (!step) return [];
    this.#budget--;
    return [step];
  }
}

function bodyStmts(decl: FuncDecl): Stmt[] {
  const body = decl.body;
  if (!body?.cmd) return body ? [body] : [];
  if (body.cmd.type === "Block" || body.cmd.type === "Subshell") {
    return body.cmd.stmts;
  }
  return [body];
}

function forwardsArguments(source: SourceMap, stmts: Stmt[]): boolean {
  let found = false;
  for (const stmt of stmts) {
    walk(stmt, (node) => {
      if (node.type !== "CallExpr" || node.args.length === 0) return;
      for (const word of node.args) {
        const text = unquote(source.slice(word.start, word.end).trim());
        if (text === "$@" || text === "$*") found = true;
      }
    });
  }
  return found;
}

function nestedCalls(node: Node): CallExpr[] {
  const found: CallExpr[] = [];
  walk(node, (child) => {
    if (child.type === "CallExpr" && child.args.length > 0) found.push(child);
  });
  return found;
}

function delegatedArgv(args: string[]): string[] | null {
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
    if (DOWNLOADERS.has(base) || CHECKSUMS.has(base)) {
      const next = unquote(args[index + 1] ?? "");
      const invocation = next.startsWith("-") || next.startsWith("$") ||
        /^https?:/.test(next);
      if (!invocation) continue;
    }
    return args.slice(index).map(unquote);
  }
  return null;
}

function lastOperand(args: string[]): string | null {
  const operands = args.filter((arg) => !arg.startsWith("-"));
  return operands.length > 0 ? operands[operands.length - 1] ?? null : null;
}

function unameSentence(args: string[]): string {
  const flags = args.filter((arg) => arg.startsWith("-")).join(" ");
  if (flags.includes("m") || flags.includes("machine")) {
    return flags
      ? `Reads the machine hardware with uname ${flags}.`
      : "Reads the machine hardware with uname.";
  }
  if (flags.includes("o") || flags.includes("operating-system")) {
    return `Reads the operating system with uname ${flags}.`;
  }
  if (flags.includes("s") || flags.includes("kernel-name") || flags === "") {
    return flags
      ? `Reads the kernel name with uname ${flags}.`
      : "Reads the kernel name with uname.";
  }
  return `Reads system information with uname ${flags}.`;
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
    const destinations = unique(grouped.get(action) ?? []);
    if (destinations.length === 0) continue;
    parts.push(placeClause(action, destinations));
  }
  if (managers.length > 0) parts.push(`runs ${joinAnd(managers)}`);
  if (installsDeb) parts.push("installs a package with dpkg");
  if (parts.length === 0) return null;
  return capitalize(joinAnd(parts)) + ".";
}

function placeClause(action: string, destinations: string[]): string {
  const target = joinAnd(destinations);
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
      return `writes ${target}`;
    default:
      return `writes ${target}`;
  }
}

function writeSentence(facts: InstallFact[]): string {
  const destinations = unique(facts.map((fact) => fact.destination));
  return capitalize(`also writes ${joinAnd(destinations)}.`);
}

function privilegeSentence(privileges: { kind: string }[]): string {
  const kinds = new Set(privileges.map((fact) => fact.kind));
  const escalate = ["sudo", "doas", "su", "pkexec"].filter((kind) =>
    kinds.has(kind)
  );
  if (escalate.length > 0 && kinds.has("root-check")) {
    return `Checks whether it is root and may run commands with ${
      joinAnd(escalate)
    }.`;
  }
  if (escalate.length > 0) {
    return `May run commands with ${joinAnd(escalate)}.`;
  }
  if (kinds.has("root-check")) return "Checks whether it is root.";
  return "No sudo, doas, su, or pkexec use was found.";
}

function platformSentence(
  operatingSystems: string[],
  architectures: string[],
): string {
  if (operatingSystems.length === 0 && architectures.length === 0) {
    return "No operating-system or architecture branch was recognized.";
  }
  const os = operatingSystems.length > 0
    ? `operating systems ${joinAnd(operatingSystems)}`
    : "no operating-system branch";
  const arch = architectures.length > 0
    ? `architectures ${joinAnd(architectures)}`
    : "no architecture branch";
  return `Recognizes ${os}, and ${arch}.`;
}

function markGuarded(steps: FlowStep[]): FlowStep[] {
  return steps.map((step, index) =>
    index === 0 && step.unresolved === null
      ? {
        ...step,
        unresolved: "This step is guarded by && or ||, so it may not run.",
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

function joinOr(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

function joinAnd(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function capitalize(text: string): string {
  if (text.length === 0) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lowerFirst(text: string): string {
  if (text.length === 0) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function clip(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 3) + "...";
}
