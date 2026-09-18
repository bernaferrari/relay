import type { ActorKind } from "./coordination.js";
import type { BrowserLaneSessionStoreKind } from "./browser-lane-session.js";
import type { CaptureRasterPolicy } from "./recipes.js";
import {
  BLOCKED_CAPTURE_REVIEW_ACCOUNT,
  CAPTURE_REVIEW_DEST_PHASE,
  CAPTURE_REVIEW_LEFTOVER_PHASE,
  captureReviewIdentityFramePaths,
  captureReviewFillsDestPhase,
  captureReviewLeftoverFramePaths,
  captureReviewLeftoverLastFramePaths,
  destIdentityCheckpointFramePaths,
  destIdentityReviewItems,
  destIdentitySourceFrames,
  enrichCaptureReviewObservedSession,
  fixtureCaptureReviewAccountIsBlocked,
  formatCaptureReviewObservedSession,
  isCaptureReviewDestPhase,
  isCaptureReviewLeftoverCaption,
  isCaptureReviewLeftoverPhase,
  isCaptureReviewOpenerCaption,
  isDeviceCaptureReviewObserved,
  leftoverCloseCaption,
  liveCaptureReviewAccount,
  observedCaptureReviewAccount,
  projectCaptureReviewDestIdentity,
  sameCheckpointFamily,
} from "./capture-review-identity.js";
export {
  BLOCKED_CAPTURE_REVIEW_ACCOUNT,
  CAPTURE_REVIEW_DEST_PHASE,
  CAPTURE_REVIEW_LEFTOVER_PHASE,
  captureReviewIdentityFramePaths,
  captureReviewFillsDestPhase,
  captureReviewLeftoverFramePaths,
  captureReviewLeftoverLastFramePaths,
  destIdentityCheckpointFramePaths,
  destIdentityReviewItems,
  destIdentitySourceFrames,
  enrichCaptureReviewObservedSession,
  fixtureCaptureReviewAccountIsBlocked,
  formatCaptureReviewObservedSession,
  isCaptureReviewDestPhase,
  isCaptureReviewLeftoverCaption,
  isCaptureReviewLeftoverPhase,
  isCaptureReviewOpenerCaption,
  isDeviceCaptureReviewObserved,
  leftoverCloseCaption,
  liveCaptureReviewAccount,
  observedCaptureReviewAccount,
  projectCaptureReviewDestIdentity,
  sameCheckpointFamily,
} from "./capture-review-identity.js";
export type { CaptureReviewEvidenceFrame } from "./capture-review-identity.js";
import {
  captureReviewSlotFamilyId,
  captureReviewSlotId,
  materializeCaptureReviewSlots,
  normalizedCaptureReviewAttempt,
  plannedSlotHasAttempt,
  sameCaptureReviewAttempt,
  withCaptureReviewAttempt,
} from "./capture-review-slots.js";
export {
  assignCaptureReviewAttempt,
  captureReviewCheckpointFamilyId,
  captureReviewEnterModule,
  captureReviewEnterRepeat,
  captureReviewSlotFamilyId,
  captureReviewSlotId,
  formatCaptureReviewConfiguration,
  joinCaptureReviewInvocation,
  materializeCaptureReviewSlots,
  namedCaptureSequencePhases,
} from "./capture-review-slots.js";
export type { CaptureReviewRuntimeCursor } from "./capture-review-slots.js";

export const CAPTURE_REVIEW_ACTIONS = ["accept", "report-issue", "need-more-evidence"] as const;
export type CaptureReviewAction = (typeof CAPTURE_REVIEW_ACTIONS)[number];

export const CAPTURE_REVIEW_STATUSES = [
  "pending",
  "accepted",
  "issue",
  "need-more-evidence",
  "missing",
] as const;
export type CaptureReviewStatus = (typeof CAPTURE_REVIEW_STATUSES)[number];

export type CaptureReviewActor = { id: string; kind: ActorKind };

/**
 * Overlay on one capture for human review. Bound to that item's frame/step.
 * Does not apply to later frames unless that item is selected, does not write
 * a visual baseline, and is not derived from identity-ignore. Looks correct
 * does not copy these into VisualComparisonPolicy.
 */
export type CaptureReviewMask = {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
};

export type CaptureReviewConfiguration = {
  app?: string;
  account?: string;
  browser?: string;
  viewport?: string;
  locale?: string;
  build?: string;
};

/** Lane/profile/cookie-store used at capture time. Display metadata only.
 * Not part of slotId unless a field is already on CaptureReviewConfiguration. */
export type CaptureReviewObservedSession = {
  laneId?: string;
  profileId?: string;
  sessionStore?: BrowserLaneSessionStoreKind;
  /** Fail-closed: unproven is not iPhone or simulator coverage. */
  iosHardwareClass?: "physical-ipad" | "physical-iphone" | "simulator" | "unproven";
};

/** Stable planned capture identity. Caption is display text only. */
export type CaptureReviewSlotIdentity = {
  requirementId?: string;
  checkpointId: string;
  configuration?: CaptureReviewConfiguration;
  invocation?: string;
  iteration?: number;
  attempt?: number;
  /** Named Sequence phase. Recapture of the same phase keeps this family. */
  phase?: string;
};

export type CaptureReviewPlannedSlot = CaptureReviewSlotIdentity & {
  caption: string;
  lookFor?: string;
  stepId?: string;
  /** Authored interval for this phase. Not a wait, and never equated across phases. */
  intervalMs?: number;
};

export type CaptureReviewItem = {
  captureId: string;
  caption: string;
  status: CaptureReviewStatus;
  lookFor?: string;
  framePath?: string;
  imageSha256?: string;
  stepId?: string;
  slotId?: string;
  requirementId?: string;
  checkpointId?: string;
  invocation?: string;
  iteration?: number;
  attempt?: number;
  phase?: string;
  settled?: boolean;
  samples?: number;
  stabilityMeasured?: boolean;
  policy?: CaptureRasterPolicy;
  configuration?: CaptureReviewConfiguration;
  observed?: CaptureReviewObservedSession;
  masks?: CaptureReviewMask[];
  decidedAt?: number;
  decidedBy?: CaptureReviewActor;
  note?: string;
  /** Monotonic review version for optimistic, retry-safe mutations. */
  reviewVersion?: number;
};

export type CaptureReviewDecision = {
  captureId: string;
  action: CaptureReviewAction;
  decidedAt: number;
  decidedBy: CaptureReviewActor;
  imageSha256?: string;
  note?: string;
  /** Durable operation identity used to replay a lost acknowledgement safely. */
  requestId?: string;
  /** Version of this capture after the decision was applied. */
  reviewVersion?: number;
};

export type CaptureReviewSummary = {
  captured: number;
  missing: number;
  pending: number;
  accepted: number;
  issue: number;
  needMoreEvidence: number;
};

export type CaptureReviewQueue = {
  items: CaptureReviewItem[];
  summary: CaptureReviewSummary;
};

export function captureReviewId(input: {
  caption: string;
  framePath?: string;
  imageSha256?: string;
  slotId?: string;
}): string {
  const caption = input.caption.trim() || "screenshot";
  const framePath = input.framePath?.trim();
  const imageSha256 = input.imageSha256?.trim();
  const slotId = input.slotId?.trim();
  if (!framePath) return `missing::${slotId || caption}`;
  if (!imageSha256) return `${framePath}::unhashed`;
  return `${framePath}::${imageSha256}`;
}

function sameCaptureReviewPhase(left?: string, right?: string): boolean {
  return (left?.trim() || "") === (right?.trim() || "");
}

export function captureReviewCoverageLine(summary: CaptureReviewSummary): string {
  const total = summary.captured + summary.missing;
  return `${summary.captured}/${total} captured`;
}

/** Planned / captured / blocked / missing / pending / accepted. Never "N tests passed". */
export function formatCaptureReviewCoverageSummary(
  summary: CaptureReviewSummary & { planned?: number; blocked?: number },
): string {
  if (summary.planned !== undefined) {
    const parts = [
      `${summary.planned} planned`,
      `${summary.captured} captured`,
      `${summary.blocked ?? 0} blocked`,
      `${summary.missing} missing`,
      `${summary.pending} pending`,
      `${summary.accepted} accepted`,
    ];
    if (summary.issue) parts.push(`${summary.issue} issue${summary.issue === 1 ? "" : "s"}`);
    if (summary.needMoreEvidence) {
      parts.push(
        `${summary.needMoreEvidence} need${summary.needMoreEvidence === 1 ? "s" : ""} more evidence`,
      );
    }
    return parts.join(" · ");
  }
  const parts = [captureReviewCoverageLine(summary)];
  if (summary.pending) parts.push(`${summary.pending} pending review`);
  if (summary.accepted) parts.push(`${summary.accepted} accepted`);
  if (summary.issue) parts.push(`${summary.issue} issue${summary.issue === 1 ? "" : "s"}`);
  if (summary.needMoreEvidence) {
    parts.push(
      `${summary.needMoreEvidence} need${summary.needMoreEvidence === 1 ? "s" : ""} more evidence`,
    );
  }
  if (summary.missing) parts.push(`${summary.missing} missing`);
  if (summary.blocked) parts.push(`${summary.blocked} blocked`);
  return parts.join(" · ");
}

/** Keyboard movement for the capture contact sheet. Unrecognized keys leave selection unchanged. */
export function captureReviewAdvanceIndex(
  current: number,
  length: number,
  key: string,
): number | undefined {
  if (!Number.isInteger(current) || length <= 0) return undefined;
  const clamped = Math.min(Math.max(0, current), length - 1);
  if (key === "ArrowRight" || key === "ArrowDown") return Math.min(length - 1, clamped + 1);
  if (key === "ArrowLeft" || key === "ArrowUp") return Math.max(0, clamped - 1);
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return undefined;
}

export function summarizeCaptureReview(items: readonly CaptureReviewItem[]): CaptureReviewSummary {
  const summary: CaptureReviewSummary = {
    captured: 0,
    missing: 0,
    pending: 0,
    accepted: 0,
    issue: 0,
    needMoreEvidence: 0,
  };
  for (const item of items) {
    if (item.status === "missing") summary.missing += 1;
    else summary.captured += 1;
    if (item.status === "pending") summary.pending += 1;
    if (item.status === "accepted") summary.accepted += 1;
    if (item.status === "issue") summary.issue += 1;
    if (item.status === "need-more-evidence") summary.needMoreEvidence += 1;
  }
  return summary;
}

export function captureReviewStatusForAction(
  action: CaptureReviewAction,
): Exclude<CaptureReviewStatus, "pending" | "missing"> {
  if (action === "accept") return "accepted";
  if (action === "report-issue") return "issue";
  return "need-more-evidence";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseMask(value: unknown): CaptureReviewMask | undefined {
  const payload = record(value);
  if (!payload) return undefined;
  const x = finiteNumber(payload.x);
  const y = finiteNumber(payload.y);
  const width = finiteNumber(payload.width);
  const height = finiteNumber(payload.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  if (width <= 0 || height <= 0) return undefined;
  if (text(payload.kind) === "identity-ignore") return undefined;
  return {
    x,
    y,
    width,
    height,
    ...(text(payload.name) ? { name: text(payload.name) } : {}),
  };
}

function parseIosHardwareClass(
  value: unknown,
): CaptureReviewObservedSession["iosHardwareClass"] | undefined {
  return value === "physical-ipad" ||
    value === "physical-iphone" ||
    value === "simulator" ||
    value === "unproven"
    ? value
    : undefined;
}

function parseObservedSession(
  value: unknown,
  appName?: string,
): CaptureReviewObservedSession | undefined {
  const payload = record(value);
  if (!payload) return undefined;
  const store = text(payload.sessionStore);
  const sessionStore: BrowserLaneSessionStoreKind | undefined =
    store === "playwright-user-data" || store === "electron-partition" ? store : undefined;
  const stamped = parseIosHardwareClass(payload.iosHardwareClass);
  const base: CaptureReviewObservedSession = {
    ...(text(payload.laneId) ? { laneId: text(payload.laneId) } : {}),
    ...(text(payload.profileId) ? { profileId: text(payload.profileId) } : {}),
    ...(sessionStore ? { sessionStore } : {}),
    ...(stamped ? { iosHardwareClass: stamped } : {}),
  };
  if (!Object.keys(base).length) return undefined;
  return enrichCaptureReviewObservedSession(base, appName);
}

function parseConfiguration(value: unknown): CaptureReviewConfiguration | undefined {
  const payload = record(value);
  if (!payload) return undefined;
  const configuration: CaptureReviewConfiguration = {
    ...(text(payload.app) ? { app: text(payload.app) } : {}),
    ...(text(payload.account) ? { account: text(payload.account) } : {}),
    ...(text(payload.browser) ? { browser: text(payload.browser) } : {}),
    ...(text(payload.viewport) ? { viewport: text(payload.viewport) } : {}),
    ...(text(payload.locale) ? { locale: text(payload.locale) } : {}),
    ...(text(payload.build) ? { build: text(payload.build) } : {}),
  };
  return Object.keys(configuration).length ? configuration : undefined;
}

function integerField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function sanitizeCaptureReviewConfiguration(
  configuration: CaptureReviewConfiguration | undefined,
  observed?: CaptureReviewObservedSession,
): CaptureReviewConfiguration | undefined {
  if (!configuration) return undefined;
  const account = liveCaptureReviewAccount(configuration.account, observed);
  const next: CaptureReviewConfiguration = {
    ...(configuration.app?.trim() ? { app: configuration.app.trim() } : {}),
    ...(account ? { account } : {}),
    ...(configuration.browser?.trim() ? { browser: configuration.browser.trim() } : {}),
    ...(configuration.viewport?.trim() ? { viewport: configuration.viewport.trim() } : {}),
    ...(configuration.locale?.trim() ? { locale: configuration.locale.trim() } : {}),
    ...(configuration.build?.trim() ? { build: configuration.build.trim() } : {}),
  };
  return Object.keys(next).length ? next : undefined;
}

function captureReviewArtifact(data: unknown): CaptureReviewItem | undefined {
  const payload = record(data);
  if (!payload) return undefined;
  const caption = text(payload.caption) ?? "screenshot";
  const framePath = text(payload.framePath);
  const imageSha256 = text(payload.imageSha256);
  const status = payload.status === "missing" || !framePath ? "missing" : "pending";
  const configurationRaw = parseConfiguration(payload.configuration);
  const observed = parseObservedSession(payload.observed, configurationRaw?.app);
  // Keep raw configuration for slot identity; strip false device signed-out on the item.
  const configuration = sanitizeCaptureReviewConfiguration(configurationRaw, observed);
  const masks = Array.isArray(payload.masks)
    ? payload.masks.flatMap((value) => {
        const mask = parseMask(value);
        return mask ? [mask] : [];
      })
    : [];
  const checkpointId = text(payload.checkpointId) ?? text(payload.stepId);
  const iteration = integerField(payload.iteration);
  const attempt = integerField(payload.attempt);
  const phase = text(payload.phase);
  const slotIdentity: CaptureReviewSlotIdentity | undefined = checkpointId
    ? {
        checkpointId,
        ...(text(payload.requirementId) ? { requirementId: text(payload.requirementId) } : {}),
        ...(configurationRaw ? { configuration: configurationRaw } : {}),
        ...(text(payload.invocation) ? { invocation: text(payload.invocation) } : {}),
        ...(iteration !== undefined ? { iteration } : {}),
        ...(attempt !== undefined ? { attempt } : {}),
        ...(phase ? { phase } : {}),
      }
    : undefined;
  // Only a persisted `slotId` is authoritative. The derived identity is still
  // useful for capture ids when a legacy artifact has no frame, but treating
  // it as explicit would make a legacy artifact with extra configuration
  // contradict an otherwise compatible checkpoint match.
  const explicitSlotId = text(payload.slotId);
  const derivedSlotId = slotIdentity ? captureReviewSlotId(slotIdentity) : undefined;
  const slotId = explicitSlotId;
  const reviewVersion =
    typeof payload.reviewVersion === "number" &&
    Number.isInteger(payload.reviewVersion) &&
    payload.reviewVersion >= 0
      ? payload.reviewVersion
      : 0;
  return {
    captureId: captureReviewId({
      caption,
      ...(framePath ? { framePath } : {}),
      ...(imageSha256 ? { imageSha256 } : {}),
      ...((explicitSlotId ?? derivedSlotId) && !framePath
        ? { slotId: explicitSlotId ?? derivedSlotId }
        : {}),
    }),
    caption,
    status,
    ...(text(payload.lookFor) ? { lookFor: text(payload.lookFor) } : {}),
    ...(framePath ? { framePath } : {}),
    ...(imageSha256 ? { imageSha256 } : {}),
    ...(text(payload.stepId) ? { stepId: text(payload.stepId) } : {}),
    ...(slotId ? { slotId } : {}),
    ...(slotIdentity?.requirementId ? { requirementId: slotIdentity.requirementId } : {}),
    ...(slotIdentity?.checkpointId ? { checkpointId: slotIdentity.checkpointId } : {}),
    ...(slotIdentity?.invocation ? { invocation: slotIdentity.invocation } : {}),
    ...(slotIdentity?.iteration !== undefined ? { iteration: slotIdentity.iteration } : {}),
    ...(slotIdentity?.attempt !== undefined ? { attempt: slotIdentity.attempt } : {}),
    ...(slotIdentity?.phase ? { phase: slotIdentity.phase } : {}),
    ...(typeof payload.settled === "boolean" ? { settled: payload.settled } : {}),
    ...(typeof payload.samples === "number" && Number.isFinite(payload.samples)
      ? { samples: payload.samples }
      : {}),
    ...(typeof payload.stabilityMeasured === "boolean"
      ? { stabilityMeasured: payload.stabilityMeasured }
      : {}),
    ...(payload.policy === "fast" || payload.policy === "stable" || payload.policy === "sequence"
      ? { policy: payload.policy }
      : {}),
    ...(configuration ? { configuration } : {}),
    ...(observed ? { observed } : {}),
    ...(masks.length ? { masks } : {}),
    reviewVersion,
  };
}

function plannedItem(slot: CaptureReviewPlannedSlot): CaptureReviewItem {
  const slotId = captureReviewSlotId(slot);
  return {
    captureId: captureReviewId({ caption: slot.caption, slotId }),
    caption: slot.caption,
    status: "missing",
    reviewVersion: 0,
    slotId,
    checkpointId: slot.checkpointId,
    ...(slot.lookFor ? { lookFor: slot.lookFor } : {}),
    ...(slot.stepId ? { stepId: slot.stepId } : {}),
    ...(slot.requirementId ? { requirementId: slot.requirementId } : {}),
    ...(slot.invocation ? { invocation: slot.invocation } : {}),
    ...(slot.iteration !== undefined ? { iteration: slot.iteration } : {}),
    attempt: normalizedCaptureReviewAttempt(slot.attempt),
    ...(slot.phase ? { phase: slot.phase } : {}),
    ...(slot.configuration ? { configuration: slot.configuration } : {}),
  };
}

function sameOptional<T>(left: T | undefined, right: T | undefined): boolean {
  return left === undefined || right === undefined || left === right;
}

function artifactMatchesSlot(artifact: CaptureReviewItem, slot: CaptureReviewPlannedSlot): boolean {
  if (!captureReviewFillsDestPhase(artifact.phase, slot.phase)) return false;
  const artifactSlotId = artifact.slotId?.trim();
  if (artifactSlotId) {
    // An explicit slot identity is authoritative. A contradictory id is a
    // conflict, never permission to retry a weaker checkpoint/step match.
    if (artifactSlotId !== captureReviewSlotId(slot)) return false;
    if (!captureReviewConfigurationMatchesSlot(artifact.configuration, slot.configuration)) {
      return false;
    }
    if (artifact.checkpointId && artifact.checkpointId !== slot.checkpointId) return false;
    if (artifact.stepId && slot.stepId && artifact.stepId !== slot.stepId) return false;
    if (!sameOptional(artifact.invocation, slot.invocation)) return false;
    if (!sameOptional(artifact.iteration, slot.iteration)) return false;
    if (!sameCaptureReviewAttempt(artifact.attempt, slot.attempt)) return false;
    // A slot id may intentionally name an unphased freeze slot while the
    // artifact carries the more specific dest phase as evidence metadata.
    return true;
  }
  if (!captureReviewConfigurationMatchesSlot(artifact.configuration, slot.configuration)) {
    return false;
  }
  const checkpoint = artifact.checkpointId ?? artifact.stepId;
  if (checkpoint && checkpoint === slot.checkpointId) {
    return (
      sameOptional(artifact.invocation, slot.invocation) &&
      sameOptional(artifact.iteration, slot.iteration) &&
      sameCaptureReviewAttempt(artifact.attempt, slot.attempt) &&
      sameCaptureReviewPhase(artifact.phase, slot.phase)
    );
  }
  if (artifact.stepId && artifact.stepId === slot.stepId) {
    return (
      sameOptional(artifact.iteration, slot.iteration) &&
      sameCaptureReviewPhase(artifact.phase, slot.phase)
    );
  }
  return false;
}

function captureReviewConfigurationMatchesSlot(
  artifact: CaptureReviewConfiguration | undefined,
  slot: CaptureReviewConfiguration | undefined,
): boolean {
  // Missing configuration is the legacy compatibility path. When both sides
  // carry a field, a disagreement is explicit contradictory evidence.
  if (!artifact || !slot) return true;
  return Object.entries(artifact).every(([key, value]) => {
    const planned = slot[key as keyof CaptureReviewConfiguration];
    return planned === undefined || planned === value;
  });
}

function bindArtifactToSlots(
  artifact: CaptureReviewItem,
  items: CaptureReviewItem[],
  slots: readonly CaptureReviewPlannedSlot[],
  bound: Set<number>,
): boolean {
  const exact: number[] = [];
  const byStep: number[] = [];
  for (const [index, slot] of slots.entries()) {
    if (bound.has(index)) continue;
    if (artifactMatchesSlot(artifact, slot)) exact.push(index);
    else if (
      !artifact.slotId &&
      artifact.stepId &&
      artifact.stepId === slot.stepId &&
      sameCaptureReviewPhase(artifact.phase, slot.phase) &&
      captureReviewFillsDestPhase(artifact.phase, slot.phase) &&
      captureReviewConfigurationMatchesSlot(artifact.configuration, slot.configuration)
    ) {
      byStep.push(index);
    }
  }
  const candidates = exact.length ? exact : artifact.slotId ? [] : byStep;
  if (candidates.length === 1) {
    const index = candidates[0]!;
    bound.add(index);
    const slot = slots[index]!;
    items[index] = {
      ...artifact,
      caption: slot.caption,
      lookFor: artifact.lookFor ?? slot.lookFor,
      slotId: captureReviewSlotId(slot),
      checkpointId: slot.checkpointId,
      stepId: artifact.stepId ?? slot.stepId,
      requirementId: artifact.requirementId ?? slot.requirementId,
      invocation: artifact.invocation ?? slot.invocation,
      iteration: artifact.iteration ?? slot.iteration,
      attempt: artifact.attempt ?? slot.attempt,
      phase: artifact.phase ?? slot.phase,
      configuration: artifact.configuration ?? slot.configuration,
    };
    return true;
  }
  return false;
}

function leftoverArtifactWithoutLeftoverSlot(
  artifact: CaptureReviewItem,
  slots: readonly CaptureReviewPlannedSlot[],
  bound: Set<number>,
): boolean {
  if (!isCaptureReviewLeftoverPhase(artifact.phase)) return false;
  return !slots.some(
    (slot, index) => !bound.has(index) && isCaptureReviewLeftoverPhase(slot.phase),
  );
}

function leftoverLastFrameExtra(
  artifact: CaptureReviewItem,
  destArtifacts: readonly CaptureReviewItem[],
): boolean {
  if (!destArtifacts.length || isCaptureReviewDestPhase(artifact.phase)) return false;
  if (isCaptureReviewLeftoverPhase(artifact.phase) || leftoverCloseCaption(artifact.caption)) {
    return true;
  }
  const destPaths = destArtifacts.flatMap((item) => (item.framePath ? [item.framePath] : []));
  return Boolean(artifact.framePath && destPaths.some((path) => artifact.framePath! > path));
}

function artifactImpersonatesDestSlot(
  artifact: CaptureReviewItem,
  slots: readonly CaptureReviewPlannedSlot[],
  destArtifacts: readonly CaptureReviewItem[],
): boolean {
  if (isCaptureReviewDestPhase(artifact.phase)) return false;
  const destExists = destArtifacts.some((dest) => sameCheckpointFamily(artifact, dest));
  if (destExists) {
    return slots.some((slot) => {
      if (
        isCaptureReviewLeftoverPhase(slot.phase) &&
        isCaptureReviewLeftoverPhase(artifact.phase)
      ) {
        return false;
      }
      if (artifact.slotId && artifact.slotId === captureReviewSlotId(slot)) return true;
      return sameCheckpointFamily(artifact, slot);
    });
  }
  return slots.some((slot) => {
    if (!isCaptureReviewDestPhase(slot.phase)) return false;
    if (artifact.slotId && artifact.slotId === captureReviewSlotId(slot)) return true;
    const checkpoint = artifact.checkpointId ?? artifact.stepId;
    if (checkpoint && checkpoint === slot.checkpointId) return true;
    return Boolean(artifact.stepId && artifact.stepId === slot.stepId);
  });
}

function overlayDecision(
  item: CaptureReviewItem,
  decisions: readonly CaptureReviewDecision[],
): CaptureReviewItem {
  const match = [...decisions].reverse().find((decision) => {
    if (decision.captureId !== item.captureId) return false;
    if (item.imageSha256 && decision.imageSha256 && decision.imageSha256 !== item.imageSha256) {
      return false;
    }
    return true;
  });
  if (!match || item.status === "missing") return item;
  return {
    ...item,
    status: captureReviewStatusForAction(match.action),
    decidedAt: match.decidedAt,
    decidedBy: match.decidedBy,
    reviewVersion: match.reviewVersion ?? item.reviewVersion ?? 0,
    ...(match.note ? { note: match.note } : {}),
  };
}

function expandPlannedSlotsFromArtifacts(
  planned: CaptureReviewPlannedSlot[],
  artifacts: readonly CaptureReviewItem[],
): CaptureReviewPlannedSlot[] {
  if (!planned.length) return planned;
  const slots: CaptureReviewPlannedSlot[] = planned.map((slot) =>
    slot.attempt === undefined && slot.stepId ? withCaptureReviewAttempt(slot, 1) : slot,
  );
  for (const artifact of artifacts) {
    const checkpointId = artifact.checkpointId ?? artifact.stepId;
    if (!checkpointId) continue;
    const identity: CaptureReviewSlotIdentity = {
      checkpointId,
      ...(artifact.requirementId ? { requirementId: artifact.requirementId } : {}),
      ...(artifact.configuration ? { configuration: artifact.configuration } : {}),
      ...(artifact.invocation ? { invocation: artifact.invocation } : {}),
      ...(artifact.iteration !== undefined ? { iteration: artifact.iteration } : {}),
      attempt: normalizedCaptureReviewAttempt(artifact.attempt),
      ...(artifact.phase ? { phase: artifact.phase } : {}),
    };
    const family = slots.find(
      (slot) => captureReviewSlotFamilyId(slot) === captureReviewSlotFamilyId(identity),
    );
    if (!family) continue;
    const attempt = normalizedCaptureReviewAttempt(identity.attempt);
    if (!plannedSlotHasAttempt(slots, family, attempt)) {
      slots.push(withCaptureReviewAttempt(family, attempt));
    }
  }
  return slots;
}

/** Build the human review queue. Decisions never rewrite execution outcome. */
export function resolveCaptureReviewQueue(input: {
  artifacts?: readonly { kind?: string; data?: unknown }[];
  decisions?: readonly CaptureReviewDecision[];
  recipeSteps?: readonly unknown[];
  recipes?: Record<string, { steps?: readonly unknown[] }>;
  plannedSlots?: readonly CaptureReviewPlannedSlot[];
  configuration?: CaptureReviewConfiguration;
  requirementId?: string;
}): CaptureReviewQueue {
  const artifacts: CaptureReviewItem[] = [];
  const seen = new Set<string>();
  for (const artifact of input.artifacts ?? []) {
    if (artifact?.kind !== "capture-review") continue;
    const item = captureReviewArtifact(artifact.data);
    if (!item || seen.has(item.captureId)) continue;
    seen.add(item.captureId);
    artifacts.push(item);
  }
  const planned = expandPlannedSlotsFromArtifacts(
    materializeCaptureReviewSlots({
      recipeSteps: input.recipeSteps,
      recipes: input.recipes,
      plannedSlots: input.plannedSlots,
      configuration: input.configuration,
      requirementId: input.requirementId,
    }),
    artifacts,
  );
  const items: CaptureReviewItem[] = [];
  if (planned.length) {
    items.push(...planned.map(plannedItem));
    const bound = new Set<number>();
    const extras: CaptureReviewItem[] = [];
    const destArtifacts = artifacts.filter((item) => isCaptureReviewDestPhase(item.phase));
    const ordered = [
      ...destArtifacts,
      ...artifacts.filter((item) => !isCaptureReviewDestPhase(item.phase)),
    ];
    for (const artifact of ordered) {
      if (bindArtifactToSlots(artifact, items, planned, bound)) continue;
      if (artifactImpersonatesDestSlot(artifact, planned, destArtifacts)) continue;
      if (leftoverArtifactWithoutLeftoverSlot(artifact, planned, bound)) continue;
      if (leftoverLastFrameExtra(artifact, destArtifacts)) continue;
      extras.push(artifact);
    }
    items.push(...extras);
  } else {
    const destArtifacts = artifacts.filter((item) => isCaptureReviewDestPhase(item.phase));
    items.push(
      ...(destArtifacts.length
        ? artifacts.filter((item) => !isCaptureReviewLeftoverPhase(item.phase))
        : artifacts),
    );
  }
  const reviewed = items.map((item) => overlayDecision(item, input.decisions ?? []));
  return { items: reviewed, summary: summarizeCaptureReview(reviewed) };
}
