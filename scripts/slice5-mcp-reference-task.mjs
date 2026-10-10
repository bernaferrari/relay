/** Drive the default MCP qa profile over stdio exactly as an external coding
 * agent would and perform the Slice 5 leg of the reference task: run saved
 * coverage, read its verdict, and inspect a failure. Prints each step's outcome. */
import { spawn } from "node:child_process";

const server = spawn(
  "node",
  ["packages/mcp/dist/relay-mcp.js", "--profile", "qa", "--credential-source", "none"],
  {
    env: {
      ...process.env,
      RELAY_URL: "http://127.0.0.1:8787",
      RELAY_MCP_PROFILE: "qa",
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

function notification(method, params) {
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
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
      // Non-JSON keepalive line; ignore.
    }
  }
});

const text = (content) =>
  (content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");

try {
  const init = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "slice5-agent-verification", version: "1.0.0" },
  });
  console.log("initialized:", init.serverInfo.name, init.serverInfo.version);
  notification("notifications/initialized", {});

  const tools = await request("tools/list", {});
  const names = tools.tools.map((tool) => tool.name);
  console.log("tools:", names.join(", "));

  const health = await request("tools/call", { name: "relay_health", arguments: {} });
  console.log("health:", text(health.content).slice(0, 160));

  // relay_run_test waits for the verdict; a failure names the step to inspect.
  const run = await request("tools/call", {
    name: "relay_run_test",
    arguments: {
      appMapId: "slice4-reference",
      testId: "test-authoring-db290d27-fdbe-4bd4-bd36-db8030bf82d2",
      targetId: "slice4-chrome-admin",
      timeoutSeconds: 180,
    },
  });
  const outcome = run.structuredContent?.result ?? {};
  console.log("run:", text(run.content).slice(0, 300));
  if (outcome.status === "failed" && outcome.runId) {
    const failure = await request("tools/call", {
      name: "relay_inspect_failure",
      arguments: { runId: outcome.runId },
    });
    console.log("failure:", text(failure.content).slice(0, 300));
  }

  server.kill();
  process.exit(0);
} catch (error) {
  console.error("FAILED:", String(error).slice(0, 400));
  server.kill();
  process.exit(1);
}
