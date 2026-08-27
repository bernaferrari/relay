import { operationDefinitions } from "@relay/protocol";

function operationInputSchema(operationId: string) {
  const definition = operationDefinitions.find((item) => item.id === operationId);
  if (!definition) {
    throw new Error(`Missing input schema for registered operation ${operationId}`);
  }
  return definition.input.presentation;
}

/** Drop CLI-only keys (`dir`, `connectionId` on `app-map.get`, …) so `.strict()`
 * protocol parse never sees them. Catchall operations keep extras. */
export function protocolOperationInput(operationId: string, input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const schema = operationInputSchema(operationId);
  const catchall = schema._zod.def.catchall;
  if (catchall && catchall._zod.def.type !== "never") return input;
  const allowed = schema.shape;
  const record = input as Record<string, unknown>;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (Object.hasOwn(allowed, key)) next[key] = record[key];
    else changed = true;
  }
  return changed ? next : input;
}
