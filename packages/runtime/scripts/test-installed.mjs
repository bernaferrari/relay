import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  chmod,
  stat,
  realpath,
} from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import net from "node:net";
import http from "node:http";

const execute = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const temporary = await realpath(await mkdtemp(resolve(tmpdir(), "relay-runtime-installed-")));
const installation = resolve(temporary, "installation");
const workspace = resolve(temporary, "workspace");
const authenticatedWorkspace = resolve(temporary, "authenticated-workspace");
await mkdir(installation);
await mkdir(workspace);
const port = await freePort();
const fixturePort = await freePort();
let runtime;
let liveDemo;
const token = "installed-runtime-test-credential";
const authorized = { headers: { Authorization: `Bearer ${token}` } };

async function freePort() {
  const server = net.createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
async function readOnly(path, readonly = true) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) await readOnly(child, readonly);
    else await chmod(child, readonly ? ((await stat(child)).mode & 0o111 ? 0o555 : 0o444) : 0o644);
  }
  await chmod(path, readonly ? 0o555 : 0o755);
}
function parseStartup(output) {
  return JSON.parse(
    output
      .trim()
      .split("\n")
      .find((line) => line.startsWith("{")),
  );
}
function launch(args, credential = "") {
  return execute(process.execPath, [cli, ...args], {
    cwd: installation,
    env: launchEnvironment(args, credential),
    timeout: 150_000,
    maxBuffer: 4_000_000,
  });
}
function launchEnvironment(args, credential = "") {
  return {
    ...process.env,
    NODE_PATH: "",
    AGENT_DEVICE_STATE_DIR: resolve(
      args[args.indexOf("--workspace") + 1] ?? workspace,
      ".relay/agent-device",
    ),
    RELAY_AUTH_TOKEN: credential,
    RELAY_AUTH_SUBJECT: "agent:installed-runtime-test",
    RELAY_ACTOR_ID: "agent:installed-runtime-test",
  };
}
async function launchLiveDemo(args) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: installation,
    env: launchEnvironment(args),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const exited = new Promise((done) => child.once("exit", done));
  const handle = {
    get stdout() {
      return stdout;
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGINT");
      let timeout;
      try {
        await Promise.race([
          exited,
          new Promise((_done, reject) => {
            timeout = setTimeout(() => reject(new Error("Owned demo did not close")), 10_000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    },
  };
  liveDemo = handle;
  let timeout;
  try {
    await new Promise((done, reject) => {
      timeout = setTimeout(() => reject(new Error(`Live demo timed out: ${stderr}`)), 150_000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (stdout.includes("The demo website stays available")) done();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`Live demo exited (${code}): ${stderr}`)));
    });
    return handle;
  } finally {
    clearTimeout(timeout);
  }
}
function outputValue(output, label) {
  const value = output.split("\n").find((line) => line.startsWith(`${label}: `));
  assert.ok(value, `Missing ${label} in demo output`);
  return value.slice(label.length + 2);
}
const startArgs = ["start", "--workspace", workspace, "--port", String(port)];
let cli;
async function inspectInstalledMcp(args, credential = "") {
  const child = spawn(
    process.execPath,
    [
      resolve(installation, "node_modules/@relay/mcp/dist/relay-mcp.js"),
      "--profile",
      "device",
      ...args,
    ],
    {
      cwd: installation,
      env: {
        ...process.env,
        NODE_PATH: "",
        RELAY_URL: "",
        RELAY_ORGANIZATION_ID: "local",
        RELAY_PROJECT_ID: "default",
        RELAY_AUTH_TOKEN: credential,
        RELAY_AUTH_SUBJECT: "agent:installed-runtime-test",
        RELAY_ACTOR_ID: "agent:installed-runtime-test",
        AGENT_DEVICE_STATE_DIR: resolve(
          args[args.indexOf("--workspace") + 1] ?? workspace,
          ".relay/agent-device",
        ),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let buffered = "";
  let errors = "";
  const responses = [];
  let timeout;
  try {
    const done = new Promise((complete, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`Installed MCP startup timed out: ${errors}`)),
        40_000,
      );
      child.stdout.on("data", (chunk) => {
        buffered += chunk;
        for (const line of buffered.split("\n").slice(0, -1)) {
          try {
            responses.push(JSON.parse(line));
          } catch (error) {
            reject(error);
          }
        }
        buffered = buffered.slice(buffered.lastIndexOf("\n") + 1);
        if ([1, 2, 3].every((id) => responses.some((entry) => entry.id === id))) complete();
      });
      child.stderr.on("data", (chunk) => {
        errors += chunk;
      });
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`Installed MCP exited (${code}): ${errors}`)));
    });
    for (const request of [
      {
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {
            extensions: {
              "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
            },
          },
          clientInfo: { name: "installed-runtime-test", version: "1" },
        },
      },
      { method: "notifications/initialized", params: {} },
      { id: 2, method: "tools/call", params: { name: "relay_health", arguments: {} } },
      { id: 3, method: "resources/read", params: { uri: "ui://relay/review" } },
    ])
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...request })}\n`);
    await done;
    for (const response of responses)
      assert.ok(!response.error && !response.result?.isError, JSON.stringify(response));
    assert.match(responses.find((entry) => entry.id === 3).result.contents[0].text, /Relay/u);
    return responses;
  } finally {
    clearTimeout(timeout);
    // Close only this harness's connector. The canonical service remains available.
    child.kill();
  }
}
try {
  await execute(process.execPath, [resolve(packageRoot, "scripts/build.mjs")], {
    cwd: repositoryRoot,
  });
  const packed = await execute(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", temporary, "--json"],
    { cwd: packageRoot },
  );
  const tarball = resolve(temporary, JSON.parse(packed.stdout)[0].filename);
  const mcpRoot = resolve(repositoryRoot, "packages/mcp");
  await execute(process.execPath, [resolve(mcpRoot, "scripts/build.mjs")], { cwd: mcpRoot });
  const mcpPacked = await execute(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", temporary, "--json"],
    { cwd: mcpRoot },
  );
  const mcpTarball = resolve(temporary, JSON.parse(mcpPacked.stdout)[0].filename);
  await writeFile(
    resolve(installation, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  await execute("npm", ["install", tarball, mcpTarball, "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: installation,
    timeout: 120_000,
    maxBuffer: 4_000_000,
  });
  const installed = resolve(installation, "node_modules/@relay/runtime");
  cli = resolve(installed, "dist/relay-runtime.js");
  const files = await readdir(installed);
  assert.ok(
    !files.includes("src") && !files.includes("scripts"),
    "installed package must not include contributor sources",
  );
  // This dependency's entry is generated only by Android preparation. Its
  // absence proves the browser acceptance does not rely on that download.
  await assert.rejects(
    readFile(resolve(installation, "node_modules/@yume-chan/fetch-scrcpy-server/index.js")),
    { code: "ENOENT" },
  );
  await readOnly(installed);
  await readOnly(resolve(installation, "node_modules/@relay/mcp"));
  await assert.rejects(
    launch(["start", "--workspace", resolve(installed, "mutable")]),
    /outside the installed Relay package/u,
  );
  const concurrentResults = await Promise.allSettled([
    inspectInstalledMcp(["--workspace", workspace, "--runtime-port", String(port)]),
    inspectInstalledMcp(["--workspace", workspace, "--runtime-port", String(port)]),
  ]);
  for (const result of concurrentResults) if (result.status === "rejected") throw result.reason;
  const [mcp, concurrentMcp] = concurrentResults.map((result) => result.value);
  runtime = parseStartup((await launch(startArgs)).stdout);
  assert.equal(
    runtime.disposition,
    "attached",
    "MCP already launched the canonical workspace owner",
  );
  const attached = parseStartup((await launch(startArgs)).stdout);
  assert.equal(attached.disposition, "attached");
  assert.equal(attached.pid, runtime.pid);

  // Unknown listeners and a different workspace cannot gain stop/recovery authority.
  const unknown = http.createServer((_request, response) => response.end("not Relay"));
  await new Promise((done) => unknown.listen(0, "127.0.0.1", done));
  try {
    await assert.rejects(
      launch([
        "start",
        "--workspace",
        resolve(temporary, "unknown"),
        "--port",
        String(unknown.address().port),
      ]),
      /no process was stopped/u,
    );
    assert.equal(
      await (await fetch(`http://127.0.0.1:${unknown.address().port}`)).text(),
      "not Relay",
    );
  } finally {
    await new Promise((done) => unknown.close(done));
  }
  await assert.rejects(
    launch(["start", "--workspace", resolve(temporary, "other"), "--port", String(port)]),
    /not a compatible Relay owner/u,
  );
  assert.equal((await (await fetch(`${runtime.url}/health`)).json()).pid, runtime.pid);

  const demoArgs = [
    "demo",
    "--workspace",
    workspace,
    "--port",
    String(port),
    "--fixture-port",
    String(fixturePort),
    "--once",
  ];
  const first = await launch(demoArgs);
  assert.match(first.stdout, /Record: sign in as Member/u);
  assert.match(first.stdout, /Caught the defect: Save overlaps/u);
  assert.match(first.stdout, /Layout check passed/u);
  assert.match(first.stdout, /Screenshot:.*Member settings\.png/u);
  assert.match(first.stdout, /Screenshot review is pending/u);
  const review = first.stdout
    .split("\n")
    .find((line) => line.startsWith("Review: "))
    .slice("Review: ".length);
  assert.ok(
    review.startsWith(`${runtime.url}/shared/runs/`),
    "packaged review must use its own canonical service",
  );
  const gallery = await fetch(review);
  assert.equal(gallery.status, 200);
  assert.match(gallery.headers.get("content-type"), /text\/html/u);
  assert.match(await gallery.text(), /Demo/u);
  assert.doesNotMatch(first.stdout, /\.\/bin\/relay/u);
  const repeat = await launch(demoArgs);
  assert.doesNotMatch(repeat.stdout, /Record:/u);
  assert.match(repeat.stdout, /Layout check passed/u);
  const saved = JSON.parse(
    await readFile(resolve(workspace, ".relay/first-run-demo.json"), "utf8"),
  );
  const frame = first.stdout
    .split("\n")
    .find((line) => line.startsWith("Screenshot: "))
    .slice("Screenshot: ".length);
  assert.ok((await stat(frame)).size > 1000);
  const readRun = async (output, prefix = "") => {
    const response = await fetch(`${runtime.url}/runs/${outputValue(output, `${prefix}Run ID`)}`, {
      headers: {
        "X-Organization-Id": "local",
        "X-Project-Id": "default",
        "X-Relay-Actor-Id": "agent:installed-runtime-test",
        "X-Relay-Actor-Kind": "agent",
      },
    });
    assert.equal(response.status, 200);
    return (await response.json()).run;
  };
  const assertLayoutOutcome = (run, passed) => {
    assert.equal(run.outcome, passed ? "passed" : "product-failure");
    assert.ok(
      run.artifacts.some(
        (artifact) => artifact.kind === "layout-assertion" && artifact.data?.passed === passed,
      ),
    );
  };
  const defectRun = await readRun(first.stdout, "Defect ");
  const repairRun = await readRun(first.stdout);
  assertLayoutOutcome(defectRun, false);
  assertLayoutOutcome(repairRun, true);
  assert.equal(outputValue(first.stdout, "Defect Test ID"), saved.testId);
  assert.equal(outputValue(first.stdout, "Test ID"), saved.testId);
  assert.deepEqual(defectRun.recipeSnapshot, repairRun.recipeSnapshot);
  assert.deepEqual(defectRun.resolvedInputs, repairRun.resolvedInputs);
  const defectGallery = await fetch(outputValue(first.stdout, "Defect Review"));
  assert.equal(defectGallery.status, 200);
  assert.match(await defectGallery.text(), /aria-label="product-failure"/u);

  // Exercise the documented default: the original terminal stays open while
  // its printed Repeat command runs the same Test in a separate process.
  const live = await launchLiveDemo(demoArgs.filter((arg) => arg !== "--once"));
  const repeatArgs = demoArgs.filter((arg) => arg !== "--once");
  repeatArgs[0] = "repeat";
  const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  assert.equal(
    outputValue(live.stdout, "Repeat"),
    `node ${shellQuote(cli)} repeat --workspace ${shellQuote(workspace)} --port ${port} --fixture-port ${fixturePort}`,
  );
  // Execute the verified argument vector, never arbitrary printed shell text.
  const liveRepeat = await launch(repeatArgs);
  assert.doesNotMatch(liveRepeat.stdout, /Record:/u);
  assert.equal(outputValue(live.stdout, "Test ID"), saved.testId);
  assert.equal(outputValue(liveRepeat.stdout, "Test ID"), saved.testId);
  assert.notEqual(outputValue(liveRepeat.stdout, "Run ID"), outputValue(live.stdout, "Run ID"));
  const fixtureUrl = `http://127.0.0.1:${fixturePort}`;
  const injected = await fetch(`${fixtureUrl}/control/defect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ on: true }),
  });
  assert.equal(injected.status, 200);
  const failedRepeat = await launch(repeatArgs).then(
    () => {
      throw new Error("Repeating the defective fixture must fail the check");
    },
    (error) => error,
  );
  assert.match(failedRepeat.stderr, /Demo check failed/u);
  assert.equal(outputValue(failedRepeat.stdout, "Test ID"), saved.testId);
  assertLayoutOutcome(await readRun(failedRepeat.stdout), false);
  assert.equal((await (await fetch(`${fixtureUrl}/control/defect`)).json()).on, true);
  const repaired = await fetch(`${fixtureUrl}/control/defect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ on: false }),
  });
  assert.equal(repaired.status, 200);
  assert.equal((await repaired.json()).on, false);
  const repairedRepeat = await launch(repeatArgs);
  assert.equal(outputValue(repairedRepeat.stdout, "Test ID"), saved.testId);
  assert.notEqual(
    outputValue(repairedRepeat.stdout, "Run ID"),
    outputValue(liveRepeat.stdout, "Run ID"),
  );
  assert.match(repairedRepeat.stdout, /Layout check passed/u);
  assert.equal((await (await fetch(`${fixtureUrl}/control/defect`)).json()).on, false);
  const defectFrame = await readFile(outputValue(failedRepeat.stdout, "Screenshot"));
  const repairedFrame = await readFile(outputValue(repairedRepeat.stdout, "Screenshot"));
  assert.ok(
    !defectFrame.equals(repairedFrame),
    "Repair must be visible in the retained new screenshot",
  );
  await live.stop();
  liveDemo = undefined;
  await assert.rejects(
    launch(repeatArgs),
    /original demo website is no longer running.*No browser input was sent/su,
  );
  const foreignFixture = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ on: false }));
  });
  await new Promise((done) => foreignFixture.listen(fixturePort, "127.0.0.1", done));
  try {
    await assert.rejects(
      launch(repeatArgs),
      /original demo website is no longer running.*No browser input was sent/su,
    );
    assert.equal((await (await fetch(fixtureUrl)).json()).on, false);
  } finally {
    await new Promise((done) => foreignFixture.close(done));
  }
  const authenticatedPort = await freePort();
  const authenticatedMcp = await inspectInstalledMcp(
    ["--workspace", authenticatedWorkspace, "--runtime-port", String(authenticatedPort)],
    token,
  );
  const authenticated = parseStartup(
    (
      await launch(
        ["start", "--workspace", authenticatedWorkspace, "--port", String(authenticatedPort)],
        token,
      )
    ).stdout,
  );
  assert.equal(authenticated.disposition, "attached");
  const authenticatedHealth = await fetch(`${authenticated.url}/health`, authorized).then(
    (response) => response.json(),
  );
  assert.equal(authenticatedHealth.pid, authenticated.pid);
  await assert.rejects(
    launch(
      [
        "demo",
        "--workspace",
        authenticatedWorkspace,
        "--port",
        String(authenticatedPort),
        "--fixture-port",
        String(fixturePort),
        "--once",
      ],
      token,
    ),
    /canonical local-host boundary/u,
  );
  assert.equal(
    JSON.parse(await readFile(resolve(workspace, ".relay/first-run-demo.json"), "utf8")).testId,
    saved.testId,
  );
  const report = {
    schemaVersion: 1,
    installation,
    workspace,
    tarball,
    mcpTarball,
    mcpStartedCanonicalService: true,
    concurrentStartPreservedOneOwner: Boolean(concurrentMcp),
    authenticatedStartup: true,
    authenticatedPanel: Boolean(authenticatedMcp.find((entry) => entry.id === 3)),
    authenticatedWorkspace,
    authenticatedPid: authenticated.pid,
    authenticatedUrl: authenticated.url,
    browserDemoUsesTrustedLoopback: true,
    browserInstallNeedsNoAndroidAsset: true,
    defectAndRepairUseIdenticalSavedRecipe: true,
    defectRunId: defectRun.id,
    repairRunId: repairRun.id,
    authenticatedDemoFailsClosed: true,
    negotiatedPanel: Boolean(mcp.find((entry) => entry.id === 3)),
    pid: runtime.pid,
    url: runtime.url,
    testId: saved.testId,
    screenshot: frame,
    first: first.stdout,
    repeat: repeat.stdout,
    defaultDemoRepeatWorks: true,
    repeatPreservesFixtureRepair: true,
    repeatAfterCloseFailsBeforeInput: true,
    foreignFixtureRejected: true,
    liveDemo: live.stdout,
    liveRepeat: liveRepeat.stdout,
    failedRepeat: failedRepeat.stdout,
    repairedRepeat: repairedRepeat.stdout,
    sourceIndependent: true,
    immutableInstallation: true,
    nativeQualified: false,
  };
  await writeFile(resolve(temporary, "acceptance.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await liveDemo?.stop();
  for (const [ownedWorkspace, headers] of [
    [workspace, {}],
    [authenticatedWorkspace, authorized],
  ]) {
    const identity = await readFile(resolve(ownedWorkspace, ".relay/runtime.json"), "utf8")
      .then(JSON.parse)
      .catch(() => undefined);
    if (!identity) continue;
    const current = await fetch(`${identity.url}/health`, headers)
      .then((response) => response.json())
      .catch(() => undefined);
    // Signal only the exact owner launched in this harness's unique workspace, after its work ended.
    if (
      current?.pid === identity.pid &&
      identity.workspaceRoot === ownedWorkspace &&
      current.activeJobs.length === 0
    )
      process.kill(identity.pid, "SIGTERM");
  }
  console.log(`Installed-runtime evidence retained at ${temporary}`);
}
