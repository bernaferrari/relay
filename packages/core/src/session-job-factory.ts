/** Build frozen replay jobs without coupling construction to the scheduler. */
import { randomUUID } from "node:crypto";
import {
  assertExecutionTargetRef,
  parseBrowserCaseProfile,
  type BrowserCaseProfile,
  type ExecutionTargetRef,
  type TargetProfile,
} from "@relay/protocol";
import { now } from "./events.js";
import { getEvidenceCollectionPolicy } from "./evidence-policy.js";
import { currentOperationContext } from "./operation-context.js";
import { PRIVATE_INPUT } from "./private-inputs.js";
import { REDACTED } from "./redaction.js";
import type { PersistedRun } from "./runs.js";
import type { EnqueueJobInput, TestJob } from "./session-contract.js";
import type { TraceFrameRef, TraceStep } from "./trace.js";
import { installRegisteredBuild, preflightRegisteredBuild } from "./builds.js";
import type { Build } from "@relay/protocol";
import { jobSchedulingTargetId, unsignedBrowserLaneId } from "./browser-account-lane.js";
import { defaultTargetWorkerAssignment } from "./target-worker.js";
import {
  executionTargetRefForJob,
  executionTargetRefFromTargetContext,
  executionTargetSchedulingKey,
  targetContextFromExecutionTargetRef,
} from "./target-driver.js";
import { inferDevicePlatformFromSerial, type TargetContext } from "./target-context.js";

function freezeExecutionTarget(target: ExecutionTargetRef): ExecutionTargetRef {
  assertExecutionTargetRef(target);
  const clone = structuredClone(target);
  return Object.freeze({
    ...clone,
    provider: Object.freeze({ ...clone.provider }),
    identity: Object.freeze({ ...clone.identity }),
  }) as ExecutionTargetRef;
}

function freezeBrowserCaseProfile(profile: BrowserCaseProfile): BrowserCaseProfile {
  return parseBrowserCaseProfile(structuredClone(profile));
}

function freezeTargetProfile(profile: TargetProfile): TargetProfile {
  const clone = structuredClone(profile);
  return Object.freeze({
    ...clone,
    ...(clone.viewport ? { viewport: Object.freeze({ ...clone.viewport }) } : {}),
    ...(clone.browserCaseProfile
      ? { browserCaseProfile: freezeBrowserCaseProfile(clone.browserCaseProfile) }
      : {}),
    capabilities: Object.freeze([...clone.capabilities]),
  }) as TargetProfile;
}

function legacyTargetKind(target: ExecutionTargetRef): "device" | "browser" {
  return target.kind === "local-browser" ? "browser" : "device";
}

/** Whether a retry explicitly selects a different legacy target instead of
 * inheriting its parent's immutable provider-neutral ref. */
function legacyInputOverridesTarget(input: EnqueueJobInput, target: ExecutionTargetRef): boolean {
  const identity = target.identity.value;
  if (input.targetKind !== undefined && input.targetKind !== legacyTargetKind(target)) return true;
  if (input.serial !== undefined && input.serial.trim() !== identity) return true;
  if (input.browserTargetId !== undefined) {
    return target.kind !== "local-browser" || input.browserTargetId.trim() !== identity;
  }
  if (input.platform !== undefined) return target.platform !== input.platform;
  return false;
}

/** New jobs always store a per-target lane in workerId. Old records may still
 * carry a caller-supplied aggregate host in that field. Retry must preserve
 * only the latter: treating the frozen target lane as a host makes the same
 * retry change scheduler policy from "no host" to "host = target lane". */
function inheritedLegacyWorkerHost(parent: TestJob | undefined): {
  workerId?: string;
  workerCapacity?: number;
} {
  if (!parent?.workerId || parent.hostWorkerId) return {};
  const target = executionTargetRefForJob(parent);
  const derivedLane = defaultTargetWorkerAssignment({
    targetId: jobSchedulingTargetId({
      executionTarget: target,
      browserCaseProfile: parent.browserCaseProfile,
      unsignedLaneId: parent.unsignedLaneId,
    }),
    platform: target.platform,
    provider: target.provider,
  });
  if (parent.workerId === derivedLane.workerId) return {};
  return {
    workerId: parent.workerId,
    ...(parent.workerCapacity ? { workerCapacity: parent.workerCapacity } : {}),
  };
}

/** An explicit ref is authoritative. Reject split-brain legacy input instead
 * of allowing a provider session and serial to be accidentally mixed. */
function assertExplicitTargetMatchesLegacy(
  input: EnqueueJobInput,
  target: ExecutionTargetRef,
): void {
  if (legacyInputOverridesTarget(input, target)) {
    throw new Error("executionTarget must agree with serial, platform, and target kind");
  }
}

function legacyTargetContext(input: EnqueueJobInput, parent: TestJob | undefined): TargetContext {
  const targetKind = input.targetKind ?? parent?.targetKind ?? "device";
  return targetKind === "browser"
    ? Object.freeze({
        kind: "browser" as const,
        platform: "browser" as const,
        targetId:
          input.browserTargetId?.trim() ||
          (parent?.targetContext.kind === "browser" ? parent.targetContext.targetId : "") ||
          input.serial?.trim() ||
          "",
      })
    : Object.freeze({
        kind: "device" as const,
        platform:
          input.platform ??
          parent?.platform ??
          inferDevicePlatformFromSerial(
            input.serial?.trim() ||
              (parent?.targetContext.kind === "device" ? parent.targetContext.serial : "") ||
              "",
          ) ??
          ("android" as const),
        serial:
          input.serial?.trim() ||
          (parent?.targetContext.kind === "device" ? parent.targetContext.serial : "") ||
          "",
      });
}

export type PersistedReplayMode = "saved-steps" | "same-configuration";

/** Validate frozen replay data before mutating a target with a build install. */
export async function prepareSameConfigurationReplay(input: {
  run: Parameters<typeof replayInputFromPersistedRun>[0];
  build: Build;
  target: TargetContext;
  targetKind?: string | null;
  preflight?: typeof preflightRegisteredBuild;
  install?: typeof installRegisteredBuild;
}): Promise<EnqueueJobInput> {
  const replay = replayInputFromPersistedRun(input.run, "same-configuration");
  if (input.build.id !== input.run.sourceRevision?.buildId) {
    throw new Error("Recorded build identity does not match the persisted run");
  }
  const persistedTarget = input.run.executionTarget;
  if (persistedTarget) {
    if (
      persistedTarget.kind !== "local-device" ||
      input.target.kind !== "device" ||
      persistedTarget.identity.value !== input.target.serial ||
      persistedTarget.platform !== input.target.platform
    ) {
      throw new Error("Replay target does not match the persisted execution target");
    }
  } else if (
    input.target.kind !== "device" ||
    input.run.serial !== input.target.serial ||
    input.run.platform !== input.target.platform
  ) {
    throw new Error("Replay target does not match the persisted execution target");
  }
  const preflight = await (input.preflight ?? preflightRegisteredBuild)(input.build, {
    target: input.target,
  });
  if (!preflight.ok) {
    throw new Error(
      preflight.checks
        .filter((check) => check.status === "fail")
        .map((check) => check.message)
        .join("; ") || `Recorded build ${input.build.id} failed preflight`,
    );
  }
  await (input.install ?? installRegisteredBuild)({
    build: input.build,
    target: input.target,
    targetKind: input.targetKind,
  });
  return replay;
}

export function replayInputFromPersistedRun(
  run: Pick<
    PersistedRun,
    | "id"
    | "action"
    | "serial"
    | "platform"
    | "targetProfile"
    | "browserCaseProfile"
    | "title"
    | "resolvedInputs"
    | "recipeSnapshot"
    | "recipeGraph"
    | "projectId"
    | "ownerId"
    | "executionTarget"
    | "sourceRevision"
  > & { artifacts?: PersistedRun["artifacts"] },
  mode: PersistedReplayMode = "saved-steps",
): EnqueueJobInput {
  if (!run.recipeSnapshot || !run.recipeGraph) {
    throw new Error("This run predates frozen replay data and cannot be replayed safely");
  }
  if (mode === "same-configuration" && !run.sourceRevision?.buildId) {
    throw new Error(
      "This run has no immutable build identity; same-configuration replay is unavailable. Use saved-steps replay or install the recorded build first.",
    );
  }
  const unavailableInput = Object.entries(run.resolvedInputs).find(
    ([, value]) => value === PRIVATE_INPUT || value === REDACTED,
  );
  if (unavailableInput) {
    throw new Error(
      `This run used a private value for “${unavailableInput[0]}”. Provide it again before replaying.`,
    );
  }
  const executionTarget = run.executionTarget
    ? freezeExecutionTarget(run.executionTarget)
    : undefined;
  if (executionTarget) {
    const targetInput =
      executionTarget.kind === "local-browser"
        ? {
            targetKind: "browser" as const,
            browserTargetId: executionTarget.identity.value,
          }
        : executionTarget.kind === "local-device"
          ? {
              targetKind: "device" as const,
              serial: executionTarget.identity.value,
              platform: executionTarget.platform,
            }
          : { targetKind: "device" as const, platform: executionTarget.platform };
    return {
      recipe: run.action,
      executionTarget,
      ...targetInput,
      sourceRevision: structuredClone(run.sourceRevision),
      targetProfile: run.targetProfile,
      browserCaseProfile: run.browserCaseProfile
        ? freezeBrowserCaseProfile(run.browserCaseProfile)
        : undefined,
      title: `${run.title ?? run.action} · replay`,
      variables: structuredClone(run.resolvedInputs),
      recipeSnapshot: structuredClone(run.recipeSnapshot),
      recipeGraph: structuredClone(run.recipeGraph),
      artifacts: structuredClone(run.artifacts ?? []),
      projectId: run.projectId,
      ownerId: run.ownerId,
    };
  }
  const platform =
    run.platform === "android" || run.platform === "ios" || run.platform === "browser"
      ? run.platform
      : undefined;
  const targetId = run.serial?.trim();
  if (!targetId || !platform) {
    throw new Error("This run has no reusable target identity and cannot be replayed safely");
  }
  return {
    recipe: run.action,
    ...(platform === "browser"
      ? { targetKind: "browser" as const, browserTargetId: targetId }
      : { targetKind: "device" as const, serial: targetId, platform }),
    targetProfile: run.targetProfile,
    browserCaseProfile: run.browserCaseProfile
      ? freezeBrowserCaseProfile(run.browserCaseProfile)
      : undefined,
    ...(run.sourceRevision ? { sourceRevision: structuredClone(run.sourceRevision) } : {}),
    title: `${run.title ?? run.action} · replay`,
    variables: structuredClone(run.resolvedInputs),
    recipeSnapshot: structuredClone(run.recipeSnapshot),
    recipeGraph: structuredClone(run.recipeGraph),
    artifacts: structuredClone(run.artifacts ?? []),
    projectId: run.projectId,
    ownerId: run.ownerId,
  };
}

/**
 * Build the compatibility projection for a retry from the job's canonical
 * target, not from its lossy legacy report fields. In particular a remote iOS
 * session has no local serial, while a browser has no device platform.
 */
export function retryTargetInputFromJob(
  job: TestJob,
): Pick<
  EnqueueJobInput,
  "executionTarget" | "targetKind" | "serial" | "platform" | "browserTargetId"
> {
  const executionTarget = freezeExecutionTarget(executionTargetRefForJob(job));
  if (executionTarget.kind === "local-browser") {
    return {
      executionTarget,
      targetKind: "browser",
      browserTargetId: executionTarget.identity.value,
    };
  }
  return {
    executionTarget,
    targetKind: "device",
    platform: executionTarget.platform,
    ...(executionTarget.kind === "local-device" ? { serial: executionTarget.identity.value } : {}),
  };
}

/** A retry always derives every scheduling/target field from the frozen job. */
export function retryInputFromJob(job: TestJob): EnqueueJobInput {
  if (!job.recipeId) throw new Error(`Job ${job.id} has no frozen recipe to retry`);
  return {
    recipe: job.recipeId,
    ...retryTargetInputFromJob(job),
    prodAccountMatch: job.options?.prodAccountMatch,
    retryOf: job.id,
    title: job.title,
    variables: job.resolvedInputs,
    sensitiveInputNames: job.sensitiveInputNames ?? [],
    recipeSnapshot: job.recipeSnapshot,
    recipeGraph: job.recipeGraph,
    batchId: job.batchId,
    caseIndex: job.caseIndex,
    caseCount: job.caseCount,
    targetProfile: job.targetProfile,
    browserCaseProfile: job.browserCaseProfile,
    unsignedLaneId: job.unsignedLaneId,
    sourceRevision: structuredClone(job.sourceRevision),
    hostWorkerId: job.hostWorkerId,
    hostWorkerCapacity: job.hostWorkerCapacity,
    artifacts: job.artifacts,
    projectId: job.projectId,
    ownerId: job.ownerId,
  };
}

export interface SessionJobFactoryOptions {
  findJob(id: string): TestJob | undefined;
  toTransport(job: TestJob): TestJob;
  attemptSeed?: number;
}

export function createSessionJob(
  input: EnqueueJobInput,
  { findJob, toTransport, attemptSeed = 1 }: SessionJobFactoryOptions,
): TestJob {
  const parent = input.retryOf ? findJob(input.retryOf) : undefined;
  const id = randomUUID();
  const inheritedTarget = parent
    ? freezeExecutionTarget(executionTargetRefForJob(parent))
    : undefined;
  const explicitTarget = input.executionTarget
    ? freezeExecutionTarget(input.executionTarget)
    : undefined;
  if (explicitTarget) assertExplicitTargetMatchesLegacy(input, explicitTarget);
  const selectedTarget =
    explicitTarget ??
    (inheritedTarget && !legacyInputOverridesTarget(input, inheritedTarget)
      ? inheritedTarget
      : undefined);
  const targetContext: TargetContext = selectedTarget
    ? Object.freeze(targetContextFromExecutionTargetRef(selectedTarget))
    : legacyTargetContext(input, parent);
  const executionTarget = freezeExecutionTarget(
    selectedTarget ?? executionTargetRefFromTargetContext(targetContext),
  );
  const targetKind = legacyTargetKind(executionTarget);
  const explicitBrowserCaseProfile =
    input.browserCaseProfile ?? input.targetProfile?.browserCaseProfile;
  const suppliedBrowserCaseProfile =
    explicitBrowserCaseProfile ??
    (targetKind === "browser" ? parent?.browserCaseProfile : undefined);
  if (targetKind === "browser" && !suppliedBrowserCaseProfile) {
    throw new Error("Browser jobs require a frozen browser case profile");
  }
  if (targetKind !== "browser" && explicitBrowserCaseProfile) {
    throw new Error("A browser case profile can only be attached to a browser job");
  }
  const browserCaseProfile = suppliedBrowserCaseProfile
    ? freezeBrowserCaseProfile(suppliedBrowserCaseProfile)
    : undefined;
  const suppliedTargetProfile = input.targetProfile ?? parent?.targetProfile;
  const selectedTargetProfile = suppliedTargetProfile
    ? freezeTargetProfile(suppliedTargetProfile)
    : undefined;
  const unsignedLaneId = unsignedBrowserLaneId({
    laneId: input.unsignedLaneId ?? parent?.unsignedLaneId,
    authenticationFixtureId: browserCaseProfile?.authenticationFixtureId,
  });
  if (
    browserCaseProfile &&
    selectedTargetProfile?.browserCaseProfile &&
    JSON.stringify(browserCaseProfile) !==
      JSON.stringify(freezeBrowserCaseProfile(selectedTargetProfile.browserCaseProfile))
  ) {
    throw new Error("Browser job profile does not match its frozen target profile");
  }
  const schedulingKey = executionTargetSchedulingKey(executionTarget);
  if (!schedulingKey) throw new Error("Every Relay job requires an explicit target");
  const operationContext = currentOperationContext() ?? parent?.operationContext;
  const inheritedLegacyWorker =
    !input.workerId && !input.hostWorkerId && !parent?.hostWorkerId
      ? inheritedLegacyWorkerHost(parent)
      : {};
  const assignment = defaultTargetWorkerAssignment({
    // Browser accounts use a fixture lane so N signed-in browsers on one
    // host do not serialize behind the target id. Unsigned Lanes are a second
    // signed-out identity so grok-daily and grok-daily-b can overlap.
    targetId: jobSchedulingTargetId({
      executionTarget,
      browserCaseProfile,
      unsignedLaneId,
    }),
    platform: targetContext.platform,
    provider: executionTarget.provider,
    // Legacy worker fields represented an aggregate platform worker. Keep
    // accepting them as host ceilings, but never reuse a derived target lane
    // from a newer parent as a host id on retry.
    workerId: input.workerId ?? inheritedLegacyWorker.workerId,
    workerCapacity: input.workerCapacity ?? inheritedLegacyWorker.workerCapacity,
    hostWorkerId: input.hostWorkerId ?? (!input.workerId ? parent?.hostWorkerId : undefined),
    hostWorkerCapacity:
      input.hostWorkerCapacity ?? (!input.workerCapacity ? parent?.hostWorkerCapacity : undefined),
  });
  const baseJob = {
    id,
    projectId: input.projectId ?? parent?.projectId,
    ownerId: input.ownerId ?? parent?.ownerId,
    operationContext: operationContext
      ? Object.freeze(structuredClone(operationContext))
      : undefined,
    targetContext,
    executionTarget,
    serial: targetContext.kind === "device" ? targetContext.serial : undefined,
    deviceName: parent?.deviceName,
    // A provider session is still a concrete iOS/Android execution target.
    // Only the legacy browser projection lacks a device platform; collapsing
    // cloud iOS to Android here would make a retry reconstruct a local target.
    platform: targetContext.kind === "browser" ? ("android" as const) : targetContext.platform,
    targetKind,
    browserTargetId: targetContext.kind === "browser" ? targetContext.targetId : undefined,
    browserCaseProfile,
    targetProfile: selectedTargetProfile,
    ...(unsignedLaneId ? { unsignedLaneId } : {}),
    sourceRevision: input.sourceRevision
      ? structuredClone(input.sourceRevision)
      : parent?.sourceRevision,
    workerId: assignment.workerId,
    workerCapacity: assignment.capacity,
    hostWorkerId: assignment.host?.workerId,
    hostWorkerCapacity: assignment.host?.capacity,
    status: "queued" as const,
    queuedAt: now(),
    logs: [] as string[],
    attempts: parent ? parent.attempts + 1 : attemptSeed,
    retryOf: input.retryOf,
    previousError: parent?.error ?? parent?.previousError,
    steps: [] as TraceStep[],
    frames: [] as TraceFrameRef[],
    artifacts: [...(input.artifacts ?? [])] as {
      kind: string;
      capturedAt: number;
      data: unknown;
    }[],
    batchId: input.batchId ?? parent?.batchId,
    caseIndex: input.caseIndex ?? parent?.caseIndex,
    caseCount: input.caseCount ?? parent?.caseCount,
    resolvedInputs: Object.assign({}, parent?.resolvedInputs ?? input.variables),
    sensitiveInputNames: [
      ...new Set(parent?.sensitiveInputNames ?? input.sensitiveInputNames ?? []),
    ].sort((left, right) => left.localeCompare(right)),
    recipeSnapshot: structuredClone(input.recipeSnapshot ?? parent?.recipeSnapshot),
    recipeGraph: structuredClone(input.recipeGraph ?? parent?.recipeGraph),
    evidencePolicy: structuredClone(
      input.evidencePolicy ?? parent?.evidencePolicy ?? getEvidenceCollectionPolicy(),
    ),
    options: {
      prodAccountMatch: input.prodAccountMatch ?? parent?.options?.prodAccountMatch,
    },
  };

  // `action` remains the report/event label; every execution itself is a frozen recipe.
  const recipeId = input.recipe;
  const job: TestJob = {
    ...baseJob,
    action: recipeId,
    recipeId,
    glyphs: ["ai", "wait"],
    kind: "Replay",
    tone: "acc",
    title: input.title ?? recipeId,
  };
  Object.defineProperty(job, "toJSON", {
    enumerable: false,
    value: () => toTransport(job),
  });
  return job;
}
