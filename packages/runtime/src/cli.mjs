import { isAbsolute } from "node:path";
import { ensureRelayRuntime } from "./startup.mjs";

const usage =
  "Usage: relay-runtime start --workspace /absolute/path [--port 8787]";
try {
  const argv = process.argv.slice(2);
  const command = argv.shift();
  const values = new Map();
  if (command !== "start") throw new Error(usage);
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!["--workspace", "--port"].includes(option)) throw new Error(usage);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${option} requires a value. ${usage}`);
    values.set(option, value);
  }
  const workspaceRoot = values.get("--workspace");
  if (!workspaceRoot || !isAbsolute(workspaceRoot)) throw new Error(usage);
  const port = Number(values.get("--port") ?? 8787);
  const runtime = await ensureRelayRuntime({ workspaceRoot, port });
  console.log(JSON.stringify(runtime));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
