import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { RelayClient } from "@relay/client";
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
  operationId: "journey.update",
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
      argv: ["journey", "get", "onboarding"],
      operationId: "journey.get",
      input: { journeyId: "onboarding" },
    },
    {
      argv: ["screen", "list", "onboarding"],
      operationId: "journey.document.get",
      input: { journeyId: "onboarding" },
    },
    {
      argv: ["connection", "update", "onboarding", "--input", '{"expectedRevision":4}'],
      operationId: "journey.document.update",
      input: { journeyId: "onboarding", expectedRevision: 4 },
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
      argv: ["collection", "run", "smoke"],
      operationId: "collection.run",
      input: { collectionId: "smoke" },
    },
    {
      argv: ["run", "visual-baseline", "update", "run-7"],
      operationId: "run.visual-baseline.update",
      input: { runId: "run-7" },
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
    assert.equal(io.stderr(), "");
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
      matches: [/session start <sessionId>/, /session commit <sessionId>/, /--actor/],
    },
    {
      argv: ["take", "--help"],
      matches: [/take trim <sessionId>/, /take replay <sessionId>/, /--project/],
    },
    {
      argv: ["screen", "--help"],
      matches: [
        /screen list <mapId>/,
        /whole App Map documents/,
        /expectedRevision \(number, required\)/,
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
