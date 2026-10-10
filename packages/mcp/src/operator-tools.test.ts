import { ApiError } from "@relay/client";
import assert from "node:assert/strict";
import test from "node:test";
import { invokeRelayOperatorTool, recoverSerialFromLane } from "./operator-tool-dispatch.js";
import {
  relayOperatorToolNames,
  relayOperatorTools,
  type RelayOperatorToolDescriptor,
} from "./operator-tools.js";
import type { OperationInvoker } from "./server.js";

type Call = { operationId: string; input: unknown };

function recordingInvoker(
  handler: (operationId: string, input: Record<string, unknown>) => unknown | Promise<unknown>,
): { invoker: OperationInvoker; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    invoker: {
      async invoke(operationId, input) {
        const payload = (input ?? {}) as Record<string, unknown>;
        calls.push({ operationId, input: payload });
        return handler(operationId, payload);
      },
    },
  };
}

function run(
  name: RelayOperatorToolDescriptor["name"],
  argumentsValue: Record<string, unknown>,
  invoker: OperationInvoker,
) {
  return invokeRelayOperatorTool({
    name,
    argumentsValue,
    invoker,
    signal: new AbortController().signal,
  });
}

const examples: Record<string, { input: Record<string, unknown>; call: Call }> = {
  relay_screenshot: {
    input: { targetId: "ipad" },
    call: { operationId: "target.screenshot.capture", input: { serial: "ipad" } },
  },
  relay_preview: {
    input: { targetId: "ipad", label: "Back" },
    call: {
      operationId: "target.interact",
      input: { serial: "ipad", preview: true, kind: "label", label: "Back" },
    },
  },
  relay_tap: {
    input: { targetId: "ipad", label: "Back" },
    call: {
      operationId: "target.interact",
      input: { serial: "ipad", kind: "label", label: "Back" },
    },
  },
  relay_type: {
    input: { targetId: "ipad", text: "hello" },
    call: {
      operationId: "target.interact",
      input: { serial: "ipad", kind: "type", text: "hello" },
    },
  },
  relay_swipe: {
    input: { targetId: "ipad", from: { x: 200, y: 800 }, to: { x: 200, y: 200 } },
    call: {
      operationId: "target.interact",
      input: { serial: "ipad", kind: "swipe", from: { x: 200, y: 800 }, to: { x: 200, y: 200 } },
    },
  },
  relay_press_key: {
    input: { targetId: "pixel", key: "back" },
    call: { operationId: "target.interact", input: { serial: "pixel", kind: "key", key: "back" } },
  },
  relay_launch_app: {
    input: { targetId: "pixel", app: "Settings", relaunch: true },
    call: {
      operationId: "target.app.launch",
      input: { serial: "pixel", app: "Settings", relaunch: true },
    },
  },
  relay_recover: {
    input: { targetId: "ipad" },
    call: { operationId: "target.recover", input: { serial: "ipad" } },
  },
};

test("device verbs are one name per capability and map targetId to the target operation", async () => {
  assert.deepEqual(relayOperatorToolNames, Object.keys(examples));
  for (const descriptor of relayOperatorTools) {
    const example = examples[descriptor.name]!;
    const { invoker, calls } = recordingInvoker(() => ({ ok: true }));
    assert.deepEqual(await run(descriptor.name, example.input, invoker), { ok: true });
    assert.deepEqual(calls, [example.call], descriptor.name);
    assert.equal(descriptor.requiresConfirmation, false);
    assert.equal(
      descriptor.annotations.readOnlyHint,
      descriptor.name === "relay_screenshot" || descriptor.name === "relay_preview",
      descriptor.name,
    );
  }
});

test("recover uses a saved sign-in's target instead of asking for a separate id", async () => {
  assert.equal(
    recoverSerialFromLane(
      { target: { kind: "browser", browserTargetId: "browser-1" } },
      "grok-daily",
    ),
    "browser-1",
  );
  assert.equal(
    recoverSerialFromLane({ target: { kind: "device", serial: "ipad" } }, "ipad-lab"),
    "ipad",
  );
  assert.throws(() => recoverSerialFromLane(undefined, "missing"), /missing was not found/u);

  const { invoker, calls } = recordingInvoker((operationId) =>
    operationId === "lane.list"
      ? { lanes: [{ id: "grok-daily", target: { kind: "browser", browserTargetId: "browser-1" } }] }
      : { ok: true, invoked: operationId },
  );
  const result = await run("relay_recover", { laneId: "grok-daily" }, invoker);
  assert.deepEqual(calls, [
    { operationId: "lane.list", input: {} },
    { operationId: "target.recover", input: { serial: "browser-1" } },
  ]);
  assert.deepEqual(result, { ok: true, invoked: "target.recover" });
});

test("a saved sign-in drives the browser without a targetId", async () => {
  for (const [name, args, operationId] of [
    ["relay_screenshot", {}, "target.screenshot.capture"],
    ["relay_preview", { label: "Settings" }, "target.interact"],
    ["relay_tap", { label: "Settings" }, "target.interact"],
    ["relay_type", { text: "hello" }, "target.interact"],
    ["relay_swipe", { from: { x: 10, y: 80 }, to: { x: 10, y: 20 } }, "target.interact"],
    ["relay_press_key", { key: "enter" }, "target.interact"],
  ] as const) {
    const { invoker, calls } = recordingInvoker(() => ({}));
    await run(name, { laneId: "signed-in", ...args }, invoker);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.operationId, operationId);
    assert.equal((calls[0]?.input as Record<string, unknown>).laneId, "signed-in");
    assert.equal(Object.hasOwn(calls[0]?.input as object, "serial"), false);
    for (const selection of [{}, { targetId: "other", laneId: "signed-in" }, { serial: "old" }]) {
      await assert.rejects(run(name, { ...selection, ...args }, invoker));
    }
    assert.equal(calls.length, 1, "invalid selections must fail before any device operation");
  }
});

test("device verbs auto-create a lease on TARGET_CONTROL_LEASE_REQUIRED", async () => {
  let taps = 0;
  const { invoker, calls } = recordingInvoker((operationId) => {
    if (operationId === "target.interact") {
      taps += 1;
      if (taps === 1) {
        throw new ApiError(403, "Take control of this target before sending device input", {
          code: "TARGET_CONTROL_LEASE_REQUIRED",
        });
      }
      return { ok: true };
    }
    if (operationId === "lease.create") return { lease: { id: "lease-1" } };
    throw new Error(`unexpected ${operationId}`);
  });
  const result = await run("relay_tap", { targetId: "ipad", label: "Back" }, invoker);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(
    calls.map(({ operationId }) => operationId),
    ["target.interact", "lease.create", "target.interact"],
  );
  assert.deepEqual(calls[1]?.input, { poolId: "local", deviceSerial: "ipad" });
});

test("a held device names who holds it and since when", async () => {
  const since = Date.parse("2026-09-13T12:00:00.000Z");
  const { invoker } = recordingInvoker(() => {
    throw new ApiError(403, "This target is currently controlled by another actor", {
      code: "TARGET_CONTROL_LEASE_CONFLICT",
      activeLease: { ownerId: "human:local-cli", leasedAt: since },
    });
  });
  await assert.rejects(
    run("relay_tap", { targetId: "ipad", identifier: "settings.gear" }, invoker),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.match(error.message, /held by human:local-cli since 2026-09-13T12:00:00.000Z/u);
      return true;
    },
  );
});

test("a role or consent 403 keeps the original message", async () => {
  const { invoker } = recordingInvoker(() => {
    throw new ApiError(403, "This actor is missing the operator role for this project", {
      code: "ACTOR_ROLE_FORBIDDEN",
    });
  });
  await assert.rejects(
    run("relay_tap", { targetId: "ipad", identifier: "settings.gear" }, invoker),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.message, "This actor is missing the operator role for this project");
      return true;
    },
  );
});
