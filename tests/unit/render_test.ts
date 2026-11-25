import { assert, assertStringIncludes } from "@std/assert";

import { analyze } from "../../src/analyze/analyze.ts";
import { renderJson } from "../../src/render/json.ts";
import { renderTerminal } from "../../src/render/terminal.ts";

Deno.test("terminal summary is plain without color and colored when asked", async () => {
  const report = await analyze("echo hi\n", { name: "hi.sh" });
  const plain = renderTerminal(report, { color: false });
  const colored = renderTerminal(report, { color: true });
  assertStringIncludes(plain, "shxray 0.1.0  hi.sh");
  assertStringIncludes(plain, "risk: info");
  assertStringIncludes(plain, "Summary");
  assertStringIncludes(plain, "Flow");
  assertStringIncludes(plain, "No install destination");
  assert(!plain.includes("\nplatforms\n") && !plain.includes("platforms"));
  assertStringIncludes(plain, "--verbose");
  assert(!plain.includes("\u001b["));
  assert(colored.includes("\u001b["));
  assertStringIncludes(colored, "risk:");
});

Deno.test("verbose terminal output keeps the detailed flow and per-category details", async () => {
  const report = await analyze(
    'main() { if [ "$X" = "1" ]; then mkdir -p /opt/a; fi; }\nmain\n',
    { name: "hi.sh" },
  );
  const plain = renderTerminal(report, { color: false });
  const verbose = renderTerminal(report, { color: false, verbose: true });
  assertStringIncludes(plain, "Flow (entry: main)");
  assert(!plain.includes("\ndetailed flow\n"));
  assertStringIncludes(verbose, "Details");
  assertStringIncludes(verbose, "\ndetailed flow\n");
  assertStringIncludes(verbose, "platforms");
  assertStringIncludes(verbose, "side effects");
});

Deno.test("plain output escapes controls and shows every download target", async () => {
  const report = await analyze(
    'curl https://example.com/\u001b[2Jfirst "\$second_url"\n',
    { name: "bad\u001b[2J.sh" },
  );
  const plain = renderTerminal(report, { color: false });
  const colored = renderTerminal(report, { color: true });
  assert(!plain.includes("\u001b"));
  assertStringIncludes(plain, "\\u001b");
  assertStringIncludes(plain, "https://example.com/");
  assertStringIncludes(plain, '"$second_url"');
  assert(!colored.includes("\u001b[2J"));
});

Deno.test("sudo and privilege steps are highlighted only when color is enabled", async () => {
  const withSudo = await analyze(
    "sudo apt-get update\nsudo install -m 755 a /usr/local/bin/a\n",
    { name: "priv.sh" },
  );
  const plain = renderTerminal(withSudo, { color: false, verbose: true });
  const colored = renderTerminal(withSudo, { color: true, verbose: true });
  assert(!plain.includes("\u001b["));
  assertStringIncludes(colored, "\u001b[1;31mWith sudo\u001b[0m");
  assertStringIncludes(colored, "\u001b[1;31msudo\u001b[0m");

  const withoutSudo = await analyze("echo hi\n", { name: "plain.sh" });
  const coloredNoSudo = renderTerminal(withoutSudo, { color: true });
  assertStringIncludes(
    coloredNoSudo,
    "No sudo, doas, su, or pkexec use was found.",
  );
  assert(!coloredNoSudo.includes("\u001b[1;31msudo\u001b[0m"));
});

Deno.test("japanese locale renders localized summary, flow, and sudo highlight", async () => {
  const withSudo = await analyze(
    "sudo apt-get update\nsudo install -m 755 a /usr/local/bin/a\n",
    { name: "priv.sh", locale: "ja" },
  );
  const plain = renderTerminal(withSudo, { color: false, verbose: true });
  const colored = renderTerminal(withSudo, { color: true, verbose: true });
  assertStringIncludes(plain, "要約");
  assertStringIncludes(plain, "処理の流れ");
  assertStringIncludes(plain, "詳細な流れ");
  assertStringIncludes(plain, "sudo で apt-get によりパッケージ一覧を更新。");
  assert(!plain.includes("\u001b["));
  assertStringIncludes(colored, "\u001b[1;31msudo で\u001b[0m");

  const withoutSudo = await analyze("echo hi\n", {
    name: "plain.sh",
    locale: "ja",
  });
  const coloredNoSudo = renderTerminal(withoutSudo, { color: true });
  assertStringIncludes(
    coloredNoSudo,
    "sudo / doas / su / pkexec の使用は検出されませんでした。",
  );
  assert(!coloredNoSudo.includes("\u001b[1;31msudo"));
});

Deno.test("json renderer is the report", async () => {
  const report = await analyze('PREFIX="${PREFIX:-/usr/local}"\n', {
    name: "env.sh",
  });
  const rendered = renderJson(report);
  assert(rendered.endsWith("\n"));
  assertEqualsReport(JSON.parse(rendered), report);
});

function assertEqualsReport(left: unknown, right: unknown): void {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error("JSON renderer changed the report");
  }
}
