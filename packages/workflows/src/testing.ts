import type { OperationId, OperationInput } from "@relay/protocol";
import type { RelayInvokeClient } from "./operation-port.js";

export type ScriptedRelayStep = {
  id: OperationId;
  output?: unknown;
  error?: unknown;
  checkInput?: (input: unknown) => void;
};

export type ScriptedRelayInvocation = { id: OperationId; input: unknown };

/** A raw transport adapter for interface tests; canonical parsing stays in the workflow module. */
export function createScriptedRelayClient(steps: readonly ScriptedRelayStep[]): {
  client: RelayInvokeClient;
  invocations: ScriptedRelayInvocation[];
  remaining(): number;
} {
  const queue = [...steps];
  const invocations: ScriptedRelayInvocation[] = [];
  const client: RelayInvokeClient = {
    async invoke<Id extends OperationId>(id: Id, input: OperationInput<Id>): Promise<unknown> {
      invocations.push({ id, input });
      const step = queue.shift();
      if (!step) throw new Error(`Unexpected operation ${id}`);
      if (step.id !== id) throw new Error(`Expected operation ${step.id}, received ${id}`);
      step.checkInput?.(input);
      if (step.error !== undefined) throw step.error;
      return step.output;
    },
  };
  return { client, invocations, remaining: () => queue.length };
}
