import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  humanInterventionNeedsReproof,
  loadRedactionPolicy,
  persistRun,
  resetControlDatabaseCache,
  type SnapshotPayload,
  type TestJob,
} from "@relay/core";
import { startServer } from "./index.js";

const IOS_REPROOF_BEFORE =
  "iVBORw0KGgoAAAANSUhEUgAAAGwAAADqCAYAAABHj6AIAAACAklEQVR4Ae3BQQ3CUAAFweUFBV9G/WupnaKBE9mwM69zzkM0RlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZU3nzpvm9+6bou/tmIyojKiMqIyojKiMqIyojKiMqIyojKiMqIyojKiMqIyojK65zzEI0RlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlQ8JFgc/rAxuHwAAAABJRU5ErkJggg==";
const IOS_REPROOF_AFTER_CHANGED =
  "iVBORw0KGgoAAAANSUhEUgAAAGwAAADqCAYAAABHj6AIAAACAElEQVR4Ae3BAQ2EQADEwLJ5BScD/1qww8sgTTpznXNeojGiMqIyojKiMqIyojKiMqIyojKiMqIyojKiMqIyojKiMqIyojKiMqIyovJD5nkevnTfN18aURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRuc45L9EYURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZUfkDiPgHP3MBZg8AAAAASUVORK5CYII=";

const IOS_REPROOF_NONBLANK =
  "iVBORw0KGgoAAAANSUhEUgAAABEAAAAUCAYAAABroNZJAAAAUElEQVR4Aa3BsQ2DQADAQGMhpfwRGIEiYzEPY2WgVJ8WpaHAd8vY9slDEpCABFb+fM4vd97HiysJSEACEpCABCQggWVs++QhCUhAAhKQgAR+9t8F4a9OexIAAAAASUVORK5CYII=";

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-project-id": "local",
    "x-organization-id": "relay",
    "x-relay-actor-id": "agent:intervention-reproof-test",
    "x-relay-actor-kind": "agent",
    "x-relay-operation-id": "job.resume",
    "x-relay-request-id": crypto.randomUUID(),
    "x-relay-command-at": String(Date.now()),
    "idempotency-key": crypto.randomUUID(),
  };
}

function pausedInterventionJob(): TestJob {
  return {
    id: "human-intervention-paused",
    projectId: "local",
    action: "plain-recipe",
    title: "Plain recipe",
    targetContext: { kind: "device", platform: "android", serial: "android-human-reproof" },
    serial: "android-human-reproof",
    platform: "android",
    targetKind: "device",
    status: "paused",
    queuedAt: 1,
    logs: [],
    attempts: 1,
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    operationContext: {
      schemaVersion: 1,
      organizationId: "relay",
      projectId: "local",
      actorId: "agent:intervention-reproof-test",
      actorKind: "agent",
      operationId: "target.interact",
      requestId: "human-intervention-owner",
      idempotencyKey: "human-intervention-owner",
      issuedAt: 1,
    },
    waitingFor: {
      kind: "human",
      message: "Repair the target, then resume.",
      reason: "review",
      resumeLabel: "Resume",
      since: 2,
    },
    artifacts: [
      { kind: "human-intervention-requested", capturedAt: 2, data: {} },
      {
        kind: "human-intervention-authorized",
        capturedAt: 3,
        data: {
          requestCapturedAt: 2,
          actorId: "agent:intervention-reproof-test",
          requestId: "human-intervention-authorized",
        },
      },
    ],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  } as TestJob;
}

function interventionSnapshot(
  qualified: boolean,
  serial = "android-human-reproof",
  capturedAt = 100,
): SnapshotPayload {
  const nodes = qualified
    ? [
        {
          type: "Button",
          label: "Continue",
          hittable: true,
          rect: { x: 20, y: 30, width: 120, height: 44 },
        },
      ]
    : [];
  return {
    serial,
    capturedAt,
    nodes,
    interactive: nodes,
    inspectable: qualified,
    source: qualified ? "sdk" : "pixels-only",
    screenIdentity: {
      fingerprint: qualified ? "a".repeat(64) : "f".repeat(64),
      nodes: qualified ? [{ role: "button", label: "Continue" }] : [],
      volatileSignals: [],
    },
    readiness: {
      previewPixels: {
        mode: "pixels",
        state: qualified ? "proven" : "unproven",
        freshness: qualified ? "current" : "unproven",
        ...(qualified ? { proof: { at: capturedAt } } : { reason: "not-yet-proven" }),
      },
      semanticControl: qualified
        ? {
            mode: "accessibility",
            state: "proven",
            freshness: "current",
            proof: { at: capturedAt, observedNodeCount: 1 },
          }
        : {
            mode: "accessibility",
            state: "unavailable",
            freshness: "unproven",
            reason: "probe-failed",
          },
      evidenceCapture: {
        mode: "evidence",
        state: qualified ? "proven" : "unproven",
        freshness: qualified ? "current" : "unproven",
        ...(qualified ? { proof: { at: capturedAt } } : { reason: "not-yet-proven" }),
      },
    },
  } as SnapshotPayload;
}

function iosReproofScreenshot(serial: string, capturedAt: number, base64: string) {
  return {
    serial,
    capturedAt,
    mime: "image/png" as const,
    base64,
    path: `/tmp/${serial}-${capturedAt}.png`,
    bytes: Buffer.from(base64, "base64").byteLength,
    width: 108,
    height: 234,
  };
}

test("resume keeps a human intervention paused until its replacement semantic proof is current", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-human-intervention-reproof-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = join(root, "state");
  resetControlDatabaseCache();
  const paused = pausedInterventionJob();
  let qualified = false;
  let captures = 0;
  let resumed = 0;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      getJob: () => paused,
      captureSnapshot: async () => {
        captures += 1;
        return interventionSnapshot(qualified);
      },
      resumeJob: () => {
        resumed += 1;
        return paused;
      },
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const rejected = await fetch(`${base}/jobs/${paused.id}/resume`, {
      method: "POST",
      headers: headers(),
      body: "{}",
    });
    assert.equal(rejected.status, 409);
    assert.equal(
      ((await rejected.json()) as { code?: string }).code,
      "HUMAN_INTERVENTION_REPROOF_UNQUALIFIED",
    );
    assert.equal(resumed, 0);
    assert.equal(humanInterventionNeedsReproof(paused), true);

    qualified = true;
    const accepted = await fetch(`${base}/jobs/${paused.id}/resume`, {
      method: "POST",
      headers: headers(),
      body: "{}",
    });
    assert.equal(accepted.status, 200);
    assert.equal(captures, 2);
    assert.equal(resumed, 1);
    assert.equal(humanInterventionNeedsReproof(paused), false);
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("iOS resume refuses a delayed AX proof when its pixel bracket changed", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-ios-human-intervention-reproof-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = join(root, "state");
  resetControlDatabaseCache();
  const paused = pausedInterventionJob();
  const serial = "ios-human-reproof";
  paused.id = "ios-human-intervention-paused";
  paused.targetContext = { kind: "device", platform: "ios", serial };
  paused.serial = serial;
  paused.platform = "ios";
  let snapshotCaptures = 0;
  let screenshotCaptures = 0;
  let resumed = 0;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      getJob: () => paused,
      captureSnapshot: async () => {
        snapshotCaptures += 1;
        return interventionSnapshot(true, serial, 101);
      },
      captureScreenshot: async () =>
        iosReproofScreenshot(
          serial,
          screenshotCaptures++ === 0 ? 100 : 102,
          screenshotCaptures === 1 ? IOS_REPROOF_BEFORE : IOS_REPROOF_AFTER_CHANGED,
        ),
      cleanupScreenshot: async () => undefined,
      resumeJob: () => {
        resumed += 1;
        return paused;
      },
    },
  });
  try {
    const response = await fetch(`${`http://127.0.0.1:${server.port}`}/jobs/${paused.id}/resume`, {
      method: "POST",
      headers: headers(),
      body: "{}",
    });
    assert.equal(response.status, 409);
    assert.equal(
      ((await response.json()) as { code?: string }).code,
      "HUMAN_INTERVENTION_REPROOF_UNQUALIFIED",
    );
    assert.equal(snapshotCaptures, 1);
    assert.equal(screenshotCaptures, 2);
    assert.equal(resumed, 0);
    assert.equal(humanInterventionNeedsReproof(paused), true);
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("iOS reproof evidence stays reviewable through its owning job and persisted run", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-ios-human-intervention-evidence-"));
  const previous = {
    state: process.env.RELAY_STATE_DIR,
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    redaction: process.env.RELAY_REDACTION_MODE,
  };
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_WORKSPACE_ROOT = root;
  delete process.env.RELAY_REDACTION_MODE;
  await loadRedactionPolicy();
  resetControlDatabaseCache();
  const paused = pausedInterventionJob();
  const serial = "ios-human-evidence";
  paused.id = "ios-human-intervention-evidence";
  paused.targetContext = { kind: "device", platform: "ios", serial };
  paused.serial = serial;
  paused.platform = "ios";
  let screenshots = 0;
  const reproofPng = IOS_REPROOF_NONBLANK;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      getJob: (id) => (id === paused.id ? paused : undefined),
      captureSnapshot: async () => interventionSnapshot(true, serial, 101),
      captureScreenshot: async () =>
        iosReproofScreenshot(serial, screenshots++ === 0 ? 100 : 102, reproofPng),
      cleanupScreenshot: async () => undefined,
      resumeJob: () => {
        paused.status = "ok";
        paused.finishedAt = 103;
        return paused;
      },
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const resumed = await fetch(`${base}/jobs/${paused.id}/resume`, {
      method: "POST",
      headers: headers(),
      body: "{}",
    });
    assert.equal(resumed.status, 200, await resumed.clone().text());
    assert.equal(humanInterventionNeedsReproof(paused), false);
    const observation = paused.artifacts.at(-1)?.data as {
      observation?: { pixelBracket?: { evidence?: { before?: { sha256?: string } } } };
    };
    const sha256 = observation.observation?.pixelBracket?.evidence?.before?.sha256;
    assert.match(sha256 ?? "", /^[a-f0-9]{64}$/u);
    const jobUrl = `${base}/jobs/${paused.id}/human-intervention-reproof/evidence/${sha256}`;
    const jobEvidence = await fetch(jobUrl, { headers: headers() });
    assert.equal(jobEvidence.status, 200);
    assert.equal(jobEvidence.headers.get("content-type"), "image/png");
    assert.deepEqual(
      Buffer.from(await jobEvidence.arrayBuffer()),
      Buffer.from(reproofPng, "base64"),
    );
    assert.equal(
      (
        await fetch(`${base}/jobs/not-the-owner/human-intervention-reproof/evidence/${sha256}`, {
          headers: headers(),
        })
      ).status,
      404,
    );

    const persisted = await persistRun(paused);
    const runEvidence = await fetch(
      `${base}/runs/${persisted.id}/human-intervention-reproof/evidence/${sha256}`,
      { headers: headers() },
    );
    assert.equal(runEvidence.status, 200);
    assert.deepEqual(
      Buffer.from(await runEvidence.arrayBuffer()),
      Buffer.from(reproofPng, "base64"),
    );

    process.env.RELAY_REDACTION_MODE = "on";
    await loadRedactionPolicy();
    const redacted = await fetch(jobUrl, { headers: headers() });
    assert.equal(redacted.status, 409);
    assert.equal(((await redacted.json()) as { code?: string }).code, "VISUAL_EVIDENCE_REDACTED");
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    if (previous.redaction === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previous.redaction;
    await loadRedactionPolicy();
    await rm(root, { recursive: true, force: true });
  }
});
