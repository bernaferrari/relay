import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { RelayClient } from "@relay/client";
import type { OperationId } from "@relay/protocol";
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

test("generic invocation calls the operation client with parsed input", async () => {
  const io = capture();
  const calls: Array<{ operationId: OperationId; input: unknown }> = [];
  const client: OperationInvoker = {
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      return { healthy: true };
    },
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

test("NDJSON contains typed progress followed by one terminal result", async () => {
  const io = capture();
  const code = await runCli(
    ["operation", "invoke", "job.get", "--input", '{"jobId":"abc"}', "--ndjson"],
    {
      streams: io.streams,
      createClient: () => ({ invoke: async () => ({ job: { id: "abc" } }) }),
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
      return { invoke: async () => ({}) };
    },
    registerSignalHandlers: false,
    env: {},
  });
  assert.equal(code, ExitCode.usage);
  assert.equal(created, false);
  assert.equal(io.stderr(), "");
});
