import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const vendorDir = join(root, "vendor", "agent-device");
const overrideDir = join(root, "vendor", "agent-device-relay-overrides", "dist", "src");

await new Promise((resolvePromise, reject) => {
  const child = spawn("corepack", ["pnpm@11.1.2", "build"], {
    cwd: vendorDir,
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) resolvePromise();
    else {
      const reason = signal ? ` (${signal})` : ` with exit code ${code}`;
      reject(new Error(`agent-device build failed${reason}`));
    }
  });
});

const overrideNames = ["2948.js", "495.js", "9722.js", "index.d.ts", "interactor.js", "session.js"];
const outputDir = join(vendorDir, "dist", "src");
await mkdir(outputDir, { recursive: true });
for (const name of overrideNames) {
  await cp(join(overrideDir, name), join(outputDir, name));
}

console.log(
  `Applied ${overrideNames.length} Relay runtime overrides to vendor/agent-device/dist/src`,
);
