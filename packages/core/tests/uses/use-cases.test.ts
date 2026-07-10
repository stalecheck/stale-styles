import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkCssModules, type CheckOptions, type CheckResult } from "../../src/index";

const usesRoot = path.dirname(fileURLToPath(import.meta.url));

type ExpectedResult = {
  status: CheckResult["status"];
  errors: Array<{
    code: string;
    severity: string;
    filePath: string;
    cssModulePath?: string;
    className?: string;
    line?: number;
    column?: number;
  }>;
};

describe("use cases", async () => {
  const entries = await readdir(usesRoot, { withFileTypes: true });
  const cases = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  it.each(cases)("%s", async (caseName) => {
    const caseRoot = path.join(usesRoot, caseName);
    const target = path.join(caseRoot, "src");
    const expected = parseExpectedResult(
      JSON.parse(await readFile(path.join(caseRoot, "expected.json"), "utf8"))
    );
    const options = await readOptions(caseRoot);
    const result = await checkCssModules({ ...options, target });

    expect(normalizeResult(result, target, expected)).toEqual(expected);
  });
});

async function readOptions(caseRoot: string): Promise<Omit<CheckOptions, "target">> {
  try {
    return parseOptions(JSON.parse(await readFile(path.join(caseRoot, "options.json"), "utf8")));
  } catch {
    return {};
  }
}

function normalizeResult(
  result: CheckResult,
  target: string,
  expected: ExpectedResult
): ExpectedResult {
  return {
    status: result.status,
    errors: result.errors.map((error, index) => {
      const expectedError = expected.errors[index];

      return {
        code: error.code,
        severity: error.severity,
        filePath: toRelative(target, error.filePath),
        ...(expectedError?.cssModulePath !== undefined && error.cssModulePath
          ? { cssModulePath: toRelative(target, error.cssModulePath) }
          : {}),
        ...(error.className ? { className: error.className } : {}),
        ...(expectedError?.line !== undefined ? { line: error.line } : {}),
        ...(expectedError?.column !== undefined ? { column: error.column } : {})
      };
    })
  };
}

function toRelative(target: string, filePath: string): string {
  return path.relative(target, filePath).split(path.sep).join("/");
}

function parseExpectedResult(value: unknown): ExpectedResult {
  if (!isExpectedResult(value)) {
    throw new Error("Invalid expected result fixture.");
  }

  return value;
}

function parseOptions(value: unknown): Omit<CheckOptions, "target"> {
  if (!isRecord(value)) {
    throw new Error("Invalid options fixture.");
  }

  return value;
}

function isExpectedResult(value: unknown): value is ExpectedResult {
  return (
    isRecord(value) &&
    (value.status === "SUCCESS" || value.status === "FAIL") &&
    Array.isArray(value.errors) &&
    value.errors.every(isExpectedError)
  );
}

function isExpectedError(value: unknown): value is ExpectedResult["errors"][number] {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.severity === "string" &&
    typeof value.filePath === "string" &&
    optionalString(value.cssModulePath) &&
    optionalString(value.className) &&
    optionalNumber(value.line) &&
    optionalNumber(value.column)
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
