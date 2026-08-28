import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
  type EventEnvelope,
  type OperationId,
} from "@relay/protocol";
import { parseCli } from "./config.js";
import { ExitCode } from "./errors.js";
import { runCli, waitForOutcome } from "./index.js";
import type { RelayOutcomeJobs, RepeatTestSnapshot } from "@relay/workflows";
import type { OperationInvoker } from "./invoke.js";

function capture() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  const chunks: Buffer[] = [];
  stdout.on("data", (chunk) => {
    chunks.push(Buffer.from(chunk));
    out += String(chunk);
  });
  stderr.on("data", (chunk) => (err += String(chunk)));
  return {
    streams: { stdout, stderr },
    stdout: () => out,
    stdoutBuffer: () => Buffer.concat(chunks),
    stderr: () => err,
  };
}

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function hasTerminalControl(value: string): boolean {
  return value.includes(String.fromCharCode(27)) || value.includes("\r");
}

const relayEvent: EventEnvelope = {
  schemaVersion: 1,
  organizationId: "local",
  projectId: "default",
  actorId: "system:relay",
  actorKind: "system",
  eventId: "event-1",
  sequence: 1,
  operationId: "app-map.update",
  requestId: "request-1",
  occurredAt: 1,
  payload: { type: "resource.updated", at: 1 },
};

function repeatOutcome(phase: RepeatTestSnapshot["phase"], version: number): RepeatTestSnapshot {
  return {
    schemaVersion: 1,
    kind: "repeat-test",
    title: "Repeat locale smoke",
    phase,
    stage: phase === "succeeded" ? "complete" : "remaining",
    version: `campaign-${version}`,
    workflow: { workflowId: "repeat-workflow", expectedVersion: version },
    outcomes: {
      selected: 2,
      observed: phase === "succeeded" ? 2 : 1,
      untouched: phase === "succeeded" ? 0 : 1,
      running: phase === "running" ? 1 : 0,
      passed: phase === "succeeded" ? 2 : 1,
      failed: 0,
      needsReview: 0,
      cancelled: 0,
    },
    results: [],
    progress: { label: phase },
    allowedNextActions: ["inspect"],
    problems: [],
    evidenceRefs: [],
  };
}

test("Repeat and continue-repeat waits poll only their durable workflow handle", async () => {
  for (const operationId of ["outcome.repeat-test", "outcome.continue-repeat"]) {
    const lookups: unknown[] = [];
    const snapshots: unknown[] = [];
    const settled = await waitForOutcome(
      {
        inspect: async (lookup: unknown) => {
          lookups.push(lookup);
          return repeatOutcome("succeeded", 3);
        },
      } as RelayOutcomeJobs,
      repeatOutcome("running", 2),
      new AbortController().signal,
      { snapshot: (_id: string, snapshot: unknown) => snapshots.push(snapshot) } as never,
      operationId,
      0,
    );
    assert.equal(settled.phase, "succeeded");
    assert.deepEqual(lookups, [{ workflowId: "repeat-workflow" }]);
    assert.equal(snapshots.length, 1);
  }
});

test("durable outcome waits prefer workflow events over fixed polling", async () => {
  const snapshots: unknown[] = [];
  let watched: unknown;
  const settled = await waitForOutcome(
    {
      inspect: async () => {
        throw new Error("fixed polling must not run");
      },
      watchWorkflow: async (input: unknown) => {
        watched = input;
        const callback = (input as { onSnapshot?: (value: RepeatTestSnapshot) => void }).onSnapshot;
        const terminal = repeatOutcome("succeeded", 3);
        callback?.(terminal);
        return terminal;
      },
    } as unknown as RelayOutcomeJobs,
    repeatOutcome("running", 2),
    new AbortController().signal,
    { snapshot: (_id: string, value: unknown) => snapshots.push(value) } as never,
    "outcome.repeat-test",
    250,
  );
  assert.equal(settled.phase, "succeeded");
  assert.equal((watched as { workflowId?: unknown }).workflowId, "repeat-workflow");
  assert.equal((watched as { disconnectedRefreshMs?: unknown }).disconnectedRefreshMs, 15_000);
  assert.equal(snapshots.length, 2);
});

test("generic invocation calls the operation client with parsed input", async () => {
  const io = capture();
  const calls: Array<{ operationId: OperationId; input: unknown }> = [];
  const client: OperationInvoker = {
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      return { healthy: true };
    },
    events: async () => {},
  };
  const code = await runCli(
    ["operation", "invoke", "system.health.get", "--input", "{}", "--json"],
    { streams: io.streams, createClient: () => client, registerSignalHandlers: false, env: {} },
  );

  assert.equal(code, ExitCode.success);
  assert.deepEqual(calls, [{ operationId: "system.health.get", input: {} }]);
  assert.deepEqual(JSON.parse(io.stdout()), {
    type: "result",
    ok: true,
    operationId: "system.health.get",
    result: { healthy: true },
  });
  assert.equal(io.stderr(), "");
});

test("only implicit-local outcome commands ensure the Relay daemon", async () => {
  for (const testCase of [
    { env: {}, expectedEnsures: 1 },
    { env: { RELAY_URL: "http://127.0.0.1:8787" }, expectedEnsures: 0 },
    { env: { RELAY_URL: "https://relay.example" }, expectedEnsures: 0 },
  ] as const) {
    const io = capture();
    let ensures = 0;
    const code = await runCli(["connect", "--json"], {
      streams: io.streams,
      env: testCase.env,
      registerSignalHandlers: false,
      ensureOutcomeServer: async (serverUrl) => {
        ensures += 1;
        assert.equal(serverUrl, "http://127.0.0.1:8787");
        return { status: "already-running" };
      },
      createClient: () => ({
        invoke: async () => ({ devices: [] }),
        events: async () => {},
      }),
    });
    assert.equal(code, ExitCode.success);
    assert.equal(ensures, testCase.expectedEnsures);
  }
});

test("Replay Lab rejects invalid explicit files without starting Relay or invoking its client", async () => {
  const io = capture();
  let ensured = false;
  let invoked = false;
  const code = await runCli(
    ["replay-lab", "compare", "/missing/oldest.json", "/missing/newest.json", "--json"],
    {
      streams: io.streams,
      env: {},
      registerSignalHandlers: false,
      ensureOutcomeServer: async () => {
        ensured = true;
        return { status: "started" };
      },
      createClient: () => ({
        invoke: async () => {
          invoked = true;
          return {};
        },
        events: async () => {},
      }),
    },
  );
  assert.equal(code, ExitCode.validation);
  assert.equal(ensured, false);
  assert.equal(invoked, false);
  assert.match(io.stderr(), /not a regular local file/u);
});

test("relay observe emits durable references without transient presentation bytes", async () => {
  const io = capture();
  const artifact = (digit: string, kind: "image" | "structured-data", mime: string) => {
    const sha256 = digit.repeat(64);
    return {
      status: "available",
      artifact: {
        schemaVersion: 1,
        id: `sha256:${sha256}`,
        integrity: { algorithm: "sha256", sha256, bytes: 3 },
        media: { kind, mime },
        capturedAt: 10,
        provenance: { source: "authoring-evidence", capture: "recorded" },
        retention: {
          scope: "workspace-content-addressed",
          recoverability: "content-addressed",
        },
        locations: [{ store: "authoring-evidence", opaque: `evidence-${digit}` }],
      },
    };
  };
  const code = await runCli(["observe", "pixel-9", "--json"], {
    streams: io.streams,
    registerSignalHandlers: false,
    env: { RELAY_URL: "http://127.0.0.1:8787" },
    createClient: () => ({
      async invoke(operationId) {
        if (operationId === "target.devices.list") {
          return {
            devices: [
              {
                id: "pixel-9",
                serial: "pixel-9",
                name: "Pixel 9",
                kind: "emulator",
                booted: true,
                platform: "android",
              },
            ],
          };
        }
        if (operationId === "target.observation.capture") {
          return {
            schemaVersion: 1,
            target: { kind: "device", platform: "android", targetId: "pixel-9" },
            capturedAt: 11,
            pixels: {
              status: "captured",
              capturedAt: 10,
              mime: "image/png",
              bytes: 3,
              artifact: artifact("a", "image", "image/png"),
              presentationBase64: "cG5n",
            },
            semantics: {
              status: "unavailable",
              artifact: artifact("b", "structured-data", "application/json"),
              nodeCount: 0,
              controls: [],
              message: "Accessibility unavailable.",
            },
          };
        }
        throw new Error(`unexpected ${operationId}`);
      },
      events: async () => {},
    }),
  });

  assert.equal(code, ExitCode.success);
  const output = JSON.parse(io.stdout()) as { result: Record<string, unknown> };
  assert.equal(JSON.stringify(output).includes("presentationBase64"), false);
  const pixels = output.result.pixels as Record<string, unknown>;
  assert.equal((pixels.artifact as Record<string, unknown>).status, "available");
});

test("friendly command families invoke through the operation client", async () => {
  const cases: Array<{
    argv: string[];
    operationId: OperationId;
    input: Record<string, unknown>;
  }> = [
    {
      argv: ["screen", "list", "onboarding"],
      operationId: "app-map.get",
      input: { appMapId: "onboarding" },
    },
    {
      argv: [
        "connection",
        "update",
        "onboarding",
        "continue",
        "--input",
        '{"expectedRevision":4,"patch":{"label":"Continue"}}',
      ],
      operationId: "app-map.connection.update",
      input: {
        appMapId: "onboarding",
        connectionId: "continue",
        expectedRevision: 4,
        patch: { label: "Continue" },
      },
    },
    {
      argv: ["target", "screenshot", "pixel-9"],
      operationId: "target.screenshot.capture",
      input: { serial: "pixel-9" },
    },
    {
      argv: ["session", "back", "session-1"],
      operationId: "authoring.session.interact",
      input: { sessionId: "session-1", interaction: { kind: "key", key: "back" } },
    },
    {
      argv: ["take", "replay", "session-1"],
      operationId: "authoring.take.replay",
      input: { sessionId: "session-1" },
    },
    {
      argv: ["run", "visual-baseline", "update", "run-7"],
      operationId: "run.visual-baseline.update",
      input: { runId: "run-7", action: "approve-new-baseline" },
    },
    {
      argv: ["discovery", "capture", "discovery-1", "pixel-9"],
      operationId: "discovery.capture",
      input: { sessionId: "discovery-1" },
    },
    {
      argv: ["policy", "privacy", "update", "--input", '{"enabled":true}'],
      operationId: "workspace.privacy.update",
      input: { enabled: true },
    },
    {
      argv: ["lease", "create", "ipad-1"],
      operationId: "lease.create",
      input: { poolId: "local", deviceSerial: "ipad-1" },
    },
  ];

  for (const testCase of cases) {
    const io = capture();
    const calls: Array<{ operationId: OperationId; input: unknown }> = [];
    const code = await runCli([...testCase.argv, "--json"], {
      streams: io.streams,
      createClient: () => ({
        async invoke(operationId, input) {
          calls.push({ operationId, input });
          return { accepted: true };
        },
        events: async () => {},
      }),
      registerSignalHandlers: false,
      env: {},
    });

    assert.equal(code, ExitCode.success, testCase.argv.join(" "));
    assert.deepEqual(calls, [{ operationId: testCase.operationId, input: testCase.input }]);
    assert.equal(io.stderr().replace(/\{"type":"progress"[^\n]*\}\n/g, ""), "");
  }
});

test("friendly screenshot output preserves the PNG base64 payload", async () => {
  const io = capture();
  const screenshot = {
    path: "/tmp/relay-shot.png",
    bytes: 12,
    mime: "image/png",
    base64: "iVBORw0KGgoAAAANSUhEUg==",
  };
  const code = await runCli(["target", "screenshot", "pixel-9", "--json"], {
    streams: io.streams,
    createClient: () => ({ invoke: async () => screenshot, events: async () => {} }),
    registerSignalHandlers: false,
    env: {},
  });

  assert.equal(code, ExitCode.success);
  assert.deepEqual(JSON.parse(io.stdout()), {
    type: "result",
    ok: true,
    operationId: "target.screenshot.capture",
    result: screenshot,
  });
});

test("App Map resource commands use declared read-only routes", async () => {
  const cases = [
    [["run", "get", "run/a"], "/runs/run%2Fa"],
    [["run", "signals", "run-1"], "/runs/run-1/signals"],
    [["run", "compare", "run-1"], "/runs/run-1/visual-baseline"],
    [["activity", "list", "--input", '{"limit":10}'], "/activity?limit=10"],
  ] as const;

  for (const [argv, expectedPath] of cases) {
    const io = capture();
    let invoked = false;
    const resources: Array<{ path: string; method?: string }> = [];
    const code = await runCli([...argv, "--json"], {
      streams: io.streams,
      createClient: () => ({
        async invoke() {
          invoked = true;
          return {};
        },
        events: async () => {},
        async resource(path, init) {
          resources.push({ path, method: init?.method });
          return { path };
        },
      }),
      registerSignalHandlers: false,
      env: {},
    });

    assert.equal(code, ExitCode.success, argv.join(" "));
    assert.equal(invoked, false, argv.join(" "));
    assert.deepEqual(resources, [{ path: expectedPath, method: "GET" }]);
    assert.equal(JSON.parse(io.stdout()).result.path, expectedPath);
  }
});

const snapshotTree = {
  serial: "pixel-9",
  bounds: { width: 834, height: 1112 },
  inspectable: true,
  interactive: [],
  tree: "Button · Ask",
  screenIdentity: { fingerprint: "abcdef0123456789deadbeef" },
  nodes: [
    {
      type: "Button",
      identifier: "navigation.tab.ask",
      label: "Ask",
      hittable: false,
      rect: { x: 331, y: 22, width: 44, height: 38 },
    },
  ],
};

test("device snapshot --json includes nodes and human default stays a digest", async () => {
  const jsonIo = capture();
  const jsonCode = await runCli(["device", "snapshot", "pixel-9", "--json"], {
    streams: jsonIo.streams,
    createClient: () => ({ invoke: async () => snapshotTree, events: async () => {} }),
    registerSignalHandlers: false,
    env: {},
  });
  assert.equal(jsonCode, ExitCode.success);
  const json = JSON.parse(jsonIo.stdout()).result as {
    nodes?: unknown[];
    nodeCount?: number;
  };
  assert.deepEqual(json.nodes, snapshotTree.nodes);
  assert.equal(json.nodeCount, undefined);

  const humanIo = capture();
  const humanCode = await runCli(["device", "snapshot", "pixel-9"], {
    streams: humanIo.streams,
    createClient: () => ({ invoke: async () => snapshotTree, events: async () => {} }),
    registerSignalHandlers: false,
    env: {},
  });
  assert.equal(humanCode, ExitCode.success);
  const human = JSON.parse(humanIo.stdout()) as {
    nodes?: unknown;
    nodeCount?: number;
    controls?: unknown;
  };
  assert.equal(human.nodes, undefined);
  assert.equal(human.nodeCount, 1);
  assert.ok(Array.isArray(human.controls));
});

test("device snapshot --file writes the full snapshot JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-cli-snapshot-"));
  const file = join(root, "tree.json");
  try {
    const io = capture();
    const code = await runCli(["device", "snapshot", "pixel-9", "--file", file, "--json"], {
      streams: io.streams,
      createClient: () => ({ invoke: async () => snapshotTree, events: async () => {} }),
      registerSignalHandlers: false,
      env: {},
    });
    assert.equal(code, ExitCode.success);
    const written = JSON.parse(await readFile(file, "utf8")) as {
      serial?: string;
      defaults?: { enabled?: boolean };
      nodes?: unknown[];
    };
    assert.equal(written.serial, "pixel-9");
    assert.equal(written.defaults?.enabled, true);
    assert.ok(Array.isArray(written.nodes));
    const firstNode = written.nodes?.[0] as { label?: string; hittable?: boolean } | undefined;
    assert.equal(firstNode?.label, "Ask");
    assert.equal(firstNode?.hittable, false);
    const terminal = JSON.parse(io.stdout());
    assert.equal(terminal.result.file, file);
    assert.equal(terminal.result.mime, "application/json");
    assert.equal(JSON.parse(io.stdout()).result.nodes, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("variable list stdout is the catalog only; map get still includes topology", async () => {
  const scope = {
    organizationId: "local",
    projectId: "project-1",
    appMapId: "grok-android",
    createdAt: 1,
    updatedAt: 2,
  };
  const appMap = {
    schemaVersion: 1,
    id: "grok-android",
    organizationId: "local",
    projectId: "project-1",
    name: "Grok",
    revision: 4,
    notes: {},
    groups: {},
    screens: {
      home: { ...scope, id: "home", title: "Home", variantIds: [] },
    },
    screenVariants: {},
    connections: {
      open: {
        ...scope,
        id: "open",
        fromScreenId: "home",
        destination: { kind: "end" },
        state: "draft",
        actions: [],
      },
    },
    caseStacks: {},
    variables: {
      language: {
        ...scope,
        id: "language",
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "ai.x.grok" },
        options: [{ id: "en-US", label: "English" }],
      },
    },
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 2,
  };

  const listIo = capture();
  const listCode = await runCli(["variable", "list", "grok-android", "--json"], {
    streams: listIo.streams,
    createClient: () => ({ invoke: async () => ({ appMap }), events: async () => {} }),
    registerSignalHandlers: false,
    env: {},
  });
  assert.equal(listCode, ExitCode.success);
  const listed = JSON.parse(listIo.stdout()).result as Record<string, unknown>;
  assert.equal("screens" in listed, false);
  assert.equal("connections" in listed, false);
  assert.ok(Array.isArray(listed.variables));
  assert.equal(JSON.stringify(listed).includes('"screens"'), false);
  assert.equal(JSON.stringify(listed).includes('"connections"'), false);

  const getIo = capture();
  const getCode = await runCli(["map", "get", "grok-android", "--json"], {
    streams: getIo.streams,
    createClient: () => ({ invoke: async () => ({ appMap }), events: async () => {} }),
    registerSignalHandlers: false,
    env: {},
  });
  assert.equal(getCode, ExitCode.success);
  const got = JSON.parse(getIo.stdout()).result as {
    appMap?: { screens?: unknown[]; connections?: unknown[] };
  };
  assert.ok(Array.isArray(got.appMap?.screens));
  assert.ok(Array.isArray(got.appMap?.connections));
  assert.ok((got.appMap?.screens?.length ?? 0) > 0);
  assert.ok((got.appMap?.connections?.length ?? 0) > 0);
});

test("connect get --json returns saved connection actions", async () => {
  const appMap = {
    id: "checkout",
    name: "Checkout",
    revision: 4,
    screens: { cart: { id: "cart", title: "Cart", variantIds: [] } },
    connections: {
      continue: {
        id: "continue",
        label: "Continue",
        fromScreenId: "cart",
        destination: { kind: "screen", screenId: "review" },
        state: "ready",
        actions: [
          { kind: "reveal", target: { label: "Continue" }, direction: "down" },
          { kind: "tap", target: { identifier: "checkout.continue", label: "Continue" } },
        ],
      },
    },
  };
  const io = capture();
  const calls: Array<{ operationId: OperationId; input: unknown }> = [];
  const code = await runCli(["connect", "get", "checkout", "continue", "--json"], {
    streams: io.streams,
    createClient: () => ({
      async invoke(operationId, input) {
        calls.push({ operationId, input });
        return { appMap };
      },
      events: async () => {},
    }),
    registerSignalHandlers: false,
    env: {},
  });
  assert.equal(code, ExitCode.success);
  assert.deepEqual(calls, [{ operationId: "app-map.get", input: { appMapId: "checkout" } }]);
  const listed = JSON.parse(io.stdout()).result as {
    connection?: { id?: string; actions?: unknown[] };
    appMap?: unknown;
  };
  assert.equal(listed.appMap, undefined);
  assert.deepEqual(listed.connection, {
    id: "continue",
    label: "Continue",
    fromScreenId: "cart",
    destination: { kind: "screen", screenId: "review" },
    state: "ready",
    actions: [
      { kind: "reveal", target: { label: "Continue" }, direction: "down" },
      { kind: "tap", target: { identifier: "checkout.continue", label: "Continue" } },
    ],
  });

  const missing = capture();
  const missingCode = await runCli(["connect", "get", "checkout", "missing", "--json"], {
    streams: missing.streams,
    createClient: () => ({ invoke: async () => ({ appMap }), events: async () => {} }),
    registerSignalHandlers: false,
    env: {},
  });
  assert.equal(missingCode, ExitCode.validation);
  assert.match(JSON.parse(missing.stdout()).error.message, /Unknown connection: missing/u);
});

test("screenshot output writes validated PNG files without leaking base64", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-cli-screenshot-"));
  const file = join(root, "screen.png");
  const screenshot = {
    path: "/server/screen.png",
    bytes: Buffer.from(pngBase64, "base64").byteLength,
    mime: "image/png",
    base64: pngBase64,
  };
  try {
    const io = capture();
    const code = await runCli(["device", "screenshot", "pixel-9", "--file", file, "--json"], {
      streams: io.streams,
      createClient: () => ({ invoke: async () => screenshot, events: async () => {} }),
      registerSignalHandlers: false,
      env: {},
    });

    assert.equal(code, ExitCode.success);
    assert.deepEqual(await readFile(file), Buffer.from(pngBase64, "base64"));
    const terminal = JSON.parse(io.stdout());
    assert.deepEqual(terminal.result, {
      file,
      bytes: screenshot.bytes,
      mime: "image/png",
      sourcePath: "/server/screen.png",
    });
    assert.doesNotMatch(io.stdout(), new RegExp(pngBase64));

    const conflict = capture();
    const conflictCode = await runCli(
      ["device", "screenshot", "pixel-9", "--file", file, "--json"],
      {
        streams: conflict.streams,
        createClient: () => ({ invoke: async () => screenshot, events: async () => {} }),
        registerSignalHandlers: false,
        env: {},
      },
    );
    assert.equal(conflictCode, ExitCode.conflict);
    assert.match(JSON.parse(conflict.stdout()).error.message, /already exists/);

    await writeFile(file, "old");
    const forced = capture();
    const forcedCode = await runCli(
      ["device", "screenshot", "pixel-9", "--file", file, "--force", "--quiet"],
      {
        streams: forced.streams,
        createClient: () => ({ invoke: async () => screenshot, events: async () => {} }),
        registerSignalHandlers: false,
        env: {},
      },
    );
    assert.equal(forcedCode, ExitCode.success);
    assert.deepEqual(await readFile(file), Buffer.from(pngBase64, "base64"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("screenshot binary mode keeps stdout byte-clean", async () => {
  const io = capture();
  const png = Buffer.from(pngBase64, "base64");
  const code = await runCli(["target", "screenshot", "pixel-9", "--binary", "--quiet"], {
    streams: io.streams,
    createClient: () => ({
      invoke: async () => ({
        path: "/server/screen.png",
        bytes: png.byteLength,
        base64: pngBase64,
      }),
      events: async () => {},
    }),
    registerSignalHandlers: false,
    env: {},
  });

  assert.equal(code, ExitCode.success);
  assert.deepEqual(io.stdoutBuffer(), png);
  assert.equal(io.stderr(), "");
});

test("screenshot file modes reject malformed image payloads", async () => {
  for (const result of [
    { mime: "image/jpeg", base64: pngBase64 },
    { mime: "image/png", base64: "not-base64" },
    { mime: "image/png", base64: Buffer.from("not a png").toString("base64") },
  ]) {
    const io = capture();
    const code = await runCli(["device", "screenshot", "pixel-9", "--binary", "--quiet"], {
      streams: io.streams,
      createClient: () => ({ invoke: async () => result, events: async () => {} }),
      registerSignalHandlers: false,
      env: {},
    });
    assert.equal(code, ExitCode.validation);
    assert.equal(io.stdoutBuffer().byteLength, 0);
  }
});

test("device survey --dir persists frames and prints a digest without base64", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-cli-survey-"));
  const dir = join(root, "frames");
  const nodes = [
    { identifier: "language", label: "Language", type: "cell", hittable: true },
    { identifier: "data", label: "Data Controls", type: "cell", hittable: true },
  ];
  const survey = {
    status: "stopped",
    reason: "limit-reached",
    frames: [
      {
        index: 0,
        offsetY: 0,
        appendedHeight: 20,
        screenshot: { base64: pngBase64, width: 10, height: 20, capturedAt: 1 },
        snapshot: {
          serial: "pixel-9",
          capturedAt: 2,
          nodes,
          interactive: nodes,
          inspectable: true,
          source: "sdk",
          screenIdentity: { fingerprint: "abc" },
        },
      },
      {
        index: 1,
        offsetY: 20,
        appendedHeight: 20,
        screenshot: { base64: pngBase64, width: 10, height: 20, capturedAt: 3 },
        snapshot: {
          serial: "pixel-9",
          capturedAt: 4,
          nodes,
          interactive: nodes,
          inspectable: true,
          source: "sdk",
          screenIdentity: { fingerprint: "def" },
        },
      },
    ],
    diagnosticFrames: [],
    mergedNodes: [],
    restoredStartViewport: true,
    message: "Relay reached the configured survey limit.",
    stitched: { base64: pngBase64, width: 10, height: 40, mime: "image/png" },
  };
  try {
    const io = capture();
    const calls: Array<{ operationId: OperationId; input: unknown }> = [];
    const code = await runCli(
      ["device", "survey", "pixel-9", "--dir", dir, "--input", '{"maxScrolls":6}', "--json"],
      {
        streams: io.streams,
        createClient: () => ({
          async invoke(operationId, input) {
            calls.push({ operationId, input });
            return survey;
          },
          events: async () => {},
        }),
        registerSignalHandlers: false,
        env: {},
      },
    );

    assert.equal(code, ExitCode.success);
    assert.deepEqual(calls, [
      {
        operationId: "target.scroll-survey.capture",
        input: { serial: "pixel-9", maxScrolls: 6 },
      },
    ]);
    const terminal = JSON.parse(io.stdout()) as { result: Record<string, unknown> };
    assert.deepEqual(terminal.result, {
      status: "stopped",
      reason: "limit-reached",
      frameCount: 2,
      dir,
      paths: [
        { png: join(dir, "00.png"), json: join(dir, "00.json") },
        { png: join(dir, "01.png"), json: join(dir, "01.json") },
      ],
      frames: [
        {
          index: 0,
          offsetY: 0,
          labelCount: 2,
          files: { png: join(dir, "00.png"), json: join(dir, "00.json") },
        },
        {
          index: 1,
          offsetY: 20,
          labelCount: 2,
          files: { png: join(dir, "01.png"), json: join(dir, "01.json") },
        },
      ],
      full: {
        png: join(dir, "full.png"),
        json: join(dir, "full.json"),
        width: 10,
        height: 40,
        nodeCount: 0,
      },
    });
    assert.doesNotMatch(io.stdout(), /base64/u);
    assert.doesNotMatch(io.stdout(), new RegExp(pngBase64));
    assert.deepEqual(await readFile(join(dir, "00.png")), Buffer.from(pngBase64, "base64"));
    const persisted = JSON.parse(await readFile(join(dir, "01.json"), "utf8")) as {
      snapshot: { nodes: unknown[] };
    };
    assert.deepEqual(persisted.snapshot.nodes, nodes);

    const conflict = capture();
    const conflictCode = await runCli(["device", "survey", "pixel-9", "--dir", dir, "--json"], {
      streams: conflict.streams,
      createClient: () => ({ invoke: async () => survey, events: async () => {} }),
      registerSignalHandlers: false,
      env: {},
    });
    assert.equal(conflictCode, ExitCode.conflict);
    assert.match(JSON.parse(conflict.stdout()).error.message, /not empty/);

    const forced = capture();
    const forcedCode = await runCli(
      ["device", "survey", "pixel-9", "--dir", dir, "--force", "--json"],
      {
        streams: forced.streams,
        createClient: () => ({ invoke: async () => survey, events: async () => {} }),
        registerSignalHandlers: false,
        env: {},
      },
    );
    assert.equal(forcedCode, ExitCode.success);

    const blocked = join(root, "blocked");
    await writeFile(blocked, "not a directory");
    const failed = capture();
    const failedCode = await runCli(["device", "survey", "pixel-9", "--dir", blocked, "--json"], {
      streams: failed.streams,
      createClient: () => ({ invoke: async () => survey, events: async () => {} }),
      registerSignalHandlers: false,
      env: {},
    });
    assert.equal(failedCode, ExitCode.validation);
    assert.match(JSON.parse(failed.stdout()).error.message, /Could not create survey directory/);
    assert.doesNotMatch(failed.stdout(), /base64/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("root and family help are useful without creating a client", async () => {
  const cases = [
    {
      argv: ["--help"],
      matches: [
        /Start with App, Device, Test, Checkpoint, Run, and Report/,
        /Topology\s+map, screen, connect, flow/,
        /Authoring\s+variable, test, combine, proposal, session/,
        /device screenshot <serial>/,
        /--binary/,
      ],
    },
    {
      argv: ["session", "--help"],
      matches: [
        /session start <sessionId>/,
        /session commit <sessionId>/,
        /session replay <sessionId>/,
        /--actor/,
      ],
    },
    {
      argv: ["take", "--help"],
      matches: [/take trim <sessionId>/, /take replay <sessionId>/, /--project/],
    },
    {
      argv: ["screen", "--help"],
      matches: [
        /screen list <appMapId>/,
        /granular, revision-safe App Map operations/,
        /screen update <appMapId> <screenId>/,
      ],
    },
    {
      argv: ["proposal", "--help"],
      matches: [/proposal record <proposalId>/, /target \(object, required\)/, /proposal accept/],
    },
    {
      argv: ["activity", "--help"],
      matches: [/activity list/, /limit \(number, optional\)/, /activity follow/],
    },
    {
      argv: ["device", "--help"],
      matches: [
        /device interact <serial>/,
        /active exclusive lease owned by the same --actor/,
        /relay lease create 00008110 --actor agent:mapper/,
        /digest/,
        /--full/,
        /device survey <serial>/,
        /--dir/,
        /megabytes/,
      ],
    },
    {
      argv: ["lease", "--help"],
      matches: [
        /lease create <serial>/,
        /defaults to 2 hours from now/,
        /same --actor for subsequent device input/,
      ],
    },
  ];

  for (const testCase of cases) {
    const io = capture();
    let created = false;
    const code = await runCli(testCase.argv, {
      streams: io.streams,
      createClient: () => {
        created = true;
        return { invoke: async () => ({}), events: async () => {} };
      },
      registerSignalHandlers: false,
      env: {},
    });

    assert.equal(code, ExitCode.success);
    assert.equal(created, false);
    for (const pattern of testCase.matches) assert.match(io.stdout(), pattern);
    assert.equal(io.stderr(), "");
  }
});

test("friendly commands reject missing target and session identities before creating a client", async () => {
  for (const [argv, message] of [
    [["target", "screenshot"], /target screenshot requires <serial>/],
    [["session", "tap"], /session tap requires <sessionId>/],
  ] as const) {
    const io = capture();
    let created = false;
    const code = await runCli(argv, {
      streams: io.streams,
      createClient: () => {
        created = true;
        return { invoke: async () => ({}), events: async () => {} };
      },
      registerSignalHandlers: false,
      env: {},
    });

    assert.equal(code, ExitCode.usage);
    assert.equal(created, false);
    assert.match(io.stderr(), message);
  }
});

test("NDJSON contains typed progress followed by one terminal result", async () => {
  const io = capture();
  const code = await runCli(
    ["operation", "invoke", "job.get", "--input", '{"jobId":"abc"}', "--ndjson"],
    {
      streams: io.streams,
      createClient: () => ({
        invoke: async () => ({ job: { id: "abc" } }),
        events: async () => {},
      }),
      registerSignalHandlers: false,
      env: {},
    },
  );

  assert.equal(code, ExitCode.success);
  const records = io
    .stdout()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    records.map((record) => record.type),
    ["progress", "result"],
  );
  assert.equal(records.at(-1).ok, true);
  assert.equal(io.stderr(), "");
  assert.equal(hasTerminalControl(io.stdout()), false);
});

test("job watch polls running jobs through the same invoker until ok", async () => {
  const io = capture();
  const responses = [
    { job: { id: "abc", status: "running" } },
    { job: { id: "abc", status: "ok" } },
  ];
  const calls: Array<{ operationId: OperationId; input: unknown }> = [];
  const client: OperationInvoker = {
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      return responses.shift();
    },
    events: async () => {},
  };

  const code = await runCli(["job", "watch", "abc", "--ndjson"], {
    streams: io.streams,
    createClient: () => client,
    registerSignalHandlers: false,
    pollIntervalMs: 0,
    env: {},
  });

  assert.equal(code, ExitCode.success);
  assert.deepEqual(calls, [
    { operationId: "job.get", input: { jobId: "abc" } },
    { operationId: "job.get", input: { jobId: "abc" } },
  ]);
  const records = io
    .stdout()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    records.map(({ type }) => type),
    ["progress", "snapshot", "snapshot", "result"],
  );
  assert.deepEqual(
    records.filter(({ ok }) => typeof ok === "boolean"),
    [
      {
        type: "result",
        ok: true,
        operationId: "job.get",
        result: { job: { id: "abc", status: "ok" } },
      },
    ],
  );
});

test("job watch prints an unchanged heartbeat only once", async () => {
  const io = capture();
  const responses = [
    { job: { id: "abc", status: "running", lastLogs: ["recipe: Wi-Fi"] } },
    { job: { id: "abc", status: "running", lastLogs: ["recipe: Wi-Fi"] } },
    { job: { id: "abc", status: "ok", lastLogs: ["recipe: Wi-Fi"] } },
  ];
  const code = await runCli(["job", "watch", "abc"], {
    streams: io.streams,
    createClient: () => ({
      async invoke() {
        return responses.shift();
      },
      events: async () => {},
    }),
    registerSignalHandlers: false,
    pollIntervalMs: 0,
    env: {},
  });

  assert.equal(code, ExitCode.success);
  assert.equal(io.stderr().match(/recipe: Wi-Fi/g)?.length, 1);
});

test("job watch emits a one-time paused hint naming job resume and backs off polling", async () => {
  const io = capture();
  const responses = [
    { job: { id: "abc", status: "running" } },
    { job: { id: "abc", status: "paused" } },
    { job: { id: "abc", status: "paused" } },
    { job: { id: "abc", status: "paused" } },
    { job: { id: "abc", status: "ok" } },
  ];
  const code = await runCli(["job", "watch", "abc", "--json"], {
    streams: io.streams,
    createClient: () => ({
      async invoke() {
        return responses.shift();
      },
      events: async () => {},
    }),
    registerSignalHandlers: false,
    pollIntervalMs: 0,
    env: {},
  });

  assert.equal(code, ExitCode.success);
  // One hint per stream surface, despite three paused polls.
  assert.equal(io.stderr().match(/job resume abc/g)?.length, 1);
  assert.match(io.stderr(), /relay_job_resume/);
  const progressEvents = io
    .stderr()
    .split("\n")
    .filter((lineText) => lineText.startsWith("{") && lineText.includes('"phase":"paused"'));
  assert.equal(progressEvents.length, 1);
});

test("job watch --no-wait gets the job exactly once", async () => {
  const io = capture();
  let calls = 0;
  const running = { job: { id: "abc", status: "running" } };
  const code = await runCli(["job", "watch", "abc", "--no-wait", "--json"], {
    streams: io.streams,
    createClient: () => ({
      async invoke() {
        calls += 1;
        return running;
      },
      events: async () => {},
    }),
    registerSignalHandlers: false,
    pollIntervalMs: 0,
    env: {},
  });

  assert.equal(code, ExitCode.success);
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(io.stdout()), {
    type: "result",
    ok: true,
    operationId: "job.get",
    result: running,
  });
});

test("test run --in and --lens send Combine worlds on the same Test operation", async () => {
  const parsed = parseCli(
    [
      "test",
      "run",
      "grok-ios",
      "settings-tour",
      "--in",
      "language=ja,pt",
      "--lens",
      "visual",
      "--input",
      '{"expectedRevision":7,"target":{"kind":"device","platform":"ios","targetId":"ipad"}}',
    ],
    {},
  );
  assert.equal(parsed.command, "invoke");
  if (parsed.command !== "invoke") throw new Error("expected invoke");
  assert.equal(parsed.operationId, "app-map.test.run");
  assert.deepEqual(parsed.input.in, { language: ["ja", "pt"] });
  assert.equal(parsed.input.lens, "visual");
  assert.equal(parsed.input.cell, undefined);
  assert.equal(parsed.input.executionMode, undefined);
});

test("test run --in --lens --cell matches the desktop one-cell run input", () => {
  const parsed = parseCli(
    [
      "test",
      "run",
      "grok-android-manual-v2",
      "data-controls-tour",
      "--in",
      "language=ja",
      "--lens",
      "visual",
      "--cell",
      "ja",
      "--input",
      '{"expectedRevision":12,"target":{"kind":"device","platform":"android","targetId":"pixel"}}',
    ],
    {},
  );
  assert.equal(parsed.command, "invoke");
  if (parsed.command !== "invoke") throw new Error("expected invoke");
  assert.deepEqual(
    {
      in: parsed.input.in,
      lens: parsed.input.lens,
      cell: parsed.input.cell,
    },
    { in: { language: ["ja"] }, lens: "visual", cell: "ja" },
  );
  assert.equal(parsed.input.executionMode, undefined);
  const all = parseCli(
    [
      "test",
      "run",
      "grok-android-manual-v2",
      "data-controls-tour",
      "--in",
      "language=ja,pt",
      "--lens",
      "smoke",
      "--all",
      "--input",
      '{"expectedRevision":12,"target":{"kind":"device","platform":"android","targetId":"pixel"}}',
    ],
    {},
  );
  assert.equal(all.command, "invoke");
  if (all.command !== "invoke") throw new Error("expected invoke");
  assert.equal(all.input.executionMode, "all");
  assert.equal(all.input.lens, "smoke");
});

test("test run --help names Variable, Test, Combine, lens, and --all", async () => {
  const io = capture();
  const code = await runCli(["test", "run", "--help"], {
    streams: io.streams,
    registerSignalHandlers: false,
    env: {},
  });
  assert.equal(code, ExitCode.success);
  const help = io.stdout();
  assert.match(help, /Variable/u);
  assert.match(help, /Test/u);
  assert.match(help, /Combine/u);
  assert.match(help, /lens/u);
  assert.match(help, /--all/u);
  assert.match(help, /visual/u);
  assert.match(help, /smoke/u);
});

test("combine run --lens maps onto the Combine capture policy", async () => {
  const parsed = parseCli(
    [
      "combine",
      "run",
      "map",
      "languages",
      "--lens",
      "smoke",
      "--all",
      "--input",
      '{"serial":"phone"}',
    ],
    {},
  );
  assert.equal(parsed.command, "invoke");
  if (parsed.command !== "invoke") throw new Error("expected invoke");
  assert.equal(parsed.operationId, "job.combine.start");
  assert.deepEqual(parsed.input.capture, { mode: "failures-only" });
  assert.equal(parsed.input.lens, undefined);
  assert.equal(parsed.input.executionMode, "all");
});

test("test run --lens --cell --all without --in are usage errors", async () => {
  assert.throws(
    () => parseCli(["test", "run", "grok-ios", "settings-tour", "--lens", "visual"], {}),
    /--lens requires --in/,
  );
  assert.throws(
    () => parseCli(["test", "run", "grok-ios", "settings-tour", "--cell", "ja"], {}),
    /--cell requires --in/,
  );
  assert.throws(
    () => parseCli(["test", "run", "grok-ios", "settings-tour", "--all"], {}),
    /--all requires --in/,
  );
});

test("combine run --cell selects one world and --all is explicit", async () => {
  const cell = parseCli(
    ["combine", "run", "map", "languages", "--cell", "ja", "--input", '{"serial":"phone"}'],
    {},
  );
  assert.equal(cell.command, "invoke");
  if (cell.command !== "invoke") throw new Error("expected invoke");
  assert.equal(cell.operationId, "job.combine.start");
  assert.equal(cell.input.cell, "ja");
  assert.equal(cell.input.executionMode, undefined);
  const all = parseCli(
    ["combine", "run", "map", "languages", "--all", "--input", '{"serial":"phone"}'],
    {},
  );
  assert.equal(all.command, "invoke");
  if (all.command !== "invoke") throw new Error("expected invoke");
  assert.equal(all.input.executionMode, "all");
});

test("test run without --in stays a single Test run", async () => {
  const parsed = parseCli(
    [
      "test",
      "run",
      "grok-ios",
      "settings-tour",
      "--input",
      '{"expectedRevision":7,"target":{"kind":"device","platform":"ios","targetId":"ipad"}}',
    ],
    {},
  );
  assert.equal(parsed.command, "invoke");
  if (parsed.command !== "invoke") throw new Error("expected invoke");
  assert.equal(parsed.input.in, undefined);
  assert.equal(parsed.input.lens, undefined);
});

test("test run starts the canonical exact Test operation and watches its job", async () => {
  const io = capture();
  const calls: Array<{ operationId: OperationId; input: unknown }> = [];
  let polls = 0;
  const client: OperationInvoker = {
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      if (operationId === "app-map.test.run") {
        return {
          job: { id: "work-job", status: "running", lastLogs: ["test: 2 steps"] },
          planIdentity: {
            appMapId: "grok-ios",
            appMapRevision: 7,
            testId: "settings-tour",
            rootRecipeId: "app-map:grok-ios:test:settings-tour:root:r7",
          },
        };
      }
      polls += 1;
      return {
        job: {
          id: "work-job",
          status: polls === 1 ? "running" : "ok",
          lastLogs: ["tour → Haptics", "tour: done"],
        },
      };
    },
    events: async () => {},
  };

  const code = await runCli(
    [
      "test",
      "run",
      "grok-ios",
      "settings-tour",
      "--input",
      '{"expectedRevision":7,"target":{"kind":"device","platform":"ios","targetId":"ipad"}}',
      "--ndjson",
    ],
    {
      streams: io.streams,
      createClient: () => client,
      registerSignalHandlers: false,
      pollIntervalMs: 0,
      env: {},
    },
  );

  assert.equal(code, ExitCode.success);
  assert.deepEqual(calls, [
    {
      operationId: "app-map.test.run",
      input: {
        appMapId: "grok-ios",
        testId: "settings-tour",
        expectedRevision: 7,
        target: { kind: "device", platform: "ios", targetId: "ipad" },
      },
    },
    { operationId: "job.get", input: { jobId: "work-job" } },
    { operationId: "job.get", input: { jobId: "work-job" } },
  ]);
  assert.match(io.stdout(), /"ok":true/);
});

test("test run resolves one connected target and current revision before invoking", async () => {
  const io = capture();
  const calls: Array<{ operationId: OperationId; input: unknown }> = [];
  const client: OperationInvoker = {
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      if (operationId === "app-map.get") return { appMap: { id: "checkout", revision: 12 } };
      if (operationId === "target.devices.list") {
        return {
          devices: [
            { id: "pixel", serial: "pixel", name: "Pixel", platform: "android", booted: true },
          ],
        };
      }
      if (operationId === "app-map.test.run") return { job: { id: "job-12", status: "queued" } };
      return { job: { id: "job-12", status: "ok" } };
    },
    events: async () => {},
  };

  const code = await runCli(
    ["test", "run", "checkout", "smoke", "--target", "current", "--revision", "current", "--json"],
    {
      streams: io.streams,
      createClient: () => client,
      registerSignalHandlers: false,
      pollIntervalMs: 0,
      env: {},
    },
  );

  assert.equal(code, ExitCode.success);
  assert.deepEqual(calls.slice(0, 3), [
    { operationId: "app-map.get", input: { appMapId: "checkout" } },
    { operationId: "target.devices.list", input: {} },
    {
      operationId: "app-map.test.run",
      input: {
        appMapId: "checkout",
        testId: "smoke",
        expectedRevision: 12,
        target: { kind: "device", platform: "android", targetId: "pixel" },
      },
    },
  ]);
  assert.match(io.stderr(), /Resolved Test run revision 12 on pixel/);
});

test("flow run starts once, then watches that execution job", async () => {
  const io = capture();
  const calls: Array<{ operationId: OperationId; input: unknown }> = [];
  let polls = 0;
  const client: OperationInvoker = {
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      if (operationId === "app-map.flow.run") {
        return {
          job: { id: "flow-job", status: "running" },
          jobs: [{ id: "flow-job", status: "running" }],
          plan: { appMapId: "map", appMapRevision: 1, connections: [] },
        };
      }
      polls += 1;
      return { job: { id: "flow-job", status: polls === 1 ? "running" : "ok" } };
    },
    events: async () => {},
  };

  const code = await runCli(["flow", "run", "map", "flow", "--ndjson"], {
    streams: io.streams,
    createClient: () => client,
    registerSignalHandlers: false,
    pollIntervalMs: 0,
    env: {},
  });

  assert.equal(code, ExitCode.success);
  assert.deepEqual(calls, [
    { operationId: "app-map.flow.run", input: { appMapId: "map", flowId: "flow" } },
    { operationId: "job.get", input: { jobId: "flow-job" } },
    { operationId: "job.get", input: { jobId: "flow-job" } },
  ]);
  const records = io
    .stdout()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(records.at(-1).operationId, "app-map.flow.run");
  assert.deepEqual(records.at(-1).result, { job: { id: "flow-job", status: "ok" } });
});

test("combine run waits for every locale case before succeeding", async () => {
  const io = capture();
  const polled: string[] = [];
  const client: OperationInvoker = {
    async invoke(operationId, input) {
      if (operationId === "job.combine.start") {
        return {
          jobs: [
            { id: "locale-it", status: "queued" },
            { id: "locale-es", status: "queued" },
            { id: "locale-ja", status: "queued" },
          ],
        };
      }
      const jobId = (input as { jobId: string }).jobId;
      polled.push(jobId);
      return { job: { id: jobId, status: "ok" } };
    },
    events: async () => {},
  };

  const code = await runCli(
    ["combine", "run", "map", "languages", "--input", '{"serial":"phone"}', "--json"],
    {
      streams: io.streams,
      createClient: () => client,
      registerSignalHandlers: false,
      pollIntervalMs: 0,
      env: {},
    },
  );

  assert.equal(code, ExitCode.success);
  assert.deepEqual(polled, ["locale-it", "locale-es", "locale-ja"]);
  assert.deepEqual(
    JSON.parse(io.stdout()).result.jobs.map((job: { id: string }) => job.id),
    polled,
  );
});

test("combine run carries the shared explicit local-admission contract unchanged", async () => {
  const io = capture();
  const calls: Array<{ operationId: OperationId; input: Record<string, unknown> }> = [];
  const localAdmission = {
    deadlineMs: 180_000,
    durationEvidence: [
      {
        schemaVersion: 1,
        cohort: {
          targetId: "pixel-1",
          platform: "android",
          testId: "settings",
          action: "app-map:settings:test:settings",
        },
        duration: {
          workItemDurationMs: 12_000,
          provenance: "observed-p95",
          observedAt: 100,
          sampleCount: 5,
          maxAgeMs: MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
        },
        measurement: {
          estimator: "campaign-duration-estimate",
          recordSource: "persisted-runs",
          durationSource: "run-wall-clock",
          sampleIds: ["run-1", "run-2", "run-3", "run-4", "run-5"],
          observationWindow: { startedAt: 1, finishedAt: 100 },
        },
      },
    ],
    recoveryHeadroomMs: 5_000,
  };
  const client: OperationInvoker = {
    async invoke(operationId, input) {
      calls.push({ operationId, input: input as Record<string, unknown> });
      if (operationId === "job.combine.start") {
        return { jobs: [{ id: "local-cell", status: "queued" }] };
      }
      return { job: { id: "local-cell", status: "ok" } };
    },
    events: async () => {},
  };
  const input = {
    cellRuntimeProfiles: [
      { testId: "settings", values: { language: "it" }, targetProfileId: "pixel-profile" },
    ],
    cellTargetBindings: [
      {
        testId: "settings",
        values: { language: "it" },
        target: {
          schemaVersion: 1,
          kind: "local-device",
          provider: { key: "relay.local.agent-device", scope: "local" },
          targetId: "pixel-1",
          platform: "android",
          identity: { kind: "device-serial", value: "pixel-1" },
        },
      },
    ],
    localAdmission,
  };

  const code = await runCli(
    ["combine", "run", "map", "languages", "--input", JSON.stringify(input), "--json"],
    {
      streams: io.streams,
      createClient: () => client,
      registerSignalHandlers: false,
      pollIntervalMs: 0,
      env: {},
    },
  );

  assert.equal(code, ExitCode.success);
  const started = calls.find((call) => call.operationId === "job.combine.start");
  assert.deepEqual(started?.input.localAdmission, localAdmission);
  assert.deepEqual(started?.input.cellTargetBindings, input.cellTargetBindings);
  assert.equal(started?.input.serial, undefined);
  assert.equal(started?.input.appMapId, "map");
  assert.equal(started?.input.combineId, "languages");
});

test("combine run waits for later cases and fails when any locale fails", async () => {
  const io = capture();
  const polled: string[] = [];
  const client: OperationInvoker = {
    async invoke(operationId, input) {
      if (operationId === "job.combine.start") {
        return {
          jobs: [
            { id: "green", status: "queued" },
            { id: "red", status: "queued" },
          ],
        };
      }
      const jobId = (input as { jobId: string }).jobId;
      polled.push(jobId);
      return {
        job: {
          id: jobId,
          status: jobId === "red" ? "error" : "ok",
          ...(jobId === "red" ? { error: "Japanese case failed" } : {}),
        },
      };
    },
    events: async () => {},
  };

  const code = await runCli(
    ["combine", "run", "map", "languages", "--input", '{"serial":"phone"}', "--json"],
    {
      streams: io.streams,
      createClient: () => client,
      registerSignalHandlers: false,
      pollIntervalMs: 0,
      env: {},
    },
  );

  assert.deepEqual(polled, ["green", "red"]);
  assert.equal(code, ExitCode.operationFailure);
  assert.equal(JSON.parse(io.stdout()).error.message, "Japanese case failed");
});

test("run watch alias shares job polling behavior", async () => {
  const io = capture();
  let calls = 0;
  const running = { job: { id: "abc", status: "running" } };
  const code = await runCli(["run", "watch", "abc", "--no-wait", "--json"], {
    streams: io.streams,
    createClient: () => ({
      async invoke() {
        calls += 1;
        return running;
      },
      events: async () => {},
    }),
    registerSignalHandlers: false,
    env: {},
  });

  assert.equal(code, ExitCode.success);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(io.stdout()).operationId, "job.get");
});

test("job watch polling is cancelled through the existing signal path", async () => {
  const io = capture();
  const listenersBefore = process.listenerCount("SIGINT");
  let calls = 0;
  const code = await runCli(["job", "watch", "abc", "--ndjson"], {
    streams: io.streams,
    createClient: () => ({
      async invoke() {
        calls += 1;
        setImmediate(() => process.emit("SIGINT"));
        return { job: { id: "abc", status: "running" } };
      },
      events: async () => {},
    }),
    pollIntervalMs: 10_000,
    env: {},
  });

  assert.equal(code, ExitCode.cancellation);
  assert.equal(calls, 1);
  const records = io
    .stdout()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    records.map(({ type }) => type),
    ["progress", "snapshot", "error"],
  );
  assert.equal(records.filter(({ ok }) => typeof ok === "boolean").length, 1);
  assert.equal(records.at(-1).error.exitCode, ExitCode.cancellation);
  assert.equal(process.listenerCount("SIGINT"), listenersBefore);
});

test("job watch rejects malformed job.get responses", async () => {
  const io = capture();
  let calls = 0;
  const code = await runCli(["job", "watch", "abc", "--json"], {
    streams: io.streams,
    createClient: () => ({
      async invoke() {
        calls += 1;
        return { job: { id: "abc" } };
      },
      events: async () => {},
    }),
    registerSignalHandlers: false,
    pollIntervalMs: 0,
    env: {},
  });

  assert.equal(code, ExitCode.validation);
  assert.equal(calls, 1);
  const records = io.stdout().trim().split("\n");
  assert.equal(records.length, 1);
  assert.match(JSON.parse(records[0]!).error.message, /Malformed job\.get response/);
});

test("system events follow emits typed NDJSON without invoking event.stream or client focus", async () => {
  const io = capture();
  let invoked = false;
  const code = await runCli(["system", "events", "follow", "--ndjson"], {
    streams: io.streams,
    createClient: () => ({
      async invoke() {
        invoked = true;
        throw new Error("event follow must subscribe");
      },
      async events(callback, options) {
        assert.ok(options?.signal);
        callback(relayEvent);
      },
    }),
    registerSignalHandlers: false,
    env: {},
  });

  assert.equal(code, ExitCode.success);
  assert.equal(invoked, false);
  const records = io
    .stdout()
    .trim()
    .split("\n")
    .map((value) => JSON.parse(value));
  assert.deepEqual(records, [
    { type: "progress", operationId: "event.stream", phase: "following" },
    { type: "event", event: relayEvent },
    { type: "result", ok: true, operationId: "event.stream", result: {} },
  ]);
  assert.equal(io.stderr(), "");
  assert.doesNotMatch(io.stdout(), /Following|relay:/);
  assert.equal(hasTerminalControl(io.stdout()), false);
});

test("activity follow alias subscribes to the shared event stream", async () => {
  const io = capture();
  let invoked = false;
  const code = await runCli(["activity", "follow", "--ndjson"], {
    streams: io.streams,
    createClient: () => ({
      async invoke() {
        invoked = true;
        return {};
      },
      async events(callback) {
        callback(relayEvent);
      },
    }),
    registerSignalHandlers: false,
    env: {},
  });

  assert.equal(code, ExitCode.success);
  assert.equal(invoked, false);
  const records = io
    .stdout()
    .trim()
    .split("\n")
    .map((value) => JSON.parse(value));
  assert.deepEqual(
    records.map(({ type }) => type),
    ["progress", "event", "result"],
  );
});

test("SIGINT and SIGTERM emit one terminal cancellation and remove handlers", async () => {
  const listenersBefore = {
    sigint: process.listenerCount("SIGINT"),
    sigterm: process.listenerCount("SIGTERM"),
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const io = capture();
    const code = await runCli(["system", "events", "follow", "--ndjson"], {
      streams: io.streams,
      createClient: () => ({
        invoke: async () => ({}),
        events: async (_callback, options) =>
          await new Promise<void>((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("cancelled", "AbortError")),
              { once: true },
            );
            queueMicrotask(() => process.emit(signal));
          }),
      }),
      env: {},
    });

    assert.equal(code, ExitCode.cancellation);
    const records = io
      .stdout()
      .trim()
      .split("\n")
      .map((value) => JSON.parse(value));
    assert.deepEqual(
      records.map(({ type }) => type),
      ["progress", "error"],
    );
    assert.equal(records.filter(({ ok }) => typeof ok === "boolean").length, 1);
    assert.equal(records.at(-1).error.exitCode, ExitCode.cancellation);
    assert.doesNotMatch(io.stdout(), /relay:/);
    assert.equal(hasTerminalControl(io.stdout()), false);
    assert.match(io.stderr(), /Operation cancelled/);
  }

  assert.equal(process.listenerCount("SIGINT"), listenersBefore.sigint);
  assert.equal(process.listenerCount("SIGTERM"), listenersBefore.sigterm);
});

test("JSON event follow is a usage error before creating a client", async () => {
  const io = capture();
  let created = false;
  const code = await runCli(["system", "events", "follow", "--json"], {
    streams: io.streams,
    createClient: () => {
      created = true;
      return { invoke: async () => ({}), events: async () => {} };
    },
    registerSignalHandlers: false,
    env: {},
  });

  assert.equal(code, ExitCode.usage);
  assert.equal(created, false);
  const records = io.stdout().trim().split("\n");
  assert.equal(records.length, 1);
  assert.match(JSON.parse(records[0]!).error.message, /use --ndjson/);
});

test("JSON failures emit exactly one terminal object and diagnostics only to stderr", async () => {
  const io = capture();
  const secret = "must-not-leak";
  const code = await runCli(
    [
      "operation",
      "invoke",
      "system.health.get",
      "--input",
      "{}",
      "--json",
      "--credential-source",
      "env:TEST_RELAY_TOKEN",
    ],
    {
      streams: io.streams,
      createClient: (config) =>
        new RelayClient(config.connection, {
          timeoutMs: config.timeoutMs,
          fetch: async () => {
            throw new TypeError("fetch failed");
          },
        }) as unknown as OperationInvoker,
      registerSignalHandlers: false,
      env: { TEST_RELAY_TOKEN: secret },
    },
  );

  assert.equal(code, ExitCode.connection);
  const lines = io.stdout().trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]!), {
    type: "error",
    ok: false,
    operationId: "system.health.get",
    error: { message: "fetch failed", exitCode: ExitCode.connection },
  });
  assert.match(io.stderr(), /fetch failed/);
  assert.doesNotMatch(io.stdout(), /Invoking|relay:/);
  assert.doesNotMatch(`${io.stdout()}${io.stderr()}`, new RegExp(secret));
});

test("structured operation failures use a non-zero exit instead of a false success", async () => {
  const io = capture();
  const code = await runCli(["operation", "invoke", "step.run", "--input", "{}", "--json"], {
    streams: io.streams,
    createClient: () => ({
      invoke: async () => ({ ok: false, error: "the system Copy action did not appear" }),
      events: async () => {},
    }),
    registerSignalHandlers: false,
    env: {},
  });

  assert.equal(code, ExitCode.operationFailure);
  assert.deepEqual(JSON.parse(io.stdout()), {
    type: "error",
    ok: false,
    operationId: "step.run",
    error: {
      message: "the system Copy action did not appear",
      exitCode: ExitCode.operationFailure,
      details: { ok: false, error: "the system Copy action did not appear", logs: [] },
    },
  });
  assert.match(io.stderr(), /the system Copy action did not appear/);
});

test("device locale fails loudly when the app keeps another language", async () => {
  const io = capture();
  const code = await runCli(["device", "locale", "pixel-1", "ai.x.grok", "he", "--json"], {
    streams: io.streams,
    createClient: () => ({
      invoke: async () => {
        throw new ApiError(409, "app locale he did not take (tried iw)", {
          code: "APP_LOCALE_DID_NOT_TAKE",
          recovery:
            "The app kept another language after the alias retries. Inspect its locale resources, or verify the screen with device snapshot before trusting the switch.",
        });
      },
      events: async () => {},
    }),
    registerSignalHandlers: false,
    env: {},
  });
  assert.equal(code, ExitCode.conflict);
  const body = JSON.parse(io.stdout()) as {
    error?: { message?: string; details?: { code?: string } };
  };
  assert.match(body.error?.message ?? "", /did not take/u);
  assert.equal(body.error?.details?.code, "APP_LOCALE_DID_NOT_TAKE");
  assert.match(io.stderr(), /did not take/u);
});

test("structured recovery is machine-readable and useful in the human CLI", async () => {
  const io = capture();
  const details = {
    code: "TARGET_CONTROL_LEASE_REQUIRED",
    recovery: "Create a 15-minute exclusive lease with this same actor, then retry.",
    recoveryAction: {
      operationId: "lease.create",
      input: { poolId: "local", deviceSerial: "ipad-1" },
      cli: { argv: ["lease", "create", "ipad-1", "--actor", "agent:mapper"] },
    },
  };
  const code = await runCli(
    ["device", "interact", "ipad-1", "--input", '{"kind":"label","label":"Continue"}', "--json"],
    {
      streams: io.streams,
      createClient: () => ({
        invoke: async () => {
          throw new ApiError(403, "Take control before sending device input", details);
        },
        events: async () => {},
      }),
      registerSignalHandlers: false,
      env: {},
    },
  );

  assert.equal(code, ExitCode.conflict);
  assert.deepEqual(JSON.parse(io.stdout()).error.details, details);
  assert.match(io.stderr(), /Recovery: Create a 15-minute exclusive lease/u);
  assert.match(io.stderr(), /Try: relay lease create ipad-1 --actor agent:mapper/u);
});

test("failed watched jobs use a non-zero exit", async () => {
  const io = capture();
  const code = await runCli(["job", "watch", "failed-job", "--json"], {
    streams: io.streams,
    createClient: () => ({
      invoke: async () => ({
        job: { id: "failed-job", status: "error", error: "destination screen differed" },
      }),
      events: async () => {},
    }),
    registerSignalHandlers: false,
    pollIntervalMs: 0,
    env: {},
  });

  assert.equal(code, ExitCode.operationFailure);
  assert.equal(JSON.parse(io.stdout()).error.message, "destination screen differed");
});

test("failed watched jobs emit a bounded summary with durable evidence pointers", async () => {
  const io = capture();
  const huge = "aggregated failure ".repeat(50_000);
  const evidenceHuge = "raw accessibility evidence ".repeat(50_000);
  const code = await runCli(["job", "watch", "failed-large", "--json"], {
    streams: io.streams,
    createClient: () => ({
      invoke: async () => ({
        job: {
          id: "failed-large",
          status: "error",
          error: huge,
          runDir: "/workspace/runs/failed-large",
          artifacts: [
            {
              kind: "campaign-check-result",
              data: {
                id: "privacy",
                title: "Privacy",
                status: "failed",
                error: "screen differed",
                startedAt: 1,
                finishedAt: 2,
              },
            },
            {
              kind: "campaign-check-evidence",
              data: { nodes: evidenceHuge, screenshot: evidenceHuge },
            },
          ],
        },
      }),
      events: async () => {},
    }),
    registerSignalHandlers: false,
    pollIntervalMs: 0,
    env: {},
  });

  const terminal = JSON.parse(io.stdout());
  assert.equal(code, ExitCode.operationFailure);
  assert.ok(terminal.error.message.length <= 4_000);
  assert.ok(io.stdout().length < 20_000);
  assert.equal(terminal.error.details.job.resources.run, "/runs/failed-large");
  assert.deepEqual(terminal.error.details.job.resources.repairs, [
    "/runs/failed-large/checks/privacy/repair",
  ]);
  assert.equal(io.stdout().includes("raw accessibility evidence"), false);
});

test("unknown operations are usage errors without invoking a client", async () => {
  const io = capture();
  let created = false;
  const code = await runCli(["operation", "invoke", "not.real", "--input", "{}", "--quiet"], {
    streams: io.streams,
    createClient: () => {
      created = true;
      return { invoke: async () => ({}), events: async () => {} };
    },
    registerSignalHandlers: false,
    env: {},
  });
  assert.equal(code, ExitCode.usage);
  assert.equal(created, false);
  assert.equal(io.stderr(), "");
});
