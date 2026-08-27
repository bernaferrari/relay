import {
  operationDefinition,
  type OperationId,
  type OperationInput,
  type OperationOutput,
} from "@relay/protocol";

export type RelayInvokeClient = {
  invoke<Id extends OperationId>(id: Id, input: OperationInput<Id>): Promise<unknown>;
};

export type RelayOperationPort = {
  invoke<Id extends OperationId>(id: Id, input: OperationInput<Id>): Promise<OperationOutput<Id>>;
};

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
