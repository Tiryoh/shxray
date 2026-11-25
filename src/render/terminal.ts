import type {
  AnalysisReport,
  Evidence,
  FlowStep,
  Severity,
} from "../analyze/types.ts";
import { escapeControls } from "./escape.ts";

export interface TerminalOptions {
  color?: boolean;
  /** Include the per-category list after the flow. */
  verbose?: boolean;
}

export function renderTerminal(
  report: AnalysisReport,
  options: TerminalOptions = {},
): string {
  const paint = theme(options.color === true);
  const lines: string[] = [];
  lines.push(
    `${paint.bold("shxray")} ${report.tool.version}  ${
      safe(report.source.name)
    }`,
  );
  if (report.source.shebang) {
    lines.push(`shebang: ${safe(report.source.shebang)}`);
  }
  if (report.parse.ok) {
    lines.push(`parse: ok (${report.parse.variant})`);
  } else {
    lines.push(`parse: error (${report.parse.variant})`);
    const error = report.parse.error;
    if (error) {
      const where = error.line
        ? `line ${error.line}, column ${error.column ?? 1}`
        : "unknown position";
      lines.push(`  ${where}  ${safe(error.message)}`);
    }
  }
  lines.push(`risk: ${paint.risk(report.summary.risk, report.summary.risk)}`);
  lines.push("");

  lines.push(paint.bold("Summary"));
  for (const sentence of report.summary.sentences) {
    lines.push(`  ${safe(sentence)}`);
  }
  lines.push("");

  lines.push(paint.bold("Flow"));
  if (report.flow.note) lines.push(`  ${safe(report.flow.note)}`);
  if (report.flow.steps.length === 0) lines.push("  none");
  pushSteps(lines, report.flow.steps, "  ");
  lines.push("");
  lines.push(
    "Static analysis only; the script was not executed. Branches are listed, not chosen.",
  );
  if (!options.verbose) {
    lines.push("Details omitted. Use --verbose for the per-category list.");
    lines.push("");
    return lines.join("\n");
  }
  lines.push("");
  lines.push(paint.bold("Details"));
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
        ? `  values ${detection.values.map(safe).join(", ")}`
        : "";
      lines.push(
        `    - ${
          at(detection.evidence)
        }  ${detection.kind}  ${detection.category}  ${
          safe(detection.subject)
        }${values}`,
      );
    }
  }
  lines.push("");

  lines.push(paint.bold("options"));
  if (report.interface.options.length === 0) lines.push("  none");
  for (const option of report.interface.options) {
    const value = option.takesValue ? "  takes a value" : "";
    lines.push(
      `  - ${at(option.evidence)}  ${
        option.flags.map(safe).join(", ")
      }${value}`,
    );
  }
  lines.push("");

  lines.push(paint.bold("environment"));
  if (report.interface.environment.length === 0) lines.push("  none");
  for (const variable of report.interface.environment) {
    const fallback = variable.defaultValue === null
      ? "no default detected"
      : `default ${
        variable.defaultValue === "" ? '""' : safe(variable.defaultValue)
      }`;
    lines.push(
      `  - ${at(variable.evidence)}  ${
        safe(variable.name)
      }  ${fallback}  ${variable.origin}`,
    );
  }
  lines.push("");

  lines.push(paint.bold("install paths"));
  if (report.installs.length === 0) lines.push("  none");
  for (const install of report.installs) {
    const mode = install.mode ? `  mode ${safe(install.mode)}` : "";
    lines.push(
      `  - ${at(install.evidence)}  ${install.action}  ${
        safe(install.destination)
      }${mode}`,
    );
  }
  lines.push("");

  lines.push(paint.bold("privilege"));
  if (report.privileges.length === 0) lines.push("  none");
  for (const privilege of report.privileges) {
    lines.push(
      `  - ${at(privilege.evidence)}  ${privilege.kind}  ${
        safe(privilege.detail)
      }`,
    );
  }
  lines.push("");

  lines.push(paint.bold("network"));
  lines.push("  downloads:");
  if (report.network.downloads.length === 0) lines.push("    none");
  for (const download of report.network.downloads) {
    lines.push(
      `    - ${at(download.evidence)}  ${download.tool}  ${
        downloadTarget(download)
      }`,
    );
  }
  lines.push("  integrity:");
  if (report.network.integrity.length === 0) lines.push("    none");
  for (const check of report.network.integrity) {
    lines.push(
      `    - ${at(check.evidence)}  ${safe(check.tool)}  ${safe(check.detail)}`,
    );
  }
  lines.push("");

  lines.push(paint.bold("side effects"));
  if (report.sideEffects.length === 0) lines.push("  none");
  for (const effect of report.sideEffects) {
    lines.push(
      `  - ${at(effect.evidence)}  ${
        paint.risk(effect.severity, effect.severity)
      }  ${effect.kind}  ${safe(effect.detail)}`,
    );
  }
  lines.push("");

  lines.push(paint.bold("notes"));
  for (const note of report.notes) lines.push(`  - ${note}`);
  lines.push("");
  return lines.join("\n");
}

function pushSteps(lines: string[], steps: FlowStep[], indent: string): void {
  steps.forEach((step, index) => {
    lines.push(`${indent}${index + 1}. ${safe(step.text)}`);
    if (step.unresolved) lines.push(`${indent}   ${safe(step.unresolved)}`);
    if (step.children.length > 0) {
      pushSteps(lines, step.children, `${indent}   `);
    }
  });
}

function downloadTarget(
  download: AnalysisReport["network"]["downloads"][number],
): string {
  const parts = [...download.urls, ...download.references];
  if (parts.length === 0) return "(url not resolved)";
  return parts.map(safe).join(" ");
}

function safe(text: string): string {
  return escapeControls(text);
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
