import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? packageRoot,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

async function runAsync(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? packageRoot,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr.on("data", (chunk) => (stderr += String(chunk)));
  return await new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (status) => {
      if (status !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed (${status}):\n${stdout}\n${stderr}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
  return port;
}

function fixtureOperationIds(source) {
  const descriptorIds = [...source.matchAll(/operationId:\s*["']([^"']+)["']/gu)].map(
    (match) => match[1],
  );
  // Proof lifecycle entries are intentionally composed from the canonical
  // registry and listed as strings in the profile. Read those names for the
  // fixture; do not maintain a second product operation list here.
  const proofIds = [...source.matchAll(/["'](proof\.[A-Za-z0-9.-]+)["']/gu)].map(
    (match) => match[1],
  );
  return [...new Set([...descriptorIds, ...proofIds])];
}

async function startFixture(operationIds) {
  const fixture = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("Content-Type", "application/json");
    if (url.pathname === "/health") {
      response.end(
        JSON.stringify({
          ok: true,
          version: "0.1.0",
          product: "relay",
          at: Date.now(),
          uptimeMs: 1,
          access: { organizationId: "local", projectId: "clean-host", role: "admin" },
        }),
      );
      return;
    }
    if (url.pathname === "/meta") {
      response.end(JSON.stringify({ operations: operationIds.map((id) => ({ id })) }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolvePromise, reject) => {
    fixture.once("error", reject);
    fixture.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = fixture.address();
  assert.ok(address && typeof address !== "string");
  return { fixture, url: `http://127.0.0.1:${address.port}` };
}

async function readMcpResponses(
  command,
  args,
  environment,
  callHealth = false,
  supportsApps = false,
) {
  const child = spawn(command, args, {
    env: { ...process.env, ...environment },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const responses = [];
  let output = "";
  let stderr = "";
  const complete = () =>
    [2, 3, 4, ...(callHealth ? [5] : []), ...(supportsApps ? [6] : [])].every((id) =>
      responses.some((response) => response.id === id),
    );
  const done = new Promise((resolvePromise, reject) => {
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      for (const line of output.split("\n").slice(0, -1)) {
        if (!line.trim()) continue;
        try {
          responses.push(JSON.parse(line));
        } catch (error) {
          reject(error);
          return;
        }
      }
      output = output.slice(output.lastIndexOf("\n") + 1);
      if (complete()) resolvePromise();
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!complete()) {
        reject(new Error(`relay-mcp exited before tool and guide discovery (${code}): ${stderr}`));
      }
    });
  });
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: supportsApps
          ? {
              extensions: {
                "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
              },
            }
          : {},
        clientInfo: { name: "relay-clean-host-test", version: "1" },
      },
    })}\n`,
  );
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`,
  );
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
  );
  for (const [id, uri] of [
    [3, "relay://guides"],
    [4, "relay://guides/waits"],
  ]) {
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method: "resources/read", params: { uri } })}\n`,
    );
  }
  if (callHealth)
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "relay_health", arguments: {} } })}\n`,
    );
  if (supportsApps)
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 6, method: "resources/read", params: { uri: "ui://relay/review" } })}\n`,
    );
  let timeout;
  try {
    await Promise.race([
      done,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("stdio MCP response timed out")), 30_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    child.kill();
  }
  const index = responses.find((response) => response.id === 3);
  assert.ok(index?.result?.contents?.[0]?.text, JSON.stringify(index));
  assert.match(index.result.contents[0].text, /relay:\/\/guides\/record/u);
  const waits = responses.find((response) => response.id === 4);
  assert.ok(waits?.result?.contents?.[0]?.text, JSON.stringify(waits));
  const guide = JSON.parse(waits.result.contents[0].text).data;
  assert.equal(guide.topic, "waits");
  assert.match(guide.markdown, /timeout is the maximum wait/u);
  return responses;
}

async function typecheckPublicExports(installRoot) {
  const smokePath = join(installRoot, "mcp-public-exports-smoke.ts");
  await writeFile(
    smokePath,
    [
      'import { createMcpServer } from "@relay/mcp";',
      'import { parseMcpConfig, type McpConfig } from "@relay/mcp/config";',
      'import { relayMcpPrompts, type RelayMcpPromptDescriptor } from "@relay/mcp/prompts";',
      'import { runRelayMcpDoctor, type RelayMcpDoctorReport } from "@relay/mcp/doctor";',
      'const config: McpConfig = parseMcpConfig(["--credential-source", "none"], {});',
      "const prompt: RelayMcpPromptDescriptor | undefined = relayMcpPrompts[0];",
      "const reportPromise: Promise<RelayMcpDoctorReport> = runRelayMcpDoctor([], {});",
      "void [createMcpServer, config, prompt, reportPromise];",
      "",
    ].join("\n"),
  );
  await runAsync(
    process.execPath,
    [
      resolve(repositoryRoot, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--strict",
      "--skipLibCheck",
      smokePath,
    ],
    { cwd: installRoot },
  );
}

async function main() {
  const toolsSource = await readFile(join(packageRoot, "src/tools.ts"), "utf8");
  const qaSource = await readFile(join(packageRoot, "src/qa-tools.ts"), "utf8");
  const qaIds = [...qaSource.matchAll(/"([a-z][a-z.-]*\.[a-z.-]+)"/gu)].map((match) => match[1]);
  const operationIds = [...new Set([...fixtureOperationIds(toolsSource), ...qaIds])];
  const tempRoot = await mkdtemp(join(tmpdir(), "relay-mcp-clean-host-"));
  let fixture;
  try {
    const copiedPlugin = join(tempRoot, "relay-proof");
    await cp(join(repositoryRoot, "plugins/relay-proof"), copiedPlugin, { recursive: true });
    run(process.execPath, [join(copiedPlugin, "scripts/validate-package.mjs")], { cwd: tempRoot });
    const copiedConfig = JSON.parse(await readFile(join(copiedPlugin, "mcp.json"), "utf8"));
    const packResult = run("npm", ["pack", "--json", "--pack-destination", tempRoot]);
    const packMetadata = JSON.parse(packResult.stdout.trim());
    assert.equal(packMetadata.length, 1);
    const tarball = join(tempRoot, basename(packMetadata[0].filename));
    const installRoot = join(tempRoot, "install");
    await mkdir(installRoot, { recursive: true });
    run("npm", ["init", "--yes"], { cwd: installRoot });
    run("npm", ["install", "--ignore-scripts", "--no-save", tarball], { cwd: installRoot });
    const offlineGuide = run(
      process.execPath,
      [join(installRoot, "node_modules/@relay/mcp/dist/relay-mcp.js"), "guide", "waits", "--json"],
      {
        cwd: installRoot,
        env: {
          RELAY_URL: "http://127.0.0.1:1",
          RELAY_CREDENTIAL_SOURCE: "env:MISSING_GUIDE_TOKEN",
          MISSING_GUIDE_TOKEN: "",
        },
      },
    );
    assert.equal(JSON.parse(offlineGuide.stdout).topic, "waits");
    assert.match(JSON.parse(offlineGuide.stdout).markdown, /timeout is the maximum wait/u);
    await typecheckPublicExports(installRoot);
    ({ fixture } = await startFixture(operationIds));
    const address = fixture.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const bin = join(installRoot, "node_modules", ".bin");
    const env = {
      RELAY_URL: url,
      RELAY_ORGANIZATION_ID: "local",
      RELAY_PROJECT_ID: "clean-host",
      RELAY_ACTOR_ID: "agent:clean-host",
      RELAY_CREDENTIAL_SOURCE: "none",
      RELAY_MCP_PROFILE: "proof",
    };

    const doctor = await runAsync(process.execPath, [join(bin, "relay-proof-doctor"), "--json"], {
      cwd: installRoot,
      env,
    });
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.ok, true);
    assert.equal(
      report.checks.every((check) => check.ok),
      true,
    );
    assert.doesNotMatch(doctor.stdout, /RELAY_AUTH_TOKEN|bridge-secret|Bearer\s+[^\s}]+/giu);

    const npxDoctor = await runAsync(
      "npx",
      ["--no-install", "--package", "@relay/mcp", "relay-proof-doctor", "--json"],
      { cwd: installRoot, env },
    );
    assert.equal(JSON.parse(npxDoctor.stdout).ok, true);

    const responses = await readMcpResponses(join(bin, "relay-mcp"), ["--profile", "proof"], env);
    const tools = responses.find((response) => response.id === 2)?.result?.tools;
    assert.ok(Array.isArray(tools));
    assert.ok(tools.some((tool) => tool.name === "relay_proof_start"));
    const outcomeResponses = await readMcpResponses(join(bin, "relay-mcp"), [], {
      ...env,
      RELAY_MCP_PROFILE: "outcome",
    });
    const outcomeTools = outcomeResponses.find((response) => response.id === 2)?.result?.tools;
    assert.ok(Array.isArray(outcomeTools));
    assert.ok(outcomeTools.some((tool) => tool.name === "relay_prove_change"));
    assert.ok(outcomeTools.some((tool) => tool.name === "relay_proof_analyze"));

    const qaEnv = { ...env, RELAY_MCP_PROFILE: "qa" };
    const qaDoctor = await runAsync(
      process.execPath,
      [join(bin, "relay-mcp"), "doctor", "--profile", "qa", "--json"],
      { cwd: installRoot, env: qaEnv },
    );
    assert.equal(JSON.parse(qaDoctor.stdout).ok, true);
    const qaResponses = await readMcpResponses(
      join(bin, copiedConfig.mcpServers.relay.command),
      copiedConfig.mcpServers.relay.args,
      qaEnv,
      true,
    );
    const qaTools = qaResponses.find((response) => response.id === 2)?.result?.tools;
    assert.equal(qaTools.length, 23);
    const fallbackPanel = qaTools.find((tool) => tool.name === "relay_panel");
    assert.equal(fallbackPanel.annotations.readOnlyHint, true);
    assert.equal(fallbackPanel._meta?.ui, undefined);
    assert.ok(qaTools.some((tool) => tool.name === "relay_record_test"));
    assert.ok(qaTools.some((tool) => tool.name === "relay_run_test"));
    assert.ok(qaTools.some((tool) => tool.name === "relay_inspect_workflow"));
    assert.equal(
      qaTools.some((tool) => tool.name === "relay_prove_change"),
      false,
    );
    assert.notEqual(
      qaResponses.find((response) => response.id === 5)?.result?.isError,
      true,
      JSON.stringify(qaResponses.find((response) => response.id === 5)),
    );

    const appResponses = await readMcpResponses(
      join(bin, copiedConfig.mcpServers.relay.command),
      copiedConfig.mcpServers.relay.args,
      qaEnv,
      false,
      true,
    );
    const appTool = appResponses
      .find((response) => response.id === 2)
      ?.result?.tools.find((tool) => tool.name === "relay_panel");
    assert.equal(appTool._meta.ui.resourceUri, "ui://relay/review");
    const panel = appResponses.find((response) => response.id === 6)?.result?.contents?.[0];
    assert.ok(panel, JSON.stringify(appResponses.find((response) => response.id === 6)));
    assert.equal(panel.mimeType, "text/html;profile=mcp-app");
    assert.deepEqual(panel._meta["openai/ui"].availableDisplayModes, ["fullscreen"]);
    assert.match(panel.text, /Tests and results/);
    assert.match(panel.text, /type="module"/);
    assert.doesNotMatch(panel.text, /RELAY_PANEL_SCRIPT|packages\/mcp\/panel|src="https?:/);

    const bridgePort = await freePort();
    const bridge = spawn(join(bin, "relay-mcp-bridge"), [], {
      cwd: installRoot,
      env: {
        ...process.env,
        ...env,
        RELAY_MCP_BRIDGE_PORT: String(bridgePort),
        RELAY_MCP_BRIDGE_AUTH_TOKEN: "bridge-secret",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let bridgeStderr = "";
    const ready = new Promise((resolvePromise, reject) => {
      bridge.stderr.on("data", (chunk) => {
        bridgeStderr += String(chunk);
        if (bridgeStderr.includes("listening")) resolvePromise();
      });
      bridge.once("exit", (code) => reject(new Error(`bridge exited (${code}): ${bridgeStderr}`)));
    });
    let bridgeTimeout;
    try {
      await Promise.race([
        ready,
        new Promise((_, reject) => {
          bridgeTimeout = setTimeout(() => reject(new Error("bridge did not start")), 30_000);
        }),
      ]);
    } finally {
      if (bridgeTimeout) clearTimeout(bridgeTimeout);
    }
    const endpoint = `http://127.0.0.1:${bridgePort}/mcp`;
    const headers = { Authorization: "Bearer bridge-secret", "Content-Type": "application/json" };
    try {
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
            clientInfo: { name: "clean-host", version: "1" },
          },
        }),
      });
      assert.equal(initialize.status, 200);
      const sessionId = initialize.headers.get("mcp-session-id");
      assert.ok(sessionId);
      const list = await fetch(endpoint, {
        method: "POST",
        headers: { ...headers, "MCP-Session-Id": sessionId },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });
      assert.equal(list.status, 200);
      assert.ok((await list.json()).result.tools.some((tool) => tool.name === "relay_proof_start"));
    } finally {
      bridge.kill();
    }
    console.log(
      "clean-host MCP package, doctor, stdio, and ChatGPT-compatible bridge checks passed",
    );
  } finally {
    if (fixture) await new Promise((resolvePromise) => fixture.close(resolvePromise));
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
