import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderTextReport } from "../../src/reporters/text";
import type { CheckResult } from "@stale-styles/css-modules";

describe("renderTextReport", () => {
  it("renders a passing summary", () => {
    const result: CheckResult = {
      status: "SUCCESS",
      errors: [],
      filesChecked: 2,
      cssModulesChecked: 1
    };

    expect(renderTextReport(result, process.cwd())).toBe(
      "CSS Modules check passed. 2 source files analyzed, 1 CSS Modules checked."
    );
  });

  it("groups diagnostics by file", () => {
    const filePath = path.resolve("src/button.tsx");
    const result: CheckResult = {
      status: "FAIL",
      filesChecked: 1,
      cssModulesChecked: 1,
      errors: [
        {
          code: "missing-css-module-class",
          severity: "error",
          message: 'Class "missing" is not defined in button.module.css.',
          filePath,
          line: 3,
          column: 14,
          className: "missing"
        }
      ]
    };

    expect(renderTextReport(result, process.cwd())).toContain(
      "error missing-css-module-class (missing) at 3:14"
    );
    expect(renderTextReport(result, process.cwd())).toContain(
      "1 source files analyzed, 1 CSS Modules checked."
    );
  });
});
