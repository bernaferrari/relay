import {
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  ResourceTemplate,
  type ReadResourceResult,
  type Variables,
} from "@modelcontextprotocol/server";
import type { OperationId } from "@relay/protocol";
import type { OperationInvoker } from "./server.js";
import { compactOfflineReplayResource } from "./offline-replay-result.js";
import { registerDiffImpactResource } from "./diff-impact-resource.js";
import { registerRepairProposalsResource } from "./repair-proposals-resource.js";
import {
  relayMcpExclusions,
  relayMcpOperationCatalog,
  relayMcpProfiles,
  relayMcpToolsForProfile,
  type RelayMcpProfile,
  type RelayMcpToolDescriptor,
} from "./tools.js";
import { relayMcpPrompts, relayMcpPromptsForTools } from "./prompts.js";

export const relayMcpResourceByteLimit = 32_768;
export const relayMcpResourceMimeType = "application/json";

export const relayMcpResourceUris = {
  project: "relay://project/current",
  operations: "relay://operations",
  variables: "relay://workspace/variables",
  appMaps: "relay://app-maps",
  appMap: "relay://app-maps/{appMapId}",
  tests: "relay://app-maps/{appMapId}/tests",
  test: "relay://app-maps/{appMapId}/tests/{testId}",
  testOutline: "relay://app-maps/{appMapId}/tests/{testId}/outline",
  testOutlinePage: "relay://app-maps/{appMapId}/tests/{testId}/outline/{page}",
  runs: "relay://runs",
  repairs: "relay://repairs",
  run: "relay://runs/{runId}",
  runEvidence: "relay://runs/{runId}/evidence",
  runOfflineReplay: "relay://runs/{runId}/offline-replay",
  runRepairProposals: "relay://runs/{runId}/repair-proposals",
  repair: "relay://runs/{runId}/checks/{checkId}/repair",
  authoringSessions: "relay://authoring-sessions",
  authoringSession: "relay://authoring-sessions/{sessionId}",
  targets: "relay://targets",
  targetObservation: "relay://targets/{targetId}/observation",
  controlGotchas: "relay://control/gotchas",
} as const;

export type RelayResourceScope = {
  projectId: string;
};

type RegisterRelayResourcesOptions = {
  invoker: OperationInvoker;
  scope: RelayResourceScope;
  profile: RelayMcpProfile;
  tools: readonly RelayMcpToolDescriptor[];
};

type ResourceEnvelope = {
  schemaVersion: 1;
  projectId: string;
  resource: string;
  truncated: boolean;
  data: unknown;
  byteLimit?: number;
  originalBytes?: number;
};

const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const localPath = /^(?:file:|\/(?:Users|private|var|tmp|home)\/|[A-Za-z]:[\\/])/i;
const sensitiveKey =
  /(?:^|_)(?:authorization|base64|cookie|credential|password|secret|token)(?:$|_)/i;
const pathKey = /(?:^|_)(?:file_?)?path$/i;

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "null" : serialized;
}

function sanitize(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (sensitiveKey.test(key) || pathKey.test(key) || key.toLowerCase().endsWith("path")) {
    return undefined;
  }
  if (typeof value === "string") {
    if (localPath.test(value) || value.startsWith("iVBORw0KGgo")) return "[redacted]";
    return value;
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => sanitize(item, "", seen));
    seen.delete(value);
    return result;
  }
  const result: Record<string, unknown> = {};
  for (const [childKey, item] of Object.entries(value as Record<string, unknown>)) {
    const sanitized = sanitize(item, childKey, seen);
    if (sanitized !== undefined) result[childKey] = sanitized;
  }
  seen.delete(value);
  return result;
}

function resourceText(
  projectId: string,
  resource: string,
  value: unknown,
  byteLimit = relayMcpResourceByteLimit,
  fallbackValue?: unknown,
): string {
  const envelope: ResourceEnvelope = {
    schemaVersion: 1,
    projectId,
    resource,
    truncated: false,
    data: sanitize(value),
  };
  const complete = stableJson(envelope);
  const originalBytes = Buffer.byteLength(complete, "utf8");
  if (originalBytes <= byteLimit) return complete;

  const truncated: ResourceEnvelope = {
    schemaVersion: 1,
    projectId,
    resource,
    truncated: true,
    data: fallbackValue === undefined ? null : sanitize(fallbackValue),
    byteLimit,
    originalBytes,
  };
  const bounded = stableJson(truncated);
  if (Buffer.byteLength(bounded, "utf8") <= byteLimit) return bounded;
  const metadataOnly = stableJson({ ...truncated, data: null });
  if (Buffer.byteLength(metadataOnly, "utf8") <= byteLimit) return metadataOnly;
  throw new ProtocolError(
    ProtocolErrorCode.InternalError,
    "Relay resource byte limit is too small",
  );
}

export function readResult(
  uri: URL,
  projectId: string,
  resource: string,
  value: unknown,
  fallbackValue?: unknown,
): ReadResourceResult {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: relayMcpResourceMimeType,
        text: resourceText(projectId, resource, value, relayMcpResourceByteLimit, fallbackValue),
      },
    ],
  };
}

export function variable(variables: Variables, name: string, uri: URL): string {
  const value = variables[name];
  if (typeof value !== "string" || !safeIdentifier.test(value)) {
    throw new ResourceNotFoundError(uri.href, `Unsafe Relay resource identifier in ${uri.href}`);
  }
  if (uri.search || uri.hash || decodeURIComponent(uri.pathname).includes("..")) {
    throw new ResourceNotFoundError(uri.href, `Unsafe Relay resource URI ${uri.href}`);
  }
  return value;
}

async function invokeRead(
  invoker: OperationInvoker,
  operationId: OperationId,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await invoker.invoke(operationId, input, { signal });
  } catch {
    throw new ProtocolError(
      ProtocolErrorCode.InternalError,
      `Relay query ${operationId} could not be read`,
    );
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayField(value: unknown, field: string): unknown[] {
  const items = object(value)[field];
  return Array.isArray(items) ? items : [];
}

function testCollection(value: unknown): {
  map: Record<string, unknown>;
  tests: Record<string, unknown>;
} {
  const map = object(object(value).appMap);
  return { map, tests: object(map.tests) };
}

function testSummary(value: unknown): Record<string, unknown> {
  const test = object(value);
  const steps = Array.isArray(test.steps) ? test.steps : [];
  return {
    id: test.id,
    name:
      typeof test.name === "string" && test.name.length > 160
        ? `${test.name.slice(0, 157)}…`
        : test.name,
    kind: test.kind,
    ...(test.capture ? { capture: test.capture } : {}),
    intentSchemaVersion: test.intentSchemaVersion,
    rootStepCount: steps.length,
    updatedAt: test.updatedAt,
  };
}

type TestOutlineEntry = {
  id: unknown;
  kind: unknown;
  intent: unknown;
  parentStepId?: string;
  branch: "root" | "then" | "else" | "steps";
  index: number;
  binding: {
    status: unknown;
    kind?: unknown;
    reason?: string;
    referencedEntityIds?: string[];
  };
  childCounts?: { thenSteps?: number; elseSteps?: number; steps?: number };
};

function testOutline(testValue: unknown, page = 0): Record<string, unknown> {
  const test = object(testValue);
  const entries: TestOutlineEntry[] = [];
  const visit = (
    stepsValue: unknown,
    branch: TestOutlineEntry["branch"],
    parentStepId?: string,
  ) => {
    const steps = Array.isArray(stepsValue) ? stepsValue : [];
    steps.forEach((stepValue, index) => {
      const step = object(stepValue);
      const binding = object(step.binding);
      const references = [
        ...(Array.isArray(binding.connectionIds) ? binding.connectionIds : []),
        ...(Array.isArray(binding.candidates)
          ? binding.candidates.map((candidate) => object(candidate).id)
          : []),
        binding.routineId,
        object(binding.assertion).screenId,
      ].filter((value): value is string => typeof value === "string");
      const id = typeof step.id === "string" ? step.id : undefined;
      entries.push({
        id: step.id,
        kind: step.kind,
        intent:
          typeof step.intent === "string" && step.intent.length > 80
            ? `${step.intent.slice(0, 77)}…`
            : step.intent,
        ...(parentStepId ? { parentStepId } : {}),
        branch,
        index,
        binding: {
          status: binding.status,
          ...(binding.kind ? { kind: binding.kind } : {}),
          ...(typeof binding.reason === "string"
            ? {
                reason:
                  binding.reason.length > 160 ? `${binding.reason.slice(0, 157)}…` : binding.reason,
              }
            : {}),
          ...(references.length ? { referencedEntityIds: references } : {}),
        },
        ...(step.kind === "decision"
          ? {
              childCounts: {
                thenSteps: Array.isArray(step.thenSteps) ? step.thenSteps.length : 0,
                elseSteps: Array.isArray(step.elseSteps) ? step.elseSteps.length : 0,
              },
            }
          : step.kind === "loop"
            ? { childCounts: { steps: Array.isArray(step.steps) ? step.steps.length : 0 } }
            : {}),
      });
      if (!id) return;
      if (step.kind === "decision") {
        visit(step.thenSteps, "then", id);
        visit(step.elseSteps, "else", id);
      } else if (step.kind === "loop") visit(step.steps, "steps", id);
    });
  };
  visit(test.steps, "root");
  const offset = page * 50;
  return {
    test: testSummary(test),
    stepCount: entries.length,
    unresolvedCount: entries.filter(({ binding }) => binding.status === "unresolved").length,
    page,
    pageSize: 50,
    returnedStepCount: Math.max(0, Math.min(entries.length - offset, 50)),
    remainingStepCount: Math.max(0, entries.length - offset - 50),
    steps: entries.slice(offset, offset + 50),
  };
}

function resourceList(
  items: unknown[],
  idField: string,
  titleField: string,
  uri: (id: string) => string,
): { resources: Array<{ uri: string; name: string; mimeType: string }> } {
  const resources = items
    .map(object)
    .filter((item) => typeof item[idField] === "string" && safeIdentifier.test(item[idField]))
    .slice(0, 100)
    .map((item) => {
      const id = item[idField] as string;
      const rawName =
        typeof item[titleField] === "string" && item[titleField]
          ? (item[titleField] as string)
          : id;
      const name = localPath.test(rawName) ? id : rawName.slice(0, 120);
      return { uri: uri(id), name, mimeType: relayMcpResourceMimeType };
    });
  return { resources };
}

async function targetLists(invoker: OperationInvoker, signal: AbortSignal) {
  const [devices, managed] = await Promise.all([
    invokeRead(invoker, "target.devices.list", {}, signal),
    invokeRead(invoker, "target.list", {}, signal),
  ]);
  return {
    devices: arrayField(devices, "devices"),
    managedTargets: arrayField(managed, "targets"),
  };
}

function latestObservation(
  sessionsValue: unknown,
  targetId: string,
): Record<string, unknown> | null {
  const sessions = arrayField(sessionsValue, "sessions")
    .map(object)
    .filter((session) => object(session.target).targetId === targetId)
    .sort((left, right) => Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0));
  const session = sessions[0];
  if (!session) return null;
  const take = object(session.take);
  const currentRevision = Number(take.currentRevision ?? 0);
  const revision = (Array.isArray(take.revisions) ? take.revisions : [])
    .map(object)
    .find((candidate) => candidate.revision === currentRevision);
  const observation = revision ? object(revision.after ?? revision.before) : {};
  return {
    sessionId: session.id,
    sessionState: session.state,
    updatedAt: session.updatedAt,
    takeId: take.id,
    takeRevision: currentRevision || undefined,
    observation: Object.keys(observation).length
      ? {
          id: observation.id,
          capturedAt: observation.capturedAt,
          bounds: observation.bounds,
          screen: observation.screen,
        }
      : null,
  };
}

function registerStaticResource(
  server: McpServer,
  name: string,
  title: string,
  uri: string,
  read: (signal: AbortSignal) => Promise<unknown>,
  scope: RelayResourceScope,
): void {
  server.registerResource(
    name,
    uri,
    {
      title,
      description: `${title} in the configured Relay project.`,
      mimeType: relayMcpResourceMimeType,
    },
    async (requestedUri, context) =>
      readResult(requestedUri, scope.projectId, name, await read(context.mcpReq.signal)),
  );
}

export function registerRelayResources(
  server: McpServer,
  { invoker, scope, profile, tools }: RegisterRelayResourcesOptions,
): void {
  registerStaticResource(
    server,
    "control-gotchas",
    "Relay device-control gotchas",
    relayMcpResourceUris.controlGotchas,
    async () => ({
      mandatory: true,
      readBefore: ["target.interact", "target.recover", "target.snapshot", "app.launch"],
      rules: [
        "Take a screenshot before interacting. Prefer identifier, then label, then text, then point.",
        "If a tap does not change pixels, it missed; try the label, not a cell center.",
        "A missing accessibility tree is not a failed session — screenshot plus point still works.",
        'On TARGET_CONTROL_LEASE_REQUIRED, call lease.create with poolId "local", deviceSerial, and confirm:true, then retry.',
        "On TARGET_CONTROL_RUN_RESERVED, wait or cancel the active job before sending input.",
        "Launch does not wait on XCTest. No active session is not a failed launch — recover the runner.",
        "Do not retry snapshot in a loop. Do not fail a tour only because the tree is missing.",
      ],
    }),
    scope,
  );
  registerStaticResource(
    server,
    "operations",
    "Relay operation discovery",
    relayMcpResourceUris.operations,
    async () => {
      const active = new Set(tools.map(({ operationId }) => operationId));
      return {
        activeProfile: profile,
        activeToolCount: tools.length,
        activeOperations: tools.map(({ operationId }) => operationId),
        profiles: relayMcpProfiles.map((id) => ({
          id,
          toolCount: relayMcpToolsForProfile(id).length,
        })),
        additionalOperations: relayMcpOperationCatalog().filter(
          ({ operationId }) => !active.has(operationId),
        ),
        excludedOperations: relayMcpExclusions,
        availablePrompts: relayMcpPrompts.map(({ name, title, description }) => ({
          name,
          title,
          description,
          unlockedByProfiles: relayMcpProfiles.filter(
            (id) =>
              relayMcpPromptsForTools(relayMcpToolsForProfile(id)).some(
                (available) => available.name === name,
              ),
          ),
        })),
        guidance:
          "Choose one task profile at server startup. Use full only for deliberate low-level access.",
      };
    },
    scope,
  );
  registerStaticResource(
    server,
    "current-project",
    "Current Relay project",
    relayMcpResourceUris.project,
    async (signal) => {
      const result = await invokeRead(invoker, "project.list", {}, signal);
      const project = arrayField(result, "projects")
        .map(object)
        .find((candidate) => candidate.id === scope.projectId);
      if (!project) throw new ResourceNotFoundError(relayMcpResourceUris.project);
      return { project };
    },
    scope,
  );
  server.registerResource(
    "run",
    new ResourceTemplate(relayMcpResourceUris.run, {
      list: async (context) =>
        resourceList(
          arrayField(await invokeRead(invoker, "run.list", {}, context.mcpReq.signal), "runs"),
          "id",
          "title",
          (id) => `relay://runs/${id}`,
        ),
    }),
    {
      title: "Relay Run",
      description: "One persisted Relay run with its immutable execution evidence.",
      mimeType: relayMcpResourceMimeType,
    },
    async (uri, variables, context) => {
      const runId = variable(variables, "runId", uri);
      try {
        const result = await invoker.invoke(
          "run.get",
          { runId },
          { signal: context.mcpReq.signal },
        );
        return readResult(uri, scope.projectId, "run", result);
      } catch {
        throw new ResourceNotFoundError(uri.href);
      }
    },
  );
  server.registerResource(
    "run-evidence",
    new ResourceTemplate(relayMcpResourceUris.runEvidence, { list: undefined }),
    {
      title: "Relay Run Evidence",
      description:
        "Bounded structured logs, network exchanges, performance samples, channel status, and provenance for one run.",
      mimeType: relayMcpResourceMimeType,
    },
    async (uri, variables, context) => {
      const runId = variable(variables, "runId", uri);
      try {
        const result = await invoker.invoke(
          "run.evidence.get",
          { runId, limit: 500 },
          { signal: context.mcpReq.signal },
        );
        return readResult(uri, scope.projectId, "run-evidence", result);
      } catch {
        throw new ResourceNotFoundError(uri.href);
      }
    },
  );
  registerRepairProposalsResource(server, { invoker, scope });
  registerDiffImpactResource(server, { invoker, scope });
  server.registerResource(
    "run-offline-replay",
    new ResourceTemplate(relayMcpResourceUris.runOfflineReplay, { list: undefined }),
    {
      title: "Relay Offline Run Replay",
      description:
        "A device-independent causal diagnosis reconstructed only from a persisted run's frozen plan and captured evidence.",
      mimeType: relayMcpResourceMimeType,
    },
    async (uri, variables, context) => {
      const runId = variable(variables, "runId", uri);
      try {
        const result = await invoker.invoke(
          "run.replay.offline",
          { runId },
          { signal: context.mcpReq.signal },
        );
        return readResult(
          uri,
          scope.projectId,
          "run-offline-replay",
          result,
          compactOfflineReplayResource(result),
        );
      } catch {
        throw new ResourceNotFoundError(uri.href);
      }
    },
  );
  server.registerResource(
    "repair",
    new ResourceTemplate(relayMcpResourceUris.repair, { list: undefined }),
    {
      title: "Relay Failed Check Repair",
      description:
        "One exact failed-check package with immutable lineage, selector attempts, observed state, and deliberate repair actions.",
      mimeType: relayMcpResourceMimeType,
    },
    async (uri, variables, context) => {
      const runId = variable(variables, "runId", uri);
      const checkId = variable(variables, "checkId", uri);
      try {
        const result = await invoker.invoke(
          "run.repair.get",
          { runId, checkId },
          { signal: context.mcpReq.signal },
        );
        const repair = object(result).repair;
        const compact = object(repair);
        return readResult(uri, scope.projectId, "repair", result, {
          repair: {
            id: compact.id,
            status: compact.status,
            defaultAction: compact.defaultAction,
            source: compact.source,
            expected: compact.expected,
            observed: compact.observed,
            lineage: compact.lineage,
            actions: compact.actions,
            evidenceTruncated: true,
          },
        });
      } catch {
        throw new ResourceNotFoundError(uri.href);
      }
    },
  );
  registerStaticResource(
    server,
    "app-maps",
    "Relay App Maps",
    relayMcpResourceUris.appMaps,
    (signal) => invokeRead(invoker, "app-map.list", {}, signal),
    scope,
  );
  registerStaticResource(
    server,
    "workspace-variables",
    "Relay Workspace Variables",
    relayMcpResourceUris.variables,
    (signal) => invokeRead(invoker, "workspace.variables.get", {}, signal),
    scope,
  );
  registerStaticResource(
    server,
    "runs",
    "Relay Runs",
    relayMcpResourceUris.runs,
    (signal) => invokeRead(invoker, "run.list", {}, signal),
    scope,
  );
  registerStaticResource(
    server,
    "repairs",
    "Relay failed-check repair queue",
    relayMcpResourceUris.repairs,
    (signal) => invokeRead(invoker, "run.repair.list", {}, signal),
    scope,
  );
  registerStaticResource(
    server,
    "authoring-sessions",
    "Relay Authoring Sessions",
    relayMcpResourceUris.authoringSessions,
    (signal) => invokeRead(invoker, "authoring.session.list", {}, signal),
    scope,
  );
  registerStaticResource(
    server,
    "targets",
    "Relay Targets",
    relayMcpResourceUris.targets,
    (signal) => targetLists(invoker, signal),
    scope,
  );

  server.registerResource(
    "app-map",
    new ResourceTemplate(relayMcpResourceUris.appMap, {
      list: async (context) =>
        resourceList(
          arrayField(
            await invokeRead(invoker, "app-map.list", {}, context.mcpReq.signal),
            "appMaps",
          ),
          "id",
          "name",
          (id) => `relay://app-maps/${id}`,
        ),
    }),
    {
      title: "Relay App Map",
      description: "One canonical App Map in the configured Relay project.",
      mimeType: relayMcpResourceMimeType,
    },
    async (uri, variables, context) => {
      const appMapId = variable(variables, "appMapId", uri);
      try {
        const result = await invoker.invoke(
          "app-map.get",
          { appMapId },
          { signal: context.mcpReq.signal },
        );
        return readResult(uri, scope.projectId, "app-map", result);
      } catch {
        throw new ResourceNotFoundError(uri.href);
      }
    },
  );

  server.registerResource(
    "tests",
    new ResourceTemplate(relayMcpResourceUris.tests, { list: undefined }),
    {
      title: "Relay Tests",
      description: "Compact Test summaries and the current App Map revision.",
      mimeType: relayMcpResourceMimeType,
    },
    async (uri, variables, context) => {
      const appMapId = variable(variables, "appMapId", uri);
      let result: unknown;
      try {
        result = await invoker.invoke(
          "app-map.get",
          { appMapId },
          { signal: context.mcpReq.signal },
        );
      } catch {
        throw new ResourceNotFoundError(uri.href);
      }
      const { map, tests } = testCollection(result);
      const summaries = Object.values(tests)
        .map(testSummary)
        .sort((left, right) => String(left.id).localeCompare(String(right.id)));
      const data = {
        appMapId,
        appMapRevision: map.revision,
        tests: summaries,
      };
      return readResult(uri, scope.projectId, "tests", data, {
        appMapId,
        appMapRevision: map.revision,
        testCount: summaries.length,
        returnedTestCount: Math.min(summaries.length, 50),
        remainingTestCount: Math.max(0, summaries.length - 50),
        tests: summaries.slice(0, 50),
      });
    },
  );

  server.registerResource(
    "test",
    new ResourceTemplate(relayMcpResourceUris.test, { list: undefined }),
    {
      title: "Relay Test",
      description:
        "One canonical Test. Oversized Tests degrade to a stable-ID outline instead of disappearing.",
      mimeType: relayMcpResourceMimeType,
    },
    async (uri, variables, context) => {
      const appMapId = variable(variables, "appMapId", uri);
      const testId = variable(variables, "testId", uri);
      let result: unknown;
      try {
        result = await invoker.invoke(
          "app-map.get",
          { appMapId },
          { signal: context.mcpReq.signal },
        );
      } catch {
        throw new ResourceNotFoundError(uri.href);
      }
      const { map, tests } = testCollection(result);
      const selected = tests[testId];
      if (!selected) throw new ResourceNotFoundError(uri.href);
      const detail = { appMapId, appMapRevision: map.revision, test: selected };
      const fallback = { appMapId, appMapRevision: map.revision, ...testOutline(selected) };
      return readResult(uri, scope.projectId, "test", detail, fallback);
    },
  );

  server.registerResource(
    "test-outline",
    new ResourceTemplate(relayMcpResourceUris.testOutline, { list: undefined }),
    {
      title: "Relay Test Outline",
      description:
        "A compact stable-ID Test tree with placements, bindings, and unresolved counts.",
      mimeType: relayMcpResourceMimeType,
    },
    async (uri, variables, context) => {
      const appMapId = variable(variables, "appMapId", uri);
      const testId = variable(variables, "testId", uri);
      let result: unknown;
      try {
        result = await invoker.invoke(
          "app-map.get",
          { appMapId },
          { signal: context.mcpReq.signal },
        );
      } catch {
        throw new ResourceNotFoundError(uri.href);
      }
      const { map, tests } = testCollection(result);
      const selected = tests[testId];
      if (!selected) throw new ResourceNotFoundError(uri.href);
      return readResult(uri, scope.projectId, "test-outline", {
        appMapId,
        appMapRevision: map.revision,
        ...testOutline(selected),
      });
    },
  );

  server.registerResource(
    "test-outline-page",
    new ResourceTemplate(relayMcpResourceUris.testOutlinePage, { list: undefined }),
    {
      title: "Relay Test Outline Page",
      description: "One 50-step page from a compact stable-ID Test outline.",
      mimeType: relayMcpResourceMimeType,
    },
    async (uri, variables, context) => {
      const appMapId = variable(variables, "appMapId", uri);
      const testId = variable(variables, "testId", uri);
      const pageValue = variable(variables, "page", uri);
      const page = Number(pageValue);
      if (!Number.isSafeInteger(page) || page < 0 || page > 3) {
        throw new ResourceNotFoundError(uri.href);
      }
      let result: unknown;
      try {
        result = await invoker.invoke(
          "app-map.get",
          { appMapId },
          { signal: context.mcpReq.signal },
        );
      } catch {
        throw new ResourceNotFoundError(uri.href);
      }
      const { map, tests } = testCollection(result);
      const selected = tests[testId];
      if (!selected) throw new ResourceNotFoundError(uri.href);
      return readResult(uri, scope.projectId, "test-outline-page", {
        appMapId,
        appMapRevision: map.revision,
        ...testOutline(selected, page),
      });
    },
  );

  server.registerResource(
    "authoring-session",
    new ResourceTemplate(relayMcpResourceUris.authoringSession, {
      list: async (context) =>
        resourceList(
          arrayField(
            await invokeRead(invoker, "authoring.session.list", {}, context.mcpReq.signal),
            "sessions",
          ),
          "id",
          "id",
          (id) => `relay://authoring-sessions/${id}`,
        ),
    }),
    {
      title: "Relay Authoring Session",
      description: "One Authoring Session in the configured Relay project.",
      mimeType: relayMcpResourceMimeType,
    },
    async (uri, variables, context) => {
      const sessionId = variable(variables, "sessionId", uri);
      try {
        const result = await invoker.invoke(
          "authoring.session.get",
          { sessionId },
          { signal: context.mcpReq.signal },
        );
        return readResult(uri, scope.projectId, "authoring-session", result);
      } catch {
        throw new ResourceNotFoundError(uri.href);
      }
    },
  );

  server.registerResource(
    "target-observation",
    new ResourceTemplate(relayMcpResourceUris.targetObservation, { list: undefined }),
    {
      title: "Relay Target Observation",
      description:
        "Current observation metadata already held by Relay; reading never captures evidence.",
      mimeType: relayMcpResourceMimeType,
    },
    async (uri, variables, context) => {
      const targetId = variable(variables, "targetId", uri);
      const targets = await targetLists(invoker, context.mcpReq.signal);
      const known = [...targets.devices, ...targets.managedTargets]
        .map(object)
        .some((target) => target.id === targetId || target.serial === targetId);
      if (!known) throw new ResourceNotFoundError(uri.href);
      const sessions = await invokeRead(
        invoker,
        "authoring.session.list",
        {},
        context.mcpReq.signal,
      );
      return readResult(uri, scope.projectId, "target-observation", {
        targetId,
        current: latestObservation(sessions, targetId),
      });
    },
  );
}
