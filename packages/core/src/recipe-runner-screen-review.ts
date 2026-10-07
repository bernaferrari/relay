import {
  captureReviewSlotId,
  classifyIosHardware,
  observedCaptureReviewAccount,
  type CaptureReviewConfiguration,
  type CaptureReviewObservedSession,
  type CaptureReviewPlannedSlot,
  type CaptureReviewSlotIdentity,
} from "@relay/protocol";
import { extractProbedAccountIdentity } from "./browser-auth-health.js";
import type { IdentityIgnoreObservation, RecipeStepContext } from "./recipe-runner-context.js";
import { recipeScreenIdentityOptions } from "./recipe-runner-context.js";
import type { SnapshotNode } from "./device.js";
import { observeScreenIdentity } from "./screen-identity.js";
import type { RecipeStep } from "./recipes.js";

export function expectScreenIdentityScope(
  ctx: RecipeStepContext,
  step: Extract<RecipeStep, { kind: "expect-screen" }>,
): IdentityIgnoreObservation {
  return {
    screenId: step.screenId,
    frameIndex: ctx.job?.frames?.length ?? 0,
    ...(step.id ? { stepId: step.id, checkpointId: step.id } : {}),
  };
}

export function observeStepIdentity(
  nodes: readonly SnapshotNode[],
  ctx: RecipeStepContext,
  step: Extract<RecipeStep, { kind: "expect-screen" }>,
) {
  return observeScreenIdentity(
    nodes,
    recipeScreenIdentityOptions(ctx, step.ignoreRegions, expectScreenIdentityScope(ctx, step)),
  );
}

function textField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function combineCellChildLaneId(
  artifacts: readonly { kind?: string; data?: unknown }[] | undefined,
): string | undefined {
  for (const artifact of artifacts ?? []) {
    if (artifact.kind !== "app-map-combine-cell-execution-intent") continue;
    const data =
      artifact.data && typeof artifact.data === "object" && !Array.isArray(artifact.data)
        ? (artifact.data as Record<string, unknown>)
        : undefined;
    const child =
      data?.child && typeof data.child === "object" && !Array.isArray(data.child)
        ? (data.child as Record<string, unknown>)
        : undefined;
    const laneId = textField(child?.laneId);
    if (laneId) return laneId;
  }
  return undefined;
}

function snapshotNodeIdentityLabels(nodes: readonly SnapshotNode[] | undefined): string[] {
  if (!nodes?.length) return [];
  const labels: string[] = [];
  for (const node of nodes) {
    for (const value of [node.label, node.content, node.value, node.identifier]) {
      const text = value?.replace(/\s+/gu, " ").trim();
      if (text) labels.push(text);
    }
  }
  return labels;
}

function liveCaptureReviewIdentityFromNodes(
  nodes: readonly SnapshotNode[] | undefined,
): string | undefined {
  const labels = snapshotNodeIdentityLabels(nodes);
  if (labels.length === 0) return undefined;
  return extractProbedAccountIdentity({ title: "", bodyText: labels.join("\n"), labels });
}

export function captureReviewConfigurationFromJob(
  job: RecipeStepContext["job"],
  artifacts?: RecipeStepContext["artifacts"],
  nodes?: readonly SnapshotNode[],
): {
  configuration?: CaptureReviewConfiguration;
  observed?: CaptureReviewObservedSession;
} {
  if (!job) return {};
  const viewport = job.browserCaseProfile?.viewport;
  const platform = job.platform?.trim() || job.targetProfile?.platform?.trim() || undefined;
  const iosHardwareClass =
    platform === "ios"
      ? classifyIosHardware({
          name: job.deviceName ?? job.targetProfile?.name,
          kind: job.targetProfile?.model,
          serial: job.serial,
          device: job.serial,
        })
      : undefined;
  const labeled = observedCaptureReviewAccount({
    laneId:
      job.laneId || combineCellChildLaneId(job.artifacts) || combineCellChildLaneId(artifacts),
    unsignedLaneId: job.unsignedLaneId,
    targetKind: job.targetKind,
    targetProfileId: job.targetProfile?.id,
    platform,
    ...(iosHardwareClass ? { iosHardwareClass } : {}),
    authenticationFixtureId: job.browserCaseProfile?.authenticationFixtureId,
    liveIdentity: job.authenticationHealth?.identity || liveCaptureReviewIdentityFromNodes(nodes),
    resolvedAccount: job.resolvedInputs?.account?.trim() || job.resolvedInputs?.Account?.trim(),
    fixtureHealthStatus: job.authenticationHealth?.status,
    fixtureSignedIn: job.authenticationHealth?.signedIn,
  });
  const locale =
    job.resolvedInputs?.language?.trim() ||
    job.resolvedInputs?.locale?.trim() ||
    job.browserCaseProfile?.locale;
  const browserJob = Boolean(job.browserTargetId || job.browserCaseProfile);
  const observed: CaptureReviewObservedSession | undefined = (() => {
    const session: CaptureReviewObservedSession = {
      ...labeled.observed,
      ...(browserJob ? { sessionStore: "playwright-user-data" as const } : {}),
    };
    return Object.keys(session).length ? session : undefined;
  })();
  const configuration: CaptureReviewConfiguration = {
    ...(job.deviceName?.trim() || job.browserTargetId?.trim()
      ? { app: (job.deviceName ?? job.browserTargetId)!.trim() }
      : {}),
    ...(labeled.account ? { account: labeled.account } : {}),
    ...(job.browserCaseProfile?.engine ? { browser: job.browserCaseProfile.engine } : {}),
    ...(viewport ? { viewport: `${viewport.width}×${viewport.height}` } : {}),
    ...(locale ? { locale } : {}),
    ...(job.sourceRevision?.buildId?.trim()
      ? { build: job.sourceRevision.buildId.trim() }
      : job.appVersion?.trim()
        ? { build: job.appVersion.trim() }
        : {}),
  };
  return {
    ...(Object.keys(configuration).length ? { configuration } : {}),
    ...(observed ? { observed } : {}),
  };
}

function integerField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export function capturedReviewIdentities(
  artifacts: readonly { kind?: string; data?: unknown }[] | undefined,
  plannedSlots: readonly CaptureReviewPlannedSlot[] = [],
): CaptureReviewSlotIdentity[] {
  const identities: CaptureReviewSlotIdentity[] = [];
  for (const artifact of artifacts ?? []) {
    if (artifact.kind !== "capture-review") continue;
    const data =
      artifact.data && typeof artifact.data === "object" && !Array.isArray(artifact.data)
        ? (artifact.data as Record<string, unknown>)
        : undefined;
    const checkpointId = textField(data?.checkpointId) ?? textField(data?.stepId);
    if (!checkpointId) continue;
    const iteration = integerField(data?.iteration);
    const attempt = integerField(data?.attempt);
    const frozen = plannedSlots.find(
      (slot) => captureReviewSlotId(slot) === textField(data?.slotId),
    );
    identities.push({
      ...(frozen?.configuration ? { configuration: frozen.configuration } : {}),
      checkpointId,
      ...(textField(data?.requirementId) ? { requirementId: textField(data?.requirementId) } : {}),
      ...(textField(data?.invocation) ? { invocation: textField(data?.invocation) } : {}),
      ...(iteration !== undefined ? { iteration } : {}),
      ...(attempt !== undefined ? { attempt } : {}),
      ...(textField(data?.phase) ? { phase: textField(data?.phase) } : {}),
    });
  }
  return identities;
}

export function reviewCapturePhase(
  review: Extract<RecipeStep, { kind: "screenshot" }>["review"],
): string | undefined {
  const named = review?.phase?.trim();
  if (named) return named;
  if (review?.policy === "sequence") return review.phases?.[0]?.id;
  return undefined;
}

export function persistCaptureReviewPlannedSlots(
  ctx: RecipeStepContext,
  slots: CaptureReviewPlannedSlot[],
): void {
  ctx.plannedSlots = slots;
  for (const artifact of ctx.job?.artifacts ?? ctx.artifacts ?? []) {
    if (!artifact?.data || typeof artifact.data !== "object" || Array.isArray(artifact.data)) {
      continue;
    }
    const data = artifact.data as {
      plan?: { plannedSlots?: CaptureReviewPlannedSlot[] };
    };
    if (artifact.kind === "app-map-test-execution-intent" && data.plan) {
      data.plan.plannedSlots = slots;
    }
    // A Combine child's slots are frozen under its canonical intent digest.
    // Setup/restore and recaptures keep their runtime slots in ctx, without
    // replacing those campaign obligations or invalidating the frozen intent.
  }
}
