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
  assertStringIncludes(plain, "platforms");
  assertStringIncludes(plain, "No installer actions matched");
  assert(!plain.includes("\u001b["));
  assert(colored.includes("\u001b["));
  assertStringIncludes(colored, "risk:");
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
