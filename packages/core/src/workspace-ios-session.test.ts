import assert from "node:assert/strict";
import test from "node:test";
import type { Device } from "./device.js";
import { runWithTargetContext } from "./target-context.js";
import { lastIosSessionOperationDiagnostic, withSession } from "./workspace-ios-session.js";

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
