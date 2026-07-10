import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { defaultIgnores } from "./config";

const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx", ".mts"]);

export async function findSourceFiles(target: string, ignore: string[] = []): Promise<string[]> {
  const root = path.resolve(target);
  const ignoreMatchers = [...defaultIgnores, ...ignore].map(createIgnoreMatcher);
  const files: string[] = [];
  const targetStats = await stat(root);

  if (targetStats.isFile()) {
    const basename = path.basename(root);

    if (
      sourceExtensions.has(path.extname(basename)) &&
      !ignoreMatchers.some((matcher) => matcher(basename, basename))
    ) {
      return [root];
    }

    return [];
  }

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toPosixPath(path.relative(root, absolutePath));

      if (ignoreMatchers.some((matcher) => matcher(relativePath, entry.name))) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
        files.push(absolutePath);
      }
    }
  }

  await walk(root);
  return files.sort();
}

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function createIgnoreMatcher(pattern: string): (relativePath: string, basename: string) => boolean {
  const normalized = toPosixPath(pattern).replace(/^\/+|\/+$/g, "");

  if (!normalized.includes("*")) {
    return (relativePath, basename) =>
      basename === normalized ||
      relativePath === normalized ||
      relativePath.startsWith(`${normalized}/`) ||
      relativePath.includes(`/${normalized}/`);
  }

  const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`(^|/)${escaped}($|/)`);
  return (relativePath) => regex.test(relativePath);
}
