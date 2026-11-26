import { projectRoles, type OperationDefinition } from "./operation-contract.js";

export function validateOperationDefinitions(definitions: readonly OperationDefinition[]): void {
  const ids = new Set<string>();
  const transports = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`Duplicate operation id: ${definition.id}`);
    ids.add(definition.id);
    const route = `${definition.transport.method} ${definition.transport.path}`;
    if (transports.has(route)) throw new Error(`Duplicate operation transport: ${route}`);
    transports.add(route);
    if (definition.version !== 1) throw new Error(`${definition.id} has an unsupported version`);
    if (!definition.label.trim()) throw new Error(`${definition.id} is missing a label`);
    if (!projectRoles.includes(definition.minimumRole)) {
      throw new Error(`${definition.id} has an unsupported minimum role`);
    }
    if (definition.cancellable && !definition.progress) {
      throw new Error(`${definition.id} is cancellable but does not report progress`);
    }
    if (definition.mode === "query" && definition.confirmation !== "none") {
      throw new Error(`${definition.id} is a query that requires confirmation`);
    }
    if (definition.lease !== "none" && definition.targetCapabilities.length === 0) {
      throw new Error(`${definition.id} requires a lease without a target capability`);
    }
  }
}
