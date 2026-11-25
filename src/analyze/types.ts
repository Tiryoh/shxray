/**
 * Versioned, JSON-serializable analysis report.
 *
 * Renderers (terminal, future HTML) consume this value and do not feed back
 * into the analyzer. Additive fields may appear without bumping `version`.
 * Removing or redefining a field bumps `version`.
 */
export const REPORT_VERSION = 1 as const;

export type Severity = "info" | "low" | "medium" | "high";

export type ShellVariant = "bash" | "posix";

export type Locale = "en" | "ja";

export interface Evidence {
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
  /** Source line that contains the fact, trimmed to a display length. */
  snippet: string;
}

export interface PlatformDetection {
  kind: "uname" | "ostype" | "case" | "test";
  category: "os" | "arch" | "unknown";
  /** The expression or command the script uses to decide. */
  subject: string;
  /** Pattern or comparison text, as written. */
  values: string[];
  evidence: Evidence;
}

export interface OptionFact {
  flags: string[];
  takesValue: boolean;
  evidence: Evidence;
}

export type EnvOrigin = "parameter-default" | "assignment" | "read";

export interface EnvFact {
  name: string;
  /** Literal or expansion text. Null when no default is visible. */
  defaultValue: string | null;
  origin: EnvOrigin;
  evidence: Evidence;
}

export type InstallAction =
  | "install"
  | "copy"
  | "move"
  | "link"
  | "mkdir"
  | "write"
  | "append";

export interface InstallFact {
  action: InstallAction;
  /** Destination as written. Variables are not resolved. */
  destination: string;
  mode: string | null;
  evidence: Evidence;
}

export type PrivilegeKind = "sudo" | "doas" | "su" | "pkexec" | "root-check";

export interface PrivilegeFact {
  kind: PrivilegeKind;
  detail: string;
  evidence: Evidence;
}

export interface DownloadFact {
  tool: string;
  /** Absolute http(s) URLs written in the command or assigned to a name it uses. */
  urls: string[];
  /**
   * URL operands that are not absolute http(s) literals, quotes included.
   * Variable values are not resolved.
   */
  references: string[];
  evidence: Evidence;
}

export interface IntegrityFact {
  tool: string;
  /** True when the invocation checks a checksum or signature. */
  verifies: boolean;
  detail: string;
  evidence: Evidence;
}

export type SideEffectKind =
  | "eval"
  | "pipe-to-shell"
  | "shell-command-string"
  | "rm-recursive"
  | "package-manager"
  | "shell-rc"
  | "insecure-download"
  | "chmod-permissive";

export interface SideEffectFact {
  kind: SideEffectKind;
  severity: Severity;
  detail: string;
  evidence: Evidence;
}

export interface FlowStep {
  /** One short sentence. */
  text: string;
  /**
   * Why this step is not a single statically chosen action.
   * Null when the step is a straight-line command.
   */
  unresolved: string | null;
  /** 1-based line of the command or branch. Null when the step is synthetic. */
  line: number | null;
  children: FlowStep[];
}

export interface AnalysisReport {
  version: typeof REPORT_VERSION;
  /** Display language used for prose fields (sentences, flow, notes). */
  locale?: Locale;
  tool: {
    name: "shxray";
    version: string;
  };
  source: {
    name: string;
    bytes: number;
    lines: number;
    shebang: string | null;
  };
  parse: {
    ok: boolean;
    variant: ShellVariant;
    error: {
      message: string;
      line: number | null;
      column: number | null;
    } | null;
  };
  summary: {
    risk: Severity;
    headline: string;
    /**
     * Plain sentences for the terminal summary: what is installed, where,
     * whether root is used, and which OS/arch names are recognized.
     */
    sentences: string[];
    counts: {
      options: number;
      environment: number;
      installs: number;
      privileges: number;
      downloads: number;
      integrity: number;
      sideEffects: number;
    };
  };
  /**
   * Installer steps in source order, following literal function calls from
   * the top level. Branches are listed, not chosen.
   */
  flow: {
    /** Entry function promoted to the top level of `steps`, when one exists. */
    entry?: string | null;
    /** Set when the top level does not call the functions it defines. */
    note: string | null;
    /** Concise, side-effect-focused steps for default display. */
    steps: FlowStep[];
    /** Detailed call and branch tree (shown with --verbose). */
    detailed?: FlowStep[];
  };
  platforms: {
    /** Canonical names. `amd64` and `arm64` fold into `x86_64` and `aarch64`. */
    operatingSystems: string[];
    architectures: string[];
    detections: PlatformDetection[];
  };
  interface: {
    options: OptionFact[];
    environment: EnvFact[];
  };
  installs: InstallFact[];
  privileges: PrivilegeFact[];
  network: {
    downloads: DownloadFact[];
    integrity: IntegrityFact[];
  };
  sideEffects: SideEffectFact[];
  notes: string[];
}
