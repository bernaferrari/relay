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
