# Deno runtime notices

These notices cover libraries linked into compiled binaries by the Deno
runtime. They are relevant only when redistributing `deno compile` binaries.
They are not source this repository copies, and they are not the packages
`deno compile` embeds from this project's dependency graph. That second
category is [`THIRD_PARTY_LICENSES.md`](../../THIRD_PARTY_LICENSES.md).

Whether this directory keeps the generated Rust crate list, or a later edit
trims it, is still open. The generator and both outputs stay until that
decision.

| File | What it holds |
| --- | --- |
| [`deno-2.9.8-runtime-notices.md`](deno-2.9.8-runtime-notices.md) | Full texts for V8, the Chromium components rusty_v8 links, zlib-ng inside `libz-sys`, and the TypeScript and Node type files the Deno 2.9.8 runtime embeds |
| [`deno-2.9.8-crate-notices.md`](deno-2.9.8-crate-notices.md) | Generated notices for the Rust crate graph of the `deno` CLI at tag `v2.9.8` |
| [`../../tools/generate_deno_crate_notices.py`](../../tools/generate_deno_crate_notices.py) | The command that regenerates the crate file from `cargo metadata` |

Copyright lines in the table are copied from the license files at the pinned
revisions. A line is included only when that file contains it.

## Summary

| Component | License | Copyright | Upstream |
| --- | --- | --- | --- |
| Deno-authored code 2.9.8 | MIT | `Copyright 2018-2026 the Deno authors` | <https://github.com/denoland/deno/blob/v2.9.8/LICENSE.md> |
| rusty_v8 bindings, crate `v8` 150.4.0 | MIT | `Copyright (c) 2018-2019 the Deno authors` | <https://github.com/denoland/rusty_v8/blob/v150.4.0/LICENSE> |
| V8 15.0.245.2 | BSD-3-Clause | `Copyright 2014, the V8 project authors. All rights reserved.` | <https://github.com/denoland/v8/blob/ac1e23989121713ca642f6650b34deff7b686896/LICENSE> |
| V8 `LICENSE.v8` (same commit) | BSD-3-Clause | `Copyright 2006-2011, the V8 project authors. All rights reserved.` | <https://github.com/denoland/v8/blob/ac1e23989121713ca642f6650b34deff7b686896/LICENSE.v8> |
| Strongtalk-derived assembler in V8 | BSD-3-Clause | `Copyright (c) 1994-2006 Sun Microsystems Inc.` | <https://github.com/denoland/v8/blob/ac1e23989121713ca642f6650b34deff7b686896/src/codegen/x64/assembler-x64.h> |
| ICU 77.1 | Unicode-3.0, plus other notices in the same file | `Copyright © 2016-2025 Unicode, Inc.` | <https://chromium.googlesource.com/chromium/deps/icu/+/ee5f27adc28bd3f15b2c293f726d14d2e336cbd5/LICENSE> |
| Abseil | Apache-2.0 | `Copyright 2017 The Abseil Authors.` and the same form with 2018 and 2023 on the files checked | <https://chromium.googlesource.com/chromium/src/third_party/abseil-cpp/+/d16e32215c3ab90ba57c2e904a5344d85c7353e4/LICENSE> |
| libc++ | Apache-2.0 WITH LLVM-exception, plus legacy NCSA and MIT | `Copyright (c) 2009-2019 by the contributors listed in CREDITS.TXT` and `Copyright (c) 2009-2014 by the contributors listed in CREDITS.TXT` | <https://chromium.googlesource.com/external/github.com/llvm/llvm-project/libcxx.git/+/5abc7f839700f0f17338434e1c1c6a8c87c00c11/LICENSE.TXT> |
| libc++abi | Apache-2.0 WITH LLVM-exception, plus legacy NCSA and MIT | `Copyright (c) 2009-2019 by the contributors listed in CREDITS.TXT` and `Copyright (c) 2009-2014 by the contributors listed in CREDITS.TXT` | <https://chromium.googlesource.com/external/github.com/llvm/llvm-project/libcxxabi.git/+/8f11bb1d4438d0239d0dfc1bd9456a9f31629dda/LICENSE.TXT> |
| simdutf | MIT | `Copyright 2021 The simdutf authors` | <https://chromium.googlesource.com/chromium/src/third_party/simdutf/+/f7356eed293f8208c40b3c1b344a50bd70971983/LICENSE> |
| fp16 | MIT | `Copyright (c) 2017 Facebook Inc.`, `Copyright (c) 2017 Georgia Institute of Technology`, `Copyright 2019 Google LLC` | <https://github.com/Maratyszcza/FP16/blob/3d2de1816307bac63c16a297e8c4dc501b4076df/LICENSE> |
| dragonbox | Apache-2.0 WITH LLVM-exception OR BSL-1.0 | `Copyright 2020-2025 Junekey Jeon` | <https://github.com/jk-jeon/dragonbox/blob/beeeef91cf6fef89a4d4ba5e95d47ca64ccb3a44/include/dragonbox/dragonbox.h> |
| fast_float | MIT OR Apache-2.0 | `Copyright (c) 2021 The fast_float authors` and `Copyright 2021 The fast_float authors` | <https://github.com/fastfloat/fast_float/blob/05087a303dad9c98768b33c829d398223a649bc6/LICENSE-MIT> |
| Highway `libhwy` | Apache-2.0 OR BSD-3-Clause | `Copyright (c) The Highway Project Authors. All rights reserved.` | <https://github.com/google/highway/blob/2607d3b5b0113992fe84d3848859eae13b3b52c1/LICENSE> |
| glibc math subset in V8 | LGPL-2.1 | `Copyright (C) 1991, 1999 Free Software Foundation, Inc.` and, in the sources, `Copyright (C) 2001-2022 Free Software Foundation, Inc.` | <https://github.com/denoland/v8/blob/ac1e23989121713ca642f6650b34deff7b686896/third_party/glibc/LICENSE> |
| inspector protocol (`crdtp`) | BSD-3-Clause | `Copyright 2016 The Chromium Authors` | <https://github.com/denoland/v8/blob/ac1e23989121713ca642f6650b34deff7b686896/third_party/inspector_protocol/LICENSE> |
| halfsiphash | CC0-1.0 | no copyright line in the `LICENSE` file | <https://github.com/denoland/v8/blob/ac1e23989121713ca642f6650b34deff7b686896/third_party/siphash/LICENSE> |
| UTF-8 decoder | MIT | `Copyright (c) 2008-2009 Bjoern Hoehrmann <bjoern@hoehrmann.de>` | <https://github.com/denoland/v8/blob/ac1e23989121713ca642f6650b34deff7b686896/third_party/utf8-decoder/LICENSE> |
| rapidhash | BSD-2-Clause | `Copyright (C) 2024 Nicolas De Carli` | <https://github.com/denoland/v8/blob/ac1e23989121713ca642f6650b34deff7b686896/third_party/rapidhash-v8/LICENSE> |
| Valgrind client header (x64 sources) | BSD-style, this file only | `Copyright (C) 2000-2010 Julian Seward.  All rights reserved.` | <https://github.com/denoland/v8/blob/ac1e23989121713ca642f6650b34deff7b686896/third_party/valgrind/LICENSE> |
| TypeScript 6.0.3 | Apache-2.0 | `Copyright (c) Microsoft Corporation. All rights reserved.` | <https://github.com/denoland/deno/blob/v2.9.8/cli/tsc/00_typescript.js> |
| `@types/node` 24.2.0 | MIT | `Copyright (c) Microsoft Corporation.` | <https://github.com/denoland/deno/blob/v2.9.8/cli/tsc/dts/node/LICENSE> |
| undici-types 7.10.0 | MIT | `Copyright (c) Matteo Collina and Undici contributors` | <https://github.com/denoland/deno/blob/v2.9.8/cli/tsc/dts/node/undici/LICENSE> |
| zlib-ng 2.1.6, inside `libz-sys` 1.1.20 | zlib | `(C) 1995-2013 Jean-loup Gailly and Mark Adler` | <https://docs.rs/crate/libz-sys/1.1.20/source/src/zlib-ng/LICENSE.md> |
| Rust crates of the `deno` CLI | per crate, from `Cargo.toml` | per crate, from that crate's license file | [`deno-2.9.8-crate-notices.md`](deno-2.9.8-crate-notices.md) |

## How this list was made

Deno 2.9.8 (`Cargo.toml` at tag `v2.9.8`) depends on workspace crate `deno_v8`
0.5.0, which depends on crate `v8` 150.4.0 with default features off. The CLI
default feature `v8` turns that dependency on. The workspace `deno_core`
dependency enables `v8_use_custom_libcxx`, and the workspace `v8` dependency
enables `simdutf`. rusty_v8 tag `v150.4.0` is that crate. Its `.gitmodules`
and gitlinks pin the submodules. Its `.gn` sets `v8_use_zlib = false`. Its
`build.rs` sets `use_custom_libcxx` from the cargo feature and sets
`v8_enable_pointer_compression=false` unless that feature is on. Deno 2.9.8
does not enable pointer compression.

Which of those submodules are linked was taken from the GN targets rusty_v8
and V8 actually depend on (`//v8:v8`, `//v8:v8_libbase`, `//v8:v8_libplatform`,
`//v8/third_party/inspector_protocol:crdtp`), not from the submodule list
alone. The official Deno 2.9.8 `x86_64-unknown-linux-gnu` binary was checked
as a second source: it dynamically links glibc, libgcc, libm, libpthread,
librt, and libdl, and its strings include libc++ hardening text, libc++abi
paths, Abseil paths, `icudt77l`, and a `simdutf::` symbol. It does not contain
`PartitionAlloc`, `zlibVersion`, or `third_party/libunwind` paths.

The Rust crate list is the normal-dependency closure of package `deno`
(`cli/Cargo.toml`) in that tag's `Cargo.lock`, unioned across
`x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`,
`x86_64-apple-darwin`, `aarch64-apple-darwin`, and
`x86_64-pc-windows-msvc`. `cargo metadata --locked --format-version 1` was
run with Rust 1.95.0, the channel in Deno's `rust-toolchain.toml`.
Dev-dependencies and build-dependencies are not followed. Proc-macro crates
remain when they are normal dependencies; they are not linked into the
executable. Copyright lines come from each crate's root license file. Nested
trees inside a crate were not walked, except `libz-sys` 1.1.20's
`src/zlib-ng`. Deno's default features enable `__vendored_zlib_ng`, and the
official binary contains the string `1.3.0.zlib-ng` from that copy
(zlib-ng 2.1.6). The crate's own `LICENSE-MIT` and `LICENSE-APACHE` cover the
Rust wrapper, not that `LICENSE.md`. 99 crate versions publish no root license
file; they are listed at the end of the crate notices with the `license` field
and repository, and no copyright line was added for them.

Deno's own tree at v2.9.8 has no third-party notice file and no `deno license`
command. The license files in that tree are `LICENSE.md`,
`ext/webgpu/LICENSE.md` (the same Deno MIT text), `cli/tsc/dts/node/LICENSE`,
and `cli/tsc/dts/node/undici/LICENSE`.

### Vendored by rusty_v8, not linked into this runtime

- Chromium's zlib. `.gitmodules` has no zlib submodule, and `.gn` sets `v8_use_zlib = false`. The binary's `1.3.0.zlib-ng` string is the zlib-ng copy inside `libz-sys`, listed above. Other compression crates (`miniz_oxide`, `fdeflate`, `libdeflater`) are in the crate list.
- partition_alloc. `v8_enable_partition_alloc` requires pointer compression. The feature is off.
- libunwind. `use_custom_libunwind` is true only for Fuchsia and Android. Desktop `deno compile` hosts use the system unwinder.
- llvm-libc. V8's dependency is the `headers` group, which adds an include path and no sources. No `llvm-libc` string was found in the official binary. Whether a libc++ header textually includes llvm-libc code was not traced.
- Wasm C API (`wee8`). `third_party/wasm-api` is a source of the `wee8` target only. rusty_v8 does not link `wee8`. V8's `LICENSE` still mentions it.
- Perfetto (`v8_use_perfetto` defaults to false), VTune (the flags default to false), RE2, jsoncpp, colorama, googletest, jinja2, markupsafe, `build`, `buildtools`, `tools/clang`, and `tools/win`. Those are tests, build tools, or unused in the linked targets.
- The Chromium `third_party/rust` submodule was not unpacked. The binary does contain crates.io `temporal_capi` 0.2.3, which is in the crate list. V8 also has a GN dependency on `//third_party/rust/temporal_capi` when temporal support is on (rusty_v8 turns that on). Whether that submodule is an extra copy was not checked.

### Limits

- Abseil's `LICENSE` has no filled-in copyright line. The years 2017, 2018, and 2023 are from the Abseil files whose paths appear in the official binary, not from every file in the tree.
- `endian.h` and `trig.h` in V8's glibc directory say `Copyright 2022 The Chromium Authors` and point at a BSD-style `LICENSE` file. The `LICENSE` file in that directory is the LGPL-2.1 text. Which text those two headers mean is not settled here.
- The glibc subset is LGPL-2.1 and is statically linked when the V8 build uses Clang, which is rusty_v8's default. The notice copies the license. It does not, by itself, do the rest of what that license asks of a statically linked binary.
- Valgrind's header was confirmed in the x64 source list only.
- Not every V8 assembler file was opened for a Sun copyright line. The ones that were are named in the runtime notices.
- The crate list does not re-audit C or C++ code nested inside a crate (for example `aws-lc-sys` or `ring`) beyond that crate's root license file.

## Deno-authored code (MIT)

The text below is the license of Deno-authored code in Deno 2.9.8, the
version named in the README and used in CI. `deno compile` links the Deno
executable's runtime into the binary. That runtime is the compiler, not a row
in `deno.json` or `deno.lock`. Libraries that runtime links, including V8,
are copied in [`deno-2.9.8-runtime-notices.md`](deno-2.9.8-runtime-notices.md).
`ext/webgpu/LICENSE.md` at the same tag is this same MIT text.

- Upstream: <https://github.com/denoland/deno/blob/v2.9.8/LICENSE.md>
- Copyright: `Copyright 2018-2026 the Deno authors`

```text
MIT License

Copyright 2018-2026 the Deno authors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
