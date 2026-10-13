import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, symlink, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { FinishedRun, Report, RunEvent } from "e2e";
import { importFinishedRun, relayReporter, runDirectory } from "./index.js";
import type { Artifact } from "./artifacts.js";

const signal = () => new AbortController().signal;
async function fixture(artifacts: Artifact[] = []) {
  const root = await mkdtemp(join(tmpdir(), "relay-e2e-"));
  const output = join(root, "relay");
  const artifactsRoot = join(root, "source");
  await mkdir(artifactsRoot);
  const report = {
    schemaVersion: "report-1",
    run: {
      id: "upstream-run",
      runner: { name: "e2e", version: "0.20.0" },
      status: "passed",
      exitCode: 0,
      results: [
        {
          id: "result",
          testId: "test",
          targetId: "target",
          agent: "default",
          repeat: 0,
          selected: true,
          attempts: [
            {
              id: "attempt",
              index: 0,
              status: "passed",
              steps: [{ id: "step", api: "app.screenshot", label: "checkpoint", status: "passed" }],
              artifacts,
            },
          ],
        },
      ],
      serialGroups: [],
    },
  } as unknown as Report;
  const run: FinishedRun = {
    report,
    status: "passed",
    exitCode: 0,
    projectRoot: root,
    artifactsRoot,
    reportPath: undefined,
    aiTracePath: undefined,
    traces: new Map(),
  };
  return { run, output, root };
}
function artifact(path = "capture.png", extras: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact",
    kind: "screenshot",
    mediaType: "image/png",
    path,
    redaction: "complete",
    producer: { kind: "step", stepId: "step" },
    ...extras,
  };
}

test("runner success stays success when evidence is missing; no denominator is invented", async () => {
  const { run, output } = await fixture([artifact()]);
  const { receipt } = await importFinishedRun(run, { directory: output }, signal());
  assert.equal(receipt.upstream.status, "passed");
  assert.equal(receipt.acceptance.state, "blocked");
  assert.equal(receipt.coverage.expected, undefined);
  assert.equal(receipt.artifacts[0]?.state, "missing");
});
test("copied evidence survives source deletion and duplicate imports do not create attempts", async () => {
  const bytes = Buffer.from("fixture-image");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { run, output } = await fixture([artifact("capture.png", { size: bytes.length, sha256 })]);
  await writeFile(join(run.artifactsRoot, "capture.png"), bytes);
  const options = {
    directory: output,
    requireHumanReview: true,
    obligations: [{ id: "owed", testId: "test", targetId: "target", stepLabel: "checkpoint" }],
  };
  const first = await importFinishedRun(run, options, signal());
  const second = await importFinishedRun(run, options, signal());
  assert.deepEqual(first.receipt, second.receipt);
  await rm(join(run.artifactsRoot, "capture.png"));
  const afterCleanup = await importFinishedRun(run, options, signal());
  assert.equal(afterCleanup.receipt.artifacts[0]?.state, "available");
  assert.equal(second.receipt.coverage.obligations?.[0]?.state, "available");
  assert.equal(second.receipt.acceptance.state, "pending-review");
  assert.deepEqual(
    JSON.parse(await readFile(join(first.directory, "report.json"), "utf8")),
    run.report,
  );
  assert.deepEqual(await readFile(join(first.directory, first.receipt.artifacts[0]!.path!)), bytes);
});
test("a declared missing checkpoint blocks acceptance even with no produced artifacts", async () => {
  const { run, output } = await fixture();
  const { receipt } = await importFinishedRun(
    run,
    {
      directory: output,
      obligations: [
        { id: "owed", testId: "test", targetId: "target", stepLabel: "never captured" },
      ],
    },
    signal(),
  );
  assert.equal(receipt.coverage.expected, 1);
  assert.equal(receipt.acceptance.state, "blocked");
});
test("traversal, symlink escapes and incomplete redaction are denied", async () => {
  const { run, output, root } = await fixture([
    artifact("../secret"),
    artifact("escape"),
    artifact("private", { redaction: "incomplete" }),
  ]);
  await writeFile(join(root, "secret"), "secret");
  await symlink(join(root, "secret"), join(run.artifactsRoot, "escape"));
  const { receipt } = await importFinishedRun(run, { directory: output }, signal());
  assert.deepEqual(
    receipt.artifacts.map((a) => a.state),
    ["denied", "denied", "denied"],
  );
});
test("hash mismatches and oversized artifacts remain unavailable", async () => {
  const { run, output } = await fixture([artifact("a", { sha256: "wrong" }), artifact("b")]);
  await writeFile(join(run.artifactsRoot, "a"), "test");
  await writeFile(join(run.artifactsRoot, "b"), "too large");
  const { receipt } = await importFinishedRun(
    run,
    { directory: output, maxArtifactBytes: 5 },
    signal(),
  );
  assert(receipt.artifacts.every((a) => a.state === "missing"));
});
test("aborted imports do not commit a receipt and conflicting reports cannot overwrite a run", async () => {
  const { run, output } = await fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(importFinishedRun(run, { directory: output }, controller.signal));
  await assert.rejects(access(join(runDirectory(output, run.report.run.id), "receipt.json")));
  await importFinishedRun(run, { directory: output }, signal());
  const changed = {
    ...run,
    report: {
      ...run.report,
      run: { ...run.report.run, project: { id: "changed", configDigest: "other" } },
    },
  };
  await assert.rejects(importFinishedRun(changed, { directory: output }, signal()), /Conflicting/);
});
test("reporter construction has no filesystem effects; queue pressure is observable", async () => {
  const { run, output } = await fixture();
  const reporter = relayReporter({ directory: output, maxQueuedEventBytes: 1 });
  await assert.rejects(access(output));
  const event = {
    type: "run-started",
    runId: run.report.run.id,
    seq: 0,
    at: new Date().toISOString(),
  } as unknown as RunEvent;
  assert.doesNotThrow(() => reporter.onEvent!(event));
  await reporter.onRunFinished!(run, signal());
  const stream = JSON.parse(
    await readFile(join(runDirectory(output, run.report.run.id), "event-stream.json"), "utf8"),
  );
  assert.equal(stream.complete, false);
  assert.equal(stream.dropped, 1);
});
test("duplicate live deliveries are idempotent", async () => {
  const { run, output } = await fixture();
  const reporter = relayReporter({ directory: output });
  const event = {
    type: "run-started",
    runId: run.report.run.id,
    seq: 0,
    at: new Date().toISOString(),
  } as unknown as RunEvent;
  reporter.onEvent!(event);
  reporter.onEvent!(event);
  await reporter.onRunFinished!(run, signal());
  const lines = (
    await readFile(join(runDirectory(output, run.report.run.id), "events.jsonl"), "utf8")
  )
    .trim()
    .split("\n");
  assert.equal(lines.length, 1);
});

test("concurrent conflicting imports cannot overwrite the same upstream identity", async () => {
  const { run, output } = await fixture();
  const changed = {
    ...run,
    report: {
      ...run.report,
      run: { ...run.report.run, project: { id: "different", configDigest: "different" } },
    },
  };
  const results = await Promise.allSettled([
    importFinishedRun(run, { directory: output }, signal()),
    importFinishedRun(changed, { directory: output }, signal()),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
});
