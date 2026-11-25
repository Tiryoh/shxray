import type {
  AnalysisReport,
  Evidence,
  FlowStep,
  Locale,
  Severity,
} from "../analyze/types.ts";
import { escapeControls } from "./escape.ts";

export interface TerminalOptions {
  color?: boolean;
  /** Include the detailed flow and per-category list after the summary flow. */
  verbose?: boolean;
  /** Display language. Defaults to `report.locale ?? "en"`. */
  locale?: Locale;
}

interface Labels {
  summary: string;
  flow: string;
  flowEntry: (entry: string) => string;
  details: string;
  detailedFlow: string;
  platforms: string;
  operatingSystems: string;
  architectures: string;
  detections: string;
  values: string;
  options: string;
  takesValue: string;
  environment: string;
  noDefault: string;
  defaultLabel: (value: string) => string;
  installPaths: string;
  modeLabel: (mode: string) => string;
  privilege: string;
  network: string;
  downloads: string;
  integrity: string;
  sideEffects: string;
  notes: string;
  none: string;
  urlNotResolved: string;
  atLine: (line: number) => string;
  parseErrorAt: (line: number | null, column: number | null) => string;
  footerStatic: string;
  footerOmitted: string;
}

const LABELS: Record<Locale, Labels> = {
  en: {
    summary: "Summary",
    flow: "Flow",
    flowEntry: (entry) => ` (entry: ${entry})`,
    details: "Details",
    detailedFlow: "detailed flow",
    platforms: "platforms",
    operatingSystems: "operating systems",
    architectures: "architectures",
    detections: "detections",
    values: "values",
    options: "options",
    takesValue: "takes a value",
    environment: "environment",
    noDefault: "no default detected",
    defaultLabel: (value) => `default ${value}`,
    installPaths: "install paths",
    modeLabel: (mode) => `mode ${mode}`,
    privilege: "privilege",
    network: "network",
    downloads: "downloads",
    integrity: "integrity",
    sideEffects: "side effects",
    notes: "notes",
    none: "none",
    urlNotResolved: "(url not resolved)",
    atLine: (line) => `line ${line}`,
    parseErrorAt: (line, column) =>
      line ? `line ${line}, column ${column ?? 1}` : "unknown position",
    footerStatic:
      "Static analysis only; the script was not executed. Branches are listed, not chosen.",
    footerOmitted:
      "Details omitted. Use --verbose for the detailed flow and per-category list.",
  },
  ja: {
    summary: "要約",
    flow: "処理の流れ",
    flowEntry: (entry) => `（入口: ${entry}）`,
    details: "詳細",
    detailedFlow: "詳細な流れ",
    platforms: "対応プラットフォーム",
    operatingSystems: "OS",
    architectures: "アーキテクチャ",
    detections: "検出箇所",
    values: "値",
    options: "オプション",
    takesValue: "値あり",
    environment: "環境変数",
    noDefault: "デフォルト未検出",
    defaultLabel: (value) => `既定 ${value}`,
    installPaths: "インストール先・書き込み先",
    modeLabel: (mode) => `mode ${mode}`,
    privilege: "権限",
    network: "ネットワーク",
    downloads: "ダウンロード",
    integrity: "整合性検証",
    sideEffects: "副作用・注意点",
    notes: "補足",
    none: "なし",
    urlNotResolved: "(URL 未解決)",
    atLine: (line) => `${line}行目`,
    parseErrorAt: (line, column) =>
      line ? `${line}行目 ${column ?? 1}列目` : "位置不明",
    footerStatic:
      "静的解析のみ（スクリプトは実行していません）。分岐は選択せず候補を列挙しています。",
    footerOmitted:
      "詳細は省略しています。詳細な流れとカテゴリ別一覧は --verbose で表示できます。",
  },
};

export function renderTerminal(
  report: AnalysisReport,
  options: TerminalOptions = {},
): string {
  const locale: Locale = options.locale ?? report.locale ?? "en";
  const t = LABELS[locale];
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
      const where = t.parseErrorAt(error.line, error.column);
      lines.push(`  ${where}  ${safe(error.message)}`);
    }
  }
  lines.push(`risk: ${paint.risk(report.summary.risk, report.summary.risk)}`);
  lines.push("");

  lines.push(paint.bold(t.summary));
  for (const sentence of report.summary.sentences) {
    lines.push(`  ${paint.summaryLine(safe(sentence))}`);
  }
  lines.push("");

  const flowTitle = report.flow.entry
    ? `${paint.bold(t.flow)}${t.flowEntry(safe(report.flow.entry))}`
    : paint.bold(t.flow);
  lines.push(flowTitle);
  if (report.flow.note) lines.push(`  ${safe(report.flow.note)}`);
  if (report.flow.steps.length === 0) lines.push(`  ${t.none}`);
  pushCompactSteps(lines, report.flow.steps, "  ", paint);
  lines.push("");
  lines.push(t.footerStatic);
  if (!options.verbose) {
    lines.push(t.footerOmitted);
    lines.push("");
    return lines.join("\n");
  }
  lines.push("");
  lines.push(paint.bold(t.details));
  lines.push("");

  if (report.flow.detailed && report.flow.detailed.length > 0) {
    lines.push(paint.bold(t.detailedFlow));
    pushDetailedSteps(lines, report.flow.detailed, "  ", paint);
    lines.push("");
  }

  lines.push(paint.bold(t.platforms));
  lines.push(
    `  ${t.operatingSystems}: ${
      list(report.platforms.operatingSystems, t.none)
    }`,
  );
  lines.push(
    `  ${t.architectures}: ${list(report.platforms.architectures, t.none)}`,
  );
  lines.push(`  ${t.detections}:`);
  if (report.platforms.detections.length === 0) {
    lines.push(`    ${t.none}`);
  } else {
    for (const detection of report.platforms.detections) {
      const values = detection.values.length > 0
        ? `  ${t.values} ${detection.values.map(safe).join(", ")}`
        : "";
      lines.push(
        `    - ${
          at(detection.evidence, t)
        }  ${detection.kind}  ${detection.category}  ${
          safe(detection.subject)
        }${values}`,
      );
    }
  }
  lines.push("");

  lines.push(paint.bold(t.options));
  if (report.interface.options.length === 0) lines.push(`  ${t.none}`);
  for (const option of report.interface.options) {
    const value = option.takesValue ? `  ${t.takesValue}` : "";
    lines.push(
      `  - ${at(option.evidence, t)}  ${
        option.flags.map(safe).join(", ")
      }${value}`,
    );
  }
  lines.push("");

  lines.push(paint.bold(t.environment));
  if (report.interface.environment.length === 0) lines.push(`  ${t.none}`);
  for (const variable of report.interface.environment) {
    const fallback = variable.defaultValue === null
      ? t.noDefault
      : t.defaultLabel(
        variable.defaultValue === "" ? '""' : safe(variable.defaultValue),
      );
    lines.push(
      `  - ${at(variable.evidence, t)}  ${
        safe(variable.name)
      }  ${fallback}  ${variable.origin}`,
    );
  }
  lines.push("");

  lines.push(paint.bold(t.installPaths));
  if (report.installs.length === 0) lines.push(`  ${t.none}`);
  for (const install of report.installs) {
    const mode = install.mode ? `  ${t.modeLabel(safe(install.mode))}` : "";
    lines.push(
      `  - ${at(install.evidence, t)}  ${install.action}  ${
        safe(install.destination)
      }${mode}`,
    );
  }
  lines.push("");

  lines.push(paint.bold(t.privilege));
  if (report.privileges.length === 0) lines.push(`  ${t.none}`);
  for (const privilege of report.privileges) {
    const kind = privilege.kind === "root-check"
      ? privilege.kind
      : paint.privilege(privilege.kind);
    lines.push(
      `  - ${at(privilege.evidence, t)}  ${kind}  ${safe(privilege.detail)}`,
    );
  }
  lines.push("");

  lines.push(paint.bold(t.network));
  lines.push(`  ${t.downloads}:`);
  if (report.network.downloads.length === 0) lines.push(`    ${t.none}`);
  for (const download of report.network.downloads) {
    lines.push(
      `    - ${at(download.evidence, t)}  ${download.tool}  ${
        downloadTarget(download, t)
      }`,
    );
  }
  lines.push(`  ${t.integrity}:`);
  if (report.network.integrity.length === 0) lines.push(`    ${t.none}`);
  for (const check of report.network.integrity) {
    lines.push(
      `    - ${at(check.evidence, t)}  ${safe(check.tool)}  ${
        safe(check.detail)
      }`,
    );
  }
  lines.push("");

  lines.push(paint.bold(t.sideEffects));
  if (report.sideEffects.length === 0) lines.push(`  ${t.none}`);
  for (const effect of report.sideEffects) {
    lines.push(
      `  - ${at(effect.evidence, t)}  ${
        paint.risk(effect.severity, effect.severity)
      }  ${effect.kind}  ${safe(effect.detail)}`,
    );
  }
  lines.push("");

  lines.push(paint.bold(t.notes));
  for (const note of report.notes) lines.push(`  - ${note}`);
  lines.push("");
  return lines.join("\n");
}

function pushCompactSteps(
  lines: string[],
  steps: FlowStep[],
  indent: string,
  paint: Theme,
): void {
  steps.forEach((step, index) => {
    lines.push(`${indent}${index + 1}. ${paint.flowLine(safe(step.text))}`);
    if (step.unresolved) lines.push(`${indent}   ${safe(step.unresolved)}`);
    for (const child of step.children) {
      lines.push(`${indent}   - ${paint.flowLine(safe(child.text))}`);
      if (child.unresolved) {
        lines.push(`${indent}     ${safe(child.unresolved)}`);
      }
    }
  });
}

function pushDetailedSteps(
  lines: string[],
  steps: FlowStep[],
  indent: string,
  paint: Theme,
): void {
  steps.forEach((step, index) => {
    lines.push(`${indent}${index + 1}. ${paint.flowLine(safe(step.text))}`);
    if (step.unresolved) lines.push(`${indent}   ${safe(step.unresolved)}`);
    if (step.children.length > 0) {
      pushDetailedSteps(lines, step.children, `${indent}   `, paint);
    }
  });
}

function downloadTarget(
  download: AnalysisReport["network"]["downloads"][number],
  t: Labels,
): string {
  const parts = [...download.urls, ...download.references];
  if (parts.length === 0) return t.urlNotResolved;
  return parts.map(safe).join(" ");
}

function safe(text: string): string {
  return escapeControls(text);
}

function list(values: string[], noneText: string): string {
  return values.length > 0 ? values.join(", ") : noneText;
}

function at(evidence: Evidence, t: Labels): string {
  return t.atLine(evidence.line);
}

interface Theme {
  bold: (text: string) => string;
  risk: (severity: Severity, text: string) => string;
  privilege: (text: string) => string;
  flowLine: (text: string) => string;
  summaryLine: (text: string) => string;
}

const PRIVILEGE_STEP_CHECK =
  /\b(?:With|with) (?:sudo|doas|su|pkexec)\b|\b(?:sudo|doas|pkexec)\b|\b(?:sudo|doas|su|pkexec)(?:・(?:sudo|doas|su|pkexec))*\s*で/;
const PRIVILEGE_STEP_TOKEN =
  /\b(?:(?:With|with) (?:sudo|doas|su|pkexec)(?: and (?:sudo|doas|su|pkexec))*\b|(?:sudo|doas|su|pkexec)(?:・(?:sudo|doas|su|pkexec))*\s*で|(?:sudo|doas|pkexec)\b)/g;
const PRIVILEGE_SUMMARY_NEG =
  /^(?:No |sudo \/ doas \/ su \/ pkexec の使用は検出されませんでした)/;
const PRIVILEGE_SUMMARY_TOKEN =
  /\b(?:sudo|doas|pkexec)\b|(?<=with )su\b|\bsu(?=\s*で)/g;

function theme(color: boolean): Theme {
  if (!color) {
    return {
      bold: identity,
      risk: (_severity, text) => text,
      privilege: identity,
      flowLine: identity,
      summaryLine: identity,
    };
  }
  const highlightToken = (text: string) => ansi("1;31", text);
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
    privilege: highlightToken,
    flowLine: (text) => {
      if (!PRIVILEGE_STEP_CHECK.test(text)) return text;
      const highlighted = text.replace(
        PRIVILEGE_STEP_TOKEN,
        (match) => `\u001b[0m${highlightToken(match)}\u001b[33m`,
      );
      return `\u001b[33m${highlighted}\u001b[0m`;
    },
    summaryLine: (text) => {
      if (PRIVILEGE_SUMMARY_NEG.test(text)) return text;
      return text.replace(PRIVILEGE_SUMMARY_TOKEN, highlightToken);
    },
  };
}

function ansi(code: string, text: string): string {
  return `\u001b[${code}m${text}\u001b[0m`;
}

function identity(text: string): string {
  return text;
}
