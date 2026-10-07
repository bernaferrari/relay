import { browserCaseProfileForTarget } from "@relay/core/browser-case-profile-target";
import { sameAppMapRuntimeTargetProfile } from "@relay/core/app-map-runtime-target-profile";
import {
  NativeTargetProfileSelectionError,
  selectNativeTargetProfile,
  type NativeDeviceFacts,
} from "@relay/core/native-target-profile";
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
  constructor(
    message: string,
    /** Names of the browsers this Test has saved screens for. */
    readonly recordedOn: readonly string[] = [],
    /** Same browser, but its account, size, or locale differs from the recording. */
    readonly setupChanged = false,
    /** Several saved setups match this browser equally. */
    readonly ambiguous = false,
  ) {
    super(message);
  }
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
  const recordedOn = [
    ...new Set(
      (compiled.plan.rawAccessibilityTargetProfiles ?? [])
        .filter((profile) => profile.platform === "browser" && profile.targetId !== targetId)
        .map(
          (profile) =>
            registered.targets.find((target) => target.id === profile.targetId)?.name ??
            profile.targetId,
        ),
    ),
  ];
  if (targets.length !== 1)
    throw new BrowserTargetProfileSelectionError(
      targets.length === 0
        ? "That browser is no longer set up in Relay."
        : "More than one browser is registered with that name.",
      recordedOn,
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
  const sameBrowser = (compiled.plan.rawAccessibilityTargetProfiles ?? []).filter(
    (profile) =>
      profile.platform === "browser" && profile.targetId === targetId && profile.browserCaseProfile,
  );
  if (candidates.length === 0 && sameBrowser.length) {
    // The Test was recorded signed in, and that sign-in still exists: run as
    // that account instead of refusing. Size, engine, locale, etc. still must match.
    const recordedAccount = await recordedAccountProfile(
      operations,
      compiled,
      sameBrowser,
      current as unknown as Record<string, unknown>,
      targetId,
    );
    if (recordedAccount) return recordedAccount;
    const changed = changedBrowserSetup(
      sameBrowser[sameBrowser.length - 1]!.browserCaseProfile as unknown as Record<string, unknown>,
      current as unknown as Record<string, unknown>,
    );
    throw new BrowserTargetProfileSelectionError(
      changed.length
        ? `This browser’s ${listNames(changed)} changed since the Test was recorded.`
        : "This browser’s setup changed since the Test was recorded.",
      [],
      true,
    );
  }
  if (candidates.length !== 1)
    throw new BrowserTargetProfileSelectionError(
      candidates.length === 0
        ? recordedOn.length
          ? `This Test was recorded on ${listNames(recordedOn)}. It has no saved screens for this browser yet.`
          : "This Test has no saved screens for this browser yet."
        : "This browser matches more than one saved setup for this Test.",
      candidates.length === 0 ? recordedOn : [],
      false,
      candidates.length > 1,
    );
  return candidates[0]!.id;
}

/** Native identity comes from current runtime facts. An expected-screen
 * intersection cannot prove which locale or runtime is currently on a phone. */
export function selectDeviceTargetProfile(
  compiled: ValidCompile,
  target: Extract<AuthoringTarget, { kind: "device" }>,
  observed?: NativeDeviceFacts,
): string | undefined {
  const candidates = (compiled.plan.rawAccessibilityTargetProfiles ?? []).filter(
    (profile) => profile.platform === target.platform && profile.targetId === target.targetId,
  );
  if (candidates.length === 0) return undefined;

  try {
    return selectNativeTargetProfile({ target, profiles: candidates, observed })?.id;
  } catch (error) {
    if (error instanceof NativeTargetProfileSelectionError)
      throw new DeviceTargetProfileSelectionError(error.message);
    throw error;
  }
}

/** An ambiguous saved namespace can be narrowed by passive discovery facts.
 * Device discovery never starts a screenshot, accessibility query or input. */
export async function resolveDeviceTargetProfile(
  operations: RelayOperationPort,
  compiled: ValidCompile,
  target: Extract<AuthoringTarget, { kind: "device" }>,
): Promise<string | undefined> {
  const candidates =
    compiled.plan.rawAccessibilityTargetProfiles?.filter(
      (profile) => profile.targetId === target.targetId && profile.platform === target.platform,
    ) ?? [];
  if (candidates.length < 2) return selectDeviceTargetProfile(compiled, target);
  const inventory = await operations.invoke("target.devices.list", {
    targetId: target.targetId,
    targetKind: "device",
  });
  const observed = inventory.devices.find(
    (device) => device.serial === target.targetId && device.platform === target.platform,
  );
  return selectDeviceTargetProfile(compiled, target, observed);
}

export function frozenIdentity(
  intent: RunTestIntent & { target: AuthoringTarget },
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
    ...(intent.engine ? { engine: intent.engine } : {}),
    ...(intent.account ? { account: { ...intent.account } } : {}),
    ...(intent.capture
      ? { capture: { fullSurfaceScreenIds: [...intent.capture.fullSurfaceScreenIds] } }
      : {}),
    ...(intent.workflowRequestId ? { workflowRequestId: intent.workflowRequestId } : {}),
  };
}

function accountFromFrozen(
  frozen: Record<string, WorkflowJsonValue>,
): Pick<FrozenRunTestIdentity, "account"> {
  const account = frozen.account;
  if (!account || typeof account !== "object" || Array.isArray(account)) return {};
  const record = account as Record<string, WorkflowJsonValue>;
  if (record.kind === "signed-out" && record.attested === true) {
    return { account: { kind: "signed-out", attested: true } };
  }
  if (
    record.kind === "fixture" &&
    typeof record.accountId === "string" &&
    record.accountId &&
    typeof record.accountRevision === "string" &&
    record.accountRevision
  ) {
    return {
      account: {
        kind: "fixture",
        accountId: record.accountId,
        accountRevision: record.accountRevision,
        ...(typeof record.reference === "string" && record.reference
          ? { reference: record.reference }
          : {}),
      },
    };
  }
  return {};
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
    ...(frozen.engine === "chromium" || frozen.engine === "firefox" || frozen.engine === "webkit"
      ? { engine: frozen.engine }
      : {}),
    ...accountFromFrozen(frozen),
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

export type ResolvedRunTestLane = { intent: RunTestIntent } | { problem: WorkflowProblem };

/** Resolve a saved Lane into the exact who-and-where a Run executes on.
 *
 * The Lane is authoritative: its bound target, runtime profile, engine, and
 * account replace whatever ambient target the caller had, so a Run can never
 * silently execute on another device or account than the saved configuration
 * (the wrong-account bug this boundary exists to prevent). */
export async function resolveRunTestLane(
  operations: RelayOperationPort,
  intent: RunTestIntent,
): Promise<ResolvedRunTestLane> {
  const laneId = intent.laneId!;
  let lane: OperationOutput<"lane.list">["lanes"][number] | undefined;
  try {
    const listed = await operations.invoke("lane.list", {});
    lane = listed.lanes.find((candidate) => candidate.id === laneId);
  } catch (error) {
    return {
      problem: mutationUnknownWorkflowProblem("read the saved Lane", error),
    };
  }
  if (!lane) {
    return {
      problem: {
        code: "invalid-intent",
        title: `Lane ${laneId} is not saved in this workspace`,
        detail: "A Run Lane must already exist; Relay never creates it implicitly.",
        recovery: `Save the Lane first (relay lane save ${laneId}), then start the Run again.`,
        retryable: false,
      },
    };
  }
  if (lane.appMapId !== intent.appMapId) {
    return {
      problem: {
        code: "invalid-intent",
        title: `Lane ${laneId} belongs to another App`,
        detail: `The Lane is bound to App ${lane.appMapId}; this Test belongs to ${intent.appMapId}.`,
        recovery: "Run the Test on a Lane saved for this App, or without a Lane.",
        retryable: false,
      },
    };
  }
  const target: AuthoringTarget =
    lane.target.kind === "browser"
      ? { kind: "browser", platform: "browser", targetId: lane.target.browserTargetId }
      : { kind: "device", platform: lane.target.platform, targetId: lane.target.serial };
  return {
    intent: {
      ...intent,
      target,
      ...(lane.targetProfileId ? { targetProfileId: lane.targetProfileId } : {}),
      ...(lane.engine ? { engine: lane.engine } : {}),
      ...(lane.account ? { account: lane.account } : {}),
    },
  };
}

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

const BROWSER_SETUP_LABELS: Record<string, string> = {
  authenticationFixtureId: "signed-in account",
  viewport: "window size",
  locale: "language",
  timezoneId: "time zone",
  colorScheme: "color scheme",
  engine: "browser engine",
  deviceScaleFactor: "pixel density",
  mobile: "mobile mode",
  touch: "touch mode",
  permissions: "permissions",
  offline: "offline mode",
  reducedMotion: "motion setting",
};

/** Human names of the browser settings that differ from the recording. */
export function changedBrowserSetup(
  saved: Record<string, unknown>,
  current: Record<string, unknown>,
): string[] {
  return Object.entries(BROWSER_SETUP_LABELS).flatMap(([key, label]) =>
    JSON.stringify(saved[key] ?? null) === JSON.stringify(current[key] ?? null) ? [] : [label],
  );
}

/** Target profiles whose saved screens this compiled Test actually expects. */
function referencedTargetProfileIds(
  compiled: ValidCompile,
  platform: string,
  targetId: string,
  requireEveryScreen = false,
): Set<string> {
  const expectedScreenIds = new Set<string>();
  for (const recipe of Object.values(compiled.plan.recipes ?? {})) {
    for (const step of recipe.steps) {
      if (step.kind === "expect-screen" && step.screenId) expectedScreenIds.add(step.screenId);
    }
  }
  const referencedProfileIds = new Set<string>();
  let firstReferencedScreen = true;
  for (const screenId of expectedScreenIds) {
    const screenProfiles = new Set<string>();
    for (const variant of compiled.plan.rawAccessibilityVariantsByScreenId?.[screenId] ?? []) {
      if (variant.platform !== platform || variant.targetId !== targetId) continue;
      screenProfiles.add(variant.targetProfileId);
    }
    if (!screenProfiles.size) continue;
    if (requireEveryScreen && !firstReferencedScreen) {
      for (const profileId of referencedProfileIds) {
        if (!screenProfiles.has(profileId)) referencedProfileIds.delete(profileId);
      }
    } else for (const profileId of screenProfiles) referencedProfileIds.add(profileId);
    firstReferencedScreen = false;
  }
  return referencedProfileIds;
}

async function recordedAccountProfile(
  operations: RelayOperationPort,
  compiled: ValidCompile,
  profiles: NonNullable<ValidCompile["plan"]["rawAccessibilityTargetProfiles"]>,
  current: Record<string, unknown>,
  targetId: string,
): Promise<string | undefined> {
  const onlyAccountDiffers = profiles.filter((profile) => {
    const saved = profile.browserCaseProfile as unknown as Record<string, unknown> | undefined;
    if (!saved?.authenticationFixtureId) return false;
    const changed = changedBrowserSetup(saved, current);
    return changed.length === 1 && changed[0] === "signed-in account";
  });
  if (!onlyAccountDiffers.length) return undefined;
  let fixtures: readonly { reference: string; health?: { status?: string } }[];
  try {
    fixtures = (await operations.invoke("target.browser-auth.list", { targetId })).fixtures;
  } catch {
    return undefined;
  }
  const ready = onlyAccountDiffers.filter((profile) =>
    fixtures.some(
      (fixture) =>
        fixture.reference === profile.browserCaseProfile?.authenticationFixtureId &&
        (fixture.health?.status ?? "ready") === "ready",
    ),
  );
  if (!ready.length) return undefined;
  const referenced = referencedTargetProfileIds(compiled, "browser", targetId);
  const preferred = ready.filter((profile) => referenced.has(profile.id));
  const choices = preferred.length ? preferred : ready;
  // Several saved setups for one account are equivalent; take the newest.
  return choices[choices.length - 1]!.id;
}
