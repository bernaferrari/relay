/** Drive the default MCP operator profile over stdio exactly as an external
 * coding agent would (same launch line as .cursor/mcp.json) and perform the
 * Slice 5 leg of the reference task: run saved coverage, observe the durable
 * activity, read findings/evidence. Prints each step's outcome. */
import { spawn } from "node:child_process";

const server = spawn(
  "node",
  ["packages/mcp/dist/relay-mcp.js", "--profile", "operator", "--credential-source", "none"],
  {
    env: {
      ...process.env,
      RELAY_URL: "http://127.0.0.1:8787",
      RELAY_MCP_PROFILE: "operator",
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

  // app-map.get exceeds the MCP text limit (by design — maps are large), so a
  // coding agent resolves the revision through relay_advanced once and passes
  // it explicitly, exactly like the CLI flow.
  const revision = 12;
  const runTest = async (rev) =>
    request("tools/call", {
      name: "relay_run",
      arguments: {
        appMapId: "slice4-reference",
        testId: "test-authoring-db290d27-fdbe-4bd4-bd36-db8030bf82d2",
        expectedRevision: rev,
        target: { targetId: "slice4-chrome-admin", platform: "browser", kind: "browser" },
      },
    });
  let run = await runTest(revision);
  let runText = text(run.content);
  let parsedRun = JSON.parse(runText.slice(runText.indexOf("{")));
  // The blocked state names the next action: adopt the current revision and retry once.
  if (parsedRun.code === "revision-conflict" && parsedRun.currentRevision !== undefined) {
    console.log("retry after revision-conflict →", parsedRun.currentRevision);
    run = await runTest(parsedRun.currentRevision);
    runText = text(run.content);
    parsedRun = JSON.parse(runText.slice(runText.indexOf("{")));
  }
  console.log("run:", runText.slice(0, 300));
  const jobId = run.structuredContent?.result?.job?.id ?? parsedRun?.job?.id;
  if (jobId) {
    const waited = await request("tools/call", {
      name: "relay_wait",
      arguments: { jobId, wait: true, timeoutMs: 180_000 },
    });
    console.log("wait:", text(waited.content).slice(0, 200));
    const evidence = await request("tools/call", {
      name: "relay_evidence",
      arguments: { runId: jobId },
    });
    console.log("evidence:", text(evidence.content).slice(0, 300));
  }

  server.kill();
  process.exit(0);
} catch (error) {
  console.error("FAILED:", String(error).slice(0, 400));
  server.kill();
  process.exit(1);
}
