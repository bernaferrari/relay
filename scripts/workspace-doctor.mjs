import { accessSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const warnings = [];

function executable(path) {
  try {
    accessSync(resolve(repositoryRoot, path), constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandAvailable(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 5_000 });
  return !result.error && result.status === 0;
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 24) failures.push(`Node.js 24+ is required; found ${process.version}.`);
if (!executable("node_modules/.bin/vp")) {
  failures.push(
    "Workspace dependencies are missing; run `corepack pnpm install --frozen-lockfile`.",
  );
}
if (!executable("node_modules/tsx/dist/cli.mjs")) {
  failures.push("The local Relay CLI runtime is missing; reinstall workspace dependencies.");
}
if (!commandAvailable("adb")) {
  warnings.push("adb is unavailable; Android targets will not be usable.");
}
if (process.platform === "darwin" && !commandAvailable("xcrun", ["--version"])) {
  warnings.push("Apple developer tools are unavailable; physical iOS control will not be usable.");
}

for (const warning of warnings) console.warn(`warning: ${warning}`);
if (failures.length) {
  for (const failure of failures) console.error(`error: ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Relay workspace is ready. Start the desktop app with `pnpm dev:desktop`.");
}
