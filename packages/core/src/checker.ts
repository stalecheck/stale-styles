import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { mergeRules } from "./config";
import { extractCssClasses } from "./css/extract-classes";
import { findSourceFiles } from "./files";
import { getLocation } from "./locations";
import { findCssModuleClassUsages, findRawClassNameUsages } from "./source/class-usages";
import { findCssModuleImports, sourceMayImportCssModule } from "./source/imports";
import { parseSourceFile } from "./source/parse";
import type {
  CheckOptions,
  CheckResult,
  CheckSourceFileOptions,
  Diagnostic,
  DiagnosticCode,
  CssModuleImport,
  RuleLevel,
  SourceLocation
} from "./types";

type CssModuleRecord = {
  classes: Set<string>;
  importableClasses: Map<string, Set<string>>;
  composedClasses: Map<string, Set<string>>;
  emptyClasses: Set<string>;
  locations: Map<string, SourceLocation>;
  usedClasses: Set<string>;
};

type SourceAnalysisOptions = Pick<
  CheckOptions,
  "ignoreClasses" | "localsConvention" | "matchFiles"
>;

/**
 * Check CSS Module imports and class usages under a target directory or source file.
 *
 * The checker validates missing classes, unused CSS Module classes, raw class
 * strings that duplicate imported module classes, empty selectors, parse
 * failures, missing module files, and dynamic accesses that cannot be resolved
 * statically.
 */
export async function checkCssModules(options: CheckOptions = {}): Promise<CheckResult> {
  const target = path.resolve(options.target ?? process.cwd());
  const rules = mergeRules(options.rules);
  const sourceFiles = await findSourceFiles(target, options.ignore);
  const diagnostics: Diagnostic[] = [];
  const cssModules = new Map<string, CssModuleRecord>();

  if (sourceFiles.length === 0) {
    diagnostics.push({
      code: "no-source-files",
      severity: "error",
      message: `No supported source files were found under ${target}. Supported extensions: .js, .jsx, .mjs, .ts, .tsx, .mts.`,
      filePath: target,
      line: 1,
      column: 1
    });
    return createCheckResult(diagnostics, 0, 0);
  }

  for (const filePath of sourceFiles) {
    await analyzeSourceFile(filePath, undefined, options, rules, cssModules, diagnostics);
  }

  pushCssModuleDiagnostics(cssModules, diagnostics, options, rules);
  return createCheckResult(diagnostics, sourceFiles.length, cssModules.size);
}

export async function checkCssModuleSourceFile(
  options: CheckSourceFileOptions
): Promise<CheckResult> {
  const rules = mergeRules(options.rules);
  const diagnostics: Diagnostic[] = [];
  const cssModules = new Map<string, CssModuleRecord>();

  await analyzeSourceFile(
    path.resolve(options.filePath),
    options.source,
    options,
    rules,
    cssModules,
    diagnostics
  );

  pushCssModuleDiagnostics(cssModules, diagnostics, options, rules);
  return createCheckResult(diagnostics, 1, cssModules.size);
}

export function checkCssModuleSourceFileSync(options: CheckSourceFileOptions): CheckResult {
  const rules = mergeRules(options.rules);
  const diagnostics: Diagnostic[] = [];
  const cssModules = new Map<string, CssModuleRecord>();

  analyzeSourceFileSync(
    path.resolve(options.filePath),
    options.source,
    options,
    rules,
    cssModules,
    diagnostics
  );

  pushCssModuleDiagnostics(cssModules, diagnostics, options, rules);
  return createCheckResult(diagnostics, 1, cssModules.size);
}

async function analyzeSourceFile(
  filePath: string,
  sourceInput: string | undefined,
  options: SourceAnalysisOptions,
  rules: Record<DiagnosticCode, RuleLevel>,
  cssModules: Map<string, CssModuleRecord>,
  diagnostics: Diagnostic[]
): Promise<void> {
  const source = sourceInput ?? (await readFile(filePath, "utf8"));

  if (!sourceMayImportCssModule(source, filePath, options.matchFiles)) {
    return;
  }

  const parsedSource = parseSourceFile(filePath, source);

  if (!parsedSource.ok) {
    pushDiagnostic(diagnostics, rules, {
      code: "source-parse-error",
      message: parsedSource.message,
      filePath,
      location: parsedSource.location
    });
    return;
  }

  const imports = findCssModuleImports(parsedSource.program, filePath, options.matchFiles);

  if (imports.length === 0) {
    return;
  }

  const analyzableImports: CssModuleImport[] = [];

  for (const cssImport of imports) {
    if (!existsSync(cssImport.cssModulePath)) {
      pushDiagnostic(diagnostics, rules, {
        code: "css-module-file-not-found",
        message: `CSS Module file not found: ${cssImport.importPath}.`,
        filePath,
        cssModulePath: cssImport.cssModulePath,
        location: getLocation(source, cssImport.index)
      });
      continue;
    }

    if (!cssModules.has(cssImport.cssModulePath)) {
      const cssSource = await readFile(cssImport.cssModulePath, "utf8");
      const extracted = extractCssClasses(
        cssSource,
        cssImport.cssModulePath,
        options.localsConvention
      );

      if (!extracted.ok) {
        pushDiagnostic(diagnostics, rules, {
          code: "css-parse-error",
          message: extracted.message,
          filePath: cssImport.cssModulePath,
          cssModulePath: cssImport.cssModulePath,
          location: { index: 0, line: extracted.line, column: extracted.column }
        });
        continue;
      }

      cssModules.set(cssImport.cssModulePath, {
        classes: extracted.classes,
        importableClasses: extracted.importableClasses,
        composedClasses: extracted.composedClasses,
        emptyClasses: extracted.emptyClasses,
        locations: extracted.locations,
        usedClasses: new Set()
      });
    }

    if (cssModules.has(cssImport.cssModulePath)) {
      analyzableImports.push(cssImport);
      continue;
    }
  }

  if (analyzableImports.length === 0) {
    return;
  }

  analyzeUsages(
    source,
    parsedSource.program,
    analyzableImports,
    filePath,
    options,
    rules,
    cssModules,
    diagnostics
  );
}

function analyzeSourceFileSync(
  filePath: string,
  sourceInput: string | undefined,
  options: SourceAnalysisOptions,
  rules: Record<DiagnosticCode, RuleLevel>,
  cssModules: Map<string, CssModuleRecord>,
  diagnostics: Diagnostic[]
): void {
  const source = sourceInput ?? readFileSync(filePath, "utf8");

  if (!sourceMayImportCssModule(source, filePath, options.matchFiles)) {
    return;
  }

  const parsedSource = parseSourceFile(filePath, source);

  if (!parsedSource.ok) {
    pushDiagnostic(diagnostics, rules, {
      code: "source-parse-error",
      message: parsedSource.message,
      filePath,
      location: parsedSource.location
    });
    return;
  }

  const imports = findCssModuleImports(parsedSource.program, filePath, options.matchFiles);

  if (imports.length === 0) {
    return;
  }

  const analyzableImports: CssModuleImport[] = [];

  for (const cssImport of imports) {
    if (!existsSync(cssImport.cssModulePath)) {
      pushDiagnostic(diagnostics, rules, {
        code: "css-module-file-not-found",
        message: `CSS Module file not found: ${cssImport.importPath}.`,
        filePath,
        cssModulePath: cssImport.cssModulePath,
        location: getLocation(source, cssImport.index)
      });
      continue;
    }

    if (!cssModules.has(cssImport.cssModulePath)) {
      const cssSource = readFileSync(cssImport.cssModulePath, "utf8");
      const extracted = extractCssClasses(
        cssSource,
        cssImport.cssModulePath,
        options.localsConvention
      );

      if (!extracted.ok) {
        pushDiagnostic(diagnostics, rules, {
          code: "css-parse-error",
          message: extracted.message,
          filePath: cssImport.cssModulePath,
          cssModulePath: cssImport.cssModulePath,
          location: { index: 0, line: extracted.line, column: extracted.column }
        });
        continue;
      }

      cssModules.set(cssImport.cssModulePath, {
        classes: extracted.classes,
        importableClasses: extracted.importableClasses,
        composedClasses: extracted.composedClasses,
        emptyClasses: extracted.emptyClasses,
        locations: extracted.locations,
        usedClasses: new Set()
      });
    }

    if (cssModules.has(cssImport.cssModulePath)) {
      analyzableImports.push(cssImport);
      continue;
    }
  }

  if (analyzableImports.length === 0) {
    return;
  }

  analyzeUsages(
    source,
    parsedSource.program,
    analyzableImports,
    filePath,
    options,
    rules,
    cssModules,
    diagnostics
  );
}

function analyzeUsages(
  source: string,
  program: Parameters<typeof findCssModuleClassUsages>[1],
  imports: Parameters<typeof findCssModuleClassUsages>[2],
  filePath: string,
  options: SourceAnalysisOptions,
  rules: Record<DiagnosticCode, RuleLevel>,
  cssModules: Map<string, CssModuleRecord>,
  diagnostics: Diagnostic[]
): void {
  for (const usage of findCssModuleClassUsages(source, program, imports)) {
    if (usage.kind === "unresolved") {
      const cssModule = cssModules.get(usage.cssModulePath);

      if (!cssModule) {
        continue;
      }

      pushDiagnostic(diagnostics, rules, {
        code: "unresolved-dynamic-class",
        message: `Cannot statically resolve dynamic class access on ${usage.localName}.`,
        filePath,
        cssModulePath: usage.cssModulePath,
        location: usage.location
      });
      continue;
    }

    if (isIgnoredClass(usage.className, options.ignoreClasses)) {
      continue;
    }

    const cssModule = cssModules.get(usage.cssModulePath);

    if (!cssModule) {
      continue;
    }

    const usedClasses = cssModule.importableClasses.get(usage.className);

    if (usedClasses) {
      for (const className of usedClasses) {
        markClassUsed(cssModule, className);
      }
      continue;
    }

    pushDiagnostic(diagnostics, rules, {
      code: "missing-css-module-class",
      message: `Class "${usage.className}" is not defined in ${path.basename(usage.cssModulePath)}.`,
      filePath,
      cssModulePath: usage.cssModulePath,
      className: usage.className,
      location: usage.location
    });
  }

  for (const rawUsage of findRawClassNameUsages(source, program)) {
    if (isIgnoredClass(rawUsage.className, options.ignoreClasses)) {
      continue;
    }

    const matchingCssModulePaths = [
      ...new Set(imports.map((cssImport) => cssImport.cssModulePath))
    ].filter((cssModulePath) => cssModules.get(cssModulePath)?.classes.has(rawUsage.className));

    if (matchingCssModulePaths.length === 0) {
      continue;
    }

    if (matchingCssModulePaths.length === 1) {
      const cssModulePath = matchingCssModulePaths[0];
      const cssModule = cssModules.get(cssModulePath);

      if (cssModule) {
        markClassUsed(cssModule, rawUsage.className);
      }

      pushDiagnostic(diagnostics, rules, {
        code: "raw-css-module-class",
        message: `CSS Module class "${rawUsage.className}" is used as a raw class string.`,
        filePath,
        cssModulePath,
        className: rawUsage.className,
        location: rawUsage.location
      });
      continue;
    }

    for (const cssModulePath of matchingCssModulePaths) {
      pushDiagnostic(diagnostics, rules, {
        code: "raw-css-module-class",
        message: `Raw class string "${rawUsage.className}" is ambiguous between imported CSS Modules.`,
        filePath,
        cssModulePath,
        className: rawUsage.className,
        location: rawUsage.location
      });
    }
  }
}

function markClassUsed(cssModule: CssModuleRecord, className: string): void {
  if (cssModule.usedClasses.has(className)) {
    return;
  }

  cssModule.usedClasses.add(className);

  for (const composedClassName of cssModule.composedClasses.get(className) ?? []) {
    markClassUsed(cssModule, composedClassName);
  }
}

function pushCssModuleDiagnostics(
  cssModules: Map<string, CssModuleRecord>,
  diagnostics: Diagnostic[],
  options: Pick<CheckOptions, "ignoreClasses">,
  rules: Record<DiagnosticCode, RuleLevel>
): void {
  for (const [cssModulePath, cssModule] of cssModules) {
    for (const className of cssModule.emptyClasses) {
      if (isIgnoredClass(className, options.ignoreClasses)) {
        continue;
      }

      pushDiagnostic(diagnostics, rules, {
        code: "empty-css-module-selector",
        message: `Class "${className}" is defined by an empty selector in ${path.basename(
          cssModulePath
        )}.`,
        filePath: cssModulePath,
        cssModulePath,
        className,
        location: cssModule.locations.get(className) ?? { index: 0, line: 1, column: 1 }
      });
    }

    for (const className of cssModule.classes) {
      if (
        cssModule.usedClasses.has(className) ||
        isIgnoredClass(className, options.ignoreClasses)
      ) {
        continue;
      }

      pushDiagnostic(diagnostics, rules, {
        code: "unused-css-module-class",
        message: `Class "${className}" is defined in ${path.basename(cssModulePath)} but is never used.`,
        filePath: cssModulePath,
        cssModulePath,
        className,
        location: cssModule.locations.get(className) ?? { index: 0, line: 1, column: 1 }
      });
    }
  }
}

function createCheckResult(
  diagnostics: Diagnostic[],
  filesChecked: number,
  cssModulesChecked: number
): CheckResult {
  return {
    status: diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "FAIL" : "SUCCESS",
    errors: diagnostics,
    filesChecked,
    cssModulesChecked
  };
}

function pushDiagnostic(
  diagnostics: Diagnostic[],
  rules: Record<DiagnosticCode, RuleLevel>,
  input: {
    code: DiagnosticCode;
    message: string;
    filePath: string;
    location: SourceLocation;
    cssModulePath?: string;
    className?: string;
  }
): void {
  const level = rules[input.code];

  if (level === "off") {
    return;
  }

  diagnostics.push({
    code: input.code,
    severity: level,
    message: input.message,
    filePath: input.filePath,
    line: input.location.line,
    column: input.location.column,
    cssModulePath: input.cssModulePath,
    className: input.className
  });
}

function isIgnoredClass(className: string, ignoreClasses: CheckOptions["ignoreClasses"]): boolean {
  return (ignoreClasses ?? []).some((ignoredClass) => {
    if (typeof ignoredClass === "string") {
      return ignoredClass === className;
    }

    ignoredClass.lastIndex = 0;
    const matches = ignoredClass.test(className);
    ignoredClass.lastIndex = 0;

    return matches;
  });
}
