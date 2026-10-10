/** Live check: the device profile's relay_screenshot accepts a saved sign-in
 * (laneId) and captures through its exact account context (§10 CLI/MCP parity). */
import { spawn } from "node:child_process";

const server = spawn(
  "node",
  ["packages/mcp/dist/relay-mcp.js", "--profile", "device", "--credential-source", "none"],
  {
    env: {
      ...process.env,
      RELAY_URL: "http://127.0.0.1:8787",
      RELAY_ACTOR_ID: "agent:cursor",
      RELAY_ORGANIZATION_ID: "local",
      RELAY_PROJECT_ID: "default",
    },
    stdio: ["pipe", "pipe", "inherit"],
  },
);
let nextId = 1;
const pending = new Map();
let buffer = "";
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}
server.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
        else waiter.resolve(message.result);
      }
    } catch {
      // ignore keepalive
    }
  }
});
await request("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "lane-shot-check", version: "0.0.0" },
});
const shot = await request("tools/call", {
  name: "relay_screenshot",
  arguments: { laneId: "slice4-member" },
});
console.log(
  JSON.stringify({
    ok: !shot.isError,
    hasImage: Boolean(shot.content?.some((c) => c.type === "image")),
    text: shot.content?.find((c) => c.type === "text")?.text?.slice(0, 200),
  }),
);
server.kill();
