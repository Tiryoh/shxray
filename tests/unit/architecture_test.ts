import { assert, assertEquals } from "@std/assert";

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

Deno.test("tooling does not download the installer fixtures", async () => {
  const root = new URL("../../", import.meta.url).pathname;
  const hits: string[] = [];
  for (
    const relative of ["src", "tests", "deno.json", ".github", "README.md"]
  ) {
    await scanForFixtureFetches(`${root}${relative}`, hits);
  }
  assertEquals(hits, []);
});

async function scanForFixtureFetches(
  path: string,
  hits: string[],
): Promise<void> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  if (info.isDirectory) {
    for await (const entry of Deno.readDir(path)) {
      if (entry.name === "fixtures") continue;
      await scanForFixtureFetches(`${path}/${entry.name}`, hits);
    }
    return;
  }
  if (!/\.(ts|json|yml|yaml|md)$/.test(path)) return;
  const lines = (await Deno.readTextFile(path)).split("\n");
  const fetch =
    /(?:curl|wget|fetch)\b[^\n]*(?:mise\.run|get-ros2\.com|astral\.sh\/uv|sh\.rustup\.rs|nvm-sh\/nvm|get\.docker\.com|Homebrew\/install)/;
  for (const [index, line] of lines.entries()) {
    if (fetch.test(line)) hits.push(`${path}:${index + 1}`);
  }
}
