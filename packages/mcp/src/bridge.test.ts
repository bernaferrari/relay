import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createRelayMcpBridge,
  parseRelayMcpBridgeConfig,
  type RelayMcpBridgeConfig,
} from "./bridge.js";

test("bridge defaults to an authenticated loopback endpoint and keeps only an env reference", () => {
  const config = parseRelayMcpBridgeConfig([], {
    RELAY_MCP_BRIDGE_AUTH_TOKEN: "do-not-copy-this",
    RELAY_MCP_BRIDGE_SERVER: "/tmp/relay-mcp.js",
  });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.path, "/mcp");
  assert.equal(config.authEnv, "RELAY_MCP_BRIDGE_AUTH_TOKEN");
  assert.equal(JSON.stringify(config).includes("do-not-copy-this"), false);
});

test("bridge refuses an unauthenticated public bind and unsupported inline credentials", () => {
  assert.throws(
    () =>
      parseRelayMcpBridgeConfig(["--host", "0.0.0.0", "--auth-env", "none"], {
        RELAY_MCP_BRIDGE_SERVER: "/tmp/relay-mcp.js",
      }),
    /only allowed on loopback/u,
  );
  assert.throws(
    () => parseRelayMcpBridgeConfig(["--auth-token", "secret"], {}),
    /Unknown option: --auth-token/u,
  );
});

test("bridge carries one MCP session between HTTP and the reviewed stdio child", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-mcp-bridge-test-"));
  const fakeServer = join(directory, "fake-relay-mcp.mjs");
  await writeFile(
    fakeServer,
    [
      "process.stdin.setEncoding('utf8');",
      "let buffer = '';",
      "process.stdin.on('data', (chunk) => {",
      "  buffer += chunk;",
      "  while (buffer.includes('\\n')) {",
      "    const index = buffer.indexOf('\\n');",
      "    const request = JSON.parse(buffer.slice(0, index));",
      "    buffer = buffer.slice(index + 1);",
      "    if (request.id === undefined) continue;",
      "    const result = request.method === 'initialize'",
      "      ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } }",
      "      : { tools: [{ name: 'relay_proof_start', inputSchema: { type: 'object' } }] };",
      "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');",
      "  }",
      "});",
    ].join("\n"),
  );
  await chmod(fakeServer, 0o755);
  const config: RelayMcpBridgeConfig = parseRelayMcpBridgeConfig(["--port", "8788"], {
    RELAY_MCP_BRIDGE_AUTH_TOKEN: "bridge-secret",
    RELAY_MCP_BRIDGE_SERVER: fakeServer,
  });
  const bridge = await createRelayMcpBridge(config, {
    RELAY_MCP_BRIDGE_AUTH_TOKEN: "bridge-secret",
    RELAY_MCP_BRIDGE_SERVER: fakeServer,
  });
  await new Promise<void>((resolve) => bridge.server.listen(0, "127.0.0.1", resolve));
  const address = bridge.server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}${config.path}`;
  const headers = {
    Authorization: "Bearer bridge-secret",
    "Content-Type": "application/json",
  };
  try {
    const unauthorized = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(unauthorized.status, 401);

    const initialize = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      }),
    });
    assert.equal(initialize.status, 200);
    const sessionId = initialize.headers.get("mcp-session-id");
    assert.ok(sessionId);
    assert.equal((await initialize.json()).result.serverInfo.name, "fake");

    const tools = await fetch(endpoint, {
      method: "POST",
      headers: { ...headers, "MCP-Session-Id": sessionId },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    assert.equal(tools.status, 200);
    assert.equal((await tools.json()).result.tools[0].name, "relay_proof_start");

    const deleted = await fetch(endpoint, {
      method: "DELETE",
      headers: { Authorization: headers.Authorization, "MCP-Session-Id": sessionId },
    });
    assert.equal(deleted.status, 204);
  } finally {
    await bridge.close();
    await rm(directory, { recursive: true, force: true });
  }
});
