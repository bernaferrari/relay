#!/usr/bin/env node
/**
 * Repo-local `relay` entry. Exec tsx against the CLI source with the
 * repository as cwd so pnpm never sits between us and stdout. The caller's
 * directory travels in RELAY_CALLER_CWD so --out, --file, --output, and
 * relay.json resolve where the person typed the command.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "packages/cli/src/index.ts", ...process.argv.slice(2)],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, RELAY_CALLER_CWD: process.env.RELAY_CALLER_CWD || process.cwd() },
  },
);
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 1);
