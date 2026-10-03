import {
  McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
  type Variables,
} from "@modelcontextprotocol/server";
import { projectDestIdentityOnEvidence, summarizeExecutionOperationResult } from "@relay/protocol";
import type { OperationInvoker } from "./server.js";
import {
  arrayField,
  cursorForUri,
  evidencePage,
  invokeRead,
  latestObservation,
  object,
  pageFromCursor,
  registerStaticResource,
  resourceList,
  relayMcpResourcePageSize,
  scalarFields,
  targetLists,
  templateResourceAllowed,
  testCollection,
  testSummary,
  testOutline,
  variable,
} from "./resource-pagination.js";
export { relayMcpResourcePageSize, variable } from "./resource-pagination.js";
import { compactOfflineReplayResource } from "./offline-replay-result.js";
import { registerDiffImpactResource } from "./diff-impact-resource.js";
import { registerRepairProposalsResource } from "./repair-proposals-resource.js";
import {
  hoistTracePackDestIdentity,
  readResult,
  relayMcpResourceMimeType,
  rewriteDestIdentityRelativeNames,
  tracePackResourceManifest,
} from "./resource-encoding.js";
export {
  readResult,
  relayMcpResourceByteLimit,
  relayMcpResourceMimeType,
  tracePackResourceManifest,
} from "./resource-encoding.js";
import {
  relayMcpExclusions,
  relayMcpOperationCatalog,
  relayMcpProfiles,
  relayMcpToolsForProfile,
  type RelayMcpProfile,
  type RelayMcpToolDescriptor,
} from "./tools.js";
import { relayMcpPrompts, relayMcpPromptsForTools } from "./prompts.js";
import { relayOutcomeTools } from "./outcome-tools.js";
import {
  relayQaOutcomeTools,
  relayQaOperatorTools,
  relayQaRequiredOperationIds,
} from "./qa-tools.js";
import { relayOperatorTools } from "./operator-tools.js";
import { registerTaskGuideResources } from "./task-guide-resources.js";

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
  runTracePack: "relay://runs/{runId}/trace-pack",
  runOfflineReplay: "relay://runs/{runId}/offline-replay",
  runRepairProposals: "relay://runs/{runId}/repair-proposals",
  repair: "relay://runs/{runId}/checks/{checkId}/repair",
  authoringSessions: "relay://authoring-sessions",
  authoringSession: "relay://authoring-sessions/{sessionId}",
  targets: "relay://targets",
  targetObservation: "relay://targets/{targetId}/observation",
  controlGotchas: "relay://control/gotchas",
  lanes: "relay://lanes",
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

export function registerRelayResources(
  server: McpServer,
  { invoker, scope, profile, tools }: RegisterRelayResourcesOptions,
): void {
  registerTaskGuideResources(server, scope, profile, tools);
  const activeOperations = new Set(tools.map(({ operationId }) => operationId));
  const leaseRecoveryRule =
    profile === "operator"
      ? "On TARGET_CONTROL_LEASE_REQUIRED, operator verbs auto-create a lease for this actor. If another actor holds the device, the error names who holds it and since when."
      : activeOperations.has("lease.create")
        ? 'On TARGET_CONTROL_LEASE_REQUIRED, call lease.create with poolId "local", deviceSerial, and confirm:true, then retry.'
        : `On TARGET_CONTROL_LEASE_REQUIRED, lease.create is not exposed in selected MCP profile "${profile}". Use a profile that exposes the canonical lease.create and lease.release pair, or ask an operator to acquire the lease.`;
  const targetRecoveryRule =
    profile === "operator"
      ? "Launch does not wait on XCTest. No active session is not a failed launch — use relay_recover, which adopts a healthy live runner instead of killing it."
      : activeOperations.has("target.recover")
        ? "Launch does not wait on XCTest. No active session is not a failed launch — recover the runner."
        : `Launch does not wait on XCTest. No active session is not a failed launch — target.recover is not exposed in selected MCP profile "${profile}"; use an authorized operator or profile to recover the runner.`;
  const readRunCollection = (signal: AbortSignal, requestedUri: URL) => {
    const cursor = cursorForUri(requestedUri, "runs", scope, profile);
    return invokeRead(
      invoker,
      "run.list",
      {
        limit: relayMcpResourcePageSize,
        ...(cursor.backendCursor ? { cursor: cursor.backendCursor } : {}),
      },
      signal,
    );
  };
  registerStaticResource(
    server,
    "control-gotchas",
    "Relay device-control gotchas",
    relayMcpResourceUris.controlGotchas,
    async () => ({
      mandatory: true,
      readBefore: ["target.interact", "target.recover", "target.snapshot", "app.launch"],
      rules: [
        "Happy path: screenshot → preview/tap → screenshot. Do not start with test run, survey, or recover.",
        "Take a screenshot before interacting. Prefer identifier, then label, then text, then point.",
        "Chrome-bounded iOS snapshot queries measured unique home ids and unique chrome labels plus the requested selector. Unique labels such as grok-compose and New temporary conversation resolve the same way unique ids do. Do not walk conversation lists. A chrome-bounded miss is not a recover-kill.",
        "If a tap does not change pixels, it missed; try the label, not a cell center.",
        "A missing accessibility tree is not a failed session — screenshot plus a point tap uses CoreDevice HID pixels. Recover only for the tree. Do not retry the tap because XCTest is down.",
        "relay_recover / target.recover adopts a healthy live XCTest runner. Do not kill a ready runner, remount DDI in a loop, or reboot the iPad.",
        "wait-for/expect-screen poll the accessibility slot while pixels stay still and freeze the glass. Screenshot + interact instead.",
        "Physical iPad screenshot uses go-ios, not target.open. iOS 17+ needs an active tunnel. A missing XCTest session is not a failed screenshot or point tap.",
        leaseRecoveryRule,
        "On TARGET_CONTROL_RUN_RESERVED, wait or cancel the active job before sending input.",
        targetRecoveryRule,
        "Signed-in browser snapshot needs laneId / --lane so the fixture overlay is applied. Snapshot grok-com without a Lane is the unsigned profile.",
        "Do not retry snapshot in a loop. Do not fail a tour only because the tree is missing.",
      ],
    }),
    scope,
    profile,
    tools,
  );
  registerStaticResource(
    server,
    "operations",
    "Relay operation discovery",
    relayMcpResourceUris.operations,
    async () => {
      return {
        activeProfile: profile,
        activeToolCount:
          profile === "qa"
            ? 1 + relayQaOutcomeTools.length + relayQaOperatorTools.length + tools.length
            : profile === "outcome"
              ? relayOutcomeTools.length
              : profile === "operator"
                ? relayOperatorTools.length
                : tools.length,
        activeOperations:
          profile === "qa"
            ? [
                "relay_panel",
                ...[...relayQaOutcomeTools, ...relayQaOperatorTools, ...tools].map(
                  ({ name }) => name,
                ),
              ]
            : profile === "outcome"
              ? relayOutcomeTools.map(({ name }) => name)
              : profile === "operator"
                ? relayOperatorTools.map(({ name }) => name)
                : tools.map(({ operationId }) => operationId),
        profiles: relayMcpProfiles.map((id) => ({
          id,
          toolCount:
            id === "qa"
              ? 1 +
                relayQaOutcomeTools.length +
                relayQaOperatorTools.length +
                relayMcpToolsForProfile(id).length
              : id === "outcome"
                ? relayOutcomeTools.length
                : id === "operator"
                  ? relayOperatorTools.length
                  : relayMcpToolsForProfile(id).length,
        })),
        additionalOperations: relayMcpOperationCatalog().filter(
          ({ operationId }) =>
            !activeOperations.has(operationId) &&
            (profile !== "qa" || relayQaRequiredOperationIds.some((id) => id === operationId)),
        ),
        excludedOperations: relayMcpExclusions,
        availablePrompts: relayMcpPrompts.map(({ name, title, description }) => ({
          name,
          title,
          description,
          unlockedByProfiles: relayMcpProfiles.filter((id) =>
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
    profile,
    tools,
  );
  registerStaticResource(
    server,
    "lanes",
    "Relay Lanes",
    relayMcpResourceUris.lanes,
    async (signal) => invokeRead(invoker, "lane.list", {}, signal),
    scope,
    profile,
    tools,
    ["lane.list"],
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
    profile,
    tools,
    ["project.list"],
  );
  if (templateResourceAllowed(profile, tools, ["run.list", "run.get"]))
    server.registerResource(
      "run",
      new ResourceTemplate(relayMcpResourceUris.run, {
        list: async (context) => {
          const result = await readRunCollection(
            context.mcpReq.signal,
            new URL(relayMcpResourceUris.runs),
          );
          return resourceList(
            arrayField(result, "runs"),
            "id",
            "title",
            (id) => `relay://runs/${id}`,
            {
              uri: relayMcpResourceUris.runs,
              resource: "runs",
              scope,
              profile,
              backendCursor:
                typeof object(result).nextCursor === "string"
                  ? (object(result).nextCursor as string)
                  : undefined,
            },
          );
        },
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
          return readResult(
            uri,
            scope.projectId,
            "run",
            rewriteDestIdentityRelativeNames(summarizeExecutionOperationResult("run.get", result)),
          );
        } catch {
          throw new ResourceNotFoundError(uri.href);
        }
      },
    );
  if (templateResourceAllowed(profile, tools, ["run.evidence.get"])) {
    const runEvidenceConfig = {
      title: "Relay Run Evidence",
      description:
        "Bounded structured logs, network exchanges, performance samples, channel status, and provenance for one run.",
      mimeType: relayMcpResourceMimeType,
    };
    const readRunEvidence = async (
      uri: URL,
      variables: Variables,
      context: { mcpReq: { signal: AbortSignal } },
    ) => {
      const runId = variable(variables, "runId", uri, { allowCursor: true });
      cursorForUri(uri, "run-evidence", scope, profile);
      try {
        const result = await invoker.invoke(
          "run.evidence.get",
          { runId, limit: 2_000 },
          { signal: context.mcpReq.signal },
        );
        const projected = rewriteDestIdentityRelativeNames({
          ...object(result),
          evidence: projectDestIdentityOnEvidence(object(result).evidence),
        }) as Record<string, unknown>;
        const evidenceRecord = object(projected.evidence);
        const destIdentity = evidenceRecord.destIdentity;
        const { destIdentity: _destIdentity, ...evidenceWithoutDest } = evidenceRecord;
        const paged = evidencePage(evidenceWithoutDest, uri, scope, profile);
        const evidence = {
          ...paged,
          ...(Array.isArray(destIdentity) && destIdentity.length ? { destIdentity } : {}),
        };
        const pagedResult = {
          ...scalarFields(projected),
          evidence,
        };
        return readResult(uri, scope.projectId, "run-evidence", pagedResult);
      } catch {
        throw new ResourceNotFoundError(uri.href);
      }
    };
    server.registerResource(
      "run-evidence",
      new ResourceTemplate(relayMcpResourceUris.runEvidence, { list: undefined }),
      runEvidenceConfig,
      readRunEvidence,
    );
    server.registerResource(
      "run-evidence-page",
      new ResourceTemplate(`${relayMcpResourceUris.runEvidence}{?cursor}`, { list: undefined }),
      runEvidenceConfig,
      readRunEvidence,
    );
  }
  if (templateResourceAllowed(profile, tools, ["run.trace-pack.get"]))
    server.registerResource(
      "run-trace-pack",
      new ResourceTemplate(relayMcpResourceUris.runTracePack, { list: undefined }),
      {
        title: "Relay TracePack",
        description:
          "A scoped TracePack artifact handle for one Run: complete when bounded, otherwise a digest and safe manifest.",
        mimeType: relayMcpResourceMimeType,
      },
      async (uri, variables, context) => {
        const runId = variable(variables, "runId", uri);
        try {
          const result = await invoker.invoke(
            "run.trace-pack.get",
            { runId },
            { signal: context.mcpReq.signal },
          );
          const hoisted = hoistTracePackDestIdentity(result);
          return readResult(uri, scope.projectId, "run-trace-pack", hoisted, {
            resourceUri: uri.href,
            ...(Array.isArray(object(hoisted).destIdentity)
              ? { destIdentity: object(hoisted).destIdentity }
              : {}),
            tracePack: tracePackResourceManifest(result),
          });
        } catch {
          throw new ResourceNotFoundError(uri.href);
        }
      },
    );
  if (templateResourceAllowed(profile, tools, ["run.get"])) {
    registerRepairProposalsResource(server, { invoker, scope });
  }
  if (templateResourceAllowed(profile, tools, ["app-map.diff.impact"])) {
    registerDiffImpactResource(server, { invoker, scope });
  }
  if (templateResourceAllowed(profile, tools, ["run.replay.offline"]))
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
          const summarized = summarizeExecutionOperationResult("run.replay.offline", result);
          return readResult(
            uri,
            scope.projectId,
            "run-offline-replay",
            rewriteDestIdentityRelativeNames(summarized),
            compactOfflineReplayResource(summarized),
          );
        } catch {
          throw new ResourceNotFoundError(uri.href);
        }
      },
    );
  if (templateResourceAllowed(profile, tools, ["run.repair.get"]))
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
    profile,
    tools,
    ["app-map.list"],
  );
  registerStaticResource(
    server,
    "workspace-variables",
    "Relay Workspace Variables",
    relayMcpResourceUris.variables,
    (signal) => invokeRead(invoker, "workspace.variables.get", {}, signal),
    scope,
    profile,
    tools,
    ["workspace.variables.get"],
  );
  registerStaticResource(
    server,
    "runs",
    "Relay Runs",
    relayMcpResourceUris.runs,
    readRunCollection,
    scope,
    profile,
    tools,
    ["run.list"],
  );
  registerStaticResource(
    server,
    "repairs",
    "Relay failed-check repair queue",
    relayMcpResourceUris.repairs,
    (signal) => invokeRead(invoker, "run.repair.list", {}, signal),
    scope,
    profile,
    tools,
    ["run.repair.list"],
  );
  registerStaticResource(
    server,
    "authoring-sessions",
    "Relay Authoring Sessions",
    relayMcpResourceUris.authoringSessions,
    (signal) => invokeRead(invoker, "authoring.session.list", {}, signal),
    scope,
    profile,
    tools,
    ["authoring.session.list"],
  );
  registerStaticResource(
    server,
    "targets",
    "Relay Targets",
    relayMcpResourceUris.targets,
    (signal) => targetLists(invoker, signal),
    scope,
    profile,
    tools,
    ["target.devices.list", "target.list"],
  );

  if (templateResourceAllowed(profile, tools, ["app-map.list", "app-map.get"]))
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
            {
              uri: relayMcpResourceUris.appMaps,
              resource: "app-maps",
              scope,
              profile,
            },
          ),
      }),
      {
        title: "Relay App Map",
        description: "One canonical App Map in the configured Relay project.",
        mimeType: relayMcpResourceMimeType,
      },
      async (uri, variables, context) => {
        const appMapId = variable(variables, "appMapId", uri, { allowCursor: true });
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

  if (templateResourceAllowed(profile, tools, ["app-map.get"]))
    server.registerResource(
      "tests",
      new ResourceTemplate(relayMcpResourceUris.tests, { list: undefined }),
      {
        title: "Relay Tests",
        description: "Compact Test summaries and the current App Map revision.",
        mimeType: relayMcpResourceMimeType,
      },
      async (uri, variables, context) => {
        const appMapId = variable(variables, "appMapId", uri, { allowCursor: true });
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

  if (templateResourceAllowed(profile, tools, ["app-map.get"]))
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
        const appMapId = variable(variables, "appMapId", uri, { allowCursor: true });
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
        const outlineUri = new URL(`${uri.href}/outline`);
        const detail = { appMapId, appMapRevision: map.revision, test: selected };
        const fallback = {
          appMapId,
          appMapRevision: map.revision,
          ...testOutline(selected, 0, outlineUri, scope, profile),
        };
        return readResult(uri, scope.projectId, "test", detail, fallback);
      },
    );

  if (templateResourceAllowed(profile, tools, ["app-map.get"])) {
    const testOutlineConfig = {
      title: "Relay Test Outline",
      description:
        "A compact stable-ID Test tree with placements, bindings, and unresolved counts.",
      mimeType: relayMcpResourceMimeType,
    };
    const readTestOutline = async (
      uri: URL,
      variables: Variables,
      context: { mcpReq: { signal: AbortSignal } },
    ) => {
      const appMapId = variable(variables, "appMapId", uri, { allowCursor: true });
      const testId = variable(variables, "testId", uri, { allowCursor: true });
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
      const page = pageFromCursor(uri, "test-outline", scope, profile) ?? 0;
      const outline = {
        appMapId,
        appMapRevision: map.revision,
        ...testOutline(selected, page, uri, scope, profile),
      };
      return readResult(uri, scope.projectId, "test-outline", outline, outline);
    };
    server.registerResource(
      "test-outline-cursor",
      new ResourceTemplate(`${relayMcpResourceUris.testOutline}{?cursor}`, { list: undefined }),
      testOutlineConfig,
      readTestOutline,
    );
    server.registerResource(
      "test-outline",
      new ResourceTemplate(relayMcpResourceUris.testOutline, { list: undefined }),
      testOutlineConfig,
      readTestOutline,
    );
  }

  if (templateResourceAllowed(profile, tools, ["app-map.get"])) {
    const testOutlinePageConfig = {
      title: "Relay Test Outline Page",
      description: "One 50-step page from a compact stable-ID Test outline.",
      mimeType: relayMcpResourceMimeType,
    };
    const readTestOutlinePage = async (
      uri: URL,
      variables: Variables,
      context: { mcpReq: { signal: AbortSignal } },
    ) => {
      const appMapId = variable(variables, "appMapId", uri, { allowCursor: true });
      const testId = variable(variables, "testId", uri, { allowCursor: true });
      const pageValue = variable(variables, "page", uri, { allowCursor: true });
      const page = Number(pageValue);
      if (!Number.isSafeInteger(page) || page < 0 || page > 10_000) {
        throw new ResourceNotFoundError(uri.href);
      }
      const cursorPage = pageFromCursor(uri, "test-outline", scope, profile);
      if (cursorPage !== undefined && cursorPage !== page) {
        throw new ResourceNotFoundError(uri.href, `Invalid Relay resource cursor in ${uri.href}`);
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
      const outline = {
        appMapId,
        appMapRevision: map.revision,
        ...testOutline(selected, page, uri, scope, profile),
      };
      return readResult(uri, scope.projectId, "test-outline-page", outline, outline);
    };
    server.registerResource(
      "test-outline-page-cursor",
      new ResourceTemplate(`${relayMcpResourceUris.testOutlinePage}{?cursor}`, {
        list: undefined,
      }),
      testOutlinePageConfig,
      readTestOutlinePage,
    );
    server.registerResource(
      "test-outline-page",
      new ResourceTemplate(relayMcpResourceUris.testOutlinePage, { list: undefined }),
      testOutlinePageConfig,
      readTestOutlinePage,
    );
  }

  if (templateResourceAllowed(profile, tools, ["authoring.session.list", "authoring.session.get"]))
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
            {
              uri: relayMcpResourceUris.authoringSessions,
              resource: "authoring-sessions",
              scope,
              profile,
            },
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

  if (
    templateResourceAllowed(profile, tools, [
      "target.devices.list",
      "target.list",
      "authoring.session.list",
    ])
  )
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
