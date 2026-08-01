import type http from "node:http";
import {
  operationDefinitions,
  operationManifest,
  parseCommandEnvelope,
  type CommandIdentity,
  type OperationDefinition,
  type OperationId,
  type OperationManifestItem,
} from "@relay/protocol";
import { enterOperationContext } from "@relay/core";
import { resolveCommandActor, type RequestContext } from "./security.js";

type RequestOperationContext = {
  definition: OperationDefinition<OperationId>;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  command: CommandIdentity;
};

const requestContexts = new WeakMap<http.IncomingMessage, RequestOperationContext>();
const responseContexts = new WeakMap<http.ServerResponse, RequestOperationContext>();

export class OperationContractError extends Error {
  constructor(
    readonly phase: "input" | "output",
    readonly operationId: OperationId,
    message: string,
  ) {
    super(`${operationId} ${phase}: ${message}`);
    this.name = "OperationContractError";
  }
}

export type OperationHandlerRegistration = {
  id: OperationId;
  method: OperationDefinition["transport"]["method"];
  path: string;
  definition: OperationDefinition<OperationId>;
};

export const operationHandlers: readonly OperationHandlerRegistration[] = operationDefinitions.map(
  (definition) => ({
    id: definition.id,
    method: definition.transport.method,
    path: definition.transport.path,
    definition,
  }),
);

function matchPath(pathname: string, pattern: string): Record<string, string> | null {
  const expected = pattern.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index++) {
    const segment = expected[index]!;
    const value = actual[index]!;
    if (segment.startsWith(":")) params[segment.slice(1)] = decodeURIComponent(value);
    else if (segment !== value) return null;
  }
  return params;
}

function queryRecord(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length === 1 ? values[0]! : values;
  }
  return query;
}

export function findOperationHandler(
  method: string,
  pathname: string,
): (OperationHandlerRegistration & { params: Record<string, string> }) | null {
  for (const registration of operationHandlers) {
    if (registration.method !== method) continue;
    const params = matchPath(pathname, registration.path);
    if (params) return { ...registration, params };
  }
  return null;
}

export function bindOperationRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  method: string,
  pathname: string,
  url: URL,
  scope: RequestContext,
): OperationHandlerRegistration | null {
  const registration = findOperationHandler(method, pathname);
  if (!registration) return null;
  const header = (name: string): string | undefined => {
    const value = request.headers[name];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };
  const operationId = header("x-relay-operation-id");
  if (operationId !== registration.id) {
    throw new OperationContractError(
      "input",
      registration.id,
      `x-relay-operation-id must be ${registration.id}`,
    );
  }
  let actor;
  try {
    actor = resolveCommandActor(request.headers, scope);
  } catch (error) {
    throw new OperationContractError(
      "input",
      registration.id,
      error instanceof Error ? error.message : String(error),
    );
  }
  const command = parseCommandEnvelope(
    {
      schemaVersion: 1,
      ...actor,
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      operationId,
      requestId: header("x-relay-request-id"),
      idempotencyKey: header("idempotency-key"),
      issuedAt: Number(header("x-relay-command-at")),
      causationId: header("x-relay-causation-id"),
      correlationId: header("x-relay-correlation-id"),
      authoringSessionId: header("x-relay-authoring-session-id"),
      payload: {},
    },
    (payload) => payload,
  );
  const context: RequestOperationContext = {
    definition: registration.definition,
    params: registration.params,
    query: queryRecord(url),
    command,
  };
  requestContexts.set(request, context);
  responseContexts.set(response, context);
  enterOperationContext(command);

  if (method === "GET" || method === "DELETE") {
    try {
      registration.definition.input.parse({ ...context.query, ...context.params });
    } catch (error) {
      throw new OperationContractError(
        "input",
        registration.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return registration;
}

export function operationRequestContext(
  request: http.IncomingMessage,
): RequestOperationContext | undefined {
  return requestContexts.get(request);
}

export function validateOperationBody(request: http.IncomingMessage, body: unknown): void {
  const context = requestContexts.get(request);
  if (!context) return;
  const bodyRecord =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : { value: body };
  const input = { ...context.query, ...context.params, ...bodyRecord };
  try {
    context.definition.input.parse(input);
  } catch (error) {
    throw new OperationContractError(
      "input",
      context.definition.id,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function validateOperationResponse(
  response: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  if (status < 200 || status >= 400) return;
  const context = responseContexts.get(response);
  if (!context) return;
  try {
    context.definition.output.parse(body);
  } catch (error) {
    throw new OperationContractError(
      "output",
      context.definition.id,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function serverOperationManifest(): OperationManifestItem[] {
  return operationManifest(operationHandlers.map((registration) => registration.definition));
}

export function assertOperationRegistryComplete(): void {
  const counts = new Map<OperationId, number>();
  for (const registration of operationHandlers) {
    counts.set(registration.id, (counts.get(registration.id) ?? 0) + 1);
  }
  for (const definition of operationDefinitions) {
    const count = counts.get(definition.id) ?? 0;
    if (count !== 1) throw new Error(`${definition.id} has ${count} server handlers`);
  }
}

assertOperationRegistryComplete();
