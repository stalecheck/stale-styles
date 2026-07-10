/**
 * Check CSS Module imports and class usages under a target directory or source file.
 *
 * This is the public programmatic API for running the same project-level check
 * exposed by the CLI.
 */
export { checkCssModules, InvalidOptionsError } from "@stale-styles/core";
export type {
  CheckOptions,
  CheckResult,
  CheckStatus,
  CssModuleFileMatcher,
  Diagnostic,
  DiagnosticCode,
  LocalsConvention,
  RuleLevel,
  RulesConfig
} from "@stale-styles/core";
