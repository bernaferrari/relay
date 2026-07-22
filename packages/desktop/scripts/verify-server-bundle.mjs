import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleServer } from "./bundle-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = 18_000 + Math.floor(Math.random() * 1_000);
await bundleServer();
const child = spawn(
  process.execPath,
  [resolve(root, "out/server/index.cjs"), "--port", String(port)],
  {
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let stderr = "";
child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
try {
  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await response.json();
      if (response.ok && body.product === "relay" && body.version === "0.1.0") {
        healthy = true;
        break;
      }
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  if (!healthy) throw new Error(`bundled server did not become healthy\n${stderr}`);
  console.log("[desktop] bundled server health verified");
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 1_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}
