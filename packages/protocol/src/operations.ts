import { replayRunInputParser, runIdInputParser } from "./run-replay-operation-parser.js";
import { createAuthoringSessionParser } from "./authoring-session-operation-parser.js";
import {
  captureReviewInputParser,
  captureReviewOutputParser,
} from "./capture-review-operation-parser.js";
import { assertTargetRuntimeReadiness } from "./target-runtime-readiness-parser.js";
import { targetDevicesInputParser } from "./target-inventory-input-parser.js";
import {
  authoringInteractionParser,
  authoringSessionListInputParser,
  authoringSessionListParser,
  authoringSessionRefParser,
  authoringSessionResponseParser,
  commitAuthoringSessionParser,
  reorderAuthoringTakeParser,
  replaceAuthoringActionParser,
  trimAuthoringTakeParser,
} from "./authoring-interaction-parsers.js";
import { assertIosSessionOperationLifecycle } from "./ios-session-lifecycle.js";
import { isExecutionTargetRef } from "./execution-target.js";
import { createTargetRecoveryOperationParsers } from "./target-recovery-operation-parsers.js";
import { createTargetCaptureOperationParsers } from "./target-capture-operation-parsers.js";
import { runsParser, runListInputParser } from "./run-list-operation-parser.js";
import { createTargetSupervisorOperationDefinitions } from "./target-supervisor-operation-definition.js";
import * as authoringOperations from "./authoring-raw-optimization-operation.js";
import { appleDeviceOperationDefinitions } from "./apple-device-operation-definitions.js";
import { browserDeviceOperationDefinitions } from "./browser-device-operation-definitions.js";
import { runRepairOperationDefinitions } from "./run-repair-operations.js";
import { runEvidenceOperationDefinitions } from "./run-evidence-operation-definitions.js";
import { captureReferenceOperationDefinitions } from "./capture-reference-operations.js";
import { parseActivityExportResponse, type ActivityExport } from "./activity.js";
import { createAppMapOperationDefinitions } from "./app-map-operation-definitions.js";
import { campaignCapacityOperationDefinitions } from "./campaign-capacity-operation-definitions.js";
import { workspaceResourceOperationDefinitions } from "./workspace-resource-operation-definitions.js";
import { durableOperationDefinitions } from "./durable-operation-definitions.js";
import { scheduleOperationDefinitions } from "./schedule-operation-definitions.js";
import { createDiscoveryOperationDefinitions } from "./discovery-operation-definitions.js";
import { combineOperationDefinitions } from "./combine-operation-definitions.js";
import { workspaceOperationDefinitions } from "./workspace-operation-definitions.js";
import { createOperationBuilders } from "./operation-builders.js";
import { runEvidenceInputParser } from "./run-evidence-operation-parser.js";
import { validateOperationDefinitions as validateDefinitions } from "./operation-definition-validation.js";
import type {
  ActionSummary,
  DeviceSummary,
  AndroidAvdBootResult,
  AndroidAvdInventory,
  GenerationRequestDto,
  GenerationResultDto,
  HealthSummary,
  IosMutationAttemptDiagnosticDto,
  OperationId,
  OperationInput,
  OperationOutput,
  RelayOperationMap,
  RevisionedDto,
  TestDataDto,
} from "./operation-map.js";
import {
  projectRoles,
  type OperationDefinition,
  type OperationRecord,
  type ProjectRole,
  type RuntimeParser,
} from "./operation-contract.js";
import {
  arrayFieldParser,
  boolean,
  emptyInputParser,
  fail,
  number,
  objectFieldParser,
  objectParser,
  record,
  string,
} from "./operation-parser-primitives.js";
import { VISUAL_REVIEW_ACTIONS } from "./visual-verification.js";
import { assertIosMutationAttemptDiagnostic } from "./ios-mutation-attempt-parser.js";
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
  type RuntimeParser,
} from "./operation-contract.js";
export type {
  ActionSummary,
  DeviceSummary,
  HealthSummary,
  IosMutationAttemptDiagnosticDto,
  OperationId,
  OperationInput,
  OperationOutput,
  RelayOperationMap,
  StandaloneStepReview,
  StepRunResult,
} from "./operation-map.js";

const okParser = objectParser<{ ok: true }>("success response", (input) => {
  if (input.ok !== true) fail("success response ok", "must be true");
});

const healthParser = objectParser<HealthSummary>("health response", (input) => {
  boolean(input.ok, "health ok");
  string(input.product, "health product");
  string(input.version, "health version");
  number(input.at, "health at");
  number(input.uptimeMs, "health uptimeMs");
  if (input.access !== undefined) {
    const access = record(input.access, "health access");
    if (!projectRoles.includes(access.role as ProjectRole)) {
      fail("health access role", "must be viewer, author, runner, or admin");
    }
    string(access.organizationId, "health access organizationId");
    string(access.projectId, "health access projectId");
  }
});

const activityExportParser: RuntimeParser<{ export: ActivityExport }> = {
  description: "project activity export",
  parse: parseActivityExportResponse,
};

const { targetRecoverInputParser, targetRecoverOutputParser } =
  createTargetRecoveryOperationParsers({
    assertTargetRuntimeReadiness,
  });
const devicesParser = objectParser<{ devices: DeviceSummary[] }>("devices response", (input) => {
  if (!Array.isArray(input.devices)) fail("devices", "must be an array");
  for (const item of input.devices) {
    const device = record(item, "device");
    string(device.id, "device id");
    string(device.serial, "device serial");
    string(device.name, "device name");
    if (device.readiness !== undefined)
      assertTargetRuntimeReadiness(device.readiness, "device readiness");
  }
});
const androidAvdInventoryParser = objectParser<{ inventory: AndroidAvdInventory }>(
  "target.avds.list output",
  (input) => {
    const inventory = record(input.inventory, "Android AVD inventory");
    if (inventory.available !== true && inventory.available !== false)
      fail("Android AVD inventory available", "must be a boolean");
    if (!Array.isArray(inventory.avds)) fail("Android AVD inventory avds", "must be an array");
    for (const item of inventory.avds) {
      const avd = record(item, "Android AVD");
      string(avd.avdName, "Android AVD name");
      string(avd.name, "Android AVD display name");
      string(avd.platform, "Android AVD platform");
      string(avd.kind, "Android AVD kind");
    }
  },
);
const androidAvdBootParser = objectParser<{ boot: AndroidAvdBootResult }>(
  "target.avd.boot output",
  (input) => {
    const boot = record(input.boot, "Android AVD boot");
    string(boot.avdName, "Android AVD name");
    string(boot.serial, "Android AVD serial");
    if (boot.booted !== true) fail("Android AVD booted", "must be true");
  },
);
const actionsParser = objectParser<{ actions: ActionSummary[] }>("actions response", (input) => {
  if (!Array.isArray(input.actions)) fail("actions", "must be an array");
  for (const item of input.actions) {
    const action = record(item, "action");
    string(action.id, "action id");
    string(action.title, "action title");
  }
});
const {
  screenshotParser,
  targetObservationOperationDefinition,
  targetScrollSurveyInputParser,
  targetScrollSurveyOutputParser,
  targetSnapshotOutputParser,
  targetScreenshotInputParser,
  targetSnapshotInputParser,
} = createTargetCaptureOperationParsers({ assertTargetRuntimeReadiness });
const jobsParser = objectParser<OperationOutput<"job.list">>("jobs response", (input) => {
  if (!Array.isArray(input.jobs)) fail("jobs", "must be an array");
  for (const item of input.jobs) {
    const job = record(item, "job summary");
    string(job.id, "job summary id");
    string(job.action, "job summary action");
    string(job.status, "job summary status");
    number(job.queuedAt, "job summary queuedAt");
    number(job.frameCount, "job summary frameCount");
  }
});

const leaseListInputParser = objectParser<OperationInput<"lease.list">>(
  "lease list input",
  (input) => {
    if (input.status !== undefined && input.status !== "active" && input.status !== "all") {
      fail("lease list status", "must be active or all");
    }
  },
);

const leaseCreateInputParser = objectParser<OperationInput<"lease.create">>(
  "lease create input",
  (input) => {
    string(input.poolId, "lease create poolId");
    string(input.deviceSerial, "lease create deviceSerial");
    if (input.expiresAt !== undefined && number(input.expiresAt, "lease create expiresAt") <= 0) {
      fail("lease create expiresAt", "must be positive");
    }
  },
);

const leaseTakeoverInputParser = objectParser<OperationInput<"lease.takeover">>(
  "lease takeover input",
  (input) => {
    string(input.leaseId, "lease takeover leaseId");
    if (input.expiresAt !== undefined && number(input.expiresAt, "lease takeover expiresAt") <= 0) {
      fail("lease takeover expiresAt", "must be positive");
    }
    string(input.reason, "lease takeover reason");
    if (input.confirm !== true) fail("lease takeover confirm", "must be true");
  },
);

const jobIdInputParser = objectParser<{ jobId: string }>("job input", (input) => {
  string(input.jobId, "job id");
});

const offlineRunReplayOutputParser = objectParser<OperationOutput<"run.replay.offline">>(
  "offline run replay response",
  (input) => {
    const report = record(input.report, "offline run replay report");
    if (report.schemaVersion !== 1) fail("offline run replay report schemaVersion", "must be 1");
    if (report.mode !== "offline-evidence-replay") {
      fail("offline run replay report mode", "must be offline-evidence-replay");
    }
    string(report.runId, "offline run replay report runId");
    string(report.sourceRunStatus, "offline run replay report sourceRunStatus");
    string(report.planDigest, "offline run replay report planDigest");
    const summary = record(report.summary, "offline run replay report summary");
    for (const key of [
      "checks",
      "proved",
      "rootFailures",
      "invalidCascades",
      "independentFailures",
    ]) {
      number(summary[key], `offline run replay report summary ${key}`);
    }
    for (const key of ["cursorTimeline", "checks", "blockers"]) {
      if (!Array.isArray(report[key])) {
        fail(`offline run replay report ${key}`, "must be an array");
      }
    }
  },
);

const stepRunOutputParser = objectParser<OperationOutput<"step.run">>(
  "standalone step response",
  (input) => {
    const response = input as unknown as OperationRecord;
    boolean(response.ok, "standalone step ok");
    number(response.durationMs, "standalone step durationMs");
    if (!Array.isArray(response.logs) || response.logs.some((entry) => typeof entry !== "string")) {
      fail("standalone step logs", "must be an array of strings");
    }
    if (response.ok === true) {
      if (response.terminal !== undefined) {
        fail("standalone step terminal", "is only valid on failure");
      }
      return;
    }
    string(response.error, "standalone step error");
    if (response.code === undefined) {
      if (response.terminal !== undefined) fail("standalone step terminal", "is unsupported");
      return;
    }
    if (response.code !== "IOS_MUTATION_OUTCOME_UNKNOWN") {
      fail("standalone step code", "is unsupported");
    }
    if (response.terminal !== "review-needed") {
      fail("standalone step terminal", "must be review-needed for an unknown iOS outcome");
    }
    assertIosMutationAttemptDiagnostic(response.iosMutation, "standalone step iOS mutation");
    const mutation = response.iosMutation as IosMutationAttemptDiagnosticDto;
    if (
      mutation.outcome !== "outcome-unknown" ||
      mutation.retry.decision !== "blocked" ||
      mutation.retry.reason !== "native-command-outcome-unknown" ||
      mutation.intervention.required !== true ||
      mutation.intervention.action !== "capture-current-screen-before-any-retry"
    ) {
      fail("standalone step iOS mutation", "must describe a blocked unknown outcome");
    }
    if (response.iosSessionLifecycle !== undefined) {
      assertIosSessionOperationLifecycle(
        response.iosSessionLifecycle,
        "standalone step iOS session lifecycle",
      );
    }
    if (response.iosVisualVerification !== undefined) {
      record(response.iosVisualVerification, "standalone step iOS visual verification");
    }
    const review = record(response.stepReview, "standalone step review");
    const captureCurrent = record(review.captureCurrent, "standalone step review captureCurrent");
    if (captureCurrent.operationId !== "target.screenshot.capture") {
      fail("standalone step review captureCurrent operationId", "must capture a target screenshot");
    }
    const captureInput = record(
      captureCurrent.input,
      "standalone step review captureCurrent input",
    );
    string(captureInput.serial, "standalone step review captureCurrent serial");
  },
);

const targetAppLaunchInputParser = objectParser<OperationInput<"target.app.launch">>(
  "target app launch input",
  (input) => {
    string(input.serial, "target app launch serial");
    string(input.app, "target app launch app");
    if (input.relaunch !== undefined) boolean(input.relaunch, "target app launch relaunch");
  },
);

const targetAppLaunchOutputParser = objectParser<OperationOutput<"target.app.launch">>(
  "target app launch response",
  (input) => {
    const launched = record(input.launched, "launched app");
    string(launched.serial, "launched app serial");
    string(launched.app, "launched app name");
    if (
      launched.platform !== "android" &&
      launched.platform !== "ios" &&
      launched.platform !== "browser"
    ) {
      fail("launched app platform", "must be android, ios, or browser");
    }
    number(launched.launchedAt, "launched app timestamp");
    const observed = record(input.observed, "observed foreground app");
    if (observed.app !== undefined) string(observed.app, "observed foreground app name");
    boolean(observed.matched, "observed foreground app matched");
  },
);

const targetAppLocalesInputParser = objectParser<OperationInput<"target.app.locales">>(
  "target app locales input",
  (input) => {
    string(input.serial, "target app locales serial");
    string(input.package, "target app locales package");
  },
);

const targetAppLocalesOutputParser = objectParser<OperationOutput<"target.app.locales">>(
  "target app locales response",
  (input) => {
    string(input.packageName, "target app locales package name");
    if (!Array.isArray(input.locales)) fail("target app locales", "must be an array");
    for (const locale of input.locales) string(locale, "target app locale");
    if (input.currentLocale !== undefined) string(input.currentLocale, "target app current locale");
    if (
      input.source !== undefined &&
      input.source !== "android-locale-manager" &&
      input.source !== "android-device-locale"
    )
      fail("target app locale source", "must be an Android locale source");
  },
);

const targetAppListInputParser = objectParser<OperationInput<"target.app.list">>(
  "target app list input",
  (input) => string(input.serial, "target app list serial"),
);

const targetAppListOutputParser = objectParser<OperationOutput<"target.app.list">>(
  "target app list response",
  (input) => {
    if (!Array.isArray(input.apps)) fail("target app list apps", "must be an array");
    input.apps.forEach((app, index) => {
      const item = record(app, `target app list app ${index}`);
      string(item.package, `target app list app ${index} package`);
      string(item.name, `target app list app ${index} name`);
    });
  },
);

const targetAppLocaleSetInputParser = objectParser<OperationInput<"target.app.locale.set">>(
  "target app locale set input",
  (input) => {
    string(input.serial, "target app locale set serial");
    string(input.package, "target app locale set package");
    string(input.locale, "target app locale set locale");
  },
);

const targetAppLocaleSetOutputParser = objectParser<OperationOutput<"target.app.locale.set">>(
  "target app locale set response",
  (input) => {
    string(input.packageName, "target app locale set package name");
    string(input.locale, "target app locale set locale");
    if (input.observedLocale !== undefined) {
      string(input.observedLocale, "target app locale set observed locale");
    }
  },
);

const startJobInputParser = objectParser<OperationInput<"job.start">>("job input", (input) => {
  string(input.recipe, "job recipe");
  if (input.executionTarget !== undefined && !isExecutionTargetRef(input.executionTarget)) {
    fail("job executionTarget", "must be a valid execution target reference");
  }
});

const revisionedVariablesParser = objectParser<RevisionedDto<TestDataDto[]>>(
  "variables response",
  (input) => {
    number(input.revision, "variables revision");
    number(input.updatedAt, "variables updatedAt");
    if (!Array.isArray(input.value)) fail("variables value", "must be an array");
  },
);

const visualCompareInputParser = objectParser<OperationInput<"run.visual.compare">>(
  "visual comparison input",
  (input) => string(input.runId, "visual comparison runId"),
);

const runReviewInputParser = objectParser<OperationInput<"run.review">>(
  "run review input",
  (input) => {
    string(input.runId, "run review runId");
    if (input.action !== "approve" && input.action !== "reject" && input.action !== "defer") {
      fail("run review action", 'must be "approve", "reject", or "defer"');
    }
    if (input.note !== undefined) string(input.note, "run review note");
  },
);

const runReviewOutputParser = objectParser<OperationOutput<"run.review">>(
  "run review response",
  (input) => {
    record(input.run, "run review run");
    record(input.review, "run review decision");
  },
);

const visualReviewInputParser = objectParser<OperationInput<"run.visual.review">>(
  "visual review input",
  (input) => {
    string(input.runId, "visual review runId");
    string(input.comparisonId, "visual review comparisonId");
    const action = string(input.action, "visual review action");
    if (!(VISUAL_REVIEW_ACTIONS as readonly string[]).includes(action)) {
      fail("visual review action", "is unsupported");
    }
    if (input.note !== undefined) string(input.note, "visual review note");
  },
);

function assertVisualRegion(value: unknown, index: number): void {
  const region = record(value, `visual region ${index + 1}`);
  string(region.id, `visual region ${index + 1} id`);
  string(region.name, `visual region ${index + 1} name`);
  if (region.mode !== "compare" && region.mode !== "ignore") {
    fail(`visual region ${index + 1} mode`, "must be compare or ignore");
  }
  const frameIndex = number(region.frameIndex, `visual region ${index + 1} frameIndex`);
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    fail(`visual region ${index + 1} frameIndex`, "must be a non-negative integer");
  }
  const x = number(region.x, `visual region ${index + 1} x`);
  const y = number(region.y, `visual region ${index + 1} y`);
  const width = number(region.width, `visual region ${index + 1} width`);
  const height = number(region.height, `visual region ${index + 1} height`);
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    fail(`visual region ${index + 1}`, "must fit inside normalized frame bounds");
  }
}

const visualPolicyGetInputParser = objectParser<OperationInput<"run.visual-policy.get">>(
  "visual policy input",
  (input) => string(input.runId, "visual policy runId"),
);

const visualPolicyUpdateInputParser = objectParser<OperationInput<"run.visual-policy.update">>(
  "visual policy update input",
  (input) => {
    string(input.runId, "visual policy runId");
    const revision = number(input.expectedRevision, "visual policy expectedRevision");
    if (!Number.isInteger(revision) || revision < 0)
      fail("visual policy expectedRevision", "must be a non-negative integer");
    const changeThreshold = number(input.changeThreshold, "visual policy changeThreshold");
    if (changeThreshold < 0 || changeThreshold > 1)
      fail("visual policy changeThreshold", "must be between 0 and 1");
    const pixelThreshold = number(input.pixelThreshold, "visual policy pixelThreshold");
    if (!Number.isInteger(pixelThreshold) || pixelThreshold < 0 || pixelThreshold > 255)
      fail("visual policy pixelThreshold", "must be an integer from 0 to 255");
    if (!Array.isArray(input.regions) || input.regions.length > 100)
      fail("visual policy regions", "must be an array with at most 100 regions");
    input.regions.forEach(assertVisualRegion);
  },
);

const visualBaselineInputParser = objectParser<OperationInput<"run.visual-baseline.update">>(
  "visual baseline input",
  (input) => {
    string(input.runId, "visual baseline runId");
    if (input.action !== "approve-new-baseline") {
      fail("visual baseline action", "must be approve-new-baseline");
    }
    if (input.note !== undefined) string(input.note, "visual baseline note");
  },
);

const visualComparisonOutputParser = objectFieldParser<OperationOutput<"run.visual.compare">>(
  "visual comparison response",
  "comparison",
);

const visualReviewOutputParser = objectParser<OperationOutput<"run.visual.review">>(
  "visual review response",
  (input) => {
    record(input.decision, "visual review decision");
    if (input.baseline !== null) record(input.baseline, "visual review baseline");
  },
);

const visualBaselineOutputParser = objectParser<OperationOutput<"run.visual-baseline.update">>(
  "visual baseline response",
  (input) => {
    record(input.comparison, "visual baseline comparison");
    record(input.decision, "visual baseline decision");
    record(input.baseline, "visual baseline");
  },
);

const visualPolicyOutputParser = objectParser<OperationOutput<"run.visual-policy.get">>(
  "visual policy response",
  (input) => record(input.policy, "visual comparison policy"),
);

const visualPolicyUpdateOutputParser = objectParser<OperationOutput<"run.visual-policy.update">>(
  "visual policy update response",
  (input) => {
    record(input.policy, "visual comparison policy");
    record(input.comparison, "visual comparison");
  },
);

const generationInputParser = objectParser<GenerationRequestDto>("generation input", (input) => {
  if (input.purpose !== "variable" && input.purpose !== "test-plan") {
    fail("generation purpose", "must be variable or test-plan");
  }
  string(input.prompt, "generation prompt");
  if (
    input.allowedValues !== undefined &&
    (!Array.isArray(input.allowedValues) ||
      input.allowedValues.some((value) => typeof value !== "string" || !value.trim()))
  ) {
    fail("generation allowedValues", "must contain non-empty strings");
  }
});

const generationOutputParser = objectParser<GenerationResultDto>("generation response", (input) => {
  string(input.provider, "generation provider");
  string(input.model, "generation model");
  if (!Array.isArray(input.values) || input.values.some((value) => typeof value !== "string")) {
    fail("generation values", "must be an array of strings");
  }
  number(input.generatedAt, "generation generatedAt");
  if (input.usage !== undefined) {
    const usage = record(input.usage, "generation usage");
    for (const field of ["inputTokens", "outputTokens", "totalTokens", "costUsd"] as const) {
      if (usage[field] !== undefined) number(usage[field], `generation usage ${field}`);
    }
  }
  if (input.provenance !== undefined) {
    const provenance = record(input.provenance, "generation provenance");
    string(provenance.requestId, "generation provenance requestId");
    string(provenance.promptDigest, "generation provenance promptDigest");
    number(provenance.startedAt, "generation provenance startedAt");
    number(provenance.completedAt, "generation provenance completedAt");
    number(provenance.durationMs, "generation provenance durationMs");
  }
});

const { command, query } = createOperationBuilders<RelayOperationMap>();
const discoveryOperationDefinitions = createDiscoveryOperationDefinitions();
const appMapOperationDefinitions = createAppMapOperationDefinitions({
  boolean,
  emptyInputParser,
  fail,
  number,
  objectFieldParser,
  objectParser,
  okParser,
  record,
  string,
});
type ExactOperationDefinition = {
  [Id in OperationId]: OperationDefinition<Id, OperationInput<Id>, OperationOutput<Id>>;
}[OperationId];
export const operationDefinitions = [
  query("system.health.get", "Get Relay health", "/health", {
    category: "system",
    input: emptyInputParser,
    output: healthParser,
  }),
  query("system.doctor.get", "Inspect Relay prerequisites", "/doctor", { category: "system" }),
  query("system.audit.list", "List audit events", "/audit", {
    category: "system",
    minimumRole: "admin",
  }),
  query("activity.list", "List durable project activity", "/activity", {
    category: "workspace",
    minimumRole: "admin",
  }),
  query("activity.export", "Export project activity", "/activity/export", {
    category: "workspace",
    minimumRole: "admin",
    input: emptyInputParser,
    output: activityExportParser,
  }),
  query("event.stream", "Stream Relay events", "/events", {
    category: "system",
    mode: "stream",
  }),
  query("presence.list", "List project presence", "/presence", { category: "system" }),
  command("presence.upsert", "Publish actor presence", "POST", "/presence", {
    category: "system",
    idempotency: "inherent",
  }),
  command("presence.clear", "Clear actor presence", "DELETE", "/presence/:actorId", {
    category: "system",
    idempotency: "inherent",
  }),
  ...workspaceOperationDefinitions,
  ...appleDeviceOperationDefinitions,
  query("target.actions.list", "List available actions", "/actions", {
    category: "target",
    input: emptyInputParser,
    output: actionsParser,
  }),
  query("target.devices.list", "List connected targets", "/devices", {
    category: "target",
    input: targetDevicesInputParser,
    output: devicesParser,
  }),
  query("target.avds.list", "List configured Android emulators", "/devices/avds", {
    category: "target",
    input: emptyInputParser,
    output: androidAvdInventoryParser,
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
  command("target.boot", "Boot target", "POST", "/device/boot", { category: "target" }),
  command("target.avd.boot", "Boot a named Android emulator", "POST", "/device/avd/boot", {
    category: "target",
    input: objectParser("Android AVD boot", (input) => {
      string(input.avdName, "Android AVD name");
      if (input.timeoutMs !== undefined) number(input.timeoutMs, "Android AVD timeoutMs");
      if (input.headless !== undefined) boolean(input.headless, "Android AVD headless");
    }),
    output: androidAvdBootParser,
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
    input: targetSnapshotInputParser,
    output: targetSnapshotOutputParser,
  }),
  query("target.screenshot.capture", "Capture target screenshot", "/screenshot", {
    category: "evidence",
    targetCapabilities: ["screenshot"],
    lease: "shared",
    input: targetScreenshotInputParser,
    output: screenshotParser,
  }),
  targetObservationOperationDefinition,
  ...createTargetSupervisorOperationDefinitions({
    assertTargetRuntimeReadiness,
    targetObservation: targetObservationOperationDefinition.output,
  }),
  command(
    "target.scroll-survey.capture",
    "Capture a bounded scrollable-page survey",
    "POST",
    "/capture/scroll-survey",
    {
      category: "target",
      targetCapabilities: ["scroll", "snapshot", "screenshot"],
      lease: "exclusive",
      input: targetScrollSurveyInputParser,
      output: targetScrollSurveyOutputParser,
      progress: false,
      cancellable: false,
    },
  ),
  command("target.app.launch", "Launch app on target", "POST", "/device/app/launch", {
    category: "target",
    targetCapabilities: ["launch"],
    lease: "exclusive",
    idempotency: "inherent",
    input: targetAppLaunchInputParser,
    output: targetAppLaunchOutputParser,
  }),
  query("target.app.locales", "List app-declared locales", "/device/app/locales", {
    category: "target",
    targetCapabilities: ["snapshot"],
    lease: "shared",
    input: targetAppLocalesInputParser,
    output: targetAppLocalesOutputParser,
  }),
  query("target.app.list", "List installed apps", "/device/apps", {
    category: "target",
    targetCapabilities: ["snapshot"],
    lease: "shared",
    input: targetAppListInputParser,
    output: targetAppListOutputParser,
  }),
  command("target.app.locale.set", "Set an app's per-app locale", "POST", "/device/app/locale", {
    category: "target",
    targetCapabilities: ["snapshot"],
    lease: "exclusive",
    idempotency: "inherent",
    input: targetAppLocaleSetInputParser,
    output: targetAppLocaleSetOutputParser,
  }),
  command("target.recover", "Repair target connection", "POST", "/device/recover", {
    category: "target",
    targetCapabilities: ["snapshot", "tap"],
    lease: "exclusive",
    idempotency: "inherent",
    input: targetRecoverInputParser,
    output: targetRecoverOutputParser,
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
    input: emptyInputParser,
    output: arrayFieldParser<OperationOutput<"target-worker.list">>(
      "target workers response",
      "workers",
    ),
  }),
  ...campaignCapacityOperationDefinitions,
  query("lease.list", "List target leases", "/device-leases", {
    input: leaseListInputParser,
    output: arrayFieldParser("leases response", "leases"),
  }),
  command("lease.create", "Lease target", "POST", "/device-leases", {
    confirmation: "confirm",
    input: leaseCreateInputParser,
    output: objectFieldParser("lease response", "lease"),
  }),
  command("lease.takeover", "Take over target lease", "POST", "/device-leases/:leaseId/takeover", {
    confirmation: "dangerous",
    input: leaseTakeoverInputParser,
    output: objectFieldParser("lease response", "lease"),
  }),
  command("lease.release", "Release target lease", "POST", "/device-leases/:leaseId/release", {
    output: objectFieldParser("lease response", "lease"),
  }),
  command("action.run", "Run action and wait", "POST", "/actions/:actionId/run", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  query("workspace.variables.get", "Get project variables", "/project/variables", {
    input: emptyInputParser,
    output: revisionedVariablesParser,
  }),
  command("workspace.variables.update", "Update project variables", "PUT", "/project/variables", {
    output: revisionedVariablesParser,
  }),
  ...appMapOperationDefinitions,
  query("authoring.session.list", "List Authoring Sessions", "/authoring-sessions", {
    category: "authoring",
    input: authoringSessionListInputParser,
    output: authoringSessionListParser,
  }),
  query("authoring.session.get", "Get Authoring Session", "/authoring-sessions/:sessionId", {
    category: "authoring",
    input: authoringSessionRefParser,
    output: authoringSessionResponseParser,
  }),
  command("authoring.session.create", "Create Authoring Session", "POST", "/authoring-sessions", {
    category: "authoring",
    input: createAuthoringSessionParser,
    output: authoringSessionResponseParser,
    targetCapabilities: ["snapshot", "screenshot"],
    lease: "exclusive",
  }),
  command(
    "authoring.session.begin",
    "Create and Start Authoring Take",
    "POST",
    "/authoring-sessions/begin",
    {
      category: "authoring",
      input: createAuthoringSessionParser,
      output: authoringSessionResponseParser,
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
    },
  ),
  command(
    "authoring.session.observe",
    "Observe Authoring Target",
    "POST",
    "/authoring-sessions/:sessionId/observe",
    {
      category: "authoring",
      input: authoringSessionRefParser,
      output: authoringSessionResponseParser,
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
    },
  ),
  command(
    "authoring.session.capture",
    "Capture Authoring Screen",
    "POST",
    "/authoring-sessions/:sessionId/capture",
    {
      category: "authoring",
      input: authoringSessionRefParser,
      output: authoringSessionResponseParser,
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
    },
  ),
  command(
    "authoring.session.start",
    "Start Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/start",
    {
      category: "authoring",
      input: authoringSessionRefParser,
      output: authoringSessionResponseParser,
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
    },
  ),
  command(
    "authoring.session.interact",
    "Interact During Authoring",
    "POST",
    "/authoring-sessions/:sessionId/interact",
    {
      category: "authoring",
      input: authoringInteractionParser,
      output: authoringSessionResponseParser,
      targetCapabilities: ["tap", "type", "scroll"],
      lease: "exclusive",
    },
  ),
  command(
    "authoring.session.stop",
    "Stop Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/stop",
    {
      category: "authoring",
      input: authoringSessionRefParser,
      output: authoringSessionResponseParser,
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
    },
  ),
  authoringOperations.authoringRawOptimizationOperationDefinition,
  command(
    "authoring.take.trim",
    "Trim Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/trim",
    {
      category: "authoring",
      input: trimAuthoringTakeParser,
      output: authoringSessionResponseParser,
    },
  ),
  command(
    "authoring.take.reorder",
    "Reorder Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/reorder",
    {
      category: "authoring",
      input: reorderAuthoringTakeParser,
      output: authoringSessionResponseParser,
    },
  ),
  command(
    "authoring.take.replace",
    "Replace Authoring Action",
    "POST",
    "/authoring-sessions/:sessionId/actions/:actionId",
    {
      category: "authoring",
      input: replaceAuthoringActionParser,
      output: authoringSessionResponseParser,
    },
  ),
  authoringOperations.authoringTakeEditOperationDefinition,
  command(
    "authoring.take.replay",
    "Replay Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/replay",
    {
      category: "authoring",
      input: authoringSessionRefParser,
      output: authoringSessionResponseParser,
      targetCapabilities: ["tap", "type", "scroll", "snapshot", "screenshot"],
      lease: "exclusive",
      progress: true,
      cancellable: true,
    },
  ),
  command(
    "authoring.session.commit",
    "Commit Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/commit",
    {
      category: "authoring",
      input: commitAuthoringSessionParser,
      output: authoringSessionResponseParser,
    },
  ),
  command(
    "authoring.session.discard",
    "Discard Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/discard",
    {
      category: "authoring",
      input: authoringSessionRefParser,
      output: authoringSessionResponseParser,
    },
  ),
  command(
    "authoring.session.cancel",
    "Cancel Authoring Session",
    "POST",
    "/authoring-sessions/:sessionId/cancel",
    {
      category: "authoring",
      input: authoringSessionRefParser,
      output: authoringSessionResponseParser,
    },
  ),
  command(
    "authoring.session.cleanup",
    "Remove Authoring Session",
    "DELETE",
    "/authoring-sessions/:sessionId",
    { category: "authoring", input: authoringSessionRefParser, output: okParser },
  ),
  ...scheduleOperationDefinitions,
  ...discoveryOperationDefinitions,
  query("job.list", "List jobs", "/jobs", { category: "execution", output: jobsParser }),
  query("job.get", "Get job", "/jobs/:jobId", { category: "execution", input: jobIdInputParser }),
  ...durableOperationDefinitions,
  command("job.start", "Start job", "POST", "/jobs", {
    category: "execution",
    input: startJobInputParser,
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
    input: replayRunInputParser,
    progress: true,
    cancellable: true,
  }),
  command("job.cancel", "Cancel job", "POST", "/jobs/:jobId/cancel", {
    category: "execution",
    input: jobIdInputParser,
    idempotency: "inherent",
  }),
  command("job.pause", "Pause job", "POST", "/jobs/:jobId/pause", {
    category: "execution",
    input: jobIdInputParser,
    idempotency: "inherent",
  }),
  command("job.resume", "Resume job", "POST", "/jobs/:jobId/resume", {
    category: "execution",
    input: jobIdInputParser,
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
    input: runListInputParser,
    output: runsParser,
  }),
  query("run.get", "Get Run", "/runs/:runId", {
    category: "evidence",
    input: runIdInputParser,
  }),
  query("run.replay.offline", "Replay Run Offline", "/runs/:runId/replay-offline", {
    category: "evidence",
    input: runIdInputParser,
    output: offlineRunReplayOutputParser,
  }),
  ...runRepairOperationDefinitions,
  command("run.review", "Review a deferred run check", "POST", "/runs/:runId/review", {
    category: "evidence",
    confirmation: "confirm",
    input: runReviewInputParser,
    output: runReviewOutputParser,
  }),
  query("run.evidence.get", "Get Run Evidence", "/runs/:runId/evidence", {
    category: "evidence",
    input: runEvidenceInputParser,
  }),
  query("run.story.get", "Get Run story", "/runs/:runId/story", {
    category: "evidence",
    input: runIdInputParser,
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
      input: visualBaselineInputParser,
      output: visualBaselineOutputParser,
    },
  ),
  command(
    "run.visual.compare",
    "Compare Run with approved visual baseline",
    "POST",
    "/runs/:runId/visual-comparison",
    {
      category: "evidence",
      input: visualCompareInputParser,
      output: visualComparisonOutputParser,
    },
  ),
  command("run.visual.review", "Review visual comparison", "POST", "/runs/:runId/visual-review", {
    category: "evidence",
    confirmation: "confirm",
    input: visualReviewInputParser,
    output: visualReviewOutputParser,
  }),
  command(
    "run.capture.review",
    "Review a captured screenshot",
    "POST",
    "/runs/:runId/capture-review",
    {
      category: "evidence",
      confirmation: "confirm",
      input: captureReviewInputParser,
      output: captureReviewOutputParser,
    },
  ),
  query("run.visual-policy.get", "Get visual comparison policy", "/runs/:runId/visual-policy", {
    category: "evidence",
    input: visualPolicyGetInputParser,
    output: visualPolicyOutputParser,
  }),
  command(
    "run.visual-policy.update",
    "Update visual comparison policy",
    "PUT",
    "/runs/:runId/visual-policy",
    {
      category: "evidence",
      confirmation: "confirm",
      input: visualPolicyUpdateInputParser,
      output: visualPolicyUpdateOutputParser,
    },
  ),
  command("run.pin.update", "Pin Run", "POST", "/runs/:runId/pin", { category: "execution" }),
  command("step.run", "Run one execution step", "POST", "/step/run", {
    category: "execution",
    targetCapabilities: ["snapshot", "tap", "type", "scroll"],
    lease: "exclusive",
    progress: true,
    cancellable: true,
    output: stepRunOutputParser,
  }),
  command("generation.create", "Generate test data", "POST", "/generate", {
    category: "authoring",
    input: generationInputParser,
    output: generationOutputParser,
  }),
] as const satisfies readonly ExactOperationDefinition[];

export function operationDefinition<Id extends OperationId>(
  id: Id,
): OperationDefinition<Id, OperationInput<Id>, OperationOutput<Id>> {
  const definition = operationDefinitions.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Unknown operation: ${id}`);
  return definition as OperationDefinition<Id, OperationInput<Id>, OperationOutput<Id>>;
}

export function validateOperationDefinitions(
  definitions: readonly OperationDefinition[] = operationDefinitions,
): void {
  validateDefinitions(definitions);
}

export type OperationManifestItem = Omit<OperationDefinition, "input" | "output"> & {
  input: string;
  output: string;
};

export function operationManifest(
  definitions: readonly OperationDefinition[] = operationDefinitions,
): OperationManifestItem[] {
  validateOperationDefinitions(definitions);
  return definitions.map(({ input, output, ...definition }) => ({
    ...definition,
    input: input.description,
    output: output.description,
  }));
}
