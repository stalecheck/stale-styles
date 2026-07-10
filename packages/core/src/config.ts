import type {
  CheckOptions,
  CheckSourceFileOptions,
  CssModuleFileMatcher,
  DiagnosticCode,
  LocalsConvention,
  RuleLevel,
  RulesConfig
} from "./types";
import { InvalidOptionsError } from "./errors";

export const defaultIgnores = ["dist", "node_modules"];
export const defaultMatchFiles: string[] = [".module.css"];

export const defaultRules: Record<DiagnosticCode, RuleLevel> = {
  "missing-css-module-class": "error",
  "unused-css-module-class": "error",
  "raw-css-module-class": "error",
  "empty-css-module-selector": "error",
  "unresolved-dynamic-class": "error",
  "css-module-file-not-found": "error",
  "css-parse-error": "error",
  "source-parse-error": "error",
  "no-source-files": "error"
};

export function mergeRules(rules: RulesConfig | undefined): Record<DiagnosticCode, RuleLevel> {
  return { ...defaultRules, ...rules };
}

/** Validates untyped input at the public JavaScript API boundary. */
export function validateCheckOptions(options: unknown): asserts options is CheckOptions {
  validateOptionsObject(options);
}

/** Validates options required by the single-source-file public APIs. */
export function validateCheckSourceFileOptions(
  options: unknown
): asserts options is CheckSourceFileOptions {
  validateOptionsObject(options);

  if (
    !("filePath" in options) ||
    typeof options.filePath !== "string" ||
    !options.filePath.trim()
  ) {
    throw new InvalidOptionsError("filePath", "must be a non-empty string");
  }

  if ("source" in options && options.source !== undefined && typeof options.source !== "string") {
    throw new InvalidOptionsError("source", "must be a string when provided");
  }
}

function validateOptionsObject(options: unknown): asserts options is CheckOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new InvalidOptionsError("options", "must be an object");
  }

  if ("target" in options && options.target !== undefined) {
    validateNonEmptyString(options.target, "target");
  }

  validateStringArrayOption(options, "ignore");
  validateMatcherArrayOption(options, "matchFiles");
  validateMatcherArrayOption(options, "ignoreClasses");
  validateLocalsConvention(options);
  validateRules(options);
}

function validateNonEmptyString(value: unknown, optionPath: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidOptionsError(optionPath, "must be a non-empty string");
  }
}

function validateStringArrayOption(options: CheckOptions, optionName: "ignore"): void {
  const value = options[optionName];

  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    throw new InvalidOptionsError(optionName, "must be an array of strings");
  }

  value.forEach((item, index) => validateNonEmptyString(item, `${optionName}[${index}]`));
}

function validateMatcherArrayOption(
  options: CheckOptions,
  optionName: "matchFiles" | "ignoreClasses"
): void {
  const value = options[optionName];

  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    throw new InvalidOptionsError(optionName, "must be an array of strings or regular expressions");
  }

  value.forEach((item, index) => {
    if (typeof item !== "string" && !(item instanceof RegExp)) {
      throw new InvalidOptionsError(
        `${optionName}[${index}]`,
        "must be a string or regular expression"
      );
    }
  });
}

function validateLocalsConvention(options: CheckOptions): void {
  const value = options.localsConvention;

  if (value === undefined || typeof value === "function") {
    return;
  }

  if (!(["camelCase", "camelCaseOnly", "dashes", "dashesOnly"] as const).includes(value)) {
    throw new InvalidOptionsError(
      "localsConvention",
      'must be "camelCase", "camelCaseOnly", "dashes", "dashesOnly", or a function'
    );
  }
}

function validateRules(options: CheckOptions): void {
  const rules = options.rules;

  if (rules === undefined) {
    return;
  }

  if (typeof rules !== "object" || rules === null || Array.isArray(rules)) {
    throw new InvalidOptionsError("rules", "must be an object");
  }

  for (const [code, level] of Object.entries(rules)) {
    if (!(code in defaultRules)) {
      throw new InvalidOptionsError(`rules.${code}`, "is not a supported diagnostic code");
    }

    if (level !== "off" && level !== "warning" && level !== "error") {
      throw new InvalidOptionsError(`rules.${code}`, 'must be "off", "warning", or "error"');
    }
  }
}

export function matchesCssModuleFile(
  importPath: string,
  resolvedPath: string,
  matchFiles: CssModuleFileMatcher[] | undefined
): boolean {
  const matchers = matchFiles ?? defaultMatchFiles;
  const candidates = [toPosixPath(importPath), toPosixPath(resolvedPath)];

  return matchers.some((matcher) =>
    candidates.some((candidate) => {
      if (typeof matcher === "string") {
        return candidate.endsWith(toPosixPath(matcher));
      }

      matcher.lastIndex = 0;
      const matches = matcher.test(candidate);
      matcher.lastIndex = 0;
      return matches;
    })
  );
}

export function getLocalClassNames(
  className: string,
  filename: string,
  localsConvention: LocalsConvention | undefined
): string[] {
  if (localsConvention === undefined) {
    return [className];
  }

  if (typeof localsConvention === "function") {
    const transformedClassName = localsConvention(className, className, filename);

    if (typeof transformedClassName !== "string") {
      throw new InvalidOptionsError("localsConvention", "function must return a string");
    }

    return [transformedClassName].filter(Boolean);
  }

  const camelCaseName = toCamelCase(className, /[-_]+([a-zA-Z0-9])/g);
  const dashesName = toCamelCase(className, /-+([a-zA-Z0-9])/g);

  if (localsConvention === "camelCase") {
    return uniqueClassNames([className, camelCaseName]);
  }

  if (localsConvention === "camelCaseOnly") {
    return [camelCaseName].filter(Boolean);
  }

  if (localsConvention === "dashes") {
    return uniqueClassNames([className, dashesName]);
  }

  return [dashesName].filter(Boolean);
}

function uniqueClassNames(classNames: string[]): string[] {
  return [...new Set(classNames.filter(Boolean))];
}

function toCamelCase(className: string, pattern: RegExp): string {
  return className.replace(pattern, (_, char: string) => char.toUpperCase());
}

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
