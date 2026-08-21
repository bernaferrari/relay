import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  humanInterventionNeedsReproof,
  resetControlDatabaseCache,
  type SnapshotPayload,
  type TestJob,
} from "@relay/core";
import { startServer } from "./index.js";

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

function interventionSnapshot(qualified: boolean): SnapshotPayload {
  const capturedAt = 100;
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
    serial: "android-human-reproof",
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
