import assert from "node:assert/strict";
import test from "node:test";
import type { TargetRuntimeReadiness } from "@relay/protocol";
import type { Device } from "./device.js";
import {
  captureIosEvidenceVideo,
  IosEvidenceCaptureUnavailableError,
} from "./workspace-capture.js";

type EvidenceRuntime = NonNullable<Parameters<typeof captureIosEvidenceVideo>[1]>;

function readiness(evidenceState: "proven" | "unavailable" = "proven"): TargetRuntimeReadiness {
  return {
    previewPixels: {
      mode: "pixels",
      state: "proven",
      freshness: "current",
      proof: { at: 1 },
    },
    semanticControl: {
      mode: "accessibility",
      state: "unavailable",
      freshness: "unproven",
      reason: "probe-failed",
    },
    evidenceCapture:
      evidenceState === "proven"
        ? {
            mode: "evidence",
            state: "proven",
            freshness: "current",
            proof: { at: 1 },
          }
        : {
            mode: "evidence",
            state: "unavailable",
            freshness: "unproven",
            reason: "probe-failed",
            lastError: { at: 1, reason: "probe-failed" },
          },
  };
}

function runtime(overrides: Partial<EvidenceRuntime> = {}): {
  runtime: EvidenceRuntime;
  capabilities: Array<Parameters<EvidenceRuntime["recordTargetRuntimeCapability"]>>;
  operations: string[];
} {
  const capabilities: Array<Parameters<EvidenceRuntime["recordTargetRuntimeCapability"]>> = [];
  const operations: string[] = [];
  let clock = 100;
  const recordTargetRuntimeCapability: EvidenceRuntime["recordTargetRuntimeCapability"] = (
    ...args
  ) => {
    capabilities.push(args);
  };
  const withSession: EvidenceRuntime["withSession"] = async (_device, op, operation) => {
    operations.push(operation ?? "interaction");
    return op();
  };
  return {
    runtime: {
      ensureIosRunnerPrepared: async () => undefined,
      withSession,
      recordIosVideo: async (_device, input) => ({
        mode: "recorded-video",
        path: input.path,
      }),
      diagnoseIosRunnerError: async (error) =>
        error instanceof Error ? error : new Error(String(error)),
      recordTargetRuntimeCapability,
      targetRuntimeReadiness: () => readiness(),
      now: () => ++clock,
      ...overrides,
    },
    capabilities,
    operations,
  };
}

test("iOS video start makes one proof-only preparation and records evidence once", async () => {
  let preparations = 0;
  let records = 0;
  const fixture = runtime({
    ensureIosRunnerPrepared: async () => {
      preparations += 1;
    },
    recordIosVideo: async (_device, input) => {
      records += 1;
      return { mode: "recorded-video", path: input.path };
    },
  });

  const result = await captureIosEvidenceVideo(
    { device: {} as Device, serial: "ipad-proof", action: "start", path: "/tmp/take.mp4" },
    fixture.runtime,
  );

  assert.deepEqual(result, {
    serial: "ipad-proof",
    platform: "ios",
    mode: "recorded-video",
    path: "/tmp/take.mp4",
  });
  assert.equal(preparations, 1);
  assert.equal(records, 1);
  assert.deepEqual(fixture.operations, ["evidence"]);
  assert.equal(fixture.capabilities.length, 1);
  assert.equal(fixture.capabilities[0]?.[1], "evidenceCapture");
  assert.equal(fixture.capabilities[0]?.[2], "proven");
});

test("a recoverable iOS preparation failure returns one actionable unavailable proof without a retry", async () => {
  const failure = new Error("CoreDevice.ActionError: StreamingAction failed");
  let preparations = 0;
  let records = 0;
  const fixture = runtime({
    ensureIosRunnerPrepared: async () => {
      preparations += 1;
      throw failure;
    },
    recordIosVideo: async () => {
      records += 1;
      return { mode: "recorded-video" };
    },
    diagnoseIosRunnerError: async () =>
      new Error("Keep the iPad unlocked, then press Reconnect once."),
    targetRuntimeReadiness: () => readiness("unavailable"),
  });

  await assert.rejects(
    captureIosEvidenceVideo(
      { device: {} as Device, serial: "ipad-proof", action: "start" },
      fixture.runtime,
    ),
    (error: unknown) => {
      assert.ok(error instanceof IosEvidenceCaptureUnavailableError);
      assert.equal(error.diagnostic.stage, "runner-preparation");
      assert.equal(error.diagnostic.attempts, 1);
      assert.equal(error.diagnostic.repairAttempted, false);
      assert.equal(error.diagnostic.code, "IOS_EVIDENCE_CAPTURE_UNAVAILABLE");
      assert.equal(error.diagnostic.readiness.previewPixels.state, "proven");
      assert.equal(error.diagnostic.readiness.evidenceCapture.state, "unavailable");
      assert.deepEqual(error.diagnostic.recoveryAction.input, {
        serial: "ipad-proof",
        reason: "record",
      });
      assert.equal(error.diagnostic.recoveryAction.operationId, "target.recover");
      return true;
    },
  );

  assert.equal(preparations, 1);
  assert.equal(records, 0);
  assert.deepEqual(fixture.operations, []);
  assert.equal(fixture.capabilities.length, 1);
  assert.equal(fixture.capabilities[0]?.[2], "unavailable");
});

test("a failed iOS recorder start does not turn into a second setup or recovery attempt", async () => {
  const failure = new Error("No active XCTest session");
  let preparations = 0;
  let records = 0;
  const fixture = runtime({
    ensureIosRunnerPrepared: async () => {
      preparations += 1;
    },
    recordIosVideo: async () => {
      records += 1;
      throw failure;
    },
  });

  await assert.rejects(
    captureIosEvidenceVideo(
      { device: {} as Device, serial: "ipad-proof", action: "start" },
      fixture.runtime,
    ),
    (error: unknown) => {
      assert.ok(error instanceof IosEvidenceCaptureUnavailableError);
      assert.equal(error.diagnostic.stage, "recording");
      assert.equal(error.diagnostic.attempts, 1);
      assert.equal(error.diagnostic.repairAttempted, false);
      return true;
    },
  );

  assert.equal(preparations, 1);
  assert.equal(records, 1);
  assert.deepEqual(fixture.operations, ["evidence"]);
});
