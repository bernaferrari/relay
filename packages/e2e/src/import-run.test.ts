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

test("partial re-import progress cannot discard a completed receipt after source cleanup", async () => {
  const { run, root, output } = await fixture([
    artifact("one.png", { id: "one" }),
    artifact("two.png", { id: "two" }),
  ]);
  try {
    await writeFile(join(run.artifactsRoot, "one.png"), "first image");
    await writeFile(join(run.artifactsRoot, "two.png"), "second image");
    const imported = await importFinishedRun(run, { directory: output }, signal());
    await writeFile(
      join(imported.directory, "import-progress.json"),
      JSON.stringify({
        reportHash: imported.receipt.reportHash,
        artifacts: imported.receipt.artifacts.slice(0, 1),
      }),
    );
    await rm(run.artifactsRoot, { recursive: true });
    const { recoverImportedRun } = await import("./recover-import.js");
    const recovered = await recoverImportedRun(output, run.report.run.id, signal());
    assert.deepEqual(
      recovered.receipt.artifacts.map((a) => a.state),
      ["available", "available"],
    );
    assert.equal(recovered.receipt.acceptance.evidenceComplete, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

test("import requirements are frozen across retries and concurrent policy changes", async () => {
  const { run, output } = await fixture();
  const first = await importFinishedRun(
    run,
    { directory: output, requireHumanReview: true },
    signal(),
  );
  await assert.rejects(
    importFinishedRun(run, { directory: output, requireHumanReview: false }, signal()),
    /Conflicting import requirements/,
  );
  await assert.rejects(
    importFinishedRun(run, { directory: output, obligations: [] }, signal()),
    /Conflicting import requirements/,
  );
  const retained = JSON.parse(await readFile(join(first.directory, "receipt.json"), "utf8"));
  assert.equal(retained.requirementsHash, first.receipt.requirementsHash);
  assert.equal(retained.acceptance.humanReview, "pending");
});

test("duplicate checkpoint selectors are rejected before any report is published", async () => {
  const { run, output } = await fixture();
  const checkpoint = { testId: "test", targetId: "target", stepLabel: "checkpoint" };
  await assert.rejects(
    importFinishedRun(
      run,
      {
        directory: output,
        obligations: [
          { id: "before", ...checkpoint },
          { id: "after", ...checkpoint },
        ],
      },
      signal(),
    ),
    /Duplicate capture selector/,
  );
  await assert.rejects(access(join(runDirectory(output, run.report.run.id), "report.json")));
});

test("repeated screenshot labels require invocation identity even with identical bytes", async () => {
  const { run, output } = await fixture([
    artifact(),
    artifact("after.png", { id: "after", producer: { kind: "step", stepId: "after-step" } }),
  ]);
  run.report.run.results[0]!.attempts[0]!.steps.push({
    ...run.report.run.results[0]!.attempts[0]!.steps[0]!,
    id: "after-step",
  });
  await writeFile(join(run.artifactsRoot, "capture.png"), "same");
  await writeFile(join(run.artifactsRoot, "after.png"), "same");
  const checkpoint = { testId: "test", targetId: "target", stepLabel: "checkpoint" };
  const ambiguous = await importFinishedRun(
    run,
    { directory: output, obligations: [{ id: "owed", ...checkpoint }] },
    signal(),
  );
  assert.equal(ambiguous.receipt.coverage.obligations?.[0]?.state, "ambiguous");
  const exact = await importFinishedRun(
    run,
    {
      directory: join(output, "exact"),
      obligations: [
        { id: "before", ...checkpoint, occurrence: 1 },
        { id: "after", ...checkpoint, occurrence: 2 },
      ],
    },
    signal(),
  );
  assert(exact.receipt.coverage.obligations?.every((slot) => slot.state === "available"));
  assert.equal(new Set(exact.receipt.artifacts.map((a) => a.path)).size, 1);
  assert.notDeepEqual(
    exact.receipt.coverage.obligations?.[0]?.artifactIds,
    exact.receipt.coverage.obligations?.[1]?.artifactIds,
  );
});

test("overlapping declarations cannot consume a single screenshot twice", async () => {
  const { run, output } = await fixture([artifact()]);
  await writeFile(join(run.artifactsRoot, "capture.png"), "image");
  const checkpoint = { testId: "test", targetId: "target", stepLabel: "checkpoint" };
  const { receipt } = await importFinishedRun(
    run,
    {
      directory: output,
      obligations: [
        { id: "first", ...checkpoint },
        { id: "second", ...checkpoint, occurrence: 1, agent: "default" },
      ],
    },
    signal(),
  );
  assert(receipt.coverage.obligations?.every((item) => item.state === "ambiguous"));
});

test("missing optional diagnostics do not block required captured screenshots", async () => {
  const { run, output } = await fixture([
    artifact(),
    artifact("video.webm", { id: "video", kind: "video", mediaType: "video/webm" }),
  ]);
  await writeFile(join(run.artifactsRoot, "capture.png"), "image");
  const { receipt } = await importFinishedRun(run, { directory: output }, signal());
  assert.equal(receipt.artifacts[1]?.state, "missing");
  assert.equal(receipt.acceptance.evidenceComplete, true);
  assert.equal(receipt.acceptance.state, "pending-review");
  const required = await importFinishedRun(
    run,
    { directory: join(output, "video-required"), requiredArtifactKinds: ["screenshot", "video"] },
    signal(),
  );
  assert.equal(required.receipt.acceptance.evidenceComplete, false);
});

test("partial import can resume from retained evidence without upstream actions or files", async () => {
  const { recoverImportedRun } = await import("./recover-import.js");
  const { run, output } = await fixture([artifact()]);
  await writeFile(join(run.artifactsRoot, "capture.png"), "image");
  const imported = await importFinishedRun(run, { directory: output }, signal());
  await rm(join(imported.directory, "receipt.json"));
  await rm(run.artifactsRoot, { recursive: true });
  const recovered = await recoverImportedRun(output, run.report.run.id, signal());
  assert.equal(recovered.receipt.artifacts[0]?.state, "available");
  assert.equal(recovered.receipt.requirementsHash, imported.receipt.requirementsHash);
  assert.equal(recovered.receipt.acceptance.humanReview, "pending");
});
