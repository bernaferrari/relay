import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleServer } from "./bundle-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = 18_000 + Math.floor(Math.random() * 1_000);
const SERVER_STARTUP_TIMEOUT_MS = 30_000;
await bundleServer();
const child = spawn(
  process.execPath,
  [resolve(root, "out/server/index.cjs"), "--port", String(port)],
  {
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let stderr = "";
let stdout = "";
child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
try {
  let healthy = false;
  let lastProbe = "server did not accept a connection";
  const deadline = Date.now() + SERVER_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const requestId = crypto.randomUUID();
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: {
          "X-Relay-Actor-Id": "system:desktop-verifier",
          "X-Relay-Actor-Kind": "system",
          "X-Relay-Operation-Id": "system.health.get",
          "X-Relay-Request-Id": requestId,
          "X-Relay-Command-At": String(Date.now()),
          "Idempotency-Key": requestId,
        },
      });
      const body = await response.json();
      if (response.ok && body.product === "relay" && body.version === "0.1.0") {
        healthy = true;
        break;
      }
      lastProbe = `HTTP ${response.status}: ${JSON.stringify(body).slice(0, 500)}`;
    } catch (error) {
      lastProbe = error instanceof Error ? error.message : String(error);
    }
    // Full-repository verification runs package tests concurrently. Give the
    // freshly loaded 8 MB bundle a fair, bounded startup window even when a
    // probe receives a non-health response instead of throwing.
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  if (!healthy) {
    throw new Error(
      [
        `bundled server did not become healthy within ${SERVER_STARTUP_TIMEOUT_MS / 1_000}s`,
        `last probe: ${lastProbe}`,
        `exit: ${child.exitCode ?? "running"}`,
        stdout.trim() ? `stdout:\n${stdout.trim()}` : "",
        stderr.trim() ? `stderr:\n${stderr.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  console.log("[desktop] bundled server health verified");
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 1_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}
