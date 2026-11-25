# shxray

Inspect a shell installer script without running it.

`shxray` replaces the shell in `curl -fsSL https://example.com/install.sh | bash`.
It parses POSIX sh / Bash with [`sh-syntax`](https://github.com/un-ts/sh-syntax)
(the Wasm build of [`mvdan/sh`](https://github.com/mvdan/sh)) and prints what the
script would do: supported OS and CPU architectures, flags and environment
variables, install paths, privilege escalation, downloads, checksums, and
risky patterns such as `eval`, `curl | sh`, and `rm -rf`.

The script is never executed.

## Usage

```bash
curl -fsSL https://example.com/install.sh | shxray
cat install.sh | shxray
shxray path/to/install.sh
shxray --json path/to/install.sh
```

With no file argument, `shxray` reads stdin. If stdin is a terminal, it prints
help instead of waiting for a script.

## Install

From a clone of this repository:

```bash
deno install --allow-read --allow-env -n shxray src/main.ts
```

Run without installing:

```bash
deno run --allow-read --allow-env src/main.ts path/to/install.sh
```

Single binary (see [deno compile](#deno-compile)):

```bash
deno task compile
./dist/shxray path/to/install.sh
```

## Options

| Flag | Description |
| --- | --- |
| `--json` | Print the versioned analysis report as JSON |
| `--plain`, `--no-color` | Plain text. Also implied when stdout is not a terminal, or when `NO_COLOR` is set to a non-empty value |
| `--bash` | Parse as Bash (default) |
| `--posix` | Parse as POSIX sh |
| `-h`, `--help` | Show help |
| `-V`, `--version` | Show the version |

Exit codes: `0` analysis finished, `1` usage or I/O error, `2` the script did not parse.
A parse error still prints a report (`parse.ok: false`) and extracts no facts.

Color is used only when stdout is a terminal. There is no full-screen interface:
stdin is reserved for the script.

## Report

`--json` prints an `AnalysisReport` (`version: 1`). Top-level fields:

- `source` — name, size, line count, shebang
- `parse` — language variant and the first syntax error, if any
- `summary` — `info` / `low` / `medium` / `high`, plus a one-line headline
- `platforms` — normalized OS and architecture names, and the `uname`, `case`, `$OSTYPE`, and `uname`-derived comparisons that produced them
- `interface` — CLI flags and environment variables, with defaults when they are written as literals or `${VAR:-default}` / `${VAR:=default}`
- `installs` — destinations of `install`, `cp`, `mv`, `ln`, `mkdir`, `tee`, and file redirects other than standard streams and `/dev/null`
- `privileges` — `sudo`, `doas`, `su`, `pkexec`, and root checks (`id -u`, `$EUID`)
- `network` — download tools, literal URLs, URL arguments left as written, and checksum or signature commands
- `sideEffects` — `eval`, pipes into a shell, `sh -c`, recursive `rm`, package managers, shell rc edits, insecure downloads, permissive `chmod`
- `notes` — limits of this static pass

The analyzer returns this object and does not render it. A future HTML view can
read the same JSON. See `src/analyze/types.ts`.

## Development

Requires Deno 2.9 or newer.

```bash
deno task check
deno task lint
deno fmt --check
deno task test
deno task test:unit
deno task test:e2e
deno task compile
deno task compile:smoke
```

`deno task test` runs unit tests, CLI tests (stdin and file, `--json` and text),
and a `deno compile` smoke test. The mise and get-ros2 fixtures under
`tests/fixtures/` are local files. Tests read them and do not download them.

## `deno compile`

Verified with Deno 2.9.8:

```bash
deno compile --allow-read --allow-env --output dist/shxray src/main.ts
```

No extra `--include` flag is required. The default compile embeds the
`sh-syntax` npm package, including `main.wasm` (about 4 MiB), in the binary's
virtual filesystem (`.deno_compile_node_modules`). The smoke test runs that
binary from `/tmp` against `tests/fixtures/installer.sh`.

Caveats:

- The executable is about 105 MiB on Linux x86_64 (Deno 2.9.8) because it
  contains the Deno runtime. The embedded files are about 4.3 MiB, almost all
  of which is `sh-syntax` and `main.wasm`.
- Do not pass `--bundle`. That experimental mode keeps the JavaScript and drops
  `main.wasm`. The process then fails at startup with `ENOENT` while opening
  `main.wasm` (observed as `/tmp/main.wasm`).
- `--allow-read` is required for file arguments. `--allow-env` lets the binary
  honor `NO_COLOR`. The tool does not use the network, and it does not fetch
  the URLs it reports.
- Wasm is instantiated on startup. One process parses with a single runtime.

## Scope and limitations

- Static analysis only. Nothing in the input is executed, including command
  substitutions.
- Bash is the default. `--posix` selects POSIX sh. Zsh is not supported.
- Every branch and function body is inspected. Unreachable code still appears.
- Values produced by command substitution, indirect expansion, or the
  environment outside the script are not resolved. A default is reported only
  when it is a literal assignment used once, or a `${VAR:-default}` /
  `${VAR:=default}` expansion.
- OS and architecture tokens are normalized (`amd64` and `arm64` become
  `x86_64` and `aarch64`). The detections list keeps the script's spelling.
  Names come from `uname` (`-s`, `-o`, `-m`), from `case` and `[` comparisons
  on variables assigned from `uname`, and from `$OSTYPE`. Echoed labels such
  as `macos` or `x64` are not scraped. A later assignment that does not call
  `uname` does not drop the earlier mark.
- Redirects to stderr, stdout, stdin, `/dev/null`, `/dev/stderr`,
  `/dev/stdout`, or `/dev/fd/N` are not install paths. A redirect such as
  `>> "$HOME/.bashrc"` still is.
- A download URL that is not an absolute `http(s)` literal is reported as
  the argument written in the script (`"$url"`). The variable is not resolved.
  A name assigned more than once is not followed. Literal URLs and written
  operands on the same command are both shown. Only URL operands are
  searched, including `curl --url`.
- Control characters from the script are escaped in the terminal summary and
  in stderr diagnostics, including when color is off.
  A downloader or checksum tool passed as its own argument (`run curl …`) is
  reported. A command hidden inside a quoted string is not.
- Recognition of commands (`curl`, `sudo`, `install`, `rm -rf`, …) is
  heuristic. Unusual wrappers can be missed or over-reported.
- `sh-syntax` stops at the first syntax error and does not return a partial
  tree.
- Heredocs, `eval` of a computed string, and binaries invoked through
  variables other than `$SUDO` are only partly visible.

## Related tools

These tools have different goals. If your use case fits, please check them out
too. shxray is one option for a different purpose: reading an install script
from a file or from stdin, where `bash` would sit in `curl … | bash`, and
reporting its intent (platforms, options, environment variables, install
paths, privilege, network activity, and side effects) before you run it.

- [Tirith](https://tirith.sh/) ([GitHub](https://github.com/sheeki03/tirith))
  intercepts shell commands, pasted content, and scanned files before they
  execute. It looks for homograph URLs, obfuscated payloads, credential
  exfiltration, malicious AI skills and configs, and known-bad packages,
  domains, and IPs from a signed threat-intelligence database.
- [vet](https://github.com/vet-run/vet) is a safety net for `curl | bash`. It
  downloads the remote script, shows what changed since the last time you ran
  that script, lints it with ShellCheck when ShellCheck is installed, and
  asks for your approval before it executes.
- [shellsentry](https://github.com/3leaps/shellsentry) assesses a shell script
  for risky patterns before you execute it. It detects pipe-to-shell, `eval`
  of external input, base64 decode-and-execute, hidden Unicode, and privilege
  escalation, and it can report in text, JSON, or SARIF. Analysis is local.
- [ShellCheck](https://github.com/koalaman/shellcheck) is a static analysis
  tool for bash/sh scripts. It gives warnings and suggestions, with the goals
  of clarifying beginner syntax issues, intermediate semantic problems, and
  subtle pitfalls that can make a working script fail later. Run
  `shellcheck yourscript`, or paste a script on
  [ShellCheck.net](https://www.shellcheck.net).
- [explainshell](https://www.explainshell.com/) matches each argument of a
  command line to the help text in its man page. Write a command on the site
  to see the matching help text.
- [curl-review](https://github.com/ytspar/curl-review) downloads a `curl | sh`
  install script so you can view it with syntax highlighting, and can run an
  AI security review before execution. An interactive shell hook can rewrite
  a pipe-to-shell command into `curl-review` before it runs.

## Acknowledgements

shxray's concept was inspired by
[curl-bash-explain](https://github.com/senko/curl-bash-explain)
([curl-bash-explain.dev](https://curl-bash-explain.dev/)), a web app that
explains a `curl | bash` installer without running it. It fetches the script
and returns a plain-English breakdown of the script's behavior, permissions,
network activity, and potential risks.

## Status

Initial prototype. The report schema is version 1. Adding fields is allowed;
removing or redefining a field bumps the version.

Architecture decisions are in [`docs/adr/`](docs/adr/README.md).
