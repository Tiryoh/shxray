#!/usr/bin/env python3
"""Generate third-party notices for the Rust crates linked by Deno.

Reads one or more `cargo metadata --format-version 1` JSON documents for the
Deno workspace and walks the normal-dependency closure of the `deno` package
(cli/Cargo.toml). Dev-dependencies and build-dependencies are not followed.
The same crate version reached on any input platform is listed once, with the
platforms that reached it.

Copyright lines are copied from LICENSE/COPYING/NOTICE files in each crate.
This script does not invent a copyright line when those files have none.

Example (from a Deno v2.9.8 checkout, after `cargo +1.95.0 metadata`):

  python3 tools/generate_deno_crate_notices.py \
    --metadata /tmp/meta-x86_64-unknown-linux-gnu.json:x86_64-unknown-linux-gnu \
    --metadata /tmp/meta-aarch64-unknown-linux-gnu.json:aarch64-unknown-linux-gnu \
    --metadata /tmp/meta-x86_64-apple-darwin.json:x86_64-apple-darwin \
    --metadata /tmp/meta-aarch64-apple-darwin.json:aarch64-apple-darwin \
    --metadata /tmp/meta-x86_64-pc-windows-msvc.json:x86_64-pc-windows-msvc \
    --deno-tag v2.9.8 \
    --output docs/third_party/deno-2.9.8-crate-notices.md
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

COMMENT_PREFIXES = ("///", "//", "/*", "*/", "*", "#")
TEMPLATE_MARKERS = (
    "[yyyy]",
    "[year]",
    "[name of copyright owner]",
    "{yyyy}",
    "{name of copyright owner}",
)
LICENSE_NAME = re.compile(
    r"^(license|licence|copying|notice|unlicense|copyright)([-.].*)?$",
    re.IGNORECASE,
)
# A copyright notice, not a sentence in the Apache license body that merely
# starts with the word "copyright" after line wrapping.
COPYRIGHT_LINE = re.compile(
    r"^copyright(?:\s+\(c\)|\s+©|\s+\d{4}|\s+\{yyyy\}|\s+\[yyyy\])",
    re.IGNORECASE,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--metadata",
        action="append",
        required=True,
        help="PATH:TARGET_TRIPLE from `cargo metadata --filter-platform TARGET_TRIPLE`",
    )
    parser.add_argument("--deno-tag", default="v2.9.8")
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def load_metadata(spec: str) -> tuple[dict, str]:
    path, triple = spec.split(":", 1)
    with open(path, encoding="utf-8") as handle:
        return json.load(handle), triple


def normal_deps(node: dict) -> list[str]:
    found: list[str] = []
    for dep in node.get("deps", []):
        kinds = {(item.get("kind") or "normal") for item in dep.get("dep_kinds", [])}
        if "normal" in kinds:
            found.append(dep["pkg"])
    return found


def closure(metadata: dict) -> set[str]:
    packages = {pkg["id"]: pkg for pkg in metadata["packages"]}
    nodes = {node["id"]: node for node in metadata["resolve"]["nodes"]}
    root = next(
        pkg["id"]
        for pkg in packages.values()
        if pkg["name"] == "deno" and pkg["manifest_path"].endswith("/cli/Cargo.toml")
    )
    seen: set[str] = set()
    stack = [root]
    while stack:
        pkg_id = stack.pop()
        if pkg_id in seen:
            continue
        seen.add(pkg_id)
        node = nodes.get(pkg_id)
        if node is None:
            continue
        for dep_id in normal_deps(node):
            if dep_id not in seen:
                stack.append(dep_id)
    return seen


def strip_comment(line: str) -> str:
    text = line.strip()
    changed = True
    while changed and text:
        changed = False
        for prefix in COMMENT_PREFIXES:
            if text.startswith(prefix):
                text = text[len(prefix) :].strip()
                changed = True
                break
    return text


def copyright_lines(text: str) -> list[str]:
    found: list[str] = []
    for raw in text.splitlines():
        line = strip_comment(raw)
        if not COPYRIGHT_LINE.match(line):
            continue
        lowered = line.lower()
        if any(marker in lowered for marker in TEMPLATE_MARKERS):
            continue
        if line not in found:
            found.append(line)
    return found


def license_files(crate_dir: Path, license_file: str | None) -> list[Path]:
    found: list[Path] = []
    if not crate_dir.is_dir():
        return found
    for entry in sorted(crate_dir.iterdir(), key=lambda item: item.name.lower()):
        if not entry.is_file():
            continue
        if LICENSE_NAME.match(entry.name):
            found.append(entry)
    if license_file:
        extra = crate_dir / license_file
        if extra.is_file() and extra not in found:
            found.append(extra)
    return found


def read_text(path: Path) -> str | None:
    data = path.read_bytes()
    if b"\0" in data:
        return None
    if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
        return data.decode("utf-16")
    return data.decode("utf-8", errors="replace")


def upstream_link(pkg: dict, filename: str, deno_tag: str) -> str:
    manifest = Path(pkg["manifest_path"])
    source = pkg.get("source") or ""
    if source.startswith("registry+"):
        return (
            f"https://docs.rs/crate/{pkg['name']}/{pkg['version']}/source/{filename}"
        )
    if source.startswith("path+") or source == "":
        # Workspace path crates live in the Deno checkout.
        try:
            relative = manifest.parent.relative_to(deno_root_from(manifest))
            base = relative.as_posix()
        except ValueError:
            base = manifest.parent.name
        path = f"{base}/{filename}" if base not in ("", ".") else filename
        return f"https://github.com/denoland/deno/blob/{deno_tag}/{path}"
    return source


def deno_root_from(manifest: Path) -> Path:
    # .../deno/cli/Cargo.toml or .../deno/ext/foo/Cargo.toml. The checkout root
    # is the directory that contains cli/Cargo.toml beside the workspace root.
    for parent in manifest.parents:
        if (parent / "cli" / "Cargo.toml").is_file() and (parent / "Cargo.toml").is_file():
            return parent
    return manifest.parent


def short_targets(triples: list[str]) -> str:
    order = [
        "x86_64-unknown-linux-gnu",
        "aarch64-unknown-linux-gnu",
        "x86_64-apple-darwin",
        "aarch64-apple-darwin",
        "x86_64-pc-windows-msvc",
    ]
    if set(triples) == set(order) and len(triples) == len(order):
        return "all five"
    labels = {
        "x86_64-unknown-linux-gnu": "linux-x64",
        "aarch64-unknown-linux-gnu": "linux-arm64",
        "x86_64-apple-darwin": "mac-x64",
        "aarch64-apple-darwin": "mac-arm64",
        "x86_64-pc-windows-msvc": "windows-x64",
    }
    return ", ".join(labels.get(item, item) for item in order if item in triples)


def escape_cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", "<br>")


def main() -> int:
    args = parse_args()
    by_id: dict[str, dict] = {}
    platforms: dict[str, set[str]] = {}
    for spec in args.metadata:
        metadata, triple = load_metadata(spec)
        for pkg in metadata["packages"]:
            by_id.setdefault(pkg["id"], pkg)
        for pkg_id in closure(metadata):
            platforms.setdefault(pkg_id, set()).add(triple)

    rows = []
    missing = []
    texts: dict[str, dict] = {}
    for pkg_id, triples in platforms.items():
        pkg = by_id[pkg_id]
        crate_dir = Path(pkg["manifest_path"]).parent
        files = license_files(crate_dir, pkg.get("license_file"))
        workspace_fallback = False
        if not files and not (pkg.get("source") or "").startswith("registry+"):
            workspace = deno_root_from(crate_dir / "Cargo.toml") / "LICENSE.md"
            if workspace.is_file():
                files = [workspace]
                workspace_fallback = True
        copyrights: list[str] = []
        links: list[str] = []
        file_ids: list[str] = []
        if not files:
            missing.append(pkg)
        for path in files:
            body = read_text(path)
            if body is None:
                missing.append(pkg)
                continue
            digest = hashlib.sha256(body.encode("utf-8")).hexdigest()[:12]
            texts.setdefault(
                digest,
                {"body": body, "name": path.name, "crates": []},
            )
            label = f"{pkg['name']} {pkg['version']}"
            if label not in texts[digest]["crates"]:
                texts[digest]["crates"].append(label)
            file_ids.append(digest)
            for line in copyright_lines(body):
                if line not in copyrights:
                    copyrights.append(line)
            if workspace_fallback:
                links.append(
                    f"https://github.com/denoland/deno/blob/{args.deno_tag}/LICENSE.md"
                )
            else:
                links.append(upstream_link(pkg, path.name, args.deno_tag))
        rows.append(
            {
                "name": pkg["name"],
                "version": pkg["version"],
                "license": pkg.get("license") or "(not declared)",
                "copyrights": copyrights,
                "links": links,
                "targets": short_targets(sorted(triples)),
                "file_ids": file_ids,
                "repository": pkg.get("repository") or "",
                "workspace_fallback": workspace_fallback,
            }
        )

    rows.sort(key=lambda item: (item["name"].lower(), item["version"], item["license"]))
    lines: list[str] = []
    lines.append("# Deno 2.9.8 Rust crate notices")
    lines.append("")
    lines.append(
        "Libraries linked into compiled binaries by the Deno runtime. This list "
        "is relevant only when redistributing `deno compile` binaries. The index "
        "for this directory is [`README.md`](README.md). Source this repository "
        "embeds from its own dependency graph is in "
        "[`THIRD_PARTY_LICENSES.md`](../../THIRD_PARTY_LICENSES.md)."
    )
    lines.append("")
    lines.append(
        "Normal-dependency closure of the `deno` package (`cli/Cargo.toml`) at "
        "tag `v2.9.8` (commit `fe7ed012d92c642fd8e5607ac5a45d517538b5c5`). "
        "Generated by `tools/generate_deno_crate_notices.py` from "
        "`cargo metadata --locked --format-version 1 --filter-platform <triple>` "
        "with Rust 1.95.0, the toolchain pinned in that tag's `rust-toolchain.toml`."
    )
    lines.append("")
    lines.append("Platforms unioned here:")
    lines.append("")
    lines.append("- `x86_64-unknown-linux-gnu`")
    lines.append("- `aarch64-unknown-linux-gnu`")
    lines.append("- `x86_64-apple-darwin`")
    lines.append("- `aarch64-apple-darwin`")
    lines.append("- `x86_64-pc-windows-msvc`")
    lines.append("")
    lines.append(
        "A crate is listed when a normal dependency edge reaches it on at least "
        "one of those platforms. Dev-dependencies and build-dependencies are not "
        "followed. Proc-macro crates stay in the list when they are normal "
        "dependencies: they run while Deno is compiled and are not linked into "
        "the executable. The `Targets` column is `all five` when every platform "
        "above reaches that crate version."
    )
    lines.append("")
    lines.append(
        "The license expression is the `license` field from the crate's "
        "`Cargo.toml`. Copyright lines are the `Copyright` lines in the crate's "
        "root `LICENSE` / `COPYING` / `NOTICE` files, with a leading comment "
        "marker removed. A line that is only the Apache appendix template "
        "(`Copyright [yyyy] [name of copyright owner]`) is not treated as a "
        "copyright. Crates with no such line say so. Nested trees inside a crate "
        "are not walked; the root license file is what this list copies. Two "
        "exceptions are written up in "
        "[`deno-2.9.8-runtime-notices.md`](deno-2.9.8-runtime-notices.md): "
        "crate `v8` 150.4.0 publishes no `LICENSE*` file, and `libz-sys` 1.1.20 "
        "vendors zlib-ng under `src/zlib-ng` with its own `LICENSE.md`."
    )
    lines.append("")
    lines.append(
        f"{len(rows)} crate versions. {len(missing)} had no readable root license file."
    )
    lines.append("")
    lines.append(
        "| Crate | Version | License | Copyright | Targets | License file |"
    )
    lines.append("| --- | --- | --- | --- | --- | --- |")
    for row in rows:
        if row["copyrights"]:
            shown = row["copyrights"][:4]
            extra = len(row["copyrights"]) - len(shown)
            copyright = "; ".join(shown)
            if extra:
                copyright += f"; and {extra} more in the license file"
        elif row["file_ids"]:
            copyright = "(no copyright line in the license file)"
        else:
            copyright = "(no license file in the crate)"
        if row["workspace_fallback"] and row["copyrights"]:
            copyright += " (workspace LICENSE.md; this crate directory has no license file)"
        if row["links"]:
            link = "<br>".join(f"[`{Path(url).name}`]({url})" for url in row["links"])
        elif row["repository"]:
            link = row["repository"]
        else:
            link = ""
        lines.append(
            "| "
            + " | ".join(
                [
                    escape_cell(row["name"]),
                    escape_cell(row["version"]),
                    escape_cell(row["license"]),
                    escape_cell(copyright),
                    escape_cell(row["targets"]),
                    link,
                ]
            )
            + " |"
        )
    lines.append("")
    lines.append("## License texts")
    lines.append("")
    lines.append(
        "Each distinct license-file body is copied once. The heading is the "
        "SHA-256 prefix of the file bytes."
    )
    lines.append("")
    for digest in sorted(texts, key=lambda item: texts[item]["name"].lower() + item):
        entry = texts[digest]
        users = ", ".join(sorted(entry["crates"])[:8])
        more = len(entry["crates"]) - min(len(entry["crates"]), 8)
        if more > 0:
            users += f", and {more} more"
        lines.append(f"### `{digest}` ({entry['name']})")
        lines.append("")
        lines.append(f"Used by: {users}.")
        lines.append("")
        lines.append("```text")
        lines.append(entry["body"].rstrip("\n"))
        lines.append("```")
        lines.append("")
    if missing:
        lines.append("## Crates with no readable root license file")
        lines.append("")
        seen_missing = set()
        for pkg in sorted(missing, key=lambda item: (item["name"], item["version"])):
            key = (pkg["name"], pkg["version"])
            if key in seen_missing:
                continue
            seen_missing.add(key)
            repo = pkg.get("repository") or "(no repository field)"
            lines.append(
                f"- `{pkg['name']}` {pkg['version']} "
                f"(`license` field: {pkg.get('license') or 'not declared'}; "
                f"repository: {repo})"
            )
        lines.append("")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {args.output} ({len(rows)} crates, {len(texts)} license texts)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
