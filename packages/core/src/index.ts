export { checkCssModules, checkCssModuleSourceFile, checkCssModuleSourceFileSync } from "./checker";
export { defaultMatchFiles } from "./config";
export { InvalidOptionsError } from "./errors";
export { sourceMayImportCssModule } from "./source/imports";
export type {
  CheckOptions,
  CheckResult,
  CheckSourceFileOptions,
  CheckStatus,
  CssModuleFileMatcher,
  Diagnostic,
  DiagnosticCode,
  LocalsConvention,
  RuleLevel,
  RulesConfig
} from "./types";
