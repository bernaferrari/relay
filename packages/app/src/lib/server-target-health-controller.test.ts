import assert from "node:assert/strict";
import test from "node:test";
import type { OperationOutput } from "@relay/protocol";
import { createRoot, createSignal } from "solid-js";
import { createServerTargetHealthController } from "./server-target-health-controller";

function health(serial: string): OperationOutput<"target.health.get"> {
  return {
    health: {
      schemaVersion: 1,
      target: { id: serial, kind: "ios" },
      observedAt: 1,
      epochs: { target: 1, semanticSession: 1 },
      pixels: { state: "ready" },
      semantics: { state: "unavailable" },
      input: { state: "ready" },
      control: { state: "owned" },
      overall: "pixel-only",
      context: {},
      counters: {
        pixelCaptures: 1,
        semanticTraversals: 0,
        semanticTimeouts: 0,
        semanticWedges: 0,
        uncertainMutations: 0,
        reconciliations: 0,
        recoveryAttempts: 0,
        recoveryFailures: 0,
      },
      latency: {
        pixels: { count: 1 },
        semantics: { count: 0 },
        recovery: { count: 0 },
      },
      readiness: {
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
        },
        evidenceCapture: {
          mode: "evidence",
          state: "proven",
          freshness: "current",
          proof: { at: 1 },
        },
      },
      events: [],
    },
  };
}

test("selected target health comes only from target.health.get and ignores stale responses", async () => {
  await createRoot(async (dispose) => {
    const [selected, setSelected] = createSignal<string | null>("phone-a");
    const pending = new Map<string, (value: OperationOutput<"target.health.get">) => void>();
    const calls: string[] = [];
    const controller = createServerTargetHealthController({
      selectedDevice: selected,
      serverHealth: () => "online",
      runAction: async (operation, input) => {
        calls.push(`${operation}:${input.serial}`);
        return new Promise((resolve) => pending.set(input.serial, resolve));
      },
    });
    const first = controller.refreshTargetHealth();
    setSelected("phone-b");
    const second = controller.refreshTargetHealth();

    pending.get("phone-a")?.(health("phone-a"));
    pending.get("phone-b")?.(health("phone-b"));
    await Promise.all([first, second]);

    assert.deepEqual(calls, ["target.health.get:phone-a", "target.health.get:phone-b"]);
    assert.equal(controller.targetHealth()?.target.id, "phone-b");
    assert.equal(controller.targetHealth()?.overall, "pixel-only");
    dispose();
  });
});

test("a refresh failure preserves the last canonical health projection", async () => {
  await createRoot(async (dispose) => {
    const responses: Array<OperationOutput<"target.health.get"> | Error> = [
      health("phone-a"),
      new Error("temporary fetch failure"),
    ];
    const controller = createServerTargetHealthController({
      selectedDevice: () => "phone-a",
      serverHealth: () => "online",
      runAction: async () => {
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response!;
      },
    });
    await controller.refreshTargetHealth();
    await controller.refreshTargetHealth();

    assert.equal(controller.targetHealth()?.overall, "pixel-only");
    assert.equal(controller.targetHealthIssue(), "temporary fetch failure");
    dispose();
  });
});
