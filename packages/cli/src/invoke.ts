import { RelayClient } from "@relay/client";
import { operationDefinitions, type EventEnvelope, type OperationId } from "@relay/protocol";
import type { GlobalConfig } from "./config.js";
import { UsageError } from "./errors.js";

export type OperationInvoker = {
  invoke(
    operationId: OperationId,
    input: never,
    options?: {
      signal?: AbortSignal;
      requestId?: string;
      idempotencyKey?: string;
      causationId?: string;
      correlationId?: string;
    },
  ): Promise<unknown>;
  events(
    callback: (event: EventEnvelope) => void,
    options?: {
      signal?: AbortSignal;
      onOpen?: () => void;
      afterSequence?: number;
      onGap?: (event: EventEnvelope) => void;
    },
  ): Promise<void>;
  resource?(path: string, init?: RequestInit): Promise<unknown>;
};

export type ClientFactory = (config: GlobalConfig) => OperationInvoker;

const operationIds = new Set<string>(operationDefinitions.map(({ id }) => id));

export function validateOperationId(operationId: string): asserts operationId is OperationId {
  if (!operationIds.has(operationId)) throw new UsageError(`Unknown operation: ${operationId}`);
}

export function createClient(config: GlobalConfig): OperationInvoker {
  return new RelayClient(config.connection, {
    timeoutMs: config.timeoutMs,
  }) as unknown as OperationInvoker;
}

export async function invokeOperation(
  client: OperationInvoker,
  operationId: string,
  input: unknown,
  signal: AbortSignal,
  identity?: { requestId: string; idempotencyKey: string },
): Promise<unknown> {
  validateOperationId(operationId);
  return client.invoke(operationId, input as never, { signal, ...identity });
}

export async function readResource(
  client: OperationInvoker,
  path: string,
  signal: AbortSignal,
): Promise<unknown> {
  if (!client.resource) throw new Error("CLI client does not support read-only resources");
  return client.resource(path, { method: "GET", signal });
}
