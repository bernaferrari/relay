import { accessSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const browserCandidates = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"],
  win32: ["chrome.exe", "chromium.exe", "msedge.exe"],
};

function browserAvailability(platform, isExecutable, isCommandAvailable) {
  const candidates = browserCandidates[platform] ?? browserCandidates.linux;
  const available = candidates.filter((candidate) =>
    candidate.startsWith("/") ? isExecutable(candidate) : isCommandAvailable(candidate),
  );
  return { candidates, available, ready: available.length > 0 };
}

export function buildWorkspaceDoctorReport({
  root = repositoryRoot,
  nodeVersion = process.version,
  platform = process.platform,
  isExecutable = executable,
  isCommandAvailable = commandAvailable,
} = {}) {
  const failures = [];
  const warnings = [];
  const nodeMajor = Number(nodeVersion.replace(/^v/u, "").split(".")[0]);
  const tools = {
    vitePlus: isExecutable(resolve(root, "node_modules/.bin/vp")),
    relayRuntime: isExecutable(resolve(root, "node_modules/tsx/dist/cli.mjs")),
  };
  const browser = browserAvailability(platform, isExecutable, isCommandAvailable);
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
  if (!browser.ready)
    warnings.push(
      "A supported Chromium browser is unavailable; browser targets will not be usable.",
    );
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
  const unknown = argv.filter((argument) => argument !== "--json");
  if (unknown.length) throw new Error(`Unknown option: ${unknown[0]}. Use --json or no options.`);
  const report = buildWorkspaceDoctorReport();
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
