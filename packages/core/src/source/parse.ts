import path from "node:path";
import { parseSync } from "oxc-parser";
import type { SourceLocation } from "../types";
import { getLocation } from "../locations";
import type { AstNode } from "./ast";
import { isAstNode } from "./ast";

export type SourceParseResult =
  | { ok: true; program: AstNode }
  | { ok: false; message: string; location: SourceLocation };

export function parseSourceFile(filePath: string, source: string): SourceParseResult {
  try {
    const result = parseSync(filePath, source, {
      lang: getParserLang(filePath),
      sourceType: "module",
      astType: "ts",
      range: true
    });

    if (result.errors.length > 0) {
      const firstError = result.errors[0];
      const labelStart = firstError.labels[0]?.start ?? 0;

      return {
        ok: false,
        message: firstError.message,
        location: getLocation(source, labelStart)
      };
    }

    if (!isAstNode(result.program)) {
      return {
        ok: false,
        message: "Parser did not return a valid program AST.",
        location: { index: 0, line: 1, column: 1 }
      };
    }

    return { ok: true, program: result.program };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      location: { index: 0, line: 1, column: 1 }
    };
  }
}

function getParserLang(filePath: string): "js" | "jsx" | "ts" | "tsx" {
  const extension = path.extname(filePath);

  if (extension === ".jsx") {
    return "jsx";
  }

  if (extension === ".ts") {
    return "ts";
  }

  if (extension === ".tsx") {
    return "tsx";
  }

  return "js";
}
