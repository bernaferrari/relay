/**
 * Opt-in deterministic provider fixture for integration tests.
 *
 * This is not a cloud vendor adapter and is never registered by default. It
 * gives Relay a bounded remote `Device` facade with an inspectable event log,
 * so tests can prove that a provider session used provider control/capture
 * rather than a same-named local AgentDevice session.
 */
import type { ExecutionTargetRef } from "@relay/protocol";
import { writeFile } from "node:fs/promises";
import type { Device } from "./device.js";
import {
  createTargetDriver,
  targetContextFromExecutionTargetRef,
  type TargetDriver,
  type TargetDriverRecoveryRequest,
  type TargetDriverTargetRunner,
} from "./target-driver.js";
import { runWithTargetContext } from "./target-context.js";

export const DETERMINISTIC_PROVIDER_TEST_KEY = "relay.test.deterministic-provider";

/** A valid, opaque 1×1 PNG. It lets normal frame persistence exercise the
 * evidence path without borrowing a local screenshot implementation. */
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLh7wAAAABJRU5ErkJggg==";

export type DeterministicProviderTestDriver = Readonly<{
  driver: TargetDriver;
  events: string[];
  target(
    sessionId: string,
    platform?: "android" | "ios",
  ): Extract<ExecutionTargetRef, { kind: "provider-session" }>;
}>;

function eventName(capability: string, target: ExecutionTargetRef): string {
  return `${capability}:${target.provider.key}:${target.targetId}`;
}

function deterministicDevice(events: string[], target: ExecutionTargetRef): Device {
  const record = (name: string) => events.push(`${name}:${target.targetId}`);
  return {
    devices: {
      list: async () => {
        record("device.list");
        return [
          {
            id: target.targetId,
            name: `Deterministic ${target.platform} provider target`,
            platform: target.platform,
          },
        ];
      },
    },
    capture: {
      snapshot: async () => {
        record("capture.snapshot");
        return { nodes: [] };
      },
      screenshot: async (input) => {
        record("capture.screenshot");
        if (input?.path) {
          await writeFile(input.path, Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));
        }
        return { base64: ONE_PIXEL_PNG_BASE64 };
      },
    },
    interactions: {
      find: async () => {
        record("interactions.find");
        return { exists: false };
      },
    },
    command: {
      wait: async () => {
        record("command.wait");
        return { ok: true };
      },
      appState: async () => {
        record("command.app-state");
        return target.platform === "ios"
          ? {
              platform: "ios" as const,
              appName: "Deterministic Provider App",
              source: "session" as const,
              surface: "provider",
            }
          : { platform: "android" as const, package: "relay.test", activity: "Main" };
      },
    },
    observability: {
      perf: async () => {
        record("observability.perf");
        return { samples: [] };
      },
      logs: async () => {
        record("observability.logs");
        return { entries: [] };
      },
      network: async () => {
        record("observability.network");
        return { entries: [] };
      },
      audio: async () => {
        record("observability.audio");
        return { entries: [] };
      },
      crashes: async () => {
        record("observability.crashes");
        return { entries: [], truncated: false } as never;
      },
    },
  };
}

/**
 * Create a test-only remote driver. It supports control, capture, and
 * recovery, but only for `provider-session` targets whose provider key matches
 * this fixture. Calling code still has to register it explicitly.
 */
export function createDeterministicProviderTestDriver(
  providerKey = DETERMINISTIC_PROVIDER_TEST_KEY,
): DeterministicProviderTestDriver {
  const events: string[] = [];
  const withTarget =
    (capability: "control" | "capture"): TargetDriverTargetRunner =>
    async (target, operation) => {
      events.push(eventName(`${capability}.enter`, target));
      try {
        const context = targetContextFromExecutionTargetRef(target);
        if (context.kind !== "cloud") throw new Error("expected provider target context");
        return await runWithTargetContext(context, async () => {
          const session = Object.freeze({
            target,
            context,
            device: deterministicDevice(events, target),
          });
          return await operation(session);
        });
      } finally {
        events.push(eventName(`${capability}.exit`, target));
      }
    };
  const driver = createTargetDriver({
    provider: { key: providerKey, scope: "remote" },
    supportsTarget: (target) =>
      target.kind === "provider-session" ? undefined : "target-kind-unsupported",
    control: withTarget("control"),
    capture: withTarget("capture"),
    recover: async (target, request: TargetDriverRecoveryRequest) => {
      events.push(`${eventName("recovery", target)}:${request.reason}`);
      return {
        recovered: true,
        ready: true,
        summary: `Deterministic provider recovered ${target.targetId} after ${request.reason}.`,
      };
    },
  });
  const target = (
    sessionId: string,
    platform: "android" | "ios" = "ios",
  ): Extract<ExecutionTargetRef, { kind: "provider-session" }> => ({
    schemaVersion: 1,
    kind: "provider-session",
    provider: { key: providerKey, scope: "remote" },
    targetId: sessionId,
    platform,
    identity: { kind: "provider-session", value: sessionId },
  });
  return Object.freeze({ driver, events, target });
}
