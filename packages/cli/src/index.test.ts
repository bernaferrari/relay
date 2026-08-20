import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import type { EventEnvelope, OperationId } from "@relay/protocol";
import { ExitCode } from "./errors.js";
import { runCli } from "./index.js";
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
      input: { sessionId: "discovery-1", serial: "pixel-9" },
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

test("root and family help are useful without creating a client", async () => {
  const cases = [
    {
      argv: ["--help"],
      matches: [/App Map\s+map, screen, connect, flow/, /device screenshot <serial>/, /--binary/],
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
  assert.equal(code, ExitCode.validation);
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

  assert.equal(code, ExitCode.validation);
  assert.deepEqual(JSON.parse(io.stdout()), {
    type: "error",
    ok: false,
    operationId: "step.run",
    error: {
      message: "the system Copy action did not appear",
      exitCode: ExitCode.validation,
      details: { ok: false, error: "the system Copy action did not appear", logs: [] },
    },
  });
  assert.match(io.stderr(), /the system Copy action did not appear/);
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

test("iOS switcher scan stops retain the exact review package in CLI JSON", async () => {
  const io = capture();
  const details = {
    code: "IOS_MUTATION_OUTCOME_UNKNOWN",
    iosMutation: {
      nativeAttempts: 1,
      operation: "press",
      retry: { attempts: 0, decision: "blocked", reason: "native-command-outcome-unknown" },
    },
    switcherScan: {
      status: "interrupted",
      repair: {
        terminal: true,
        nextAction: "capture-current-screen-before-any-retry",
      },
    },
  };
  const code = await runCli(
    ["operation", "invoke", "switcher-profile.scan", "--input", "{}", "--json"],
    {
      streams: io.streams,
      createClient: () => ({
        invoke: async () => {
          throw new ApiError(409, "The iOS press may already have reached the device.", details);
        },
        events: async () => {},
      }),
      registerSignalHandlers: false,
      env: {},
    },
  );

  assert.equal(code, ExitCode.conflict);
  assert.deepEqual(JSON.parse(io.stdout()).error.details, details);
  assert.match(io.stderr(), /Capture the current screen|may already have reached/u);
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

  assert.equal(code, ExitCode.validation);
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
  assert.equal(code, ExitCode.validation);
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
