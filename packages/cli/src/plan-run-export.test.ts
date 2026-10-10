import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { ApiError } from "@relay/client";
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

async function fixture(
  t: test.TestContext,
  options: {
    exportError?: Error;
    exportResult?: unknown;
    failedJob?: boolean;
    singleJob?: boolean;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "relay-plan-run-json-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const rootDir = join(directory, "pack");
  const runDir = join(directory, "run");
  await mkdir(rootDir);
  await mkdir(runDir);
  await writeFile(join(rootDir, "index.html"), "<main>Review the two Runs</main>\n");
  await writeFile(join(runDir, "last.png"), "retained frame bytes");
  const calls: Array<{ operationId: string; input: unknown }> = [];
  const jobs = [
    { id: "first", status: "ok", runDir },
    {
      id: "second",
      status: options.failedJob ? "error" : "ok",
      ...(options.failedJob ? { error: "The second case failed" } : {}),
    },
  ].filter((_, index) => !options.singleJob || index === 0);
  const client: OperationInvoker = {
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      if (operationId === "job.combine.start") {
        return {
          campaign: { id: "campaign-1" },
          jobs: jobs.map((job) => ({ ...job, status: "queued" })),
        };
      }
      if (operationId === "job.get") {
        return { job: jobs.find((job) => job.id === (input as { jobId: string }).jobId) };
      }
      if (operationId === "job.combine.export") {
        if (options.exportError) throw options.exportError;
        if (options.exportResult !== undefined) return options.exportResult;
        return { rootDir, jobIds: jobs.map((job) => job.id), manifest: { batchId: "campaign-1" } };
      }
      if (operationId === "job.combine.analysis") {
        return {
          schemaVersion: 1,
          batchId: "campaign-1",
          analysis: { findings: [], critical: 0, warnings: 0 },
        };
      }
      throw new Error(`Unexpected operation: ${operationId}`);
    },
    events: async () => {},
  };
  const io = capture();
  const run = (flags: string[]) =>
    runCli(
      [
        "plan",
        "run",
        "grok-ios",
        "prompt-checks",
        "--all",
        "--budget",
        "10m",
        "--input",
        '{"serial":"synthetic-ipad","platform":"ios","targetKind":"device"}',
        ...flags,
      ],
      {
        streams: io.streams,
        createClient: () => client,
        env: {},
        registerSignalHandlers: false,
        pollIntervalMs: 0,
      },
    );
  return { directory, rootDir, calls, io, run };
}

test("actual Plan run emits one JSON result with completed Runs and requested export", async (t) => {
  const f = await fixture(t);
  const exportDir = join(f.directory, "review");
  const outDir = join(f.directory, "out");
  assert.equal(await f.run(["--export", exportDir, "--out", outDir, "--json"]), ExitCode.success);
  const envelope = JSON.parse(f.io.stdout());
  assert.equal(envelope.operationId, "job.combine.start");
  assert.equal(envelope.ok, true);
  assert.deepEqual(
    envelope.result.jobs.map((job: { id: string; status: string }) => [job.id, job.status]),
    [
      ["first", "ok"],
      ["second", "ok"],
    ],
  );
  assert.deepEqual(envelope.result.evidencePack, {
    rootDir: f.rootDir,
    exportDir,
    jobIds: ["first", "second"],
    manifest: { batchId: "campaign-1" },
  });
  assert.deepEqual(
    f.calls.filter((call) => call.operationId === "job.combine.start"),
    [
      {
        operationId: "job.combine.start",
        input: {
          appMapId: "grok-ios",
          combineId: "prompt-checks",
          serial: "synthetic-ipad",
          platform: "ios",
          targetKind: "device",
          executionMode: "all",
        },
      },
    ],
  );
  assert.deepEqual(
    f.calls.filter((call) => call.operationId === "job.combine.export"),
    [{ operationId: "job.combine.export", input: { batchId: "campaign-1" } }],
  );
  assert.match(f.io.stderr(), /"type":"progress"/);
  assert.equal(
    await readFile(join(exportDir, "index.html"), "utf8"),
    "<main>Review the two Runs</main>\n",
  );
  assert.deepEqual(JSON.parse(await readFile(join(outDir, "result.json"), "utf8")), envelope);
  assert.equal(await readFile(join(outDir, "checkpoint.png"), "utf8"), "retained frame bytes");
});

test("export ACK failure emits one original error and retains completed Run evidence without retry", async (t) => {
  const details = {
    code: "MUTATION_OUTCOME_UNKNOWN",
    operationId: "job.combine.export",
    mutationId: "export-once",
  };
  const f = await fixture(t, {
    exportError: new ApiError(500, "Export outcome could not be confirmed", details),
  });
  const outDir = join(f.directory, "out");
  assert.equal(
    await f.run(["--export", join(f.directory, "review"), "--out", outDir, "--json"]),
    ExitCode.server,
  );
  const envelope = JSON.parse(f.io.stdout());
  assert.equal(envelope.type, "error");
  assert.deepEqual(envelope.error.details, details);
  assert.equal(envelope.error.message, "Export outcome could not be confirmed");
  assert.deepEqual(
    envelope.result.jobs.map((job: { id: string }) => job.id),
    ["first", "second"],
  );
  assert.equal(envelope.result.evidencePack, undefined);
  assert.equal(f.calls.filter((call) => call.operationId === "job.combine.start").length, 1);
  assert.equal(f.calls.filter((call) => call.operationId === "job.combine.export").length, 1);
  assert.deepEqual(JSON.parse(await readFile(join(outDir, "result.json"), "utf8")), envelope);
  assert.equal(await readFile(join(outDir, "checkpoint.png"), "utf8"), "retained frame bytes");
});

test("a local export copy failure cannot emit a preceding JSON success", async (t) => {
  const f = await fixture(t);
  const exportDir = join(f.directory, "existing-file");
  await writeFile(exportDir, "not a directory");
  assert.equal(await f.run(["--export", exportDir, "--json"]), ExitCode.validation);
  const envelope = JSON.parse(f.io.stdout());
  assert.equal(envelope.ok, false);
  assert.equal(envelope.result.jobs.length, 2);
  assert.equal(envelope.result.evidencePack, undefined);
  assert.equal(f.calls.filter((call) => call.operationId === "job.combine.export").length, 1);
});

test("a structured export refusal remains an operation failure with one JSON receipt", async (t) => {
  const f = await fixture(t, {
    exportResult: { ok: false, error: { message: "Export was refused" } },
  });
  assert.equal(
    await f.run(["--export", join(f.directory, "review"), "--json"]),
    ExitCode.operationFailure,
  );
  const envelope = JSON.parse(f.io.stdout());
  assert.equal(envelope.error.message, "Export was refused");
  assert.equal(envelope.result.jobs.length, 2);
  assert.equal(envelope.result.evidencePack, undefined);
  assert.equal(f.calls.filter((call) => call.operationId === "job.combine.export").length, 1);
});

test("unexported Plan JSON keeps the existing jobs result and performs no export", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.run(["--json"]), ExitCode.success);
  const envelope = JSON.parse(f.io.stdout());
  assert.deepEqual(Object.keys(envelope.result), ["jobs"]);
  assert.equal(envelope.result.jobs.length, 2);
  assert.equal(f.calls.filter((call) => call.operationId === "job.combine.export").length, 0);
});

test("single-Run Plans retain the existing job shape with and without export", async (t) => {
  for (const exporting of [false, true]) {
    const f = await fixture(t, { singleJob: true });
    const flags = exporting ? ["--export", join(f.directory, "review"), "--json"] : ["--json"];
    assert.equal(await f.run(flags), ExitCode.success);
    const envelope = JSON.parse(f.io.stdout());
    assert.equal(envelope.result.job.id, "first");
    assert.equal(envelope.result.jobs, undefined);
    assert.deepEqual(Object.keys(envelope.result), exporting ? ["job", "evidencePack"] : ["job"]);
  }
});

test("JSON findings and export are phases of the same Plan result", async (t) => {
  const f = await fixture(t);
  assert.equal(
    await f.run(["--findings", "--export", join(f.directory, "review"), "--json"]),
    ExitCode.success,
  );
  const envelope = JSON.parse(f.io.stdout());
  assert.equal(envelope.result.jobs.length, 2);
  assert.equal(envelope.result.findings.batchId, "campaign-1");
  assert.equal(envelope.result.evidencePack.rootDir, f.rootDir);
  assert.equal(f.calls.filter((call) => call.operationId === "job.combine.analysis").length, 1);
});

test("failed watched cases remain failures and never begin export", async (t) => {
  const f = await fixture(t, { failedJob: true });
  assert.equal(
    await f.run(["--export", join(f.directory, "review"), "--json"]),
    ExitCode.operationFailure,
  );
  const envelope = JSON.parse(f.io.stdout());
  assert.match(envelope.error.message, /second case failed/);
  assert.equal(f.calls.filter((call) => call.operationId === "job.combine.export").length, 0);
});

test("nonwaiting export is rejected before any Plan mutation", async (t) => {
  const f = await fixture(t);
  assert.equal(
    await f.run(["--no-wait", "--export", join(f.directory, "review"), "--json"]),
    ExitCode.usage,
  );
  assert.equal(JSON.parse(f.io.stdout()).ok, false);
  assert.deepEqual(f.calls, []);
});

test("ndjson retains per-phase streaming instead of adopting the JSON envelope", async (t) => {
  const f = await fixture(t);
  assert.equal(
    await f.run(["--export", join(f.directory, "review"), "--ndjson"]),
    ExitCode.success,
  );
  const envelopes = f.io
    .stdout()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    envelopes.filter((value) => value.type === "result").map((value) => value.operationId),
    ["job.combine.start", "job.combine.export"],
  );
  assert.ok(envelopes.some((value) => value.type === "progress"));
});

test("human output retains separate execution and export results", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.run(["--export", join(f.directory, "review")]), ExitCode.success);
  assert.match(f.io.stdout(), /"jobs": \[/);
  assert.match(f.io.stdout(), /"rootDir":/);
  assert.doesNotMatch(f.io.stdout(), /"evidencePack":/);
  assert.match(f.io.stderr(), /Starting the run…/);
});
