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

Deno.test("verbose terminal output keeps the per-category details", async () => {
  const report = await analyze("echo hi\n", { name: "hi.sh" });
  const verbose = renderTerminal(report, { color: false, verbose: true });
  assertStringIncludes(verbose, "Details");
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
