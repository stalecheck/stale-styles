/** Overall status returned by a CSS Modules check. */
export type CheckStatus = "SUCCESS" | "FAIL";

/** Severity level used to configure an individual diagnostic rule. */
export type RuleLevel = "off" | "warning" | "error";

/** Stable code identifying the kind of problem reported by a diagnostic. */
export type DiagnosticCode =
  | "missing-css-module-class"
  | "unused-css-module-class"
  | "raw-css-module-class"
  | "empty-css-module-selector"
  | "unresolved-dynamic-class"
  | "css-module-file-not-found"
  | "css-parse-error"
  | "source-parse-error"
  | "no-source-files";

/** A single issue found while checking source files and CSS Modules. */
export type Diagnostic = {
  /** Stable diagnostic code. */
  code: DiagnosticCode;
  /** Effective diagnostic severity after applying rule configuration. */
  severity: "error" | "warning";
  /** Human-readable diagnostic message. */
  message: string;
  /** Absolute path to the source or CSS file where the issue was found. */
  filePath: string;
  /** One-based line number. */
  line: number;
  /** One-based column number. */
  column: number;
  /** Absolute path to the related CSS Module, when applicable. */
  cssModulePath?: string;
  /** CSS class name related to the diagnostic, when applicable. */
  className?: string;
};

/** Result returned after checking a target directory or source file. */
export type CheckResult = {
  /** `FAIL` when at least one emitted diagnostic has `error` severity. */
  status: CheckStatus;
  /** Diagnostics emitted by enabled rules. Includes warnings. */
  errors: Diagnostic[];
  /** Number of JavaScript or TypeScript source files visited. */
  filesChecked: number;
  /** Number of CSS Module files loaded and analyzed. */
  cssModulesChecked: number;
};

/** Per-rule severity overrides keyed by diagnostic code. */
export type RulesConfig = Partial<Record<DiagnosticCode, RuleLevel>>;

/**
 * CSS Modules locals convention used to map selector names to importable names.
 *
 * String values match conventions commonly exposed by build tools such as Vite.
 * A function can be used for custom transformations.
 */
export type LocalsConvention =
  | "camelCase"
  | "camelCaseOnly"
  | "dashes"
  | "dashesOnly"
  | ((originalClassName: string, generatedClassName: string, inputFile: string) => string);

/** Matcher used to decide whether an import should be treated as a CSS Module. */
export type CssModuleFileMatcher = string | RegExp;

/** Options accepted by {@link checkCssModules}. */
export type CheckOptions = {
  /** Directory or source file to check. Defaults to the current working directory. */
  target?: string;
  /** File or directory patterns to skip while walking source files. */
  ignore?: string[];
  /** Import path or resolved file path matchers for CSS Module files. */
  matchFiles?: CssModuleFileMatcher[];
  /** Class names or regular expressions that should not emit diagnostics. */
  ignoreClasses?: Array<string | RegExp>;
  /** Convention used to expose CSS class names to JavaScript imports. */
  localsConvention?: LocalsConvention;
  /** Per-rule severity overrides. */
  rules?: RulesConfig;
};

/** Options for checking a single source file. Intended for integrations. */
export type CheckSourceFileOptions = Omit<CheckOptions, "ignore" | "target"> & {
  /** Source file path used to resolve CSS Module imports. */
  filePath: string;
  /** Source text. When omitted, the file is read from disk. */
  source?: string;
};

export type CssModuleNamedImport = {
  importedName: string;
  localName: string;
  index: number;
};

export type CssModuleImport = {
  localName?: string;
  namedImports: CssModuleNamedImport[];
  importPath: string;
  cssModulePath: string;
  index: number;
};

export type SourceLocation = {
  index: number;
  line: number;
  column: number;
};

export type ClassUsage =
  | {
      kind: "resolved";
      className: string;
      localName: string;
      location: SourceLocation;
      cssModulePath: string;
    }
  | {
      kind: "unresolved";
      localName: string;
      location: SourceLocation;
      cssModulePath: string;
    };
