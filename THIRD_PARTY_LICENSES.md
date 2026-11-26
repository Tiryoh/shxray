# Third-party licenses

Notices for code that `deno compile` embeds in the shxray binary:

```bash
deno compile --allow-read --allow-env --output dist/shxray src/main.ts
```

`deno.lock` pins `npm:sh-syntax@0.8.7`. That package has no further npm
dependencies. The sections below are the license texts copied from the
upstream `LICENSE` files at the locked revisions. `jsr:@std/assert@1.0.19`
and its dependency `jsr:@std/internal@1.0.14` are imported only from `tests/`.
`src/main.ts` does not import them, so they are not in the compiled binary.

## sh-syntax 0.8.7 (MIT)

- Package: `npm:sh-syntax@0.8.7`
- Upstream: <https://github.com/un-ts/sh-syntax/blob/v0.8.7/LICENSE>
- Copyright: `Copyright (c) 2021 UnTS`

`deno compile` embeds this package, including `main.wasm` and
`vendors/wasm_exec.cjs`, in the binary's virtual filesystem.

```text
MIT License

Copyright (c) 2021 UnTS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## mvdan/sh (BSD-3-Clause)

`main.wasm` in sh-syntax 0.8.7 is a Go build whose entrypoint imports
`mvdan.cc/sh/v3/syntax`. sh-syntax v0.8.7 `go.mod` requires
`mvdan.cc/sh/v3 v3.14.1-0.20261114222558-6f0102cc00b2`
(commit `6f0102cc00b2024fdffb1f6b8a15d0d586cd5324`). The printer in that
package also imports `mvdan.cc/sh/v3/fileutil`, which is the same module and
the same license. Those packages use the Go standard library. They do not
import the interpreter and test modules listed in mvdan/sh `go.mod`
(`golang.org/x/sys`, `github.com/google/go-cmp`, and the others).

Source files in `syntax` and `fileutil` carry
`Copyright (c) 2016, Daniel Martí <mvdan@mvdan.cc>` and point at the LICENSE
below.

- Upstream: <https://github.com/mvdan/sh/blob/6f0102cc00b2024fdffb1f6b8a15d0d586cd5324/LICENSE>
- Copyright: `Copyright (c) 2016, Daniel Martí. All rights reserved.`

```text
Copyright (c) 2016, Daniel Martí. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of the copyright holder nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Go code vendored and linked by sh-syntax (BSD-3-Clause)

- Upstream: <https://github.com/golang/go/blob/go1.27.4/LICENSE>
- Copyright: `Copyright 2009 The Go Authors.`

sh-syntax 0.8.7 ships two pieces of Go project code inside the same npm
package, and therefore inside the compiled binary:

- `vendors/wasm_exec.cjs`. Its header is
  `Copyright 2018 The Go Authors. All rights reserved.` and says use of that
  file is governed by the Go LICENSE.
- The Go runtime linked into `main.wasm`. The package `go.mod` declares
  `go 1.27.4`.

```text
Copyright 2009 The Go Authors.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google LLC nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Deno runtime (MIT)

`deno compile` links the Deno runtime into the executable. That runtime is
the compiler, not a row in `deno.json` or `deno.lock`. The text below is the
license of Deno 2.9.8, the version named in the README and used in CI.

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
