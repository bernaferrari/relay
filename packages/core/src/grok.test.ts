import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Device } from "./device.js";
import { loginGoogle, logout, postLoginNotifications } from "./grok.js";
import { IosMutationOutcomeUnknownError } from "./ios-mutation-policy.js";
import { runWithTargetContext } from "./target-context.js";

type PressCall = { selector?: string; x?: number; y?: number };
type FindCall = { query?: string; action?: string };

function unknownIosPress(): IosMutationOutcomeUnknownError {
  return new IosMutationOutcomeUnknownError(
    {
      sequence: 1,
      operation: "press",
      nativeAttempts: 1,
      outcome: "outcome-unknown",
      retry: {
        attempts: 0,
        decision: "blocked",
        reason: "native-command-outcome-unknown",
      },
      intervention: {
        required: true,
        action: "capture-current-screen-before-any-retry",
      },
      at: 0,
    },
    new Error("connection reset"),
  );
}

function grokDevice(input: {
  existing?: readonly string[];
  labels?: readonly string[];
  press?: (call: PressCall) => Promise<void> | void;
  click?: (call: FindCall) => Promise<void> | void;
}) {
  const presses: PressCall[] = [];
  const finds: FindCall[] = [];
  const existing = new Set(input.existing ?? []);
  const device = {
    apps: {
      open: async () => ({ appId: "ai.x.grok" }),
    },
    capture: {
      snapshot: async () => ({
        nodes: (input.labels ?? []).map((label) => ({
          type: "Button",
          label,
          enabled: true,
          hittable: true,
          rect: { x: 20, y: 40, width: 240, height: 44 },
        })),
      }),
    },
    interactions: {
      press: async (call: PressCall) => {
        presses.push(call);
        await input.press?.(call);
      },
      find: async (call: FindCall) => {
        finds.push(call);
        if (call.action === "exists" && existing.has(call.query ?? "")) return;
        if (call.action === "click") {
          await input.click?.(call);
          return;
        }
        throw new Error("element not found");
      },
    },
    command: {
      // Grok's pacing must not make its exact-once boundary tests wait in real time.
      wait: async () => undefined,
    },
  } as unknown as Device;
  return { device, presses, finds };
}

async function withIosCloud<T>(sessionId: string, body: () => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "relay-grok-ios-"));
  const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
  const previousAttempts = process.env.RELAY_RETRY_ATTEMPTS;
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_RETRY_ATTEMPTS = "1";
  try {
    return await runWithTargetContext(
      { kind: "cloud", provider: "test", sessionId, platform: "ios" },
      body,
    );
  } finally {
    if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
    if (previousAttempts === undefined) delete process.env.RELAY_RETRY_ATTEMPTS;
    else process.env.RELAY_RETRY_ATTEMPTS = previousAttempts;
    await rm(root, { recursive: true, force: true });
  }
}

test("notification fallback stops after an unknown iOS label press", async () => {
  const { device, presses, finds } = grokDevice({
    existing: ["Enable notifications"],
    labels: ["Enable notifications"],
    press: () => {
      throw unknownIosPress();
    },
  });

  await assert.rejects(
    withIosCloud("grok-notification-unknown", () => postLoginNotifications(device, 100)),
    IosMutationOutcomeUnknownError,
  );

  assert.deepEqual(
    presses.map(({ selector, x, y }) => ({ selector, x, y })),
    [{ selector: 'label="Enable notifications"', x: undefined, y: undefined }],
  );
  assert.deepEqual(
    finds.map(({ query, action }) => ({ query, action })),
    [{ query: "Enable notifications", action: "exists" }],
  );
});

test("provider fallback stops after an unknown iOS label press", async () => {
  const { device, presses, finds } = grokDevice({
    existing: ["Continue with Google"],
    labels: ["Continue with Google"],
    press: () => {
      throw unknownIosPress();
    },
  });

  await assert.rejects(
    withIosCloud("grok-provider-unknown", () => loginGoogle(device)),
    IosMutationOutcomeUnknownError,
  );

  assert.deepEqual(
    presses.map(({ selector, x, y }) => ({ selector, x, y })),
    [{ selector: 'label="Continue with Google"', x: undefined, y: undefined }],
  );
  assert.equal(
    finds.some((call) => call.action === "click"),
    false,
    "an uncertain provider press must not be retried through findClick",
  );
});

test("logout never coordinate-presses after its fallback find becomes ambiguous", async () => {
  const { device, presses, finds } = grokDevice({
    labels: ["Menu", "Settings"],
    press: (call) => {
      if (call.selector === 'label="Settings"') throw new Error("semantic label unavailable");
    },
    click: (call) => {
      if (call.query === "Settings") throw unknownIosPress();
    },
  });

  await assert.rejects(
    withIosCloud("grok-logout-unknown", () => logout(device)),
    IosMutationOutcomeUnknownError,
  );

  assert.deepEqual(
    presses.map(({ selector, x, y }) => ({ selector, x, y })),
    [
      { selector: 'label="Menu"', x: undefined, y: undefined },
      { selector: 'label="Settings"', x: undefined, y: undefined },
    ],
    "the ambiguous find must not fall through to logout's Settings point",
  );
  assert.ok(finds.some((call) => call.query === "Settings" && call.action === "click"));
});

test("an ordinary notification label failure still uses its existing find fallback", async () => {
  const { device, presses, finds } = grokDevice({
    existing: ["Enable notifications", "Allow"],
    labels: ["Enable notifications", "Allow"],
    press: (call) => {
      if (call.selector === 'label="Enable notifications"') {
        throw new Error("semantic label unavailable");
      }
    },
  });

  await withIosCloud("grok-notification-known-fallback", () => postLoginNotifications(device, 100));

  assert.deepEqual(
    presses.map(({ selector, x, y }) => ({ selector, x, y })),
    [
      { selector: 'label="Enable notifications"', x: undefined, y: undefined },
      { selector: 'label="Allow"', x: undefined, y: undefined },
    ],
  );
  assert.ok(
    finds.some((call) => call.query === "Enable notifications" && call.action === "click"),
    "ordinary errors retain the historical find fallback",
  );
});
