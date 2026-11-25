export type PlatformCategory = "os" | "arch" | "unknown";

const OS_EXACT: Readonly<Record<string, string>> = {
  linux: "linux",
  "gnu/linux": "linux",
  darwin: "darwin",
  macos: "darwin",
  osx: "darwin",
  mac: "darwin",
  freebsd: "freebsd",
  openbsd: "openbsd",
  netbsd: "netbsd",
  dragonfly: "dragonfly",
  windows: "windows",
  mingw: "windows",
  mingw32: "windows",
  mingw64: "windows",
  msys: "windows",
  cygwin: "windows",
  android: "android",
  sunos: "solaris",
  solaris: "solaris",
  aix: "aix",
  illumos: "illumos",
};

const ARCH_EXACT: Readonly<Record<string, string>> = {
  x86_64: "x86_64",
  amd64: "x86_64",
  aarch64: "aarch64",
  arm64: "aarch64",
  arm: "arm",
  armhf: "arm",
  armv6: "arm",
  armv7: "arm",
  armv7l: "arm",
  i386: "i386",
  i486: "i386",
  i586: "i386",
  i686: "i386",
  x86: "i386",
  ppc64le: "ppc64le",
  ppc64: "ppc64",
  s390x: "s390x",
  riscv64: "riscv64",
  mips64: "mips64",
  loongarch64: "loongarch64",
};

export function normalizeOsToken(raw: string): string | null {
  const core = coreToken(raw);
  if (!core) return null;
  if (core.startsWith("linux")) return "linux";
  if (core.startsWith("darwin")) return "darwin";
  if (
    core.startsWith("mingw") || core.startsWith("msys") ||
    core.startsWith("cygwin")
  ) {
    return "windows";
  }
  return OS_EXACT[core] ?? null;
}

export function normalizeArchToken(raw: string): string | null {
  const core = coreToken(raw);
  if (!core) return null;
  if (core.startsWith("armv")) return "arm";
  return ARCH_EXACT[core] ?? null;
}

export function platformCategoryFromSubject(subject: string): PlatformCategory {
  const text = subject.toLowerCase();
  if (text.includes("uname")) {
    const arch = /(?:^|[\s"'`$({-])-[a-z]*m\b|--machine/.test(text);
    const os = /(?:^|[\s"'`$({-])-[a-z]*[so]\b|--kernel-name|--operating-system/
      .test(
        text,
      );
    if (arch && !os) return "arch";
    if (os && !arch) return "os";
    return "unknown";
  }
  if (/ostype|host_os|os_name|kernel/.test(text) || /\$\{?os\b/.test(text)) {
    return "os";
  }
  if (/\$\{?arch\b|machine|\bcpu\b/.test(text)) return "arch";
  return "unknown";
}

export function subjectLooksLikePlatform(subject: string): boolean {
  const text = subject.toLowerCase();
  return /uname|ostype|host_os|os_name/.test(text) ||
    /\$\{?os\b/.test(text) ||
    /\$\{?arch\b/.test(text);
}

/** Category of a `uname` invocation from its flags. Bare `uname` is the OS. */
export function unameCategory(args: readonly string[]): PlatformCategory {
  let letters = "";
  for (const arg of args) {
    if (arg === "--machine") letters += "m";
    else if (arg === "--kernel-name") letters += "s";
    else if (arg === "--operating-system") letters += "o";
    else if (arg === "--all" || arg === "-a") letters += "a";
    else if (/^-[A-Za-z]+$/.test(arg)) letters += arg.slice(1);
  }
  if (letters.includes("a")) return "unknown";
  const arch = letters.includes("m");
  const os = letters.includes("s") || letters.includes("o");
  if (arch && os) return "unknown";
  if (arch) return "arch";
  return "os";
}

export function unameCategoryFromInvocation(text: string): PlatformCategory {
  return unameCategory(text.match(/--[A-Za-z-]+|-[A-Za-z]+/g) ?? []);
}

export function mergePlatformCategory(
  left: PlatformCategory,
  right: PlatformCategory,
): PlatformCategory {
  return left === right ? left : "unknown";
}

function coreToken(raw: string): string {
  let text = raw.trim().toLowerCase();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }
  text = text.replace(/^\*+/, "").replace(/\*+$/, "");
  const bracket = text.indexOf("[");
  if (bracket !== -1) text = text.slice(0, bracket);
  return text;
}
