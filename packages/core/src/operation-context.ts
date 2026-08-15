import { AsyncLocalStorage } from "node:async_hooks";
import type { CommandIdentity } from "@relay/protocol";

export type OperationContext = CommandIdentity & { leaseId?: string; leaseOwnerId?: string };

const operationContexts = new AsyncLocalStorage<OperationContext>();

export function runWithOperationContext<T>(
  context: OperationContext,
  operation: () => Promise<T>,
): Promise<T>;
export function runWithOperationContext<T>(context: OperationContext, operation: () => T): T;
export function runWithOperationContext<T>(
  context: OperationContext,
  operation: () => Promise<T> | T,
): Promise<T> | T {
  return operationContexts.run({ ...context }, operation);
}

export function enterOperationContext(context: OperationContext): void {
  operationContexts.enterWith({ ...context });
}

export function currentOperationContext(): OperationContext | undefined {
  return operationContexts.getStore();
}

export function requireOperationContext(): OperationContext {
  const context = currentOperationContext();
  if (!context) throw new Error("Relay operation context is required");
  return context;
}

export function setOperationLease(leaseId: string, leaseOwnerId?: string): void {
  const context = requireOperationContext();
  context.leaseId = leaseId;
  if (leaseOwnerId) context.leaseOwnerId = leaseOwnerId;
}
