import { operationDefinitions, type OperationDefinition, type OperationId } from "@relay/protocol";
import { relayToolInputSchema, type RelayToolInputSchema } from "./input-schemas.js";

export const relayMcpProfiles = [
  "observe",
  "author",
  "execute",
  "review",
  "admin",
  "full",
] as const;

export type RelayMcpProfile = (typeof relayMcpProfiles)[number];
export const defaultRelayMcpProfile: RelayMcpProfile = "author";

export const relayMcpExclusions = [
  {
    operationId: "event.stream",
    reason: "Relay event streams are resource-only and are not exposed as MCP tools.",
  },
  {
    operationId: "target.stream.open",
    reason: "Live target video is a media stream, not an MCP tool.",
  },
  ...(
    [
      "recipe.list",
      "recipe.get",
      "recipe.create",
      "recipe.update",
      "recipe.delete",
      "recipe.yaml.get",
      "recipe.import",
      "recipe.evidence.create",
      "recipe.history.list",
      "recipe.history.restore",
      "recipe.stability.get",
    ] as const
  ).map((operationId) => ({
    operationId,
    reason: "Compiled recipe storage is internal; agents author and run App Map flows.",
  })),
] as const satisfies readonly { operationId: OperationId; reason: string }[];

type ExcludedOperationId = (typeof relayMcpExclusions)[number]["operationId"];

export type RelayMcpToolAnnotations = {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
};

export type RelayMcpToolDescriptor = {
  readonly name: `relay_${string}`;
  readonly operationId: Exclude<OperationId, ExcludedOperationId>;
  readonly title: string;
  readonly description: string;
  readonly annotations: RelayMcpToolAnnotations;
  readonly requiresConfirmation: boolean;
  readonly inputSchema: RelayToolInputSchema;
};

const excludedOperationIdSet = new Set<OperationId>(
  relayMcpExclusions.map(({ operationId }) => operationId),
);

export function relayToolName(operationId: string): `relay_${string}` {
  return `relay_${operationId.replace(/[.-]/g, "_")}`;
}

function isToolOperation(
  definition: OperationDefinition<OperationId>,
): definition is OperationDefinition<Exclude<OperationId, ExcludedOperationId>> {
  return !excludedOperationIdSet.has(definition.id);
}

function toolDescriptor(
  definition: OperationDefinition<Exclude<OperationId, ExcludedOperationId>>,
): RelayMcpToolDescriptor {
  const requiresConfirmation = definition.confirmation !== "none";
  const requirements = [
    definition.targetCapabilities.length
      ? `Target capabilities: ${definition.targetCapabilities.join(", ")}.`
      : "",
    definition.lease !== "none" ? `Lease: ${definition.lease}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return Object.freeze({
    name: relayToolName(definition.id),
    operationId: definition.id,
    title: definition.label,
    description: `${definition.label}. Pass operation fields directly.${requirements ? ` ${requirements}` : ""}${requiresConfirmation ? " Requires confirm: true." : ""}`,
    annotations: Object.freeze({
      readOnlyHint: definition.mode === "query",
      destructiveHint:
        definition.confirmation === "dangerous" || definition.transport.method === "DELETE",
      idempotentHint:
        definition.idempotency === "inherent" || definition.idempotency === "required",
      openWorldHint: false,
    }),
    requiresConfirmation,
    inputSchema: relayToolInputSchema(definition.id, requiresConfirmation),
  });
}

export const relayMcpTools: readonly RelayMcpToolDescriptor[] = Object.freeze(
  operationDefinitions.filter(isToolOperation).map(toolDescriptor),
);

const authorSupport = new Set<OperationId>([
  "system.health.get",
  "system.doctor.get",
  "target.devices.list",
  "target.list",
  "target.preflight",
  "target.open",
  "target.snapshot.capture",
  "target.screenshot.capture",
  "target.app.launch",
  "target.interact",
  "target.ui.describe",
  "target.ui.back",
  "target.ui.scrollCollect",
  "lease.list",
  "lease.create",
  "lease.takeover",
  "lease.release",
  "workspace.variables.get",
  "workspace.variables.update",
  "app-map.list",
  "app-map.get",
  "app-map.create",
  "app-map.export",
  "app-map.update",
  "app-map.screen.capture",
  "app-map.teach",
  "app-map.flow.run",
  "app-map.case-stack.save",
  "app-map.case-stack.attach",
  "app-map.case-stack.remove",
  "app-map.routine.save",
  "app-map.routine.remove",
  "app-map.proposal.submit",
  "app-map.observations.propose",
  "generation.create",
]);

const executePrefixes = ["job."] as const;
const executeSupport = new Set<OperationId>([
  "system.health.get",
  "system.doctor.get",
  "target.actions.list",
  "target.devices.list",
  "target.list",
  "target.preflight",
  "target.open",
  "target.boot",
  "target.authorize",
  "target.snapshot.capture",
  "target.screenshot.capture",
  "target.app.launch",
  "target.interact",
  "target.ui.describe",
  "target.ui.back",
  "target.ui.scrollCollect",
  "target.touch",
  "target.key",
  "target.scroll",
  "target.video.start",
  "lease.list",
  "lease.create",
  "lease.takeover",
  "lease.release",
  "action.run",
  "app-map.list",
  "app-map.get",
  "matrix.list",
  "matrix.resolve",
  "run.list",
  "step.run",
  "app-map.flow.run",
]);

const reviewSupport = new Set<OperationId>([
  "system.health.get",
  "target.devices.list",
  "target.snapshot.capture",
  "target.screenshot.capture",
  "lease.list",
  "lease.create",
  "lease.takeover",
  "lease.release",
  "authoring.session.list",
  "authoring.session.get",
  "authoring.take.trim",
  "authoring.take.reorder",
  "authoring.take.replace",
  "authoring.take.replay",
  "authoring.session.commit",
  "authoring.session.discard",
  "authoring.session.cancel",
  "authoring.session.cleanup",
  "job.list",
  "job.get",
  "run.list",
  "run.review",
  "run.visual.compare",
  "run.visual-baseline.update",
  "run.visual.review",
  "run.visual-policy.get",
  "run.visual-policy.update",
  "run.pin.update",
]);

function toolInProfile(tool: RelayMcpToolDescriptor, profile: RelayMcpProfile): boolean {
  if (profile === "full") return true;
  const definition = operationDefinitions.find(({ id }) => id === tool.operationId)!;
  if (profile === "observe") return definition.mode === "query";
  if (profile === "author") {
    return tool.operationId.startsWith("authoring.") || authorSupport.has(tool.operationId);
  }
  if (profile === "execute") {
    return (
      executeSupport.has(tool.operationId) ||
      executePrefixes.some((prefix) => tool.operationId.startsWith(prefix))
    );
  }
  if (profile === "review") {
    return (
      reviewSupport.has(tool.operationId) ||
      tool.operationId === "app-map.list" ||
      tool.operationId === "app-map.get" ||
      tool.operationId.startsWith("app-map.proposal.")
    );
  }
  return (
    definition.category === "system" ||
    definition.category === "workspace" ||
    tool.operationId.startsWith("project.") ||
    tool.operationId.startsWith("build.") ||
    tool.operationId.startsWith("device-pool.") ||
    tool.operationId.startsWith("schedule.") ||
    tool.operationId.startsWith("matrix.") ||
    tool.operationId.startsWith("run.") ||
    tool.operationId === "target.list" ||
    tool.operationId === "target.create" ||
    tool.operationId === "target.delete" ||
    tool.operationId === "target.preflight" ||
    tool.operationId === "generation.create"
  );
}

export function relayMcpToolsForProfile(
  profile: RelayMcpProfile = defaultRelayMcpProfile,
): readonly RelayMcpToolDescriptor[] {
  return Object.freeze(relayMcpTools.filter((tool) => toolInProfile(tool, profile)));
}

export function assertRelayMcpToolParity(
  tools: readonly RelayMcpToolDescriptor[] = relayMcpTools,
): void {
  const expected = operationDefinitions.filter(isToolOperation);
  if (tools.length !== expected.length) {
    throw new Error(
      `MCP tool count mismatch: expected ${expected.length}, received ${tools.length}`,
    );
  }

  const operationIds = new Set<string>();
  const names = new Set<string>();
  for (let index = 0; index < expected.length; index += 1) {
    const definition = expected[index]!;
    const tool = tools[index]!;
    if (tool.operationId !== definition.id) {
      throw new Error(
        `MCP tool order mismatch at ${index}: expected ${definition.id}, received ${tool.operationId}`,
      );
    }
    const expectedName = relayToolName(definition.id);
    if (tool.name !== expectedName) {
      throw new Error(`MCP tool name mismatch for ${definition.id}: expected ${expectedName}`);
    }
    if (operationIds.has(tool.operationId)) {
      throw new Error(`Duplicate MCP operation mapping: ${tool.operationId}`);
    }
    if (names.has(tool.name)) throw new Error(`Duplicate MCP tool name: ${tool.name}`);
    operationIds.add(tool.operationId);
    names.add(tool.name);
  }
}

assertRelayMcpToolParity();
