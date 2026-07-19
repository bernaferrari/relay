import { AsyncLocalStorage } from "node:async_hooks";

export type TargetContext =
  | { kind: "device"; platform: "android" | "ios"; serial?: string }
  | { kind: "browser"; platform: "browser"; targetId: string };

const targets = new AsyncLocalStorage<TargetContext>();

export function configuredTargetContext(): TargetContext {
  const browserTarget = process.env.RELAY_TARGET_ID?.trim();
  if (browserTarget) return { kind: "browser", platform: "browser", targetId: browserTarget };
  const platform = process.env.AGENT_DEVICE_PLATFORM === "ios" ? "ios" : "android";
  const serial =
    process.env.AGENT_DEVICE_SERIAL?.trim() || process.env.ANDROID_SERIAL?.trim() || undefined;
  return { kind: "device", platform, ...(serial ? { serial } : {}) };
}

export function currentTargetContext(): TargetContext {
  return targets.getStore() ?? configuredTargetContext();
}

export function runWithTargetContext<T>(
  context: TargetContext,
  operation: () => Promise<T>,
): Promise<T> {
  return targets.run(Object.freeze({ ...context }), operation);
}

export function targetIdentity(context = currentTargetContext()): string | undefined {
  return context.kind === "browser" ? context.targetId : context.serial;
}
