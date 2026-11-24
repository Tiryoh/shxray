import type { AnalysisReport, Evidence, Severity } from "../analyze/types.ts";

export interface TerminalOptions {
  color?: boolean;
}

export function renderTerminal(
  report: AnalysisReport,
  options: TerminalOptions = {},
): string {
  const paint = theme(options.color === true);
  const lines: string[] = [];
  lines.push(
    `${paint.bold("shxray")} ${report.tool.version}  ${report.source.name}`,
  );
  if (report.source.shebang) lines.push(`shebang: ${report.source.shebang}`);
  if (report.parse.ok) {
    lines.push(`parse: ok (${report.parse.variant})`);
  } else {
    lines.push(`parse: error (${report.parse.variant})`);
    const error = report.parse.error;
    if (error) {
      const where = error.line
        ? `line ${error.line}, column ${error.column ?? 1}`
        : "unknown position";
      lines.push(`  ${where}  ${error.message}`);
    }
  }
  lines.push(`risk: ${paint.risk(report.summary.risk, report.summary.risk)}`);
  lines.push(report.summary.headline);
  lines.push("");

  lines.push(paint.bold("platforms"));
  lines.push(
    `  operating systems: ${list(report.platforms.operatingSystems)}`,
  );
  lines.push(`  architectures: ${list(report.platforms.architectures)}`);
  lines.push("  detections:");
  if (report.platforms.detections.length === 0) {
    lines.push("    none");
  } else {
    for (const detection of report.platforms.detections) {
      const values = detection.values.length > 0
        ? `  values ${detection.values.join(", ")}`
        : "";
      lines.push(
        `    - ${
          at(detection.evidence)
        }  ${detection.kind}  ${detection.category}  ${detection.subject}${values}`,
      );
    }
  }
  lines.push("");

  lines.push(paint.bold("options"));
  if (report.interface.options.length === 0) lines.push("  none");
  for (const option of report.interface.options) {
    const value = option.takesValue ? "  takes a value" : "";
    lines.push(
      `  - ${at(option.evidence)}  ${option.flags.join(", ")}${value}`,
    );
  }
  lines.push("");

  lines.push(paint.bold("environment"));
  if (report.interface.environment.length === 0) lines.push("  none");
  for (const variable of report.interface.environment) {
    const fallback = variable.defaultValue === null
      ? "no default detected"
      : `default ${
        variable.defaultValue === "" ? '""' : variable.defaultValue
      }`;
    lines.push(
      `  - ${
        at(variable.evidence)
      }  ${variable.name}  ${fallback}  ${variable.origin}`,
    );
  }
  lines.push("");

  lines.push(paint.bold("install paths"));
  if (report.installs.length === 0) lines.push("  none");
  for (const install of report.installs) {
    const mode = install.mode ? `  mode ${install.mode}` : "";
    lines.push(
      `  - ${
        at(install.evidence)
      }  ${install.action}  ${install.destination}${mode}`,
    );
  }
  lines.push("");

  lines.push(paint.bold("privilege"));
  if (report.privileges.length === 0) lines.push("  none");
  for (const privilege of report.privileges) {
    lines.push(
      `  - ${at(privilege.evidence)}  ${privilege.kind}  ${privilege.detail}`,
    );
  }
  lines.push("");

  lines.push(paint.bold("network"));
  lines.push("  downloads:");
  if (report.network.downloads.length === 0) lines.push("    none");
  for (const download of report.network.downloads) {
    const urls = download.urls.length > 0
      ? download.urls.join(" ")
      : "(url not resolved)";
    lines.push(`    - ${at(download.evidence)}  ${download.tool}  ${urls}`);
  }
  lines.push("  integrity:");
  if (report.network.integrity.length === 0) lines.push("    none");
  for (const check of report.network.integrity) {
    lines.push(`    - ${at(check.evidence)}  ${check.tool}  ${check.detail}`);
  }
  lines.push("");

  lines.push(paint.bold("side effects"));
  if (report.sideEffects.length === 0) lines.push("  none");
  for (const effect of report.sideEffects) {
    lines.push(
      `  - ${at(effect.evidence)}  ${
        paint.risk(effect.severity, effect.severity)
      }  ${effect.kind}  ${effect.detail}`,
    );
  }
  lines.push("");

  lines.push(paint.bold("notes"));
  for (const note of report.notes) lines.push(`  - ${note}`);
  lines.push("");
  return lines.join("\n");
}

function list(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function at(evidence: Evidence): string {
  return `line ${evidence.line}`;
}

function theme(color: boolean): {
  bold: (text: string) => string;
  risk: (severity: Severity, text: string) => string;
} {
  if (!color) return { bold: identity, risk: (_severity, text) => text };
  return {
    bold: (text) => ansi("1", text),
    risk: (severity, text) => {
      const code = severity === "high"
        ? "31"
        : severity === "medium"
        ? "33"
        : severity === "low"
        ? "36"
        : "2";
      return ansi(code, text);
    },
  };
}

function ansi(code: string, text: string): string {
  return `\u001b[${code}m${text}\u001b[0m`;
}

function identity(text: string): string {
  return text;
}
