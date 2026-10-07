import {
  parseAppMapRuntimeTargetProfile,
  sameAppMapRuntimeTargetProfile,
} from "@relay/core/app-map-runtime-target-profile";
import type { OperationOutput } from "@relay/protocol";
import { readCompile, type ValidCompile } from "./run-workflow-support.js";
import type { FrozenRunTestIdentity } from "./types.js";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export type QueuedRunIdentity =
  | { status: "missing" | "invalid" }
  | { status: "verified"; frozen: FrozenRunTestIdentity; compiled?: ValidCompile };

/** Complete a provisional Run from the receipt persisted with the queued job.
 * A preliminary compile or a mutable map cannot identify the selected setup. */
export function queuedRunIdentityFromJob(input: {
  frozen: FrozenRunTestIdentity;
  job: unknown;
  requireNativeProfile?: boolean;
  matchPlanDigest?: boolean;
}): QueuedRunIdentity {
  const job = record(input.job);
  const target = input.frozen.target;
  const targetMatches =
    target.kind === "device"
      ? job?.serial === target.targetId && job.platform === target.platform
      : job?.browserTargetId === target.targetId;
  const hasJobTarget = job && ("serial" in job || "platform" in job || "browserTargetId" in job);
  if (hasJobTarget && !targetMatches) return { status: "invalid" };
  const artifacts = Array.isArray(job?.artifacts) ? job.artifacts : [];
  const executionArtifact = artifacts.find(
    (candidate) => record(candidate)?.kind === "app-map-test-execution-intent",
  );
  if (!executionArtifact) return { status: "missing" };
  const execution = record(record(executionArtifact)?.data);
  const source = record(execution?.sourcePlan);
  const frozen = input.frozen;
  if (
    !job ||
    !execution ||
    !source ||
    source.appMapId !== frozen.appMapId ||
    source.appMapRevision !== frozen.appMapRevision ||
    source.testId !== frozen.testId ||
    !nonempty(source.rootRecipeId) ||
    !nonempty(source.digest) ||
    (input.matchPlanDigest && source.digest !== frozen.planDigest)
  )
    return { status: "invalid" };

  if (frozen.workflowRequestId) {
    const request = record(
      record(
        artifacts.find((candidate) => record(candidate)?.kind === "app-map-test-workflow-request"),
      )?.data,
    );
    if (request?.requestId !== frozen.workflowRequestId) return { status: "invalid" };
  }
  if (!targetMatches) return { status: "invalid" };

  const selected = execution.selectedRuntimeTargetProfile;
  const profile = selected === undefined ? undefined : parseAppMapRuntimeTargetProfile(selected);
  if (selected !== undefined && !profile) return { status: "invalid" };
  const planProfiles = record(execution.plan)?.rawAccessibilityTargetProfiles;
  const nativeProfileRequired =
    input.requireNativeProfile ||
    (target.kind === "device" &&
      Array.isArray(planProfiles) &&
      planProfiles.some((candidate) => {
        const profile = record(candidate);
        return profile?.targetId === target.targetId && profile.platform === target.platform;
      }));
  if (
    (nativeProfileRequired && !profile) ||
    (profile && (profile.targetId !== target.targetId || profile.platform !== target.platform)) ||
    (frozen.targetProfileId !== undefined && profile?.id !== frozen.targetProfileId)
  )
    return { status: "invalid" };

  const planArtifact = artifacts.find(
    (candidate) => record(candidate)?.kind === "app-map-test-plan",
  );
  const preflightArtifact = artifacts.find(
    (candidate) => record(candidate)?.kind === "app-map-test-preflight",
  );
  let compiled: ValidCompile | undefined;
  if (planArtifact || preflightArtifact) {
    const plan = record(record(planArtifact)?.data);
    const preflight = record(record(preflightArtifact)?.data);
    compiled = readCompile(
      { plan, preflight: preflight?.report } as OperationOutput<"app-map.test.compile">,
      frozen,
    );
    const planProfile = parseAppMapRuntimeTargetProfile(plan?.runtimeTargetProfile);
    const reportProfile = parseAppMapRuntimeTargetProfile(preflight?.runtimeTargetProfile);
    if (
      !compiled ||
      compiled.blockers.length ||
      compiled.preflight.planDigest !== source.digest ||
      plan?.appMapId !== frozen.appMapId ||
      plan.appMapRevision !== frozen.appMapRevision ||
      record(plan.test)?.id !== frozen.testId ||
      plan.rootRecipeId !== source.rootRecipeId ||
      (profile
        ? !planProfile ||
          !reportProfile ||
          !sameAppMapRuntimeTargetProfile(profile, planProfile) ||
          !sameAppMapRuntimeTargetProfile(profile, reportProfile)
        : plan?.runtimeTargetProfile !== undefined || preflight?.runtimeTargetProfile !== undefined)
    )
      return { status: "invalid" };
  }
  if ((nativeProfileRequired || (target.kind === "device" && profile)) && !compiled)
    return { status: "invalid" };

  return {
    status: "verified",
    frozen: {
      ...frozen,
      rootRecipeId: source.rootRecipeId,
      planDigest: source.digest,
      ...(profile ? { targetProfileId: profile.id } : {}),
    },
    ...(compiled ? { compiled } : {}),
  };
}
