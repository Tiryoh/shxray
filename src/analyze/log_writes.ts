import { extractVarRefs } from "./bindings.ts";
import { unquote } from "./words.ts";

/**
 * Log-file writes are noise in `installs[]`, not install destinations.
 *
 * A write or append destination matches when any of the following is true
 * after one layer of quotes is removed:
 *
 * 1. A referenced variable has a log component. The name is split on `_`,
 *    `-`, and camelCase boundaries (`stepLog` → `step` + `Log`). A component
 *    is a log component when it is `log`, `logs`, `logfile`, `logdir`, or
 *    `logpath` (any case). `LOG_FILE`, `STEP_LOG`, and `logfile` match.
 *    `CATALOG`, `LOGICAL`, and `LOGNAME` do not.
 * 2. The basename ends with `.log` (any case), or is itself `log` / `logs` /
 *    `logfile` / `logdir` / `logpath`.
 * 3. An earlier path component is `log` or `logs` (any case), so
 *    `/var/log/syslog` matches.
 *
 * This looks at the path as written. It does not resolve variables, and it
 * does not apply to `install` / `cp` / `mv` / `ln` / `mkdir` (a binary named
 * `logtool` can still be an install).
 */
const LOG_COMPONENT = /^(log|logs|logfile|logdir|logpath)$/i;

export function isLogWriteDestination(destination: string): boolean {
  const text = unquote(destination).trim();
  if (text.length === 0) return false;
  for (const name of extractVarRefs(text)) {
    if (variableNameIsLog(name)) return true;
  }
  const parts = text.split(/[/\\]+/).filter((part) =>
    part.length > 0 && part !== "." && part !== ".."
  );
  if (parts.length === 0) return false;
  const basename = stripParam(parts[parts.length - 1] ?? "");
  if (LOG_COMPONENT.test(basename) || /\.log$/i.test(basename)) return true;
  for (const part of parts.slice(0, -1)) {
    if (LOG_COMPONENT.test(stripParam(part))) return true;
  }
  return false;
}

function variableNameIsLog(name: string): boolean {
  const split = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  return split.split(/[_\-]/).some((part) => LOG_COMPONENT.test(part));
}

function stripParam(part: string): string {
  const match = part.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (match?.[1]) return match[1];
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(part)) return part.slice(1);
  return part;
}
