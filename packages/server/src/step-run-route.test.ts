import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { IosMutationOutcomeUnknownError } from "@relay/core";
import { startServer } from "./index.js";

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-project-id": "step-run-project",
    "x-organization-id": "relay",
    "x-relay-actor-id": "agent:step-run-test",
    "x-relay-actor-kind": "agent",
    "x-relay-operation-id": "step.run",
    "x-relay-request-id": crypto.randomUUID(),
    "x-relay-command-at": String(Date.now()),
    "idempotency-key": crypto.randomUUID(),
  };
}

function unknownIosStepError(): IosMutationOutcomeUnknownError {
  const error = new IosMutationOutcomeUnknownError(
    {
      sequence: 7,
      operation: "press",
      nativeAttempts: 1,
      outcome: "outcome-unknown",
      retry: {
        attempts: 0,
        decision: "blocked",
        reason: "native-command-outcome-unknown",
      },
      intervention: { required: true, action: "capture-current-screen-before-any-retry" },
      at: 123,
    },
    new Error("connection reset"),
  );
  Object.defineProperty(error, "iosSessionLifecycle", {
    configurable: true,
    value: {
      operation: "interaction",
      outcome: "unavailable",
      code: "IOS_SESSION_OPERATION_UNAVAILABLE",
      attempts: 1,
      repairAttempted: false,
      durationMs: 8,
      stages: [
        { stage: "preview", outcome: "passed" },
        { stage: "xctest-availability", outcome: "failed" },
        { stage: "accessibility-query", outcome: "skipped" },
        { stage: "repair", outcome: "skipped" },
      ],
    },
  });
  return error;
}

test("standalone iOS step preserves one-command review evidence without retry or capture", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-step-run-route-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  let executed = 0;
  let screenshots = 0;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    captureTargetScreenshot: async () => {
      screenshots += 1;
      throw new Error("a terminal step result must not capture automatically");
    },
    stepRunRuntime: {
      assertTargetControl: async () => ({
        id: "lease-1",
        projectId: "step-run-project",
        poolId: "local",
        deviceSerial: "ipad-1",
        ownerId: "agent:step-run-test",
        status: "leased",
        leasedAt: 1,
        expiresAt: Date.now() + 60_000,
      }),
      listDevices: async () => [
        {
          id: "ipad-1",
          serial: "ipad-1",
          name: "iPad",
          kind: "iPad",
          booted: true,
          platform: "ios",
        },
      ],
      devicePlatformForSerial: async () => "ios",
      executeStep: async ({ log }) => {
        executed += 1;
        log("native command issued once");
        throw unknownIosStepError();
      },
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/step/run`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ serial: "ipad-1", step: { kind: "sleep", ms: 1 } }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(typeof body.durationMs, "number");
    assert.deepEqual(body, {
      ok: false,
      terminal: "review-needed",
      error:
        "The iOS press may already have reached the device. Relay did not retry it. Capture the current screen, review the outcome, then explicitly choose retry or repair.",
      durationMs: body.durationMs,
      logs: ["native command issued once"],
      code: "IOS_MUTATION_OUTCOME_UNKNOWN",
      iosMutation: {
        sequence: 7,
        operation: "press",
        nativeAttempts: 1,
        outcome: "outcome-unknown",
        retry: {
          attempts: 0,
          decision: "blocked",
          reason: "native-command-outcome-unknown",
        },
        intervention: { required: true, action: "capture-current-screen-before-any-retry" },
        at: 123,
      },
      iosSessionLifecycle: {
        operation: "interaction",
        outcome: "unavailable",
        code: "IOS_SESSION_OPERATION_UNAVAILABLE",
        attempts: 1,
        repairAttempted: false,
        durationMs: 8,
        stages: [
          { stage: "preview", outcome: "passed" },
          { stage: "xctest-availability", outcome: "failed" },
          { stage: "accessibility-query", outcome: "skipped" },
          { stage: "repair", outcome: "skipped" },
        ],
      },
      stepReview: {
        captureCurrent: {
          operationId: "target.screenshot.capture",
          input: { serial: "ipad-1" },
        },
      },
    });
    assert.equal(executed, 1, "the uncertain native command is never replayed");
    assert.equal(screenshots, 0, "fresh pixels remain an explicit review action");
  } finally {
    await server.close();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
