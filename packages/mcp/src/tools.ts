import { operationDefinitions, type OperationDefinition, type OperationId } from "@relay/protocol";
import * as z from "zod/v4";
type RelayToolInputSchema = z.ZodType<Record<string, unknown>>;

/** qa: write, run and read Tests. device: qa plus live device control and
 * recording. full: device plus every raw operation. */
export const relayMcpProfiles = ["qa", "device", "full"] as const;

export type RelayMcpProfile = (typeof relayMcpProfiles)[number];
export const defaultRelayMcpProfile: RelayMcpProfile = "qa";

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
    operationId: "target.browser-device.frame-binary",
    reason: "Browser Device binary frames are renderer media transport, not an MCP tool.",
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
    " Happy path 1/3: capture pixels, then interact, then screenshot again. iOS 17+ pixels need go-ios tunnel, not target.open. A missing XCTest session is not a failed screenshot. For a requested saved Test, run it directly; this observation loop is for manual control. Do not retry snapshot in a loop if the tree is missing.",
  "target.interact":
    " Happy path 2/3: after screenshot, send one interaction. Prefer identifier, then label, then text, then point. Use preview:true to mark without committing (returns a PNG image, not JSON). Huge SwiftUI cells are often not hittable — tap the label. If pixels do not change, it is a dead cell, not a new screen. A missing XCTest runner is not a reason to retry a point tap — Relay taps via pixels (CoreDevice HID). Recover only for identifier/label. A requested saved Test can start directly with app-map.test.run.",
  "target.ground":
    " Resolve text (or InteractInput) to a tap without committing. Order: unique a11y label/id → common menu heuristics → optional OpenRouter vision. On miss, returns candidates — never relaunches the app.",
  "target.do":
    " Ground then interact in one call. Prefer this for NL taps (Menu, Appearance). Requires exclusive lease.",
  "target.snapshot.capture":
    " Default JSON is a digest (app, header, controls, nodeCount, fingerprint). Missing trees still return pixel identity (visualFingerprint/proposedRows/app/header when visual identity or last launch can name them). Pass visual:false to skip that one-shot PNG. Pass full:true for nodes. Pass laneId for a saved sign-in/browser; without it a browser snapshot is signed out. Screenshot plus a point tap uses pixels (HID), not XCTest. Do not retry snapshot or the tap because the runner is down. Do not retry snapshot in a loop.",
  "target.devices.list":
    " Omit phase to list iOS, Android, and browsers. phase is an optional android|ios filter, not a required platform.",
  "target.scroll-survey.capture":
    " Not a first poke. Pass dir on this call to persist frames once (force overwrites a non-empty folder). The tool result is a digest without base64. A survey directory is raw capture evidence; use Plan export when a person needs a portable review folder.",
  "target.app.launch":
    " Launch is not the same as foreground. The result includes observed.app and observed.matched so a bounce (Chrome → Settings) is visible.",
  "target.recover":
    " Not a first poke and not a wait loop. Adopt a healthy live XCTest runner; do not kill it and do not reboot. Restores a dead go-ios userspace tunnel on the same recover — do not shell `ios tunnel start`. A missing XCTest session is not a failed launch.",
  "target.browser-auth.save":
    " Human-only. Open the managed Browser Device, complete sign-in or MFA, and review the current account before saving. Relay returns only non-secret metadata and an exact encrypted fixture reference.",
  "target.browser-auth.list":
    " Read-only metadata. Credentials, cookies, and local storage are never returned through MCP or evidence.",
  "target.browser-auth.revoke":
    " Human-only. Revocation is permanent for the exact fixture revision and future Proof runs fail closed.",
  "target.browser-auth.probe":
    " Opens a fresh proof browser with the encrypted sign-in. Signed-out or expired fixtures need Refresh before the next Plan. Does not accept visual baselines.",
  "step.run":
    " Runs one standalone step only. If it returns terminal: review-needed, capture the current screen from stepReview before any retry; never repeat the command automatically.",
  "lease.create":
    ' Only after TARGET_CONTROL_LEASE_REQUIRED. Pass poolId "local", deviceSerial, and confirm:true. Local trusted servers often mint a lease on first control.',
  "discovery.start":
    " Starts the server-owned explore job. Poll relay_discovery_get. Each identity-changing interact becomes one pending proposal. Do not self-approve.",
  "job.combine.analysis":
    " Read durable Plan findings without writing a pack. Each finding names its source frame; export only when a person needs a portable folder.",
  "job.combine.capture.review":
    " Aggregate screenshot review across one Plan. Filter with pending, screen, device, or account; coverage counts stay planned/captured/blocked + accepted/issue/pending. Missing stays in the denominator. Accept as reference explicitly governs later Runs.",
  "job.combine.capture.review.apply":
    " Human-only bulk screenshot review for exact selected Plan items. Bind runId, captureId, and image hash. Never accepts future arrivals, missing frames, or items hidden by pending/screen/device/account filters. Accept as reference explicitly governs later Runs.",
  "job.combine.start":
    " Run a saved Plan. Default is one cell. Pass executionMode all to run every selected world. Missing extra sign-ins or devices fail closed as Infra columns, not a smaller Plan. cell or selectedCellIds names the worlds to queue. A default serial/target fills missing cell bindings. A single Test with in worlds uses app-map.test.run. Never invent a Variable for screenshots.",
  "app-map.test.edit":
    " Semantic edits include test.patch.requirementAction: capture-view | test-action. MCP can author the same dest-end contract as CLI. capture-view may reuse the screen a previous Test left open; omitted dest-end stays test-action.",
  "app-map.test.run":
    " Run a requested saved Test directly on its selected target. Without `in`: runs one saved Test once (expectedRevision + target are required). Compiled wait-for/expect-screen check their authored condition within its timeout; inspect retained evidence on failure. With `in`: upserts a Combine for this Test × the selected worlds and runs one cell — pass executionMode:'all' to run every world instead; `cell` or `selectedCellIds` names which. Never invent a Variable for screenshots.",
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
  "proof.prepare":
    " Prepare or resume one reviewable Proof from the server's current repository change and reviewed .relay/change-proof.json. Relay resolves the exact Git revision, App Map revisions, builds, targets, and cells; never supply a head SHA, cells, or verdict.",
  "proof.start":
    " Start one versioned Proof for an exact source change, builds, Verification Plan, and policy. Keep the returned proof id and version for every later lifecycle call.",
  "proof.list":
    " List the project's change-level Proof records. Filter by state when narrowing review work.",
  "proof.inspect":
    " Inspect one Proof and optionally its bounded immutable lifecycle history before deciding the next action.",
  "proof.plan.approve":
    " Approve the Proof's frozen Verification Plan as a human reviewer. Approval is human-only and requires explicit confirm: true.",
  "proof.run.confirm":
    " Issue one short-lived, durable confirmation receipt for the exact reviewed guarded or destructive Proof Cell. This requires a human actor and the digest returned by proof.inspect.",
  "proof.run":
    " Run or resume an approved Proof through the server-owned coordinator. Relay persists progress, survives client disconnects, and returns one bounded execution summary instead of exposing campaign or job choreography.",
  "proof.run.human-evidence":
    " Record a bounded screenshot, snapshot, or video attachment for the exact paused human-only Proof step and resume its durable execution. The server persists and hashes the attachment; a legacy evidence digest remains accepted for backward compatibility. This requires a human actor and exact execution/cell/step identities.",
  "proof.continue":
    " Continue one Proof with an exact version and one bounded plan action: revise the plan, request review, or return to planning.",
  "proof.cancel":
    " Cancel one Proof with an exact version and reason. This is durable and requires explicit confirm: true.",
  "proof.publication.retry":
    " Reconcile or grant one additional delivery attempt for an exhausted merge check. Inspect the Proof first, pass the exact publication id and immutable Proof version, and explicitly confirm. Relay preserves the provider check identity and prior receipts.",
  "proof.rerun-affected":
    " Create a replacement Proof for the affected verification scope after a change. Preserve the prior Proof and pass its exact version.",
};

/** Operations whose last word deletes, discards or stops something. */
const destructiveVerb = /\.(?:delete|remove|discard|cancel|revoke|clear)$/u;

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
        definition.confirmation === "dangerous" ||
        definition.transport.method === "DELETE" ||
        destructiveVerb.test(definition.id),
      idempotentHint:
        definition.idempotency === "inherent" || definition.idempotency === "required",
      openWorldHint: false,
    }),
    requiresConfirmation,
    // A few canonical inputs carry cross-field fail-closed refinements (for
    // example, attachment XOR legacy digest). Zod requires safeExtend to keep
    // those checks when MCP adds its transport-level confirmation field.
    inputSchema: presentation.safeExtend({
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

/** Read tools the qa profile names plainly. Each is one existing operation
 * under a friendlier name; full hides the raw duplicate. */
const qaOperationAliases = [
  {
    name: "relay_list_apps",
    operationId: "app-map.list",
    title: "List Apps",
    description: "List the Apps in this project with their ids and names.",
  },
  {
    name: "relay_list_runs",
    operationId: "run.list",
    title: "List Runs",
    description: "List recent Runs, newest first, with their status and Test.",
  },
  {
    name: "relay_get_test",
    operationId: "test.yaml.get",
    title: "Read a Test",
    description:
      "Read one saved Test as its test file (name, url or app, steps). Edit it and pass it back to relay_create_test to update the Test.",
  },
  {
    name: "relay_health",
    operationId: "system.doctor.get",
    title: "Check Relay",
    description:
      "Check that Relay is running and ready on this computer: the server, devices, browsers and model key. Call it first when something does not work.",
  },
] as const satisfies readonly {
  name: `relay_${string}`;
  operationId: Exclude<OperationId, ExcludedOperationId>;
  title: string;
  description: string;
}[];

export const relayQaOperationTools: readonly RelayMcpToolDescriptor[] = Object.freeze(
  qaOperationAliases.map(({ name, operationId, title, description }) => {
    const raw = relayMcpTools.find((tool) => tool.operationId === operationId)!;
    return Object.freeze({ ...raw, name, title, description });
  }),
);

/** Raw operations a named tool already covers: create/run/verdict loop and
 * the qa read aliases. full lists each capability once. */
const wrappedOperations = new Set<OperationId>([
  "test.create-from-goal",
  "test.apply-yaml",
  "run.verdict.get",
  ...qaOperationAliases.map(({ operationId }) => operationId),
]);

/** Raw operation tools for a profile. qa and device expose only named tools. */
export function relayMcpToolsForProfile(
  profile: RelayMcpProfile = defaultRelayMcpProfile,
): readonly RelayMcpToolDescriptor[] {
  if (profile !== "full") return Object.freeze([]);
  return Object.freeze(relayMcpTools.filter((tool) => !wrappedOperations.has(tool.operationId)));
}

/** Old profile names keep working: live control maps to device, the rest to full. */
const legacyProfiles: Readonly<Record<string, RelayMcpProfile>> = {
  operator: "device",
  outcome: "device",
  control: "device",
  observe: "device",
  map: "full",
  author: "full",
  test: "full",
  run: "full",
  locale: "full",
  review: "full",
  admin: "full",
  proof: "full",
};

export function resolveRelayMcpProfile(
  value: string,
  warn: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): RelayMcpProfile {
  if ((relayMcpProfiles as readonly string[]).includes(value)) return value as RelayMcpProfile;
  const legacy = Object.hasOwn(legacyProfiles, value) ? legacyProfiles[value] : undefined;
  if (!legacy) throw new TypeError(`--profile must be one of: ${relayMcpProfiles.join(", ")}`);
  warn(`relay-mcp: profile "${value}" was removed; using "${legacy}".`);
  return legacy;
}

export type RelayMcpOperationCatalogEntry = {
  readonly operationId: RelayMcpToolDescriptor["operationId"];
  readonly task: OperationDefinition<OperationId>["category"];
  readonly role: OperationDefinition<OperationId>["minimumRole"];
  readonly confirmation: OperationDefinition<OperationId>["confirmation"];
  readonly capabilities?: readonly string[];
  readonly profiles: readonly RelayMcpProfile[];
};

/** Compact discovery metadata: which profiles can reach each operation. */
export function relayMcpOperationCatalog(): readonly RelayMcpOperationCatalogEntry[] {
  return Object.freeze(
    relayMcpTools.map((tool) => {
      const definition = operationDefinitions.find(({ id }) => id === tool.operationId)!;
      return Object.freeze({
        operationId: tool.operationId,
        task: definition.category,
        role: definition.minimumRole,
        confirmation: definition.confirmation,
        ...(definition.targetCapabilities.length
          ? { capabilities: definition.targetCapabilities }
          : {}),
        profiles: wrappedOperations.has(tool.operationId) ? relayMcpProfiles : ["full" as const],
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
