import { describe, expect, it } from "vitest";
import {
  checkCssModuleSourceFileSync,
  checkCssModules,
  InvalidOptionsError
} from "../../src/index";

describe("programmatic option validation", () => {
  it("rejects invalid rule levels instead of returning an invalid diagnostic severity", async () => {
    await expect(
      callCheckCssModules({ rules: { "missing-css-module-class": "warn" } })
    ).rejects.toThrow(
      new InvalidOptionsError(
        "rules.missing-css-module-class",
        'must be "off", "warning", or "error"'
      )
    );
  });

  it("rejects unknown rule codes", async () => {
    await expect(callCheckCssModules({ rules: { "not-a-rule": "error" } })).rejects.toThrow(
      InvalidOptionsError
    );
  });

  it("rejects an invalid locals convention instead of treating it as dashesOnly", async () => {
    await expect(callCheckCssModules({ localsConvention: "invalid" })).rejects.toThrow(
      InvalidOptionsError
    );
  });

  it("rejects invalid array options", async () => {
    await expect(callCheckCssModules({ ignore: "dist" })).rejects.toThrow(InvalidOptionsError);
    await expect(callCheckCssModules({ matchFiles: [42] })).rejects.toThrow(InvalidOptionsError);
  });

  it("validates required options for the synchronous single-file API", () => {
    expect(() => callCheckCssModuleSourceFileSync({ filePath: "" })).toThrow(InvalidOptionsError);
  });
});

function callCheckCssModules(options: unknown): Promise<unknown> {
  return Reflect.apply(checkCssModules, undefined, [options]);
}

function callCheckCssModuleSourceFileSync(options: unknown): unknown {
  return Reflect.apply(checkCssModuleSourceFileSync, undefined, [options]);
}
