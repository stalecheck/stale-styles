import { Buffer } from "node:buffer";
import {
  Features,
  transform,
  type CSSModuleExports,
  type KeyframesName,
  type Selector
} from "lightningcss";
import { getLocalClassNames } from "../config";
import { getLocation } from "../locations";
import type { LocalsConvention, SourceLocation } from "../types";

export type CssClassExtraction =
  | {
      ok: true;
      classes: Set<string>;
      importableClasses: Map<string, Set<string>>;
      composedClasses: Map<string, Set<string>>;
      emptyClasses: Set<string>;
      locations: Map<string, SourceLocation>;
    }
  | { ok: false; message: string; line: number; column: number };

export function extractCssClasses(
  source: string,
  filename = "input.module.css",
  localsConvention?: LocalsConvention
): CssClassExtraction {
  try {
    const transformed = transform({
      filename,
      code: Buffer.from(source),
      cssModules: { pattern: "[local]" },
      include: Features.Nesting
    });
    const exports = transformed.exports ?? {};
    const keyframeNames = getKeyframeNames(source, filename);
    const classes = new Set(
      Object.keys(exports)
        .filter((className) => !keyframeNames.has(className))
        .sort()
    );
    const emptyClasses = getEmptyStandaloneClasses(source, filename);
    const locations = getClassLocations(source);

    for (const className of emptyClasses) {
      classes.add(className);
    }

    return {
      ok: true,
      classes,
      importableClasses: getImportableClasses(classes, filename, localsConvention),
      composedClasses: getComposedClasses(exports),
      emptyClasses,
      locations
    };
  } catch (error) {
    const loc = getErrorLocation(error);

    return {
      ok: false,
      message: getErrorMessage(error),
      line: loc.line,
      column: loc.column
    };
  }
}

function getKeyframeNames(source: string, filename: string): Set<string> {
  const keyframeNames = new Set<string>();

  transform({
    filename,
    code: Buffer.from(source),
    include: Features.Nesting,
    visitor: {
      Rule: {
        keyframes(rule) {
          keyframeNames.add(getKeyframesName(rule.value.name));
        }
      }
    }
  });

  return keyframeNames;
}

function getKeyframesName(name: KeyframesName): string {
  return name.value;
}

function getComposedClasses(exports: CSSModuleExports): Map<string, Set<string>> {
  const composedClasses = new Map<string, Set<string>>();

  for (const [className, cssModuleExport] of Object.entries(exports)) {
    for (const reference of cssModuleExport.composes) {
      if (reference.type !== "local") {
        continue;
      }

      addImportableClass(composedClasses, className, reference.name);
    }
  }

  return composedClasses;
}

function getImportableClasses(
  classes: Set<string>,
  filename: string,
  localsConvention: LocalsConvention | undefined
): Map<string, Set<string>> {
  const importableClasses = new Map<string, Set<string>>();

  for (const className of classes) {
    for (const localClassName of getLocalClassNames(className, filename, localsConvention)) {
      addImportableClass(importableClasses, localClassName, className);
    }
  }

  return importableClasses;
}

function addImportableClass(
  importableClasses: Map<string, Set<string>>,
  importableClassName: string,
  className: string
): void {
  const mappedClasses = importableClasses.get(importableClassName);

  if (mappedClasses) {
    mappedClasses.add(className);
    return;
  }

  importableClasses.set(importableClassName, new Set([className]));
}

function getEmptyStandaloneClasses(source: string, filename: string): Set<string> {
  const classes = new Set<string>();

  transform({
    filename,
    code: Buffer.from(source),
    include: Features.Nesting,
    visitor: {
      Rule: {
        style(rule) {
          if (!isEmptyStyleRule(rule.value)) {
            return;
          }

          collectStandaloneClasses(rule.value.selectors, classes);
        }
      }
    }
  });

  return classes;
}

function collectStandaloneClasses(selectorList: Selector[], classes: Set<string>): void {
  for (const selector of selectorList) {
    let compoundClassCount = 0;
    let exportedCompoundClass: string | undefined;

    for (const component of selector) {
      if (component.type === "combinator") {
        addStandaloneCompoundClass(compoundClassCount, exportedCompoundClass, classes);
        compoundClassCount = 0;
        exportedCompoundClass = undefined;
        continue;
      }

      if (component.type === "class") {
        compoundClassCount += 1;
        exportedCompoundClass = component.name;
      }
    }

    addStandaloneCompoundClass(compoundClassCount, exportedCompoundClass, classes);
  }
}

function isEmptyStyleRule(rule: {
  declarations: { declarations: unknown[]; importantDeclarations: unknown[] };
  rules: unknown[];
}): boolean {
  return (
    rule.declarations.declarations.length === 0 &&
    rule.declarations.importantDeclarations.length === 0 &&
    rule.rules.length === 0
  );
}

function addStandaloneCompoundClass(
  compoundClassCount: number,
  exportedClass: string | undefined,
  classes: Set<string>
): void {
  if (compoundClassCount === 1 && exportedClass) {
    classes.add(exportedClass);
  }
}

function getClassLocations(source: string): Map<string, SourceLocation> {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    " ".repeat(comment.length)
  );
  const locations = new Map<string, SourceLocation>();
  const classPattern = /\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g;

  for (const match of withoutComments.matchAll(classPattern)) {
    const className = match[1];

    if (!locations.has(className)) {
      locations.set(className, getLocation(source, match.index + 1));
    }
  }

  return locations;
}

function getErrorLocation(error: unknown): { line: number; column: number } {
  if (
    typeof error === "object" &&
    error !== null &&
    "loc" in error &&
    typeof error.loc === "object" &&
    error.loc !== null &&
    "line" in error.loc &&
    "column" in error.loc &&
    typeof error.loc.line === "number" &&
    typeof error.loc.column === "number"
  ) {
    return { line: error.loc.line, column: error.loc.column };
  }

  return { line: 1, column: 1 };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `CSS parse error: ${error.message}`;
  }

  return "CSS parse error.";
}
