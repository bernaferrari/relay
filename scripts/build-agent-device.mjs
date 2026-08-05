import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const vendorDir = join(root, "vendor", "agent-device");

await new Promise((resolvePromise, reject) => {
  const child = spawn("pnpm", ["build"], {
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

console.log("Built the vendored agent-device source without a compiled override layer.");
