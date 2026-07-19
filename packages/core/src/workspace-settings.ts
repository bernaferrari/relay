import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { findWorkspaceRoot } from "./workspace-root.js";

export function workspaceSettingFile(relativePath: string): string {
  const root = process.env.RELAY_WORKSPACE_ROOT?.trim() || findWorkspaceRoot();
  return join(root, ".relay", relativePath);
}

export async function readWorkspaceSetting(relativePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(workspaceSettingFile(relativePath), "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeWorkspaceSetting(relativePath: string, value: unknown): Promise<void> {
  const file = workspaceSettingFile(relativePath);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await mkdir(dirname(file), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
