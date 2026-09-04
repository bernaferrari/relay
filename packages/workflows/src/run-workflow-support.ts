import { browserCaseProfileForTarget } from "@relay/core/browser-case-profile-target";
import { sameAppMapRuntimeTargetProfile } from "@relay/core/app-map-runtime-target-profile";
import type {
  AuthoringTarget,
  DurableWorkflowOperationOutput,
  OfflineTestPreflightFinding,
  OperationOutput,
  WorkflowJsonValue,
} from "@relay/protocol";
import { parseCanonicalJob, snapshotFromJob } from "./job-projection.js";
import type {
  DurableWorkflowHandle,
  FrozenRunTestIdentity,
  RunTestSnapshot,
  RunTestIntent,
  WorkflowProblem,
} from "./types.js";
import { mutationUnknownWorkflowProblem } from "./workflow-problems.js";
import type { RelayOperationPort } from "./operation-port.js";
import { isExecutionRisk } from "./execution-risk-preflight.js";

export type ValidCompile = {
  plan: OperationOutput<"app-map.test.compile">["plan"];
  preflight: OperationOutput<"app-map.test.compile">["preflight"];
  blockers: OfflineTestPreflightFinding[];
};

export class BrowserTargetProfileSelectionError extends Error {
  readonly sourceCode = "browser-target-profile-selection-required";
}

export class DeviceTargetProfileSelectionError extends Error {
  readonly sourceCode = "device-target-profile-selection-required";
}

export function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function readCompile(
  output: OperationOutput<"app-map.test.compile">,
  identity: { appMapId: string; appMapRevision: number; testId: string },
): ValidCompile | undefined {
  const preflight = output.preflight;
  if (
    !preflight ||
    typeof preflight !== "object" ||
    !output.plan ||
    typeof output.plan !== "object"
  )
    return undefined;
  if (
    preflight.schemaVersion !== 1 ||
    preflight.mode !== "offline-test-preflight" ||
    preflight.appMapId !== identity.appMapId ||
    preflight.appMapRevision !== identity.appMapRevision ||
    preflight.testId !== identity.testId ||
    typeof preflight.planDigest !== "string" ||
    !preflight.planDigest ||
    !preflight.summary ||
    !validRevision(preflight.summary.blockers) ||
    !isExecutionRisk(preflight.executionRisk) ||
    !Array.isArray(preflight.findings)
  )
    return undefined;
  const blockers = preflight.findings.filter((finding): finding is OfflineTestPreflightFinding =>
    Boolean(
      finding &&
      typeof finding === "object" &&
      finding.severity === "blocker" &&
      typeof finding.code === "string" &&
      typeof finding.message === "string",
    ),
  );
  return blockers.length === preflight.summary.blockers
    ? { plan: output.plan, preflight, blockers }
    : undefined;
}

export async function selectBrowserTargetProfile(
  operations: RelayOperationPort,
  compiled: ValidCompile,
  targetId: string,
): Promise<string> {
  const registered = await operations.invoke("target.list", {});
  const targets = registered.targets.filter(
    (target) => target.id === targetId && target.kind === "browser" && target.browser,
  );
  if (targets.length !== 1)
    throw new BrowserTargetProfileSelectionError(
      targets.length === 0
        ? `Managed browser target ${targetId} is not registered.`
        : `Managed browser target ${targetId} has an ambiguous registration.`,
    );
  const current = browserCaseProfileForTarget(targets[0]!);
  const candidates = (compiled.plan.rawAccessibilityTargetProfiles ?? []).filter(
    (profile) =>
      profile.platform === "browser" &&
      profile.targetId === targetId &&
      profile.browserCaseProfile &&
      sameAppMapRuntimeTargetProfile(
        {
          id: profile.id,
          targetId: profile.targetId,
          platform: profile.platform,
          viewport: profile.browserCaseProfile.viewport,
          browserCaseProfile: profile.browserCaseProfile,
        },
        {
          id: profile.id,
          targetId,
          platform: "browser",
          viewport: current.viewport,
          browserCaseProfile: current,
        },
      ),
  );
  if (candidates.length !== 1)
    throw new BrowserTargetProfileSelectionError(
      candidates.length === 0
        ? `No frozen browser evidence profile matches the current environment for ${targetId}.`
        : `More than one frozen browser evidence profile matches the current environment for ${targetId}.`,
    );
  return candidates[0]!.id;
}

/** Select the one device profile actually referenced by this compiled Test.
 * App Maps may retain older profiles for the same serial, so target identity
 * alone is insufficient. The expected screens in the reviewed plan provide
 * the authoritative narrowing signal. */
export function selectDeviceTargetProfile(
  compiled: ValidCompile,
  target: Extract<AuthoringTarget, { kind: "device" }>,
): string | undefined {
  const candidates = (compiled.plan.rawAccessibilityTargetProfiles ?? []).filter(
    (profile) => profile.platform === target.platform && profile.targetId === target.targetId,
  );
  if (candidates.length === 0) return undefined;

  const expectedScreenIds = new Set<string>();
  for (const recipe of Object.values(compiled.plan.recipes ?? {})) {
    for (const step of recipe.steps) {
      if (step.kind === "expect-screen" && step.screenId) expectedScreenIds.add(step.screenId);
    }
  }
  const referencedProfileIds = new Set<string>();
  for (const screenId of expectedScreenIds) {
    for (const variant of compiled.plan.rawAccessibilityVariantsByScreenId?.[screenId] ?? []) {
      if (variant.platform !== target.platform || variant.targetId !== target.targetId) continue;
      referencedProfileIds.add(variant.targetProfileId);
    }
  }
  const referenced = candidates.filter((profile) => referencedProfileIds.has(profile.id));
  const eligible = referenced.length ? referenced : candidates;
  if (eligible.length !== 1) {
    throw new DeviceTargetProfileSelectionError(
      `The reviewed Test matches ${eligible.length} saved evidence profiles for ${target.platform}:${target.targetId}.`,
    );
  }
  return eligible[0]!.id;
}

export function frozenIdentity(
  intent: RunTestIntent,
  revision: number,
  planDigest: string,
  rootRecipeId?: string,
): FrozenRunTestIdentity {
  return {
    appMapId: intent.appMapId,
    appMapRevision: revision,
    testId: intent.testId,
    ...(rootRecipeId ? { rootRecipeId } : {}),
    planDigest,
    target: { ...intent.target },
    ...(intent.startup ? { startup: { ...intent.startup } } : {}),
    ...(intent.targetProfileId ? { targetProfileId: intent.targetProfileId } : {}),
    ...(intent.sourceRevision ? { sourceRevision: { ...intent.sourceRevision } } : {}),
    ...(intent.capture
      ? { capture: { fullSurfaceScreenIds: [...intent.capture.fullSurfaceScreenIds] } }
      : {}),
    ...(intent.workflowRequestId ? { workflowRequestId: intent.workflowRequestId } : {}),
  };
}

function durableRunIdentity(value: WorkflowJsonValue): FrozenRunTestIdentity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const frozen = value as Record<string, WorkflowJsonValue>,
    target = frozen.target;
  if (
    typeof frozen.appMapId !== "string" ||
    !frozen.appMapId ||
    !validRevision(frozen.appMapRevision) ||
    typeof frozen.testId !== "string" ||
    !frozen.testId ||
    typeof frozen.planDigest !== "string" ||
    !frozen.planDigest ||
    !target ||
    typeof target !== "object" ||
    Array.isArray(target)
  )
    return undefined;
  const t = target as Record<string, WorkflowJsonValue>;
  if (
    (t.kind !== "device" && t.kind !== "browser") ||
    typeof t.targetId !== "string" ||
    !t.targetId ||
    (t.kind === "device" && t.platform !== "android" && t.platform !== "ios")
  )
    return undefined;
  return {
    appMapId: frozen.appMapId,
    appMapRevision: frozen.appMapRevision,
    testId: frozen.testId,
    planDigest: frozen.planDigest,
    target:
      t.kind === "device"
        ? { kind: "device", platform: t.platform as "android" | "ios", targetId: t.targetId }
        : { kind: "browser", platform: "browser", targetId: t.targetId },
    ...(typeof frozen.rootRecipeId === "string" && frozen.rootRecipeId
      ? { rootRecipeId: frozen.rootRecipeId }
      : {}),
    ...(typeof frozen.targetProfileId === "string" && frozen.targetProfileId
      ? { targetProfileId: frozen.targetProfileId }
      : {}),
    ...(typeof frozen.workflowRequestId === "string" && frozen.workflowRequestId
      ? { workflowRequestId: frozen.workflowRequestId }
      : {}),
  };
}

export function unavailableDurableRun(input: {
  workflow: DurableWorkflowHandle;
  frozen?: FrozenRunTestIdentity;
  problem: WorkflowProblem;
  jobId?: string;
}): RunTestSnapshot {
  return {
    schemaVersion: 1,
    kind: "run-test",
    title: `Run ${input.frozen?.testId ?? "Test"}`,
    phase: "needs-attention",
    version: `workflow-v${input.workflow.expectedVersion}`,
    workflow: input.workflow,
    ...(input.frozen ? { frozen: input.frozen } : {}),
    ...(input.jobId ? { execution: { jobId: input.jobId } } : {}),
    progress: { label: input.problem.title },
    allowedNextActions: ["inspect"],
    problems: [input.problem],
    evidenceRefs: [],
  };
}

export function durableRunSnapshot(output: DurableWorkflowOperationOutput): RunTestSnapshot {
  const record = output.workflow.record,
    workflow = { workflowId: record.workflowId, expectedVersion: record.version },
    frozen = durableRunIdentity(record.frozenIdentity),
    job = parseCanonicalJob(output.job);
  if (!frozen || record.kind !== "run-test")
    return unavailableDurableRun({
      workflow,
      problem: {
        code: "malformed-response",
        title: "Relay could not validate this Run workflow",
        detail: "The durable workflow does not contain one valid frozen Run identity.",
        recovery: "Inspect the server-owned workflow after repairing its canonical record.",
        retryable: false,
      },
    });
  if (!job || (record.resource?.kind === "job" && record.resource.id !== job.id)) {
    if (record.status === "terminal" && record.resolution?.kind === "abandoned") {
      return {
        ...unavailableDurableRun({
          workflow,
          frozen,
          problem: {
            code: "operation-unavailable",
            title: "The Test run was rejected before dispatch",
            detail: record.resolution.reason,
            recovery:
              "Correct the reported request or target problem, then start a new Run explicitly.",
            retryable: false,
          },
        }),
        phase: "blocked",
      };
    }
    return unavailableDurableRun({
      workflow,
      frozen,
      ...(record.resource?.kind === "job" ? { jobId: record.resource.id } : {}),
      problem: mutationUnknownWorkflowProblem(
        "the Run outcome was reconciled",
        "Relay cannot yet prove a canonical job for this server-owned workflow.",
      ),
    });
  }
  const projected = snapshotFromJob({ workflow, frozen, job });
  if (
    record.status === "needs-attention" ||
    record.lastTransition === "cancel-requested" ||
    record.lastTransition === "cancel-outcome-unknown"
  )
    return {
      ...projected,
      phase: "needs-attention",
      allowedNextActions: ["inspect"],
      progress: { label: "Run outcome needs reconciliation" },
      problems: [
        ...projected.problems,
        mutationUnknownWorkflowProblem(
          "the last Run mutation",
          `Relay stopped at ${record.lastTransition} and will not issue it again automatically.`,
        ),
      ],
    };
  return projected;
}

export function authoritativePreDispatch(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number" &&
    (error as { status: number }).status >= 400 &&
    (error as { status: number }).status < 500,
  );
}

export function preDispatchProblem(error: unknown): WorkflowProblem {
  return {
    code: "operation-unavailable",
    title: "Relay rejected the Test run before dispatch",
    detail:
      error instanceof Error ? error.message : "Relay rejected the request before creating a job.",
    recovery: "Correct the reported request or target problem, then start a new Run explicitly.",
    retryable: false,
  };
}
