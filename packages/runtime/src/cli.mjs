import { isAbsolute } from "node:path";
import { ensureRelayRuntime } from "./startup.mjs";

const usage =
  "Usage: relay-runtime start|demo|repeat --workspace /absolute/path [--port 8787] [--fixture-port 8792] [--once]";
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
try {
  const argv = process.argv.slice(2);
  const command = argv.shift();
  const values = new Map();
  let once = false;
  if (!["start", "demo", "repeat"].includes(command)) throw new Error(usage);
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--once") {
      once = true;
      continue;
    }
    if (!["--workspace", "--port", "--fixture-port"].includes(option)) throw new Error(usage);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${option} requires a value. ${usage}`);
    values.set(option, value);
  }
  const workspaceRoot = values.get("--workspace");
  if (!workspaceRoot || !isAbsolute(workspaceRoot)) throw new Error(usage);
  const port = Number(values.get("--port") ?? 8787);
  const fixturePort = Number(values.get("--fixture-port") ?? 8792);
  if (!Number.isInteger(fixturePort) || fixturePort < 1 || fixturePort > 65535)
    throw new Error("Fixture port must be an integer from 1 to 65535.");
  const runtime = await ensureRelayRuntime({ workspaceRoot, port });
  console.log(JSON.stringify(runtime));
  if (command === "demo" || command === "repeat") {
    const { runPackagedDemo } = await import("./demo.mjs");
    const invocation = `node ${quote(process.argv[1])}`;
    const workspaceArgs = `--workspace ${quote(workspaceRoot)} --port ${new URL(runtime.url).port} --fixture-port ${fixturePort}`;
    const repeatCommand = `${invocation} repeat ${workspaceArgs}`;
    await runPackagedDemo({
      workspaceRoot,
      serverUrl: runtime.url,
      port: fixturePort,
      once,
      repeatCommand,
      reuseFixture: command === "repeat",
      recovery: {
        missingBrowser:
          "Install Chrome or Chromium, or set RELAY_BROWSER_EXECUTABLE to its absolute executable path, then retry.",
        unavailableServer: `Start it with: ${invocation} start --workspace ${quote(workspaceRoot)} --port ${new URL(runtime.url).port}`,
        restartDemo: `Start ${invocation} demo ${workspaceArgs}, leave it open, then repeat.`,
      },
    });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
