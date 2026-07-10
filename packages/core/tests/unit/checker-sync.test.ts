import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkCssModuleSourceFileSync } from "../../src/index";

describe("checkCssModuleSourceFileSync", () => {
  it("returns success for source files without CSS Module imports", () => {
    const result = checkCssModuleSourceFileSync({
      filePath: path.resolve("button.ts"),
      source: "export const button = 'plain';\n"
    });

    expect(result).toMatchObject({
      status: "SUCCESS",
      filesChecked: 1,
      cssModulesChecked: 0,
      errors: []
    });
  });

  it("ignores source parse errors in files without CSS Module imports", () => {
    const result = checkCssModuleSourceFileSync({
      filePath: path.resolve("vite-env.d.ts"),
      source: [
        '/// <reference types="vite/client" />',
        "",
        "interface ImportMetaEnv {",
        "  readonly VITE_SOME_KEY: string;",
        "}",
        "",
        "declare module 'My/App' {",
        "  declare const App: import('react').ComponentType;",
        "  export default App;",
        "}"
      ].join("\n")
    });

    expect(result).toMatchObject({
      status: "SUCCESS",
      filesChecked: 1,
      cssModulesChecked: 0,
      errors: []
    });
  });

  it("reports source parse errors", () => {
    const result = checkCssModuleSourceFileSync({
      filePath: path.resolve("button.tsx"),
      source: 'import styles from "./button.module.css";\nexport function Button('
    });

    expect(result).toMatchObject({
      status: "FAIL",
      errors: [
        expect.objectContaining({
          code: "source-parse-error",
          filePath: path.resolve("button.tsx")
        })
      ]
    });
  });

  it("reports CSS parse errors from imported modules", () => {
    const targetRoot = mkdtempSync(path.join(os.tmpdir(), "stale-styles-sync-"));
    const filePath = path.join(targetRoot, "button.tsx");
    const cssPath = path.join(targetRoot, "button.module.css");

    writeFileSync(cssPath, ".root { color: red; }\n}\n", "utf8");

    const result = checkCssModuleSourceFileSync({
      filePath,
      source: 'import styles from "./button.module.css"; styles.root;\n'
    });

    expect(result).toMatchObject({
      status: "FAIL",
      errors: [
        expect.objectContaining({
          code: "css-parse-error",
          filePath: cssPath,
          cssModulePath: cssPath
        })
      ]
    });
  });

  it("does not report ignored empty selectors", () => {
    const targetRoot = mkdtempSync(path.join(os.tmpdir(), "stale-styles-sync-"));
    const filePath = path.join(targetRoot, "button.tsx");

    writeFileSync(
      path.join(targetRoot, "button.module.css"),
      ".root { color: red; }\n.empty {}\n",
      "utf8"
    );

    const result = checkCssModuleSourceFileSync({
      filePath,
      source: 'import styles from "./button.module.css"; styles.root;\n',
      ignoreClasses: ["empty"]
    });

    expect(result).toMatchObject({
      status: "SUCCESS",
      errors: []
    });
  });

  it("reports ambiguous raw classes for every candidate without marking them as used", () => {
    const targetRoot = mkdtempSync(path.join(os.tmpdir(), "stale-styles-sync-"));
    const filePath = path.join(targetRoot, "button.tsx");
    const firstCssPath = path.join(targetRoot, "first.module.css");
    const secondCssPath = path.join(targetRoot, "second.module.css");

    writeFileSync(firstCssPath, ".root { color: red; }\n", "utf8");
    writeFileSync(secondCssPath, ".root { color: blue; }\n", "utf8");

    const result = checkCssModuleSourceFileSync({
      filePath,
      source: [
        'import first from "./first.module.css";',
        'import second from "./second.module.css";',
        'export const Button = () => <button className="root" />;'
      ].join("\n")
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "raw-css-module-class",
          cssModulePath: firstCssPath,
          className: "root"
        }),
        expect.objectContaining({
          code: "raw-css-module-class",
          cssModulePath: secondCssPath,
          className: "root"
        }),
        expect.objectContaining({
          code: "unused-css-module-class",
          cssModulePath: firstCssPath,
          className: "root"
        }),
        expect.objectContaining({
          code: "unused-css-module-class",
          cssModulePath: secondCssPath,
          className: "root"
        })
      ])
    );
  });
});
