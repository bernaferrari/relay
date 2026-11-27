import { createOperationManifest } from "./operation/operation-manifest.js";
import { managedFixtureOperationDefinitions } from "./managed-fixture-operation-definitions.js";
import { e2eOperationDefinitions } from "./e2e-operation-definitions.js";
import { authoringOperationDefinitions } from "./authoring/authoring-operation-definitions.js";
import { captureReviewOperationDefinition } from "./capture/capture-review-operation-definition.js";
import { createTargetSupervisorOperationDefinitions } from "./target/target-supervisor-operation-definition.js";
import { createTargetObservationOperationDefinition } from "./target/target-observation-operation-definition.js";
import { appleDeviceOperationDefinitions } from "./apple-device-operation-definitions.js";
import { browserDeviceOperationDefinitions } from "./browser/browser-device-operation-definitions.js";
import { savedSignInOperationDefinitions } from "./sign-in/saved-sign-in-operation-definitions.js";
import { targetDeviceControlOperationDefinitions } from "./target/target-device-control-operation-definitions.js";
import { presenceOperationDefinitions } from "./presence-operation-definitions.js";
import { runRepairOperationDefinitions } from "./run/run-repair-operations.js";
import { runEvidenceOperationDefinitions } from "./run/run-evidence-operation-definitions.js";
import { captureReferenceOperationDefinitions } from "./capture/capture-reference-operations.js";
import { appMapOperationDefinitions } from "./app-map/app-map-operation-definitions.js";
import { createEverydayOperationDefinitions } from "./everyday-operation-definitions.js";
import { campaignCapacityOperationDefinitions } from "./campaign/campaign-capacity-operation-definitions.js";
import { workspaceResourceOperationDefinitions } from "./workspace/workspace-resource-operation-definitions.js";
import { durableOperationDefinitions } from "./durable-operation-definitions.js";
import { scheduleOperationDefinitions } from "./schedule-operation-definitions.js";
import { createDiscoveryOperationDefinitions } from "./discovery-operation-definitions.js";
import { combineOperationDefinitions } from "./combine/combine-operation-definitions.js";
import { workspaceOperationDefinitions } from "./workspace/workspace-operation-definitions.js";
import {
  createSchemaOperationBuilders,
  operationInputContractFromSchema,
  operationOutputContractFromSchema,
} from "./operation/operation-builders.js";
import { validateOperationDefinitions as validateDefinitions } from "./operation/operation-definition-validation.js";
import type { OperationId, OperationInput, OperationOutput } from "./operation/operation-map.js";
import type { OperationDefinition } from "./operation/operation-contract.js";
export {
  projectRoleAllows,
  projectRoles,
  type OperationCategory,
  type OperationConfirmation,
  type OperationDefinition,
  type OperationIdempotency,
  type OperationMode,
  type OperationRecord,
  type OperationTransport,
  type ProjectRole,
} from "./operation/operation-contract.js";
export type {
  ActionSummary,
  DeviceSummary,
  HealthSummary,
  OperationId,
  OperationInput,
  OperationOutput,
  RelayOperationMap,
  StandaloneStepReview,
  StepRunResult,
} from "./operation/operation-map.js";

const { command, query } = createSchemaOperationBuilders();
const discoveryOperationDefinitions = createDiscoveryOperationDefinitions();
const everydayOperationDefinitions = createEverydayOperationDefinitions();
type ExactOperationDefinition = {
  [Id in OperationId]: OperationDefinition<Id, OperationInput<Id>, OperationOutput<Id>>;
}[OperationId];
export const operationDefinitions = [
  query("system.health.get", "Get Relay health", "/health", {
    category: "system",
  }),
  ...everydayOperationDefinitions,
  query("activity.list", "List durable project activity", "/activity", {
    category: "workspace",
    minimumRole: "admin",
  }),
  query("activity.export", "Export project activity", "/activity/export", {
    category: "workspace",
    minimumRole: "admin",
  }),
  query("event.stream", "Stream Relay events", "/events", {
    category: "system",
    mode: "stream",
  }),
  ...presenceOperationDefinitions,
  ...workspaceOperationDefinitions,
  ...appleDeviceOperationDefinitions,
  query("target.actions.list", "List available actions", "/actions", {
    category: "target",
  }),
  query("target.devices.list", "List connected targets", "/devices", {
    category: "target",
  }),
  query("target.avds.list", "List configured Android emulators", "/devices/avds", {
    category: "target",
  }),
  query("target.list", "List managed targets", "/targets", { category: "target" }),
  command("target.create", "Create managed target", "POST", "/targets", {
    category: "target",
    minimumRole: "admin",
  }),
  command("target.delete", "Delete managed target", "DELETE", "/targets/:targetId", {
    category: "target",
    minimumRole: "admin",
  }),
  command("target.preflight", "Check target readiness", "POST", "/targets/:targetId/preflight", {
    category: "target",
    idempotency: "inherent",
  }),
  ...browserDeviceOperationDefinitions,
  ...savedSignInOperationDefinitions,
  ...targetDeviceControlOperationDefinitions,
  command("target.boot", "Boot target", "POST", "/device/boot", { category: "target" }),
  command("target.avd.boot", "Boot a named Android emulator", "POST", "/device/avd/boot", {
    category: "target",
    minimumRole: "runner",
    idempotency: "optional",
  }),
  command("target.authorize", "Authorize target", "POST", "/device/authorize", {
    category: "target",
    confirmation: "confirm",
    minimumRole: "admin",
  }),
  query("target.snapshot.capture", "Capture target structure", "/snapshot", {
    category: "evidence",
    targetCapabilities: ["snapshot"],
    lease: "shared",
  }),
  query("target.screenshot.capture", "Capture target screenshot", "/screenshot", {
    category: "evidence",
    targetCapabilities: ["screenshot"],
    lease: "shared",
  }),
  createTargetObservationOperationDefinition(),
  ...createTargetSupervisorOperationDefinitions(),
  command(
    "target.scroll-survey.capture",
    "Capture a bounded scrollable-page survey",
    "POST",
    "/capture/scroll-survey",
    {
      category: "target",
      targetCapabilities: ["scroll", "snapshot", "screenshot"],
      lease: "exclusive",
      progress: false,
      cancellable: false,
    },
  ),
  command("target.app.launch", "Launch app on target", "POST", "/device/app/launch", {
    category: "target",
    targetCapabilities: ["launch"],
    lease: "exclusive",
    idempotency: "inherent",
  }),
  query("target.app.locales", "List app-declared locales", "/device/app/locales", {
    category: "target",
    targetCapabilities: ["snapshot"],
    lease: "shared",
  }),
  query("target.app.list", "List installed apps", "/device/apps", {
    category: "target",
    targetCapabilities: ["snapshot"],
    lease: "shared",
  }),
  command("target.app.locale.set", "Set an app's per-app locale", "POST", "/device/app/locale", {
    category: "target",
    targetCapabilities: ["snapshot"],
    lease: "exclusive",
    idempotency: "inherent",
  }),
  command("target.recover", "Repair target connection", "POST", "/device/recover", {
    category: "target",
    targetCapabilities: ["snapshot", "tap"],
    lease: "exclusive",
    idempotency: "inherent",
  }),
  command("target.interact", "Interact with target", "POST", "/interact", {
    category: "target",
    targetCapabilities: ["tap"],
    lease: "exclusive",
  }),
  command("target.ground", "Ground a text or structured target", "POST", "/ground", {
    category: "target",
    targetCapabilities: ["snapshot", "screenshot"],
    lease: "shared",
  }),
  command("target.do", "Ground a text target then interact", "POST", "/do", {
    category: "target",
    targetCapabilities: ["tap", "snapshot", "screenshot"],
    lease: "exclusive",
  }),
  query("target.ui.describe", "Describe target UI context", "/target/ui", {
    category: "target",
    targetCapabilities: ["snapshot"],
    lease: "shared",
  }),
  command("target.ui.back", "Sheet-aware back / dismiss toward parent", "POST", "/target/ui/back", {
    category: "target",
    targetCapabilities: ["tap"],
    lease: "exclusive",
  }),
  command(
    "target.ui.scrollCollect",
    "Scroll list and collect interactive controls",
    "POST",
    "/target/ui/scroll-collect",
    {
      category: "target",
      targetCapabilities: ["scroll", "snapshot"],
      lease: "exclusive",
    },
  ),
  command("target.touch", "Send target touch", "POST", "/device/touch", {
    category: "target",
    targetCapabilities: ["tap"],
    lease: "exclusive",
  }),
  command("target.key", "Send target key", "POST", "/device/key", {
    category: "target",
    targetCapabilities: ["type"],
    lease: "exclusive",
  }),
  command("target.scroll", "Scroll target", "POST", "/device/scroll", {
    category: "target",
    targetCapabilities: ["scroll"],
    lease: "exclusive",
  }),
  command("target.video.start", "Start target video", "POST", "/device/video", {
    category: "evidence",
    minimumRole: "runner",
    targetCapabilities: ["recording"],
    lease: "shared",
  }),
  query("target.stream.open", "Stream live target video", "/device/stream", {
    category: "target",
    mode: "stream",
    targetCapabilities: ["observe"],
    lease: "shared",
  }),
  ...workspaceResourceOperationDefinitions,
  query("target-worker.list", "List target workers", "/target-workers", {
    category: "target",
  }),
  ...campaignCapacityOperationDefinitions,
  query("lease.list", "List target leases", "/device-leases", {}),
  command("lease.create", "Lease target", "POST", "/device-leases", {
    confirmation: "confirm",
  }),
  command("lease.takeover", "Take over target lease", "POST", "/device-leases/:leaseId/takeover", {
    confirmation: "dangerous",
  }),
  command("lease.release", "Release target lease", "POST", "/device-leases/:leaseId/release", {}),
  command("action.run", "Run action and wait", "POST", "/actions/:actionId/run", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  query("workspace.variables.get", "Get project variables", "/project/variables", {}),
  command(
    "workspace.variables.update",
    "Update project variables",
    "PUT",
    "/project/variables",
    {},
  ),
  ...appMapOperationDefinitions,
  ...authoringOperationDefinitions,
  ...scheduleOperationDefinitions,
  ...managedFixtureOperationDefinitions,
  ...e2eOperationDefinitions,
  ...discoveryOperationDefinitions,
  query("job.list", "List jobs", "/jobs", { category: "execution" }),
  query("job.get", "Get job", "/jobs/:jobId", { category: "execution" }),
  ...durableOperationDefinitions,
  command("job.start", "Start job", "POST", "/jobs", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  command("job.retry", "Retry job", "POST", "/jobs/:jobId/retry", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  command("run.replay", "Replay recorded run", "POST", "/runs/:runId/replay", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  command("job.cancel", "Cancel job", "POST", "/jobs/:jobId/cancel", {
    category: "execution",
    idempotency: "inherent",
  }),
  command("job.pause", "Pause job", "POST", "/jobs/:jobId/pause", {
    category: "execution",
    idempotency: "inherent",
  }),
  command("job.resume", "Resume job", "POST", "/jobs/:jobId/resume", {
    category: "execution",
    idempotency: "inherent",
  }),
  command("job.active.cancel", "Cancel active job", "POST", "/jobs/active/cancel", {
    category: "execution",
    idempotency: "inherent",
  }),
  command("job.matrix.start", "Run job matrix", "POST", "/jobs/matrix", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  ...combineOperationDefinitions,
  command(
    "job.compatibility-matrix.start",
    "Run compatibility matrix",
    "POST",
    "/jobs/compatibility-matrix",
    {
      category: "execution",
      progress: true,
      cancellable: true,
    },
  ),
  command("job.soak.start", "Start soak run", "POST", "/jobs/soak", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  query("run.list", "List Runs", "/runs", {
    category: "execution",
  }),
  query("run.get", "Get Run", "/runs/:runId", {
    category: "evidence",
  }),
  query("run.replay.offline", "Replay Run Offline", "/runs/:runId/replay-offline", {
    category: "evidence",
  }),
  ...runRepairOperationDefinitions,
  command("run.review", "Review a deferred run check", "POST", "/runs/:runId/review", {
    category: "evidence",
    confirmation: "confirm",
  }),
  query("run.evidence.get", "Get Run Evidence", "/runs/:runId/evidence", {
    category: "evidence",
  }),
  query("run.story.get", "Get Run story", "/runs/:runId/story", {
    category: "evidence",
  }),
  ...runEvidenceOperationDefinitions,
  ...captureReferenceOperationDefinitions,
  command("run.catalog.rebuild", "Rebuild Run catalog", "POST", "/runs/catalog/rebuild", {
    category: "execution",
    confirmation: "confirm",
  }),
  command("run.retention.apply", "Apply Run retention", "POST", "/runs/retention", {
    category: "execution",
    confirmation: "dangerous",
  }),
  command(
    "run.visual-baseline.update",
    "Explicitly approve visual baseline",
    "POST",
    "/runs/:runId/visual-baseline",
    {
      category: "evidence",
      confirmation: "confirm",
    },
  ),
  command(
    "run.visual.compare",
    "Compare Run with approved visual baseline",
    "POST",
    "/runs/:runId/visual-comparison",
    {
      category: "evidence",
    },
  ),
  command("run.visual.review", "Review visual comparison", "POST", "/runs/:runId/visual-review", {
    category: "evidence",
    confirmation: "confirm",
  }),
  captureReviewOperationDefinition,
  query("run.visual-policy.get", "Get visual comparison policy", "/runs/:runId/visual-policy", {
    category: "evidence",
  }),
  command(
    "run.visual-policy.update",
    "Update visual comparison policy",
    "PUT",
    "/runs/:runId/visual-policy",
    {
      category: "evidence",
      confirmation: "confirm",
    },
  ),
  command("run.pin.update", "Pin Run", "POST", "/runs/:runId/pin", { category: "execution" }),
  command("step.run", "Run one execution step", "POST", "/step/run", {
    category: "execution",
    targetCapabilities: ["snapshot", "tap", "type", "scroll"],
    lease: "exclusive",
    progress: true,
    cancellable: true,
  }),
  command("generation.create", "Generate test data", "POST", "/generate", {
    category: "authoring",
  }),
] as const satisfies readonly ExactOperationDefinition[];

const operationDefinitionById = new Map(
  operationDefinitions.map((definition) => [definition.id, definition] as const),
);

export function operationDefinition<Id extends OperationId>(
  id: Id,
): OperationDefinition<Id, OperationInput<Id>, OperationOutput<Id>> {
  const definition = operationDefinitionById.get(id);
  if (!definition) throw new Error(`Unknown operation: ${id}`);
  return {
    ...definition,
    id,
    input: operationInputContractFromSchema(id),
    output: operationOutputContractFromSchema(id),
  };
}

export function validateOperationDefinitions(
  definitions: readonly OperationDefinition[] = operationDefinitions,
): void {
  validateDefinitions(definitions);
}

export type { OperationManifestItem } from "./operation/operation-manifest.js";
export function operationManifest(
  definitions: readonly OperationDefinition[] = operationDefinitions,
) {
  return createOperationManifest(definitions);
}
