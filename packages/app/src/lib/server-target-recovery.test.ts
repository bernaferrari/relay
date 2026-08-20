import assert from "node:assert/strict";
import test from "node:test";
import { createServerTargetRecovery } from "./server-target-recovery";

function targetRecoveryInput(
  overrides: {
    ready?: boolean;
    run?: () => Promise<unknown>;
  } = {},
) {
  const calls: string[] = [];
  const ready = overrides.ready ?? true;
  const recover = createServerTargetRecovery({
    selectedDevice: () => "ipad",
    devices: () => [{ serial: "ipad", platform: "ios" }] as never,
    selectDevice: async () => {
      calls.push("select");
    },
    runAction: async () => {
      calls.push("recover");
      if (overrides.run) await overrides.run();
      return {
        recovery: {
          serial: "ipad",
          recovered: ready,
          ready,
          summary: ready ? "Ready" : "Unavailable",
          actions: [],
          session: { status: ready ? "restored" : "unavailable", detail: "Proof result" },
        },
      };
    },
    appendLog: (message, level) => calls.push(`log:${level}:${message}`),
    setLiveCaptureIssue: (issue) => calls.push(`issue:${issue ?? "cleared"}`),
    setControlIssue: (issue) => calls.push(`control:${issue ?? "cleared"}`),
    refreshEvidence: async () => {
      calls.push("refresh");
    },
  });
  return { calls, recover };
}

test("target recovery is single-flight and refreshes only after a fresh ready proof", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { calls, recover } = targetRecoveryInput({ run: () => gate });

  const first = recover("observe");
  const second = recover("observe");
  await Promise.resolve();
  assert.deepEqual(calls, ["select", "recover"]);
  release();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(calls, [
    "select",
    "recover",
    "log:success:Ready",
    "issue:cleared",
    "control:cleared",
    "refresh",
  ]);
});

test("unavailable recovery keeps the proof failure and does not refresh pixels or AX", async () => {
  const { calls, recover } = targetRecoveryInput({ ready: false });

  assert.equal(await recover("observe"), false);
  assert.deepEqual(calls, ["select", "recover", "log:error:Unavailable", "issue:Proof result"]);
});
