import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { startServer } from "../../server/src/index.ts";

const started = await startServer({
  port: Number(process.env.RELAY_PORT ?? 8787),
  host: "127.0.0.1",
  token: process.env.RELAY_AUTH_TOKEN,
});
const identity = {
  schemaVersion: 1,
  product: "relay",
  version: "0.1.0",
  pid: process.pid,
  url: `http://127.0.0.1:${started.port}`,
  workspaceRoot: process.env.RELAY_WORKSPACE_ROOT,
  stateDirectory: process.env.RELAY_STATE_DIR,
  startedAt: Date.now(),
};
await mkdir(identity.stateDirectory, { recursive: true });
await writeFile(
  resolve(identity.stateDirectory, "runtime.json"),
  JSON.stringify(identity, null, 2),
  { mode: 0o600 },
);
process.send?.({ type: "relay-runtime-ready", identity });
console.log(`Relay runtime ready at ${identity.url}`);
