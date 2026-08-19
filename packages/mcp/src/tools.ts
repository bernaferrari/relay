import { operationDefinitions, type OperationDefinition, type OperationId } from "@relay/protocol";
import { relayToolInputSchema, type RelayToolInputSchema } from "./input-schemas.js";

export const relayMcpProfiles = [
  "control",
  "map",
  "observe",
  "author",
  "test",
  "run",
  "execute",
  "review",
  "admin",
  "full",
] as const;

export type RelayMcpProfile = (typeof relayMcpProfiles)[number];
export const defaultRelayMcpProfile: RelayMcpProfile = "control";

export const relayMcpExclusions = [
  {
    operationId: "event.stream",
    reason: "Relay event streams are resource-only and are not exposed as MCP tools.",
  },
  {
    operationId: "target.stream.open",
    reason: "Live target video is a media stream, not an MCP tool.",
  },
  {
    operationId: "activity.export",
    reason:
      "Complete project activity can be multi-megabyte; export it as an app or CLI artifact instead of returning it inline to an agent.",
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
  {
    operationId: "discovery.promote",
    reason:
      "App Map is truth. Explore proposes edges; Keep accepts them. YAML recipe promote is not an MCP tool.",
  },
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

const extraGuidance: Partial<Record<OperationId, string>> = {
  "target.screenshot.capture":
    " Step 1 of a tap: capture pixels, then call interact. Do not retry snapshot in a loop if the tree is missing.",
  "target.interact":
    " Step 2 of a tap: after screenshot or snapshot, send one interaction. Prefer identifier, then label, then text, then point. Use preview:true to mark without committing. Huge SwiftUI cells are often not hittable — tap the label. If pixels do not change, it is a dead cell, not a new screen.",
  "target.ground":
    " Resolve text (or InteractInput) to a tap without committing. Order: unique a11y label/id → Grok Menu/Private heuristics → optional OpenRouter vision. On miss, returns candidates — never relaunches the app.",
  "target.do":
    " Ground then interact in one call. Prefer this for NL taps (Menu, Appearance). Requires exclusive lease.",
  "target.snapshot.capture":
    " Step 1 of a tap when you need identifiers or labels. The accessibility tree may be missing. Screenshot plus a point tap still works. Do not retry snapshot in a loop.",
  "target.recover":
    " Repair the runner without rebooting the device. A missing XCTest session is not a failed launch.",
  "lease.create":
    ' Only after TARGET_CONTROL_LEASE_REQUIRED. Pass poolId "local", deviceSerial, and confirm:true. Local trusted servers often mint a lease on first control.',
  "discovery.start":
    " Starts the server-owned explore job. Poll relay_discovery_get. Each identity-changing interact becomes one pending proposal. Do not self-approve.",
};

function toolDescriptor(
  definition: OperationDefinition<Exclude<OperationId, ExcludedOperationId>>,
): RelayMcpToolDescriptor {
  const requiresConfirmation = definition.confirmation !== "none";
  const requirements = [
    `Project role: ${definition.minimumRole}.`,
    definition.targetCapabilities.length
      ? `Target capabilities: ${definition.targetCapabilities.join(", ")}.`
      : "",
    definition.lease !== "none" ? `Lease: ${definition.lease}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const guidance = extraGuidance[definition.id] ?? "";
  return Object.freeze({
    name: relayToolName(definition.id),
    operationId: definition.id,
    title: definition.label,
    description: `${definition.label}. Pass operation fields directly.${requirements ? ` ${requirements}` : ""}${guidance}${requiresConfirmation ? " Requires confirm: true." : ""}`,
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

const controlOperations = [
  "system.health.get",
  "system.doctor.get",
  "target.devices.list",
  "target.list",
  "target.snapshot.capture",
  "target.screenshot.capture",
  "target.interact",
  "target.ground",
  "target.do",
  "target.recover",
  "target.app.launch",
  "target.ui.describe",
  "lease.list",
  "lease.create",
  "lease.release",
] as const satisfies readonly OperationId[];

const observeOperations = [
  "system.health.get",
  "system.doctor.get",
  "target.devices.list",
  "target.list",
  "target.snapshot.capture",
  "target.screenshot.capture",
  "lease.list",
  "workspace.variables.get",
  "app-map.list",
  "app-map.get",
  "authoring.session.list",
  "authoring.session.get",
  "job.list",
  "job.get",
  "run.list",
  "run.get",
  "run.evidence.get",
] as const satisfies readonly OperationId[];

const mapOperations = [
  "system.health.get",
  "system.doctor.get",
  "target.devices.list",
  "target.list",
  "target.preflight",
  "target.snapshot.capture",
  "target.screenshot.capture",
  "lease.list",
  "lease.create",
  "app-map.list",
  "app-map.get",
  "authoring.session.list",
  "authoring.session.get",
  "discovery.create",
  "discovery.get",
  "discovery.start",
  "discovery.cancel",
  "discovery.here",
  "discovery.do",
  "discovery.suggestion",
  "discovery.coverage",
  "discovery.journey",
  "target.ground",
  "target.do",
  "app-map.observations.propose",
] as const satisfies readonly OperationId[];

const authorOperations = [
  ...mapOperations,
  "app-map.proposal.submit",
  "app-map.test.propose",
  "workspace.variables.update",
  "authoring.session.create",
  "authoring.session.observe",
  "authoring.session.capture",
  "authoring.session.start",
  "authoring.session.interact",
  "authoring.session.stop",
  "authoring.take.trim",
  "authoring.take.reorder",
  "authoring.take.replace",
  "authoring.take.replay",
  "authoring.session.commit",
  "authoring.session.discard",
] as const satisfies readonly OperationId[];

const testOperations = [
  "system.health.get",
  "system.doctor.get",
  "target.devices.list",
  "target.list",
  "target.preflight",
  "target.snapshot.capture",
  "target.screenshot.capture",
  "lease.list",
  "lease.create",
  "app-map.list",
  "app-map.get",
  "app-map.test.save",
  "app-map.test.edit",
  "app-map.test.propose",
  "app-map.test.compile",
  "app-map.test.run",
  "target.interact",
  "target.recover",
  "job.list",
  "job.get",
  "job.cancel",
  "job.pause",
  "job.resume",
  "run.get",
  "run.evidence.get",
  "run.story.get",
  "app-map.test.from-intent",
  "run.repair.list",
  "run.repair.get",
  "run.repair.retry",
] as const satisfies readonly OperationId[];

const runOperations = [
  "system.health.get",
  "system.doctor.get",
  "target.devices.list",
  "target.list",
  "target.preflight",
  "target.screenshot.capture",
  "target.interact",
  "target.recover",
  "lease.list",
  "lease.create",
  "app-map.list",
  "app-map.get",
  "app-map.test.run",
  "app-map.combine.preflight",
  "app-map.combine.save",
  "job.list",
  "job.get",
  "job.start",
  "job.retry",
  "job.cancel",
  "job.pause",
  "job.resume",
  "job.combine.start",
  "job.combine.export",
  "run.list",
  "run.get",
  "run.evidence.get",
  "run.story.get",
  "run.repair.list",
  "run.repair.get",
  "run.repair.retry",
] as const satisfies readonly OperationId[];

const reviewOperations = [
  "system.health.get",
  "target.devices.list",
  "target.snapshot.capture",
  "target.screenshot.capture",
  "lease.list",
  "lease.create",
  "lease.release",
  "app-map.list",
  "app-map.get",
  "app-map.proposal.approve",
  "app-map.proposal.reject",
  "authoring.session.list",
  "authoring.session.get",
  "authoring.take.trim",
  "authoring.take.reorder",
  "authoring.take.replace",
  "authoring.take.replay",
  "authoring.session.commit",
  "authoring.session.discard",
  "job.list",
  "job.get",
  "run.list",
  "run.get",
  "run.evidence.get",
  "run.repair.list",
  "run.repair.get",
  "run.review",
  "run.visual.compare",
  "run.visual-baseline.update",
  "run.visual.review",
  "run.pin.update",
] as const satisfies readonly OperationId[];

const adminOperations = [
  "system.health.get",
  "system.doctor.get",
  "system.audit.list",
  "activity.list",
  "workspace.privacy.get",
  "workspace.privacy.update",
  "workspace.evidence.get",
  "workspace.evidence.update",
  "project.list",
  "project.save",
  "target.list",
  "target.create",
  "target.delete",
  "build.list",
  "build.save",
  "build.preflight",
  "device-pool.list",
  "device-pool.save",
  "device-pool.preflight",
  "target-worker.list",
  "schedule.list",
  "schedule.create",
  "schedule.delete",
  "run.retention.apply",
] as const satisfies readonly OperationId[];

const profileOperations: Record<Exclude<RelayMcpProfile, "full">, ReadonlySet<OperationId>> = {
  control: new Set(controlOperations),
  map: new Set(mapOperations),
  observe: new Set(observeOperations),
  author: new Set(authorOperations),
  test: new Set(testOperations),
  run: new Set(runOperations),
  execute: new Set(runOperations),
  review: new Set(reviewOperations),
  admin: new Set(adminOperations),
};

function toolInProfile(tool: RelayMcpToolDescriptor, profile: RelayMcpProfile): boolean {
  if (profile === "full") return true;
  return profileOperations[profile].has(tool.operationId);
}

export function relayMcpToolsForProfile(
  profile: RelayMcpProfile = defaultRelayMcpProfile,
): readonly RelayMcpToolDescriptor[] {
  return Object.freeze(relayMcpTools.filter((tool) => toolInProfile(tool, profile)));
}

export type RelayMcpOperationCatalogEntry = {
  readonly operationId: RelayMcpToolDescriptor["operationId"];
  readonly task: OperationDefinition<OperationId>["category"];
  readonly role: OperationDefinition<OperationId>["minimumRole"];
  readonly confirmation: OperationDefinition<OperationId>["confirmation"];
  readonly capabilities?: readonly string[];
  readonly profiles: readonly RelayMcpProfile[];
};

/** Compact discovery metadata for agents that need to move beyond their task profile. */
export function relayMcpOperationCatalog(): readonly RelayMcpOperationCatalogEntry[] {
  return Object.freeze(
    relayMcpTools.map((tool) => {
      const definition = operationDefinitions.find(({ id }) => id === tool.operationId)!;
      const profiles = relayMcpProfiles.filter(
        (profile) => profile !== "full" && toolInProfile(tool, profile),
      );
      return Object.freeze({
        operationId: tool.operationId,
        task: definition.category,
        role: definition.minimumRole,
        confirmation: definition.confirmation,
        ...(definition.targetCapabilities.length
          ? { capabilities: definition.targetCapabilities }
          : {}),
        profiles,
      });
    }),
  );
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
