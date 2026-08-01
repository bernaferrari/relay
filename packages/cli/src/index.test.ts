import assert from "node:assert/strict";
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
  stdout.on("data", (chunk) => (out += String(chunk)));
  stderr.on("data", (chunk) => (err += String(chunk)));
  return { streams: { stdout, stderr }, stdout: () => out, stderr: () => err };
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

test("root and family help are useful without creating a client", async () => {
  const cases = [
    { argv: ["--help"], matches: [/Command families:/, /target screenshot <serial>/, /--server/] },
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
      matches: [/screen list <journeyId>/, /aliases for Journey document operations/],
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
  assert.doesNotMatch(io.stdout(), /\u001b|\r/);
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
  assert.doesNotMatch(io.stdout(), /Following|relay:|\u001b|\r/);
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
    assert.doesNotMatch(io.stdout(), /relay:|\u001b|\r/);
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
