import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const vendorDir = join(root, "vendor", "agent-device");
const patchDir = join(root, "patches", "agent-device");
const upstreamCommit = "3e0814c574f55e92b5d067bcdfbb0720c12b9e26";

function git(args, options = {}) {
  return execFileSync("git", ["-C", vendorDir, ...args], { encoding: "utf8", ...options });
}

if (!existsSync(join(vendorDir, ".git"))) {
  execFileSync("git", ["submodule", "update", "--init", "vendor/agent-device"], {
    cwd: root,
    stdio: "inherit",
  });
}

const head = git(["rev-parse", "HEAD"]).trim();
if (head !== upstreamCommit) {
  throw new Error(`agent-device must be pinned to ${upstreamCommit}; found ${head}`);
}

for (const patch of readdirSync(patchDir)
  .filter((name) => name.endsWith(".patch"))
  .sort()) {
  const patchPath = join(patchDir, patch);
  try {
    git(["apply", "--check", patchPath], { stdio: "pipe" });
    git(["apply", patchPath], { stdio: "inherit" });
    console.log(`applied ${patch}`);
  } catch {
    try {
      git(["apply", "--reverse", "--check", patchPath], { stdio: "pipe" });
      console.log(`${patch} already applied`);
    } catch {
      throw new Error(`${patch} neither applies cleanly nor matches the applied agent-device tree`);
    }
  }
}

execFileSync("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], {
  cwd: vendorDir,
  stdio: "inherit",
});

// Relay core bundles its own copy of the snapshot helper for packaged servers.
// Keep that copy on the vendor's exact version so the SDK never installs
// mismatched instrumentation.
const helperDist = join(vendorDir, "android", "snapshot-helper", "dist");
const helperTarget = join(root, "packages", "core", "android-helpers");
const version = JSON.parse(readFileSync(join(vendorDir, "package.json"), "utf8")).version;
const artifactBase = `agent-device-android-snapshot-helper-${version}`;
for (const stale of readdirSync(helperTarget).filter((name) =>
  /^agent-device-android-snapshot-helper-.*\.(apk|manifest\.json)$/u.test(name),
)) {
  rmSync(join(helperTarget, stale));
}
for (const suffix of [".apk", ".manifest.json"]) {
  copyFileSync(join(helperDist, artifactBase + suffix), join(helperTarget, artifactBase + suffix));
}
console.log(`synced ${artifactBase} into packages/core/android-helpers`);
