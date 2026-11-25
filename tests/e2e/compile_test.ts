import { assert, assertEquals } from "@std/assert";

const CLI = new URL("../../src/main.ts", import.meta.url);
const FIXTURE = new URL("../fixtures/installer.sh", import.meta.url);

Deno.test("deno compile embeds sh-syntax and the binary analyzes a script", async () => {
  const directory = await Deno.makeTempDir({ prefix: "shxray-compile-" });
  const binary = `${directory}/shxray`;
  try {
    const compile = await new Deno.Command(Deno.execPath(), {
      args: [
        "compile",
        "--allow-read",
        "--allow-env",
        "--output",
        binary,
        CLI.pathname,
      ],
      cwd: new URL("../..", import.meta.url).pathname,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(
      compile.code,
      0,
      new TextDecoder().decode(compile.stderr),
    );

    const stat = await Deno.stat(binary);
    assert(
      stat.size > 1_000_000,
      `compiled binary is unexpectedly small: ${stat.size}`,
    );

    const run = await new Deno.Command(binary, {
      args: ["--json", FIXTURE.pathname],
      cwd: "/tmp",
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(run.code, 0, new TextDecoder().decode(run.stderr));
    const report = JSON.parse(new TextDecoder().decode(run.stdout));
    assertEquals(report.parse.ok, true);
    assertEquals(report.platforms.operatingSystems, [
      "darwin",
      "freebsd",
      "linux",
    ]);
    assertEquals(report.summary.risk, "high");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
