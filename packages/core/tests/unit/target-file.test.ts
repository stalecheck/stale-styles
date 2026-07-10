import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkCssModules } from "../../src/index";

describe("target files", () => {
  it("checks a single source file target", async () => {
    const targetRoot = await mkdtemp(path.join(os.tmpdir(), "stale-styles-target-file-"));
    const sourceFile = path.join(targetRoot, "button.tsx");

    await writeFile(
      sourceFile,
      [
        'import styles from "./button.module.css";',
        "",
        "export function Button() {",
        "  return <button className={styles.root} />;",
        "}",
        ""
      ].join("\n")
    );
    await writeFile(
      path.join(targetRoot, "button.module.css"),
      ".root { display: inline-flex; }\n"
    );
    await writeFile(
      path.join(targetRoot, "other.tsx"),
      'import styles from "./other.module.css"; styles.missing;\n'
    );
    await writeFile(path.join(targetRoot, "other.module.css"), ".root { color: red; }\n");

    const result = await checkCssModules({ target: sourceFile });

    expect(result).toMatchObject({
      status: "SUCCESS",
      filesChecked: 1,
      cssModulesChecked: 1,
      errors: []
    });
  });

  it("fails when a single file target is not a supported source file", async () => {
    const targetRoot = await mkdtemp(path.join(os.tmpdir(), "stale-styles-target-file-"));
    const textFile = path.join(targetRoot, "notes.txt");

    await writeFile(textFile, "not source code\n");

    const result = await checkCssModules({ target: textFile });

    expect(result).toMatchObject({
      status: "FAIL",
      filesChecked: 0,
      cssModulesChecked: 0,
      errors: [expect.objectContaining({ code: "no-source-files", severity: "error" })]
    });
  });

  it("fails when a single source file target matches ignore options", async () => {
    const targetRoot = await mkdtemp(path.join(os.tmpdir(), "stale-styles-target-file-"));
    const sourceFile = path.join(targetRoot, "ignored.tsx");

    await writeFile(sourceFile, 'import styles from "./missing.module.css"; styles.root;\n');

    const result = await checkCssModules({ target: sourceFile, ignore: ["ignored.tsx"] });

    expect(result).toMatchObject({
      status: "FAIL",
      filesChecked: 0,
      cssModulesChecked: 0,
      errors: [expect.objectContaining({ code: "no-source-files", severity: "error" })]
    });
  });

  it.each(["mjs", "mts"])("checks %s source files", async (extension) => {
    const targetRoot = await mkdtemp(path.join(os.tmpdir(), "stale-styles-target-file-"));
    const sourceFile = path.join(targetRoot, `button.${extension}`);

    await writeFile(sourceFile, 'import styles from "./button.module.css"; styles.root;\n');
    await writeFile(path.join(targetRoot, "button.module.css"), ".root { color: red; }\n");

    await expect(checkCssModules({ target: sourceFile })).resolves.toMatchObject({
      status: "SUCCESS",
      filesChecked: 1,
      cssModulesChecked: 1,
      errors: []
    });
  });

  it("applies directory and glob ignores while walking target directories", async () => {
    const targetRoot = await mkdtemp(path.join(os.tmpdir(), "stale-styles-target-dir-"));

    await mkdir(path.join(targetRoot, "src"), { recursive: true });
    await mkdir(path.join(targetRoot, "ignored"), { recursive: true });
    await mkdir(path.join(targetRoot, "generated"), { recursive: true });
    await writeFile(path.join(targetRoot, "src", "button.tsx"), "export const ok = true;\n");
    await writeFile(
      path.join(targetRoot, "ignored", "button.tsx"),
      'import styles from "./missing.module.css"; styles.root;\n'
    );
    await writeFile(
      path.join(targetRoot, "generated", "button.generated.tsx"),
      'import styles from "./missing.module.css"; styles.root;\n'
    );

    const result = await checkCssModules({
      target: targetRoot,
      ignore: ["ignored", "*.generated.tsx"]
    });

    expect(result).toMatchObject({
      status: "SUCCESS",
      filesChecked: 1,
      cssModulesChecked: 0,
      errors: []
    });
  });
});
