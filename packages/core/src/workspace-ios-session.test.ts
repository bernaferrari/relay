import assert from "node:assert/strict";
import test from "node:test";
import type { Device } from "./device.js";
import { recoverIosRuntimeSession } from "./ios-runtime-recovery.js";
import { runWithTargetContext } from "./target-context.js";
import {
  ensureIosRunnerPrepared,
  lastIosSessionOperationDiagnostic,
  resetIosRunnerState,
  setIosSessionHostRuntimeForTests,
  withSession,
} from "./workspace-ios-session.js";

test("a snapshot failure remains one read-only attempt with no hidden repair", async () => {
  let attempts = 0;
  const failure = new Error("No active XCTest session");

  await assert.rejects(
    runWithTargetContext({ kind: "device", platform: "ios", serial: "read-only-ipad" }, () =>
      withSession(
        {} as Device,
        async () => {
          attempts += 1;
          throw failure;
        },
        "snapshot",
      ),
    ),
    (error: unknown) => error === failure,
  );

  assert.equal(attempts, 1);
  const diagnostic = lastIosSessionOperationDiagnostic("read-only-ipad");
  assert.ok(diagnostic);
  assert.ok(diagnostic.durationMs >= 0);
  assert.deepEqual(
    { ...diagnostic, durationMs: 0 },
    {
      operation: "snapshot",
      outcome: "unavailable",
      code: "IOS_SESSION_OPERATION_UNAVAILABLE",
      attempts: 1,
      repairAttempted: false,
      durationMs: 0,
      stages: [
        { stage: "preview", outcome: "skipped" },
        { stage: "xctest-availability", outcome: "failed" },
        { stage: "accessibility-query", outcome: "failed" },
        { stage: "repair", outcome: "skipped" },
      ],
    },
  );
  assert.equal(
    (failure as Error & { iosSessionLifecycle?: { repairAttempted: boolean } }).iosSessionLifecycle
      ?.repairAttempted,
    false,
  );
});

test("preview and interaction report their explicit bounded operation outcome", async () => {
  for (const operation of ["preview", "interaction"] as const) {
    const serial = `${operation}-ipad`;
    const value = await runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
      withSession({} as Device, async () => operation, operation),
    );
    assert.equal(value, operation);
    const diagnostic = lastIosSessionOperationDiagnostic(serial);
    assert.equal(diagnostic?.operation, operation);
    assert.equal(diagnostic?.outcome, "passed");
    assert.equal(diagnostic?.attempts, 1);
    assert.equal(diagnostic?.repairAttempted, false);
    assert.equal(diagnostic?.stages.at(-1)?.outcome, "skipped");
  }
});

test("runner preparation makes one proof attempt and never repairs the host", async () => {
  const failure = new Error("CoreDevice.ActionError: StreamingAction failed");
  let preparations = 0;
  let repairs = 0;
  const restore = setIosSessionHostRuntimeForTests({
    prepareIosRunner: async () => {
      preparations += 1;
      throw failure;
    },
    recoverIosRuntime: async () => {
      repairs += 1;
      throw new Error("unexpected hidden host repair");
    },
  });
  try {
    await assert.rejects(ensureIosRunnerPrepared({} as Device, "proof-only-ipad"), (error) => {
      return error === failure;
    });
    assert.equal(preparations, 1);
    assert.equal(repairs, 0);
  } finally {
    restore();
    resetIosRunnerState();
  }
});

test("recorded evidence uses its own truthful session diagnostic", async () => {
  const value = await runWithTargetContext(
    { kind: "device", platform: "ios", serial: "evidence-ipad" },
    () => withSession({} as Device, async () => "recording", "evidence"),
  );
  assert.equal(value, "recording");
  const diagnostic = lastIosSessionOperationDiagnostic("evidence-ipad");
  assert.equal(diagnostic?.operation, "evidence");
  assert.equal(diagnostic?.attempts, 1);
  assert.equal(diagnostic?.repairAttempted, false);
  assert.equal(
    diagnostic?.stages.find((stage) => stage.stage === "accessibility-query")?.outcome,
    "skipped",
  );
});

test("only explicit recovery owns its one host-repair attempt", async () => {
  let inspections = 0;
  let repairs = 0;
  const result = await recoverIosRuntimeSession(
    "reconnect-ipad",
    async () => {
      inspections += 1;
      if (inspections === 1) throw new Error("No active XCTest session");
      return { app: "Grok" };
    },
    async () => {
      repairs += 1;
      return {
        serial: "reconnect-ipad",
        recovered: true,
        ready: true,
        actions: [],
        summary: "Relay repaired the explicit Reconnect request.",
      };
    },
    async () => "Reconnect failed.",
  );
  assert.equal(repairs, 1);
  assert.equal(inspections, 2);
  assert.equal(result.lifecycle.repairAttempts, 1);
  assert.equal(result.lifecycle.proofAttempts, 1);
  assert.equal(result.ready, true);
});
