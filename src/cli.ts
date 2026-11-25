import { analyze } from "./analyze/analyze.ts";
import { parseLocale } from "./analyze/locale.ts";
import type { Locale, ShellVariant } from "./analyze/types.ts";
import { escapeControls } from "./render/escape.ts";
import { renderJson } from "./render/json.ts";
import { renderTerminal } from "./render/terminal.ts";
import { VERSION } from "./version.ts";

const HELP = `shxray — inspect a shell installer without executing it

Usage:
  shxray [options] [file]
  curl -fsSL https://example.com/install.sh | shxray

Options:
  --json          Print the versioned analysis report as JSON
  --verbose       After the summary and flow, print detailed flow and category details
  --lang <en|ja>  Output language (default: from LC_ALL, LC_MESSAGES, or LANG)
  --plain         Plain text, without color
  --no-color      Same as --plain
  --posix         Parse as POSIX sh (default: bash)
  --bash          Parse as bash (default)
  -h, --help      Show this help
  -V, --version   Show the version

The script is never executed. With no file, shxray reads stdin.
If stdin is a terminal, pass a file path instead.

Exit codes:
  0  analysis finished
  1  usage or I/O error
  2  the script could not be parsed
`;

interface Flags {
  json: boolean;
  verbose: boolean;
  plain: boolean;
  variant: ShellVariant;
  lang: Locale | undefined;
  help: boolean;
  version: boolean;
  file: string | undefined;
}

export async function main(argv: string[] = Deno.args): Promise<void> {
  let flags: Flags;
  try {
    flags = parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "invalid arguments";
    console.error(`shxray: ${escapeControls(message)}`);
    console.error("Run shxray --help for usage.");
    Deno.exit(1);
  }

  if (flags.help) {
    console.log(HELP);
    Deno.exit(0);
  }
  if (flags.version) {
    console.log(`shxray ${VERSION}`);
    Deno.exit(0);
  }

  let source: string;
  let name: string;
  try {
    const input = await readInput(flags.file);
    source = input.source;
    name = input.name;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`shxray: ${escapeControls(message)}`);
    Deno.exit(1);
  }

  const locale = resolveLocale(flags.lang);
  const report = await analyze(source, {
    name,
    variant: flags.variant,
    locale,
  });
  const color = flags.json ? false : colorEnabled(flags.plain);
  const rendered = flags.json
    ? renderJson(report)
    : renderTerminal(report, { color, verbose: flags.verbose, locale });
  await Deno.stdout.write(new TextEncoder().encode(rendered));

  if (!report.parse.ok) {
    const error = report.parse.error;
    const where = error?.line ? ` (line ${error.line})` : "";
    console.error(
      `shxray: parse error${where}: ${
        escapeControls(error?.message ?? "unknown error")
      }`,
    );
    Deno.exit(2);
  }
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    json: false,
    verbose: false,
    plain: false,
    variant: "bash",
    lang: undefined,
    help: false,
    version: false,
    file: undefined,
  };
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (arg === "--") {
      rest.push(...argv.slice(index + 1));
      break;
    }
    if (arg === "--json") flags.json = true;
    else if (arg === "--verbose") flags.verbose = true;
    else if (arg === "--plain" || arg === "--no-color") flags.plain = true;
    else if (arg === "--posix") flags.variant = "posix";
    else if (arg === "--bash") flags.variant = "bash";
    else if (arg === "--lang") {
      const value = argv[++index];
      flags.lang = parseLangFlag(value);
    } else if (arg.startsWith("--lang=")) {
      flags.lang = parseLangFlag(arg.slice("--lang=".length));
    } else if (arg === "-h" || arg === "--help") flags.help = true;
    else if (arg === "-V" || arg === "--version") flags.version = true;
    else if (arg === "-") rest.push(arg);
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else rest.push(arg);
  }
  if (rest.length > 1) throw new Error("too many file arguments");
  flags.file = rest[0];
  return flags;
}

function parseLangFlag(value: string | undefined): Locale {
  if (!value) throw new Error("--lang requires a value (en or ja)");
  const lower = value.trim().toLowerCase();
  if (lower === "en" || lower.startsWith("en_") || lower.startsWith("en-")) {
    return "en";
  }
  if (lower === "ja" || lower.startsWith("ja_") || lower.startsWith("ja-")) {
    return "ja";
  }
  throw new Error(`unsupported language: ${value} (expected en or ja)`);
}

function resolveLocale(explicit: Locale | undefined): Locale {
  if (explicit) return explicit;
  const permission = Deno.permissions.querySync({ name: "env" });
  if (permission.state !== "granted") return "en";
  for (const key of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const value = Deno.env.get(key);
    if (value && value.trim().length > 0) return parseLocale(value) ?? "en";
  }
  const language = Deno.env.get("LANGUAGE");
  if (language) {
    const first = language.split(":")[0];
    const parsed = parseLocale(first);
    if (parsed) return parsed;
  }
  return "en";
}

async function readInput(
  file: string | undefined,
): Promise<{ source: string; name: string }> {
  if (file === undefined || file === "-") {
    if (Deno.stdin.isTerminal()) {
      throw new Error(
        "no script on stdin. Pass a file or pipe a script.\n\n" + HELP,
      );
    }
    const source = await new Response(Deno.stdin.readable).text();
    return { source, name: "<stdin>" };
  }
  try {
    const source = await Deno.readTextFile(file);
    return { source, name: file };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new Error(`cannot read ${file}: ${detail}`);
  }
}

function colorEnabled(plain: boolean): boolean {
  if (plain || !Deno.stdout.isTerminal()) return false;
  const permission = Deno.permissions.querySync({ name: "env" });
  if (permission.state !== "granted") return true;
  const noColor = Deno.env.get("NO_COLOR");
  return noColor === undefined || noColor.length === 0;
}
