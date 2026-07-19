import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function findWorkspaceRoot(start = process.cwd()): string {
  let directory = start;
  for (;;) {
    if (
      existsSync(join(directory, "pnpm-workspace.yaml")) ||
      existsSync(join(directory, "pnpm-lock.yaml"))
    ) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) return start;
    directory = parent;
  }
}
