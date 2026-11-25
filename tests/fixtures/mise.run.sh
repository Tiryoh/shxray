#!/bin/sh
# Excerpt of https://mise.run for local shxray tests.
# Fetched: 2026-11-25
# Upstream: https://github.com/jdx/mise (MIT License).
# Trimmed to the OS/arch comparisons, the stderr redirect, and the download
# calls. Tests, tasks, and CI must read this file and must not download it.

set -eu

get_os() {
	os="$(uname -s)"
	if [ "$os" = Darwin ]; then
		echo "macos"
	elif [ "$os" = Linux ]; then
		echo "linux"
	else
		error "unsupported OS: $os"
	fi
}

get_arch() {
	musl=""
	if [ "$(uname -o)" = "Android" ]; then
		musl="-musl"
	fi
	arch="$(uname -m)"
	if [ "$arch" = x86_64 ]; then
		echo "x64$musl"
	elif [ "$arch" = aarch64 ] || [ "$arch" = arm64 ]; then
		echo "arm64$musl"
	elif [ "$arch" = armv7l ]; then
		echo "armv7$musl"
	else
		unsupported_arch "$arch"
	fi
}

download_file() {
	url="$1"
	download_dir="$2"
	filename="$(basename "$url")"
	file="$download_dir/$filename"

	if command -v curl >/dev/null 2>&1; then
		curl -#fLo "$file" "$url" >&2 || return 1
	else
		if command -v wget >/dev/null 2>&1; then
			stderr=$(mktemp)
			if ! wget -O "$file" "$url" >"$stderr" 2>&1; then
				warn "wget failed: $(cat "$stderr")"
				rm -f "$stderr"
				return 1
			fi
			rm "$stderr"
		else
			error "curl or wget is required"
		fi
	fi
	echo "$file"
}

install_mise() {
	os="${MISE_INSTALL_OS:-$(get_os)}"
	arch="${MISE_INSTALL_ARCH:-$(get_arch)}"
	download_dir="${TMPDIR:-/tmp}/mise"
	mkdir -p "$download_dir"
	tarball_url="${MISE_TARBALL_URL:-}"
	file="$(download_file "$tarball_url" "$download_dir")"
	curl -fsSL https://mise.jdx.dev/releases.tsv
	wget -qO- https://mise.jdx.dev/releases.tsv
	mv "$file" "$HOME/.local/bin/mise"
	echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >>"$HOME/.bashrc"
}
