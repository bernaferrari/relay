import {
  operationDefinition,
  type EventEnvelope,
  type OperationId,
  type OperationInput,
  type OperationOutput,
} from "@relay/protocol";

export type RelayInvokeClient = {
  invoke<Id extends OperationId>(id: Id, input: OperationInput<Id>): Promise<unknown>;
  events?(
    onEvent: (event: EventEnvelope) => void,
    options?: {
      signal?: AbortSignal;
      onOpen?: () => void;
      afterSequence?: number;
      onGap?: (event: EventEnvelope) => void;
    },
  ): Promise<void>;
};

export type RelayOperationPort = {
  invoke<Id extends OperationId>(id: Id, input: OperationInput<Id>): Promise<OperationOutput<Id>>;
};

/** Preserve only the HTTP status from the client's named error contract.
 * Arbitrary domain exceptions and response bodies are not status provenance. */
export function relayHttpErrorStatus(error: unknown): number | undefined {
  if (
    error instanceof Error &&
    error.name === "ApiError" &&
    "body" in error &&
    "status" in error &&
    typeof error.status === "number" &&
    Number.isInteger(error.status) &&
    error.status >= 100 &&
    error.status <= 599
  )
    return error.status;
  return undefined;
}

/** Recognize fetch rejections before workflow recovery flattens the exception.
 * HTTP/domain failures and prose containing "offline" are not transport proof. */
export function isRelayTransportFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    !("status" in error) &&
    !("body" in error) &&
    ((error instanceof TypeError &&
      [
        "Failed to fetch",
        "fetch failed",
        "Load failed",
        "Network request failed",
        "NetworkError when attempting to fetch resource.",
      ].includes(error.message)) ||
      (error instanceof DOMException && error.name === "NetworkError"))
  );
}

/**
 * The workflow transport seam accepts any Relay client with the canonical
 * invoke shape. Both sides of every call are checked by the one operation
 * registry, so a permissive adapter cannot create a second wire contract.
 */
export function createRelayOperationPort(client: RelayInvokeClient): RelayOperationPort {
  return {
    async invoke<Id extends OperationId>(
      id: Id,
      input: OperationInput<Id>,
    ): Promise<OperationOutput<Id>> {
      const definition = operationDefinition(id);
      const parsedInput = definition.input.parse(input);
      const rawOutput = await client.invoke(id, parsedInput);
      return definition.output.parse(rawOutput) as OperationOutput<Id>;
    },
  };
}
