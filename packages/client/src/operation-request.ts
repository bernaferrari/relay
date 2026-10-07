import {
  operationDefinition,
  operationDefinitions,
  type OperationDefinition,
  type OperationId,
  type OperationInput,
} from "@relay/protocol";

export function operationRequest<Id extends OperationId>(
  id: Id,
  input: OperationInput<Id>,
): { path: string; init: RequestInit } {
  const definition = operationDefinition(id);
  const parsed = definition.input.parse(input);
  const values = { ...(parsed as Record<string, unknown>) };
  const path = definition.transport.path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_, key: string) => {
    const value = values[key];
    if (typeof value !== "string" || !value) {
      throw new TypeError(`${id} is missing path parameter ${key}`);
    }
    delete values[key];
    return encodeURIComponent(value);
  });

  if (definition.transport.method === "GET") {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) query.append(key, String(item));
      } else {
        query.set(key, String(value));
      }
    }
    const suffix = query.size ? `?${query.toString()}` : "";
    return { path: `${path}${suffix}`, init: { method: "GET" } };
  }

  return {
    path,
    init: {
      method: definition.transport.method,
      ...(definition.transport.method === "DELETE" && Object.keys(values).length === 0
        ? {}
        : { body: JSON.stringify(values) }),
    },
  };
}

export function registeredTransport(
  path: string,
  method: string,
): { definition: OperationDefinition<OperationId>; input: Record<string, unknown> } | null {
  const url = new URL(path, "http://relay.local");
  const actual = url.pathname.split("/").filter(Boolean);
  let best:
    | {
        definition: OperationDefinition<OperationId>;
        input: Record<string, unknown>;
        staticSegmentCount: number;
      }
    | undefined;
  for (const definition of operationDefinitions) {
    if (definition.transport.method !== method) continue;
    const expected = definition.transport.path.split("/").filter(Boolean);
    if (expected.length !== actual.length) continue;
    const input: Record<string, unknown> = {};
    let matches = true;
    for (let index = 0; index < expected.length; index++) {
      const segment = expected[index]!;
      const value = actual[index]!;
      if (segment.startsWith(":")) input[segment.slice(1)] = decodeURIComponent(value);
      else if (segment !== value) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    for (const key of new Set(url.searchParams.keys())) {
      const values = url.searchParams.getAll(key);
      input[key] = values.length === 1 ? values[0]! : values;
    }
    const staticSegmentCount = expected.filter((segment) => !segment.startsWith(":")).length;
    if (!best || staticSegmentCount > best.staticSegmentCount) {
      best = { definition, input, staticSegmentCount };
    }
  }
  return best ? { definition: best.definition, input: best.input } : null;
}
