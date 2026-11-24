import { assert, assertEquals, assertStringIncludes } from "@std/assert";

const CLI = new URL("../../src/main.ts", import.meta.url);
const FIXTURE = new URL("../fixtures/installer.sh", import.meta.url);
const BROKEN = new URL("../fixtures/parse_error.sh", import.meta.url);
const MARKER = "/tmp/shxray-must-not-run";

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], stdin?: string): Promise<RunResult> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-env", CLI.pathname, ...args],
    cwd: new URL("../..", import.meta.url).pathname,
    stdin: stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  if (stdin !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(stdin));
    await writer.close();
  }
  const output = await child.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

Deno.test("file argument --json reports installer facts", async () => {
  const result = await runCli(["--json", FIXTURE.pathname]);
  assertEquals(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assertEquals(report.version, 1);
  assertEquals(report.parse.ok, true);
  assertEquals(report.platforms.operatingSystems, [
    "darwin",
    "freebsd",
    "linux",
  ]);
  assertEquals(report.platforms.architectures, ["aarch64", "x86_64"]);
  assertEquals(report.summary.risk, "high");
  assert(
    report.network.downloads.some((download: { urls: string[] }) =>
      download.urls.some((url) => url.includes("example.com/hook.sh"))
    ),
  );
  assert(
    report.privileges.some((fact: { kind: string }) => fact.kind === "sudo"),
  );
  assert(
    report.installs.some((fact: { destination: string }) =>
      fact.destination.includes("$PREFIX/bin/tool")
    ),
  );
});

Deno.test("stdin pipe matches the file report", async () => {
  const source = await Deno.readTextFile(FIXTURE);
  const piped = await runCli(["--json"], source);
  assertEquals(piped.code, 0, piped.stderr);
  const report = JSON.parse(piped.stdout);
  assertEquals(report.source.name, "<stdin>");
  assertEquals(report.platforms.operatingSystems, [
    "darwin",
    "freebsd",
    "linux",
  ]);
  assertEquals(
    report.interface.environment.find((
      fact: { name: string; defaultValue: string | null },
    ) => fact.name === "PREFIX")?.defaultValue,
    "/usr/local",
  );
});

Deno.test("default output is a plain terminal summary when stdout is not a tty", async () => {
  const result = await runCli([FIXTURE.pathname]);
  assertEquals(result.code, 0, result.stderr);
  assertStringIncludes(result.stdout, "platforms");
  assertStringIncludes(
    result.stdout,
    "operating systems: darwin, freebsd, linux",
  );
  assertStringIncludes(result.stdout, "risk: high");
  assertStringIncludes(result.stdout, "pipe-to-shell");
  assertStringIncludes(result.stdout, "was not executed");
  assert(!result.stdout.includes("\u001b["));
});

Deno.test("parse errors exit 2 and still print a report", async () => {
  const json = await runCli(["--json", BROKEN.pathname]);
  assertEquals(json.code, 2);
  const report = JSON.parse(json.stdout);
  assertEquals(report.parse.ok, false);
  assertStringIncludes(report.parse.error.message, "fi");
  assertStringIncludes(json.stderr, "parse error");

  const text = await runCli([BROKEN.pathname]);
  assertEquals(text.code, 2);
  assertStringIncludes(text.stdout, "parse: error");
  assertStringIncludes(text.stderr, "parse error");
});

Deno.test("help, version, unknown flags, and missing files", async () => {
  const help = await runCli(["--help"]);
  assertEquals(help.code, 0);
  assertStringIncludes(help.stdout, "curl -fsSL");

  const version = await runCli(["--version"]);
  assertEquals(version.code, 0);
  assertStringIncludes(version.stdout, "shxray 0.1.0");

  const unknown = await runCli(["--nope"]);
  assertEquals(unknown.code, 1);
  assertStringIncludes(unknown.stderr, "unknown option");

  const missing = await runCli(["/tmp/shxray-no-such-file.sh"]);
  assertEquals(missing.code, 1);
  assertStringIncludes(missing.stderr, "cannot read");
});

Deno.test("the input script is not executed", async () => {
  await Deno.remove(MARKER).catch(() => {});
  const result = await runCli(["--json", FIXTURE.pathname]);
  assertEquals(result.code, 0, result.stderr);
  let created = true;
  try {
    await Deno.stat(MARKER);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) created = false;
    else throw error;
  }
  assertEquals(created, false);
});
