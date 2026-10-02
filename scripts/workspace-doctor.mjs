import { accessSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBrowserExecutable } from "../packages/core/src/browser-executable.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandAvailable(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 5_000 });
  return !result.error && result.status === 0;
}

export function buildWorkspaceDoctorReport({
  root = repositoryRoot,
  nodeVersion = process.version,
  platform = process.platform,
  isExecutable = executable,
  isCommandAvailable = commandAvailable,
  environment = process.env,
  requireBrowser = false,
} = {}) {
  const failures = [];
  const warnings = [];
  const nodeMajor = Number(nodeVersion.replace(/^v/u, "").split(".")[0]);
  const tools = {
    vitePlus: isExecutable(resolve(root, "node_modules/.bin/vp")),
    relayRuntime: isExecutable(resolve(root, "node_modules/tsx/dist/cli.mjs")),
  };
  const resolvedBrowser = resolveBrowserExecutable({ platform, environment, isExecutable });
  const browser = {
    ...resolvedBrowser,
    available: resolvedBrowser.path ? [resolvedBrowser.path] : [],
    ready: Boolean(resolvedBrowser.path),
  };
  const android = { adb: isCommandAvailable("adb"), ready: isCommandAvailable("adb") };
  const ios = {
    xcrun: platform === "darwin" ? isCommandAvailable("xcrun", ["--version"]) : false,
    ready: platform === "darwin" && isCommandAvailable("xcrun", ["--version"]),
  };

  if (nodeMajor < 24) failures.push(`Node.js 24+ is required; found ${nodeVersion}.`);
  if (!tools.vitePlus) {
    failures.push(
      "Workspace dependencies are missing; run `corepack pnpm install --frozen-lockfile`.",
    );
  }
  if (!tools.relayRuntime) {
    failures.push("The local Relay CLI runtime is missing; reinstall workspace dependencies.");
  }
  if (!browser.ready) {
    const message = resolvedBrowser.configured
      ? `RELAY_BROWSER_EXECUTABLE is not executable: ${resolvedBrowser.candidates[0]}. Fix this path before starting Relay; no fallback will be used.`
      : "A supported Chromium browser is unavailable. Install Chrome or Chromium, or set RELAY_BROWSER_EXECUTABLE to an absolute executable path before starting Relay.";
    (requireBrowser ? failures : warnings).push(message);
  }
  if (!android.ready) warnings.push("adb is unavailable; Android targets will not be usable.");
  if (platform === "darwin" && !ios.ready) {
    warnings.push(
      "Apple developer tools are unavailable; physical iOS control will not be usable.",
    );
  }

  return {
    schemaVersion: 1,
    kind: "relay-workspace-doctor",
    ready: failures.length === 0,
    platform,
    node: { version: nodeVersion, major: nodeMajor, ready: nodeMajor >= 24 },
    tools,
    browser,
    android,
    ios,
    failures,
    warnings,
  };
}

function main(argv) {
  const json = argv.includes("--json");
  const unknown = argv.filter((argument) => argument !== "--json" && argument !== "--web");
  if (unknown.length) throw new Error(`Unknown option: ${unknown[0]}. Use --json and/or --web.`);
  const report = buildWorkspaceDoctorReport({ requireBrowser: argv.includes("--web") });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const warning of report.warnings) console.warn(`warning: ${warning}`);
    if (report.failures.length) {
      for (const failure of report.failures) console.error(`error: ${failure}`);
    } else {
      console.log("Relay workspace is ready. Start the desktop app with `pnpm dev:desktop`.");
    }
  }
  if (report.failures.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
