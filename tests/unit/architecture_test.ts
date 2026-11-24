import { assert } from "@std/assert";

Deno.test("analyzer modules do not touch the Deno runtime", async () => {
  const directory = new URL("../../src/analyze/", import.meta.url);
  for await (const entry of Deno.readDir(directory)) {
    if (!entry.name.endsWith(".ts")) continue;
    const text = await Deno.readTextFile(new URL(entry.name, directory));
    assert(
      !text.includes("Deno."),
      `${entry.name} imports a runtime API; keep analysis pure`,
    );
  }
});
