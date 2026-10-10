/**
 * Tests as files: `relay apply <file|folder>`, `relay new --file`, and
 * `relay ci <folder>` read YAML Tests (name, url or app, steps) from disk.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { UsageError } from "./errors.js";
import type { EverydayInvoke } from "./everyday-names.js";

export type AppliedTestFile = {
  file: string;
  appId: string;
  testId: string;
  name: string;
  created: boolean;
  keptRecorded: number;
};

const TEST_FILE = new Set([".yaml", ".yml"]);

/** True when the argument names a file or folder on disk. */
export async function isPath(cwd: string, value: string): Promise<boolean> {
  try {
    await stat(resolve(cwd, value));
    return true;
  } catch {
    return false;
  }
}

export async function testFilePaths(cwd: string, value: string): Promise<string[]> {
  const root = resolve(cwd, value);
  const info = await stat(root).catch(() => undefined);
  if (!info) throw new UsageError(`No file or folder at ${value}`);
  if (info.isFile()) return [root];
  const found: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (TEST_FILE.has(extname(entry.name).toLowerCase())) found.push(path);
    }
  };
  await walk(root);
  if (!found.length) throw new UsageError(`No .yaml test files in ${value}`);
  return found.sort();
}

/** Apply every test file; a bad file is reported with its path and the field to fix. */
export async function applyTestFiles(
  invoke: EverydayInvoke,
  cwd: string,
  value: string,
): Promise<AppliedTestFile[]> {
  const applied: AppliedTestFile[] = [];
  for (const path of await testFilePaths(cwd, value)) {
    const file = relative(cwd, path) || path;
    const yaml = await readFile(path, "utf8");
    try {
      const result = (await invoke("test.apply-yaml", { yaml })) as Omit<AppliedTestFile, "file">;
      applied.push({ file, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new UsageError(`${file}: ${message}`);
    }
  }
  return applied;
}
