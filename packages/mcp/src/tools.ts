import { operationDefinitions, type OperationDefinition, type OperationId } from "@relay/protocol";
import * as z from "zod/v4";
type RelayToolInputSchema = z.ZodType<Record<string, unknown>>;

export const relayMcpProfiles = [
  "outcome",
  "control",
  "map",
  "observe",
  "author",
  "test",
  "run",
  "execute",
  "locale",
  "review",
  "admin",
  "proof",
  "full",
] as const;

export type RelayMcpProfile = (typeof relayMcpProfiles)[number];
export const defaultRelayMcpProfile: RelayMcpProfile = "outcome";

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
  {
    operationId: "discovery.promote",
    reason:
      "App Map is truth. Explore proposes edges; Keep accepts them. Direct execution-plan promotion is not an MCP tool.",
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
    " Default JSON is a digest (app, header, controls, nodeCount). Pass full:true for the accessibility tree nodes. The tree may still be missing — screenshot plus a point tap still works. Do not retry snapshot in a loop.",
  "target.scroll-survey.capture":
    " Persist frames with the CLI: relay device survey <serial> --dir <folder>. Do not dump base64 in the tool result. A survey directory is raw capture evidence; use Combine export when a person needs a portable review folder.",
  "target.recover":
    " Repair the runner without rebooting the device. A missing XCTest session is not a failed launch.",
  "step.run":
    " Runs one standalone step only. If it returns terminal: review-needed, capture the current screen from stepReview before any retry; never repeat the command automatically.",
  "lease.create":
    ' Only after TARGET_CONTROL_LEASE_REQUIRED. Pass poolId "local", deviceSerial, and confirm:true. Local trusted servers often mint a lease on first control.',
  "discovery.start":
    " Starts the server-owned explore job. Poll relay_discovery_get. Each identity-changing interact becomes one pending proposal. Do not self-approve.",
  "job.combine.analysis":
    " Read durable findings from the current Combine evidence without writing a pack. Each finding names its source frame; export only when a person needs a portable folder.",
  "job.combine.start":
    " Run a saved Variable × Test Combine. Default is one cell. Pass executionMode all to run every selected world. cell or selectedCellIds names the worlds to queue and those named cells run. A default serial/target fills missing cell bindings. A single Test with in worlds uses app-map.test.run. Never invent a Variable for screenshots.",
  "app-map.test.run":
    " Without `in`: runs one saved Test once (expectedRevision + target are required). With `in`: upserts a Combine for this Test × the selected worlds and runs one cell — pass executionMode:'all' to run every world instead; `cell` or `selectedCellIds` names which. Never invent a Variable for screenshots.",
  "app-map.screen.alias-observe":
    " One-command fix when a run reports an unknown screen in a new locale: navigate the target to that screen first, then approve its observed fingerprint as an alias of the mapped screen. Never replaces the primary fingerprint; repeats deduplicate.",
  "app-map.scroll-surface.origin.inspect":
    " Offline audit only: it reads the signed immutable first PNG/tree evidence and lifecycle; it never resolves, leases, or controls a target.",
  "app-map.scroll-surface.origin.review":
    " Offline authority decision only: inspect first, pass assertion reviewed-document-top and confirm:true. It never captures or controls a target.",
  "app-map.scroll-surface.origin.revoke":
    " Offline authority decision only: pass assertion revoke-reviewed-document-origin and confirm:true. Revocation is durable and blocks compiled execution plans without controlling a target.",
  "app-map.routine.impact":
    " Offline proof-layer read: preview which connections, flows, and sibling routines a Routine change would touch before proposing it. It never controls a target.",
  "run.share.create":
    " Mint one expiring signed link that attaches this run's proof report to a PR. The token is returned once; never echo it in logs or prompts.",
  "run.share.list":
    " Read active, expired, and revoked links for one run before minting a duplicate.",
  "run.share.revoke":
    " Immediately invalidate a signed link. Use when a PR closes or a link leaked.",
};

function toolDescriptor(
  definition: OperationDefinition<Exclude<OperationId, ExcludedOperationId>>,
): RelayMcpToolDescriptor {
  const requiresConfirmation = definition.confirmation !== "none";
  const presentation = Object.hasOwn(definition.input.presentation.shape, "confirmation")
    ? definition.input.presentation.omit({ confirmation: true })
    : definition.input.presentation;
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
    inputSchema: presentation.extend({
      confirm: requiresConfirmation
        ? z.literal(true).describe("Explicit approval for this protected operation")
        : z.literal(true).optional().describe("Optional explicit approval"),
    }),
  });
}

export const relayMcpTools: readonly RelayMcpToolDescriptor[] = Object.freeze(
  operationDefinitions
    .filter((definition) => isToolOperation(definition as OperationDefinition<OperationId>))
    .map((definition) =>
      toolDescriptor(definition as OperationDefinition<Exclude<OperationId, ExcludedOperationId>>),
    ),
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
  "action.run",
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
  "app-map.scroll-surface.origin.inspect",
  "authoring.session.list",
  "authoring.session.get",
  "job.list",
  "job.get",
  "run.list",
  "run.get",
  "run.replay.offline",
  "run.evidence.get",
  "run.trace-pack.get",
  "job.combine.analysis",
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
  "app-map.scroll-surface.origin.inspect",
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
  "discovery.exploration-timeline",
  "target.ground",
  "target.do",
  "app-map.observations.propose",
] as const satisfies readonly OperationId[];

const authorOperations = [
  ...mapOperations,
  "app-map.proposal.submit",
  "app-map.test.propose",
  "workspace.variables.update",
  "app-map.variable.infer",
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
  "app-map.test.run",
  "target.interact",
  "target.recover",
  "app-map.test.compile",
  "app-map.diff.impact",
  "job.get",
  "job.cancel",
  "job.pause",
  "job.resume",
  "run.get",
  "run.replay.offline",
  "run.evidence.get",
  "run.trace-pack.get",
  "run.story.get",
  "app-map.test.from-intent",
  "run.repair.list",
  "run.repair.get",
  "run.repair.retry",
  "run.repair.propose",
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
  "job.combine.campaign.get",
  "job.combine.campaign.resume",
  "job.combine.campaign.cancel",
  "job.combine.analysis",
  "run.list",
  "run.get",
  "run.replay.offline",
  "run.evidence.get",
  "run.trace-pack.get",
  "run.story.get",
  "run.repair.list",
  "run.repair.get",
  "run.repair.retry",
  "run.repair.propose",
] as const satisfies readonly OperationId[];

/**
 * Sweep one app's screens across languages and read what broke.
 *
 * One Language Variable × one graph Test is the canonical campaign. The
 * profile keeps one App Map/Test/Variable authoring path, so an agent cannot
 * accidentally create a second source of truth.
 */
const localeOperations = [
  "system.health.get",
  "system.doctor.get",
  "target.devices.list",
  "target.list",
  "target.screenshot.capture",
  "target.app.launch",
  "target.app.locales",
  "target.snapshot.capture",
  "target.scroll-survey.capture",
  "target.interact",
  "target.recover",
  "lease.list",
  "lease.create",
  "app-map.list",
  "app-map.get",
  "app-map.variable.save",
  "app-map.variable.remove",
  "app-map.test.save",
  "app-map.screen.alias-observe",
  "app-map.variable.infer",
  "app-map.test.edit",
  "app-map.test.propose",
  "app-map.test.compile",
  "app-map.test.run",
  "app-map.combine.save",
  "app-map.combine.preflight",
  "workspace.variables.get",
  "workspace.variables.update",
  "job.combine.start",
  "job.combine.export",
  "job.combine.campaign.get",
  "job.combine.campaign.resume",
  "job.combine.campaign.cancel",
  "job.combine.analysis",
  "job.list",
  "job.get",
  "job.cancel",
  "run.list",
  "run.get",
  "run.replay.offline",
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
  "app-map.scroll-surface.origin.inspect",
  "app-map.scroll-surface.origin.review",
  "app-map.scroll-surface.origin.revoke",
  "app-map.screen.alias-observe",
  "app-map.proposal.approve",
  "app-map.proposal.reject",
  "app-map.proposal.revert",
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
  "run.replay.offline",
  "run.evidence.get",
  "run.trace-pack.get",
  "run.repair.list",
  "run.repair.get",
  "run.repair.propose",
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

/**
 * Relay as the proof layer for AI-written code: verify one change by running
 * the affected flows on real devices, reading the proof report, and turning
 * a failure into a precise digest the coding agent can fix. Read-heavy by
 * design; execution reuses app-map.test.run and job tools.
 */
const proofOperations = [
  "system.health.get",
  "system.doctor.get",
  "target.devices.list",
  "target.list",
  "target.screenshot.capture",
  "lease.list",
  "app-map.list",
  "app-map.get",
  "app-map.test.run",
  "app-map.routine.impact",
  "app-map.diff.impact",
  "job.list",
  "job.get",
  "run.list",
  "run.get",
  "run.replay.offline",
  "run.evidence.get",
  "run.trace-pack.get",
  "run.story.get",
  "run.repair.list",
  "run.repair.get",
  "run.repair.propose",
  "run.share.create",
  "run.share.list",
  "run.share.revoke",
] as const satisfies readonly OperationId[];

const profileOperations: Record<
  Exclude<RelayMcpProfile, "full" | "outcome">,
  ReadonlySet<OperationId>
> = {
  control: new Set(controlOperations),
  map: new Set(mapOperations),
  observe: new Set(observeOperations),
  author: new Set(authorOperations),
  test: new Set(testOperations),
  run: new Set(runOperations),
  execute: new Set(runOperations),
  locale: new Set(localeOperations),
  review: new Set(reviewOperations),
  admin: new Set(adminOperations),
  proof: new Set(proofOperations),
};

function toolInProfile(tool: RelayMcpToolDescriptor, profile: RelayMcpProfile): boolean {
  if (profile === "full") return true;
  if (profile === "outcome") return false;
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
