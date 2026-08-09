import { AsyncLocalStorage } from "node:async_hooks";

export type TargetContext =
  | { kind: "device"; platform: "android" | "ios"; serial: string }
  | { kind: "browser"; platform: "browser"; targetId: string };

const targets = new AsyncLocalStorage<TargetContext>();

export function currentTargetContext(): TargetContext {
  const context = targets.getStore();
  if (!context) throw new Error("Explicit Relay target context is required");
  return context;
}

export function runWithTargetContext<T>(
  context: TargetContext,
  operation: () => Promise<T>,
): Promise<T> {
  return targets.run(Object.freeze({ ...context }), operation);
}

export function targetIdentity(context = currentTargetContext()): string {
  return context.kind === "browser" ? context.targetId : context.serial;
}

/** Sync guess when a job omits platform. 40-hex is an iOS UDID, not Android. */
export function inferDevicePlatformFromSerial(
  serial: string | undefined,
): "android" | "ios" | undefined {
  const id = serial?.trim() ?? "";
  if (!id) return undefined;
  if (/^[0-9a-f]{40}$/i.test(id)) return "ios";
  if (/^[0-9a-f]{8}-[0-9a-f]{16}$/i.test(id)) return "ios";
  if (/^0000[0-9a-f-]+$/i.test(id)) return "ios";
  if (/emulator-|localhost:\d+|:\d{4,5}$/i.test(id)) return "android";
  return undefined;
}

/** Stable, filesystem-safe agent-device session isolation per selected target. */
export function targetSessionName(context = currentTargetContext()): string {
  const identity = targetIdentity(context)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `relay-${context.platform}-${identity || "target"}`;
}
