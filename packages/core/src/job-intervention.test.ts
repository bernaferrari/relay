import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PNG } from "pngjs";
import type { OperationContext } from "./operation-context.js";
import {
  captureHumanInterventionReproof,
  type HumanInterventionPixelBracket,
  type HumanInterventionReproofCapture,
} from "./human-intervention-reproof.js";
import {
  HumanInterventionReproofUnavailableError,
  humanInterventionNeedsReproof,
  operationOwnsHumanIntervention,
  recordHumanInterventionAuthorization,
  recordHumanInterventionReproof,
} from "./job-intervention.js";
import { loadRedactionPolicy } from "./redaction.js";
import { observeVisualScreenFingerprint } from "./screen-identity.js";
import type { TestJob } from "./session-contract.js";
import type { ScreenshotPayload, SnapshotPayload } from "./workspace-capture.js";

function operation(actorId = "agent:runner", requestId = crypto.randomUUID()): OperationContext {
  return {
    schemaVersion: 1,
    organizationId: "org",
    projectId: "project",
    actorId,
    actorKind: "agent",
    operationId: "target.interact",
    requestId,
    idempotencyKey: requestId,
    issuedAt: Date.now(),
  };
}

function pausedJob(): TestJob {
  return {
    id: "job-paused",
    projectId: "project",
    operationContext: operation(),
    status: "paused",
    waitingFor: {
      kind: "human",
      message: "Repair Birth year",
      reason: "review",
      resumeLabel: "Resume",
      since: 100,
    },
    artifacts: [
      {
        kind: "human-intervention-requested",
        capturedAt: 99,
        data: { reason: "review" },
      },
    ],
  } as TestJob;
}

function qualifiedReproof(capturedAt = 100): Record<string, unknown> {
  return {
    capturedAt,
    inspectable: true,
    source: "sdk",
    nodeCount: 1,
    screenIdentity: { fingerprint: "birth-year-closed", nodes: [], volatileSignals: [] },
    readiness: {
      semanticControl: {
        mode: "accessibility",
        state: "proven",
        freshness: "current",
        proof: { at: capturedAt, observedNodeCount: 1 },
      },
    },
  };
}

function iosPausedJob(): TestJob {
  const job = pausedJob();
  job.targetContext = { kind: "device", platform: "ios", serial: "ios-human-reproof" };
  job.serial = "ios-human-reproof";
  return job;
}

function screenPng(panelX = 12): Buffer {
  const png = new PNG({ width: 108, height: 234 });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const offset = (y * png.width + x) * 4;
      const panel = x >= panelX && x < panelX + 32 && y >= 22 && y < 40;
      png.data[offset] = panel ? 232 : 18;
      png.data[offset + 1] = panel ? 232 : 18;
      png.data[offset + 2] = panel ? 232 : 18;
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function screenshot(serial: string, capturedAt: number, png: Buffer): ScreenshotPayload {
  return {
    serial,
    capturedAt,
    mime: "image/png",
    base64: png.toString("base64"),
    path: `/tmp/${serial}-${capturedAt}.png`,
    bytes: png.byteLength,
    width: 108,
    height: 234,
  };
}

function lowerScreenMutation(): Buffer {
  const png = PNG.sync.read(screenPng());
  for (let y = 205; y < 225; y++) {
    for (let x = 12; x < 97; x++) {
      const offset = (y * png.width + x) * 4;
      png.data[offset] = 232;
      png.data[offset + 1] = 232;
      png.data[offset + 2] = 232;
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function matchingPersistedEvidence(
  input: Parameters<NonNullable<HumanInterventionReproofCapture["persistEvidence"]>>[0],
) {
  const bytes = typeof input.data === "string" ? Buffer.from(input.data) : Buffer.from(input.data);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    id: `evidence-${sha256.slice(0, 24)}`,
    kind: input.kind,
    capturedAt: input.capturedAt,
    uri: `relay-evidence://${sha256}`,
    sha256,
    bytes: bytes.byteLength,
    ...(input.mime ? { mime: input.mime } : {}),
  };
}

function qualifiedSnapshot(serial: string, capturedAt: number): SnapshotPayload {
  const nodes = [
    {
      type: "Button",
      label: "Continue",
      hittable: true,
      rect: { x: 20, y: 30, width: 120, height: 44 },
    },
  ];
  return {
    serial,
    capturedAt,
    nodes,
    interactive: nodes,
    inspectable: true,
    source: "sdk",
    screenIdentity: {
      fingerprint: "a".repeat(64),
      nodes: [{ role: "button", label: "Continue" }],
      volatileSignals: [],
    },
    readiness: {
      previewPixels: {
        mode: "pixels",
        state: "proven",
        freshness: "current",
        proof: { at: capturedAt },
      },
      semanticControl: {
        mode: "accessibility",
        state: "proven",
        freshness: "current",
        proof: { at: capturedAt, observedNodeCount: 1 },
      },
      evidenceCapture: {
        mode: "evidence",
        state: "proven",
        freshness: "current",
        proof: { at: capturedAt },
      },
    },
  };
}

test("paused intervention belongs only to the exact project and actor", () => {
  const job = pausedJob();
  assert.deepEqual(operationOwnsHumanIntervention(job, operation()), { requestCapturedAt: 99 });
  assert.equal(operationOwnsHumanIntervention(job, operation("human:other")), undefined);
  assert.equal(
    operationOwnsHumanIntervention(job, { ...operation(), projectId: "other-project" }),
    undefined,
  );
  job.status = "running";
  assert.equal(operationOwnsHumanIntervention(job, operation()), undefined);
});

test("manual intervention has immutable authorization and re-proof lineage", () => {
  const job = pausedJob();
  const authorized = operation();
  recordHumanInterventionAuthorization(job, authorized, 99);
  recordHumanInterventionAuthorization(job, authorized, 99);
  assert.equal(
    job.artifacts.filter((artifact) => artifact.kind === "human-intervention-authorized").length,
    1,
  );
  assert.equal(humanInterventionNeedsReproof(job), true);

  recordHumanInterventionReproof(job, operation(), qualifiedReproof());
  assert.equal(humanInterventionNeedsReproof(job), false);

  recordHumanInterventionAuthorization(job, operation(), 99);
  assert.equal(humanInterventionNeedsReproof(job), true, "a later edit invalidates the old proof");
});

test("pixels-only and stale intervention observations cannot clear a human pause", () => {
  const job = pausedJob();
  recordHumanInterventionAuthorization(job, operation(), 99);

  const pixelsOnly = qualifiedReproof();
  pixelsOnly.inspectable = false;
  pixelsOnly.nodeCount = 0;
  const pixelsReadiness = pixelsOnly.readiness as { semanticControl: Record<string, unknown> };
  pixelsReadiness.semanticControl = {
    mode: "accessibility",
    state: "unavailable",
    freshness: "unproven",
    reason: "probe-failed",
  };
  assert.throws(
    () => recordHumanInterventionReproof(job, operation(), pixelsOnly),
    HumanInterventionReproofUnavailableError,
  );
  assert.equal(humanInterventionNeedsReproof(job), true);

  assert.throws(
    () => recordHumanInterventionReproof(job, operation(), qualifiedReproof(98)),
    HumanInterventionReproofUnavailableError,
  );

  const stale = qualifiedReproof();
  const staleReadiness = stale.readiness as { semanticControl: Record<string, unknown> };
  staleReadiness.semanticControl.freshness = "stale";
  assert.throws(
    () => recordHumanInterventionReproof(job, operation(), stale),
    HumanInterventionReproofUnavailableError,
  );
  assert.equal(
    job.artifacts.filter((artifact) => artifact.kind === "human-intervention-reproof").length,
    0,
  );
});

test("iOS human intervention resume requires a stable pixel bracket around current AX", async () => {
  const job = iosPausedJob();
  const owner = operation();
  recordHumanInterventionAuthorization(job, owner, 99);

  assert.throws(
    () => recordHumanInterventionReproof(job, operation(), qualifiedReproof()),
    HumanInterventionReproofUnavailableError,
  );

  const targetId = "ios-human-reproof";
  let mismatchedCaptures = 0;
  const cleanedPaths: string[] = [];
  await assert.rejects(
    captureHumanInterventionReproof({
      job,
      operation: operation(),
      targetId,
      capture: {
        captureScreenshot: async () => {
          const capture = mismatchedCaptures++;
          return screenshot(
            targetId,
            capture === 0 ? 100 : 102,
            screenPng(capture === 0 ? 12 : 44),
          );
        },
        captureSnapshot: async () => qualifiedSnapshot(targetId, 101),
        cleanupScreenshot: async (path) => {
          cleanedPaths.push(path);
        },
      },
    }),
    HumanInterventionReproofUnavailableError,
  );
  assert.deepEqual(cleanedPaths, [`/tmp/${targetId}-100.png`, `/tmp/${targetId}-102.png`]);
  assert.equal(humanInterventionNeedsReproof(job), true);

  const lowerMutationJob = iosPausedJob();
  recordHumanInterventionAuthorization(lowerMutationJob, operation(), 99);
  const lowerMutation = lowerScreenMutation();
  assert.equal(
    observeVisualScreenFingerprint(screenPng()),
    observeVisualScreenFingerprint(lowerMutation),
    "the coarse identity intentionally cannot stand in for a stable full raster",
  );
  let lowerMutationCaptures = 0;
  await assert.rejects(
    captureHumanInterventionReproof({
      job: lowerMutationJob,
      operation: operation(),
      targetId,
      capture: {
        captureScreenshot: async () =>
          screenshot(
            targetId,
            lowerMutationCaptures++ === 0 ? 200 : 202,
            lowerMutationCaptures === 1 ? screenPng() : lowerMutation,
          ),
        captureSnapshot: async () => qualifiedSnapshot(targetId, 201),
        cleanupScreenshot: async () => undefined,
      },
    }),
    HumanInterventionReproofUnavailableError,
  );
  assert.equal(humanInterventionNeedsReproof(lowerMutationJob), true);

  const persistenceFailureJob = iosPausedJob();
  recordHumanInterventionAuthorization(persistenceFailureJob, operation(), 99);
  let failedPersistenceCaptures = 0;
  const failureCleanup: string[] = [];
  await assert.rejects(
    captureHumanInterventionReproof({
      job: persistenceFailureJob,
      operation: operation(),
      targetId,
      capture: {
        captureScreenshot: async () =>
          screenshot(targetId, failedPersistenceCaptures++ === 0 ? 200 : 202, screenPng()),
        captureSnapshot: async () => qualifiedSnapshot(targetId, 201),
        cleanupScreenshot: async (path) => {
          failureCleanup.push(path);
        },
        persistEvidence: async () => {
          throw new Error("evidence storage unavailable");
        },
      },
    }),
    /evidence storage unavailable/u,
  );
  assert.deepEqual(failureCleanup, [`/tmp/${targetId}-200.png`, `/tmp/${targetId}-202.png`]);
  assert.equal(humanInterventionNeedsReproof(persistenceFailureJob), true);
  assert.equal(
    persistenceFailureJob.artifacts.filter(
      (artifact) => artifact.kind === "human-intervention-reproof",
    ).length,
    0,
  );

  let captures = 0;
  const persisted: Array<{ kind: string; capturedAt: number; data: Uint8Array | string }> = [];
  await captureHumanInterventionReproof({
    job,
    operation: operation(),
    targetId,
    capture: {
      captureScreenshot: async () =>
        screenshot(targetId, captures++ === 0 ? 200 : 202, screenPng()),
      captureSnapshot: async () => qualifiedSnapshot(targetId, 201),
      cleanupScreenshot: async () => undefined,
      persistEvidence: async (input) => {
        persisted.push(input);
        return matchingPersistedEvidence(input);
      },
      evidenceExists: async () => true,
    },
  });
  assert.equal(humanInterventionNeedsReproof(job), false);
  const reproof = job.artifacts.at(-1);
  const data = reproof?.data as
    | { observation?: { pixelBracket?: HumanInterventionPixelBracket } }
    | undefined;
  const bracket = data?.observation?.pixelBracket;
  assert.ok(bracket);
  assert.equal(bracket.schemaVersion, 1);
  assert.equal(bracket.captureOrder, "pixels-ax-pixels");
  assert.equal(bracket.serial, targetId);
  assert.equal(bracket.before.capturedAt, 200);
  assert.equal(bracket.after.capturedAt, 202);
  assert.equal(bracket.before.visualFingerprint, bracket.after.visualFingerprint);
  assert.deepEqual(
    persisted.map((item) => [item.kind, item.capturedAt]),
    [
      ["screenshot", 200],
      ["snapshot", 201],
      ["screenshot", 202],
      ["snapshot", 202],
    ],
  );
  assert.equal(
    bracket.evidence.before.sha256,
    createHash("sha256").update(screenPng()).digest("hex"),
  );
  assert.equal(bracket.evidence.semantics.capturedAt, 201);
  assert.equal(bracket.evidence.after.capturedAt, 202);
  assert.equal(bracket.evidence.manifest.kind, "snapshot");

  const tamperedJob = iosPausedJob();
  recordHumanInterventionAuthorization(tamperedJob, operation(), 99);
  const tamperedObservation = structuredClone(data?.observation);
  const tamperedBracket = (
    tamperedObservation as {
      pixelBracket?: HumanInterventionPixelBracket;
    }
  ).pixelBracket;
  assert.ok(tamperedBracket);
  tamperedBracket.evidence.before.uri =
    "relay-evidence://ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  assert.throws(
    () => recordHumanInterventionReproof(tamperedJob, operation(), tamperedObservation),
    HumanInterventionReproofUnavailableError,
  );
  assert.equal(humanInterventionNeedsReproof(tamperedJob), true);

  const uncommittedJob = iosPausedJob();
  recordHumanInterventionAuthorization(uncommittedJob, operation(), 99);
  let uncommittedCaptures = 0;
  await assert.rejects(
    captureHumanInterventionReproof({
      job: uncommittedJob,
      operation: operation(),
      targetId,
      capture: {
        captureScreenshot: async () =>
          screenshot(targetId, uncommittedCaptures++ === 0 ? 200 : 202, screenPng()),
        captureSnapshot: async () => qualifiedSnapshot(targetId, 201),
        cleanupScreenshot: async () => undefined,
        persistEvidence: async (input) => matchingPersistedEvidence(input),
        evidenceExists: async () => false,
      },
    }),
    HumanInterventionReproofUnavailableError,
  );
  assert.equal(humanInterventionNeedsReproof(uncommittedJob), true);
});

test("iOS human intervention reproof fails closed before pixels are captured under visual redaction", async () => {
  const previousMode = process.env.RELAY_REDACTION_MODE;
  process.env.RELAY_REDACTION_MODE = "on";
  await loadRedactionPolicy();
  const job = iosPausedJob();
  recordHumanInterventionAuthorization(job, operation(), 99);
  let captures = 0;
  try {
    await assert.rejects(
      captureHumanInterventionReproof({
        job,
        operation: operation(),
        targetId: "ios-human-reproof",
        capture: {
          captureScreenshot: async () => {
            captures += 1;
            return screenshot("ios-human-reproof", 100, screenPng());
          },
          captureSnapshot: async () => qualifiedSnapshot("ios-human-reproof", 101),
        },
      }),
      HumanInterventionReproofUnavailableError,
    );
    assert.equal(captures, 0);
    assert.equal(humanInterventionNeedsReproof(job), true);
  } finally {
    if (previousMode === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previousMode;
    await loadRedactionPolicy();
  }
});
