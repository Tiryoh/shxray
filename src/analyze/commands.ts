import { unquote } from "./words.ts";

const WRAPPERS = new Set([
  "sudo",
  "doas",
  "pkexec",
  "command",
  "exec",
  "nice",
  "nohup",
  "time",
  "env",
]);

const WRAPPER_VALUE_FLAGS: Readonly<Record<string, readonly string[]>> = {
  sudo: [
    "-u",
    "-g",
    "-C",
    "-p",
    "-r",
    "-t",
    "-T",
    "--user",
    "--group",
    "--prompt",
    "--chdir",
  ],
  doas: ["-u", "-C", "--"],
  pkexec: ["--user", "--prompt"],
  env: ["-u", "--unset", "-C", "--chdir", "-S", "--split-string"],
  nice: ["-n", "--adjustment"],
  command: [],
  exec: [],
  nohup: [],
  time: [],
};

const INSTALL_VALUE_FLAGS: Readonly<Record<string, readonly string[]>> = {
  install: [
    "-m",
    "-o",
    "-g",
    "-t",
    "-S",
    "--mode",
    "--owner",
    "--group",
    "--target-directory",
    "--suffix",
    "--strip-program",
  ],
  cp: ["-t", "-S", "--target-directory", "--suffix"],
  mv: ["-t", "-S", "--target-directory", "--suffix"],
  ln: ["-t", "-S", "--target-directory", "--suffix"],
  mkdir: ["-m", "--mode"],
  tee: [],
  rm: [],
  chmod: [],
};

export interface UnwrappedCommand {
  wrappers: string[];
  command: string;
  args: string[];
  /** Present for `su -c <string>`, which is not split into another argv. */
  shellString: string | null;
}

export interface ParsedArgv {
  flags: string[];
  values: Map<string, string>;
  operands: string[];
}

export function basename(word: string): string {
  const trimmed = word.trim();
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

export function unwrapCommand(argv: string[]): UnwrappedCommand {
  const wrappers: string[] = [];
  let index = 0;
  if (/^\$\{?SUDO(?:\[[@*]\])?\}?$/.test(argv[0] ?? "")) {
    wrappers.push("sudo");
    index = 1;
  }

  while (index < argv.length) {
    const current = argv[index] ?? "";
    const base = basename(current);
    if (base === "su") {
      wrappers.push("su");
      const flag = argv[index + 1];
      let cursor = index + 1;
      let shellString: string | null = null;
      while (cursor < argv.length) {
        const token = argv[cursor] ?? "";
        if (token === "-c" || token === "--command") {
          shellString = argv[cursor + 1] ?? "";
          break;
        }
        if (token === "--") break;
        cursor++;
      }
      if (shellString !== null) {
        return { wrappers, command: "su", args: [], shellString };
      }
      index += flag && !flag.startsWith("-") ? 2 : 1;
      continue;
    }
    if (base === "command" && isCommandQuery(argv, index)) {
      return {
        wrappers,
        command: "command",
        args: argv.slice(index + 1),
        shellString: null,
      };
    }
    if (!WRAPPERS.has(base)) break;
    wrappers.push(base);
    index = skipWrapperFlags(base, argv, index + 1);
  }

  return {
    wrappers,
    command: basename(argv[index] ?? ""),
    args: argv.slice(index + 1),
    shellString: null,
  };
}

export function parseArgv(command: string, args: string[]): ParsedArgv {
  const takesValue = new Set(INSTALL_VALUE_FLAGS[command] ?? []);
  const flags: string[] = [];
  const values = new Map<string, string>();
  const operands: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      operands.push(...args.slice(index + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      if (equals !== -1) {
        const key = arg.slice(0, equals);
        flags.push(key);
        values.set(key, arg.slice(equals + 1));
        continue;
      }
      flags.push(arg);
      if (takesValue.has(arg) && index + 1 < args.length) {
        values.set(arg, args[index + 1] ?? "");
        index++;
      }
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      const letters = arg.slice(1);
      for (let cursor = 0; cursor < letters.length; cursor++) {
        const short = `-${letters[cursor] ?? ""}`;
        flags.push(short);
        if (!takesValue.has(short)) continue;
        const rest = letters.slice(cursor + 1);
        if (rest.length > 0) values.set(short, rest);
        else if (index + 1 < args.length) {
          values.set(short, args[index + 1] ?? "");
          index++;
        }
        break;
      }
      continue;
    }
    operands.push(arg);
  }

  return { flags, values, operands };
}

const DOWNLOAD_VALUE_FLAGS: Readonly<Record<string, readonly string[]>> = {
  curl: [
    "-o",
    "-d",
    "-D",
    "-H",
    "-A",
    "-e",
    "-u",
    "-K",
    "-m",
    "-w",
    "-E",
    "-b",
    "-c",
    "-F",
    "-T",
    "-C",
    "-x",
    "-U",
    "-X",
    "-Y",
    "--output",
    "--output-dir",
    "--data",
    "--data-raw",
    "--data-binary",
    "--data-ascii",
    "--data-urlencode",
    "--header",
    "--user-agent",
    "--referer",
    "--user",
    "--config",
    "--retry",
    "--retry-delay",
    "--retry-max-time",
    "--connect-timeout",
    "--max-time",
    "--write-out",
    "--cacert",
    "--capath",
    "--cert",
    "--key",
    "--proxy",
    "--proxy-user",
    "--request",
    "--form",
    "--upload-file",
    "--continue-at",
    "--cookie",
    "--cookie-jar",
    "--dump-header",
    "--stderr",
    "--trace",
    "--trace-ascii",
    "--limit-rate",
    "--speed-limit",
    "--speed-time",
    "--connect-to",
    "--resolve",
    "--unix-socket",
    "--proto",
    "--proto-redir",
  ],
  wget: [
    "-O",
    "-o",
    "-P",
    "-t",
    "-T",
    "-a",
    "-i",
    "-B",
    "--output-document",
    "--output-file",
    "--directory-prefix",
    "--tries",
    "--timeout",
    "--header",
    "--user-agent",
    "--post-data",
    "--post-file",
    "--referer",
    "--user",
    "--password",
    "--append-output",
    "--input-file",
    "--base",
    "--limit-rate",
  ],
  fetch: ["-o", "--output"],
  aria2c: ["-o", "-d", "--out", "--dir"],
  axel: ["-o", "--output"],
};

/** Options whose value is itself a URL operand, in either `--url VALUE` or `--url=VALUE` form. */
const URL_OPERAND_FLAGS: Readonly<Record<string, readonly string[]>> = {
  curl: ["--url"],
};

/**
 * URL operands with quotes preserved.
 * Flags are classified from the unquoted word, so `"-o"` still consumes the next argument.
 */
export function urlOperands(command: string, args: string[]): string[] {
  const takes = new Set(DOWNLOAD_VALUE_FLAGS[command] ?? []);
  const urlFlags = new Set(URL_OPERAND_FLAGS[command] ?? []);
  const operands: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const raw = args[index] ?? "";
    const arg = unquote(raw);
    if (arg === "--") {
      operands.push(...args.slice(index + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      if (equals !== -1) {
        const key = arg.slice(0, equals);
        if (urlFlags.has(key)) operands.push(equalsValue(raw));
        continue;
      }
      if (urlFlags.has(arg) && index + 1 < args.length) {
        operands.push(args[index + 1] ?? "");
        index++;
        continue;
      }
      if (takes.has(arg) && index + 1 < args.length) index++;
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1 && !arg.startsWith("-$")) {
      let takesNext = false;
      const body = arg.slice(1);
      for (let cursor = 0; cursor < body.length; cursor++) {
        const char = body[cursor] ?? "";
        if (!/[A-Za-z]/.test(char)) continue;
        if (!takes.has(`-${char}`)) continue;
        if (body.slice(cursor + 1).length === 0) takesNext = true;
        break;
      }
      if (takesNext) index++;
      continue;
    }
    operands.push(raw);
  }
  return operands;
}

function equalsValue(raw: string): string {
  const word = unquote(raw);
  const semantic = word.indexOf("=");
  if (semantic === -1) return "";
  if (raw !== word) return word.slice(semantic + 1);
  const at = raw.indexOf("=");
  return at === -1 ? "" : raw.slice(at + 1);
}

export function disablesTlsVerification(
  command: string,
  args: string[],
): boolean {
  if (command === "curl") {
    return args.some((arg) => {
      const word = unquote(arg);
      if (word === "--insecure") return true;
      return word.startsWith("-") && !word.startsWith("--") &&
        word.includes("k");
    });
  }
  if (command === "wget") {
    return args.some((arg) => unquote(arg) === "--no-check-certificate");
  }
  return false;
}

function isCommandQuery(argv: string[], index: number): boolean {
  const flags: string[] = [];
  for (let cursor = index + 1; cursor < argv.length; cursor++) {
    const token = argv[cursor] ?? "";
    if (!token.startsWith("-") || token === "--") break;
    flags.push(token);
  }
  return flags.some((flag) =>
    flag === "-v" || flag === "-V" || flag === "--version"
  );
}

export function flagsFromOptstring(
  optstring: string,
): { flag: string; takesValue: boolean }[] {
  let body = optstring;
  if (body.startsWith(":")) body = body.slice(1);
  const flags: { flag: string; takesValue: boolean }[] = [];
  for (let index = 0; index < body.length; index++) {
    const char = body[index] ?? "";
    if (!/[A-Za-z0-9]/.test(char)) continue;
    flags.push({ flag: `-${char}`, takesValue: body[index + 1] === ":" });
  }
  return flags;
}

export function optionFlag(
  pattern: string,
): { flag: string; inlineValue: boolean } | null {
  let text = pattern.trim();
  if (
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith('"') && text.endsWith('"'))
  ) {
    text = text.slice(1, -1);
  }
  if (!text.startsWith("-") || text === "-" || text === "--") return null;
  let inlineValue = false;
  const equals = text.indexOf("=");
  if (equals !== -1) {
    inlineValue = true;
    text = text.slice(0, equals);
  }
  text = text.replace(/\*+$/, "");
  if (/^-[A-Za-z0-9]$/.test(text) || /^--[A-Za-z0-9][\w.-]*$/.test(text)) {
    return { flag: text, inlineValue };
  }
  return null;
}

function skipWrapperFlags(
  wrapper: string,
  argv: string[],
  index: number,
): number {
  const takesValue = new Set(WRAPPER_VALUE_FLAGS[wrapper] ?? []);
  while (index < argv.length) {
    const token = argv[index] ?? "";
    if (token === "--") return index + 1;
    if (wrapper === "env" && !token.startsWith("-") && token.includes("=")) {
      index++;
      continue;
    }
    if (!token.startsWith("-") || token === "-") break;
    index++;
    const key = token.includes("=")
      ? token.slice(0, token.indexOf("="))
      : token;
    if (!token.includes("=") && takesValue.has(key)) index++;
  }
  return index;
}
