import type { BrowserAuthenticationHealth } from "./browser-authentication-fixture.js";
import type { ActorKind } from "./coordination.js";
import type { BrowserLaneSessionStoreKind } from "./browser-lane-session.js";
import type { CaptureRasterPolicy, CaptureSequencePhase } from "./recipes.js";

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

/** Capture-review account when a fixture is not ready to claim the pixels. */
export const BLOCKED_CAPTURE_REVIEW_ACCOUNT = "blocked";

/** Expired, errored, signed-out, or zero-ready fixtures must not be labeled
 * as the saved account (SuperGrok). Missing health stays the fixture. */
export function fixtureCaptureReviewAccountIsBlocked(input: {
  fixtureHealthStatus?: BrowserAuthenticationHealth["status"];
  fixtureSignedIn?: boolean;
  readyCount?: number;
}): boolean {
  if (input.readyCount === 0) return true;
  if (input.fixtureSignedIn === false) return true;
  return input.fixtureHealthStatus !== undefined && input.fixtureHealthStatus !== "ready";
}

const CAPTURE_REVIEW_ACCOUNT_STAND_INS = new Set([
  "super grok",
  "supergrok",
  "grok-lab",
  "grok-daily",
  "grok-daily-b",
  "grok-daily-c",
  "grok-daily-d",
  "grok-daily-e",
  "grok-daily-f",
  "grok-daily-g",
  "grok-daily-h",
  "grok-auth-email",
  "grok-auth-gmail",
  "grok-auth-x",
  "grok-auth-x-out",
]);

/** Live page account name. Lane ids, SuperGrok, and saved fixture names are not identity. */
export function liveCaptureReviewAccount(value?: string): string | undefined {
  const trimmed = value?.replace(/\s+/gu, " ").trim();
  if (!trimmed || trimmed.length > 80) return undefined;
  const key = trimmed.toLocaleLowerCase();
  if (CAPTURE_REVIEW_ACCOUNT_STAND_INS.has(key) || key.startsWith("grok-")) return undefined;
  return trimmed;
}

/** Account on the pixels, not a Lane-name overlay. Fixture identity wins;
 * unsigned/signed-out stays signed-out even when the Lane is named grok-lab.
 * Device Lanes are not signed-out grok.com identities; leftover BF / person
 * names win over SuperGrok and grok-ios-daily. */
export function observedCaptureReviewAccount(input: {
  laneId?: string;
  unsignedLaneId?: string;
  targetKind?: string;
  targetProfileId?: string;
  authenticationFixtureId?: string;
  fixtureName?: string;
  liveIdentity?: string;
  signedOut?: boolean;
  resolvedAccount?: string;
  fixtureHealthStatus?: BrowserAuthenticationHealth["status"];
  fixtureSignedIn?: boolean;
  readyCount?: number;
}): { account?: string; observed: CaptureReviewObservedSession } {
  const laneId = input.laneId?.trim() || input.unsignedLaneId?.trim() || undefined;
  const unsignedLaneId = input.unsignedLaneId?.trim() || undefined;
  const profileId = input.targetProfileId?.trim() || undefined;
  const fixture = input.authenticationFixtureId?.trim() || undefined;
  const live = liveCaptureReviewAccount(input.liveIdentity);
  const observed: CaptureReviewObservedSession = {
    ...(laneId ? { laneId } : {}),
    ...(profileId ? { profileId } : {}),
  };
  if (fixture) {
    if (fixtureCaptureReviewAccountIsBlocked(input)) {
      return { account: BLOCKED_CAPTURE_REVIEW_ACCOUNT, observed };
    }
    return {
      account: live || liveCaptureReviewAccount(input.fixtureName) || fixture,
      observed,
    };
  }
  if (live) return { account: live, observed };
  const browserUnsigned = Boolean(unsignedLaneId) && input.targetKind !== "device";
  if (input.signedOut === true || browserUnsigned) {
    return { account: "signed-out", observed };
  }
  const resolved = liveCaptureReviewAccount(input.resolvedAccount);
  return { ...(resolved ? { account: resolved } : {}), observed };
}

export function formatCaptureReviewObservedSession(
  observed?: CaptureReviewObservedSession,
): string[] {
  if (!observed) return [];
  const hardware =
    observed.iosHardwareClass === "physical-ipad"
      ? "physical iPad"
      : observed.iosHardwareClass === "physical-iphone"
        ? "physical iPhone"
        : observed.iosHardwareClass === "simulator"
          ? "iOS simulator"
          : observed.iosHardwareClass === "unproven"
            ? "iOS hardware unproven"
            : undefined;
  return [
    observed.laneId,
    observed.profileId,
    observed.sessionStore === "playwright-user-data"
      ? "Playwright user-data"
      : observed.sessionStore === "electron-partition"
        ? "Electron partition"
        : undefined,
    hardware,
  ].filter((part): part is string => Boolean(part?.trim()));
}

/** Dest-end capture-review identity. Leftover dismiss is a later phase. */
export const CAPTURE_REVIEW_DEST_PHASE = "dest";
export const CAPTURE_REVIEW_LEFTOVER_PHASE = "leftover";

export function isCaptureReviewDestPhase(phase?: string): boolean {
  return phase?.trim() === CAPTURE_REVIEW_DEST_PHASE;
}

export function isCaptureReviewLeftoverPhase(phase?: string): boolean {
  return phase?.trim() === CAPTURE_REVIEW_LEFTOVER_PHASE;
}

/** Dest slots bind dest-phase pixels only. Leftover Close/Back cannot fill dest,
 * including unphased freeze slots (no `::dest` suffix). */
function captureReviewFillsDestPhase(
  artifactPhase: string | undefined,
  slotPhase: string | undefined,
): boolean {
  if (isCaptureReviewLeftoverPhase(artifactPhase) && !isCaptureReviewLeftoverPhase(slotPhase)) {
    return false;
  }
  if (!isCaptureReviewDestPhase(slotPhase)) return true;
  return isCaptureReviewDestPhase(artifactPhase) && !isCaptureReviewLeftoverPhase(artifactPhase);
}

function checkpointFamilyKey(item: { checkpointId?: string; stepId?: string }): string | undefined {
  return item.checkpointId?.trim() || item.stepId?.trim() || undefined;
}

function sameCheckpointFamily(
  left: { checkpointId?: string; stepId?: string },
  right: { checkpointId?: string; stepId?: string },
): boolean {
  const leftKey = checkpointFamilyKey(left);
  const rightKey = checkpointFamilyKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

/** Dest-end identity prefers dest-phase capture-review. Leftover Close/Back
 * last-frame artifacts are recorded but never overwrite dest. */
export function captureReviewIdentityFramePaths(
  artifacts: readonly { kind?: string; data?: unknown }[],
): string[] {
  const dest: string[] = [];
  for (const artifact of artifacts) {
    if (artifact.kind !== "capture-review") continue;
    const payload = record(artifact.data);
    const framePath = text(payload?.framePath);
    if (!framePath) continue;
    const phase = text(payload?.phase);
    if (isCaptureReviewLeftoverPhase(phase)) continue;
    if (isCaptureReviewDestPhase(phase)) dest.push(framePath);
  }
  return dest;
}

/** Leftover-phase Close / dismiss rasters. Dest identity stays dest. */
export function captureReviewLeftoverFramePaths(
  artifacts: readonly { kind?: string; data?: unknown }[],
): string[] {
  const leftover: string[] = [];
  for (const artifact of artifacts) {
    if (artifact.kind !== "capture-review") continue;
    const payload = record(artifact.data);
    const framePath = text(payload?.framePath);
    if (!framePath || !isCaptureReviewLeftoverPhase(text(payload?.phase))) continue;
    leftover.push(framePath);
  }
  return leftover;
}

/** Leftover Close / Back / Run saved Test last-frame captions. Dest wait-for
 * Observe is not this. Unphased dest-wait keeps those frames until dest
 * identity also exists. */
export function isCaptureReviewLeftoverCaption(caption?: string): boolean {
  const value = caption?.trim() ?? "";
  return /^(?:close|back)(?:\s|$)/iu.test(value) || /^after · run saved test$/iu.test(value);
}

function leftoverCloseCaption(caption?: string): boolean {
  return isCaptureReviewLeftoverCaption(caption);
}

/** Leftover Close / Run saved Test last-frame after dest identity.
 * Unphased Android dest-wait (no dest identity) keeps every frame. */
export function captureReviewLeftoverLastFramePaths(
  frames: readonly { path: string; caption?: string }[],
  artifacts?: readonly { kind?: string; data?: unknown }[],
): string[] {
  const leftover = new Set(captureReviewLeftoverFramePaths(artifacts ?? []));
  const dest = new Set(captureReviewIdentityFramePaths(artifacts ?? []));
  if (!dest.size) return [...leftover];
  let seenDest = false;
  for (const frame of frames) {
    if (dest.has(frame.path)) {
      seenDest = true;
      continue;
    }
    if (seenDest) leftover.add(frame.path);
  }
  return [...leftover];
}

/** Dest-phase identity rasters only. Leftover Close last-frame cannot fill dest.
 * Unphased runs (Android dest-wait) keep every frame. */
export function destIdentitySourceFrames<T extends { path: string }>(
  frames: readonly T[],
  artifacts?: readonly { kind?: string; data?: unknown }[],
): T[] {
  const destIdentity = new Set(captureReviewIdentityFramePaths(artifacts ?? []));
  if (!destIdentity.size) return [...frames];
  return frames.filter((frame) => destIdentity.has(frame.path));
}

/** Dest wait-for checkpoint paths. Leftover Close / Run saved Test last-frame
 * cannot fill dest even without leftover-phase. Unphased dest-wait keeps listed
 * frames. */
export function destIdentityCheckpointFramePaths(
  frames: readonly { path: string; caption?: string }[],
  artifacts?: readonly { kind?: string; data?: unknown }[],
): string[] {
  const dest = captureReviewIdentityFramePaths(artifacts ?? []);
  if (dest.length) return [...new Set(dest)];
  const leftover = new Set(captureReviewLeftoverLastFramePaths(frames, artifacts));
  const usable = leftover.size ? frames.filter((frame) => !leftover.has(frame.path)) : frames;
  return [...new Set(usable.map((frame) => frame.path))];
}

/** Dest-phase slot cards when dest identity exists. Leftover Close extras cannot fill dest
 * even without leftover-phase. */
export function destIdentityReviewItems<T extends { phase?: string; caption?: string }>(
  items: readonly T[],
): T[] {
  const dest = items.filter((item) => isCaptureReviewDestPhase(item.phase));
  if (dest.length) return dest;
  return items.filter(
    (item) =>
      !isCaptureReviewLeftoverPhase(item.phase) && !isCaptureReviewLeftoverCaption(item.caption),
  );
}

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
};

export type CaptureReviewDecision = {
  captureId: string;
  action: CaptureReviewAction;
  decidedAt: number;
  decidedBy: CaptureReviewActor;
  imageSha256?: string;
  note?: string;
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

export function captureReviewSlotId(identity: CaptureReviewSlotIdentity): string {
  const configuration = formatCaptureReviewConfiguration(identity.configuration).join(",");
  const parts = [
    identity.requirementId?.trim() || "",
    identity.checkpointId.trim() || "checkpoint",
    configuration,
    identity.invocation?.trim() || "",
    identity.iteration === undefined ? "" : String(identity.iteration),
    identity.attempt === undefined ? "" : String(identity.attempt),
  ];
  const phase = identity.phase?.trim();
  if (phase) parts.push(phase);
  return parts.join("::");
}

/** Identity without attempt. Recapture of the same phase keeps this family. */
export function captureReviewSlotFamilyId(identity: CaptureReviewSlotIdentity): string {
  return captureReviewSlotId({ ...identity, attempt: undefined });
}

/** Sequence phases of one checkpoint share this id; phase is not included. */
export function captureReviewCheckpointFamilyId(identity: CaptureReviewSlotIdentity): string {
  return captureReviewSlotId({ ...identity, attempt: undefined, phase: undefined });
}

function sameCaptureReviewPhase(left?: string, right?: string): boolean {
  return (left?.trim() || "") === (right?.trim() || "");
}

/** Named Sequence frames. An unphased sequence is not a silent Stable slot. */
export function namedCaptureSequencePhases(review: unknown): CaptureSequencePhase[] {
  const payload = record(review);
  if (!payload) return [];
  const named: CaptureSequencePhase[] = [];
  const seen = new Set<string>();
  if (Array.isArray(payload.phases)) {
    for (const item of payload.phases) {
      const phase = record(item);
      const id = text(phase?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const intervalMs = integerField(phase?.intervalMs);
      named.push({
        id,
        ...(text(phase?.caption) ? { caption: text(phase?.caption) } : {}),
        ...(text(phase?.lookFor) ? { lookFor: text(phase?.lookFor) } : {}),
        ...(intervalMs !== undefined && intervalMs > 0 ? { intervalMs } : {}),
      });
    }
  }
  const current = text(payload.phase);
  if (current && !seen.has(current)) {
    named.push({ id: current });
  }
  return named;
}

function normalizedCaptureReviewAttempt(attempt?: number): number {
  return attempt === undefined ? 1 : attempt;
}

function sameCaptureReviewAttempt(left?: number, right?: number): boolean {
  return normalizedCaptureReviewAttempt(left) === normalizedCaptureReviewAttempt(right);
}

function withCaptureReviewAttempt(
  slot: CaptureReviewPlannedSlot,
  attempt: number,
): CaptureReviewPlannedSlot {
  return { ...slot, attempt };
}

function plannedSlotHasAttempt(
  slots: readonly CaptureReviewPlannedSlot[],
  identity: CaptureReviewSlotIdentity,
  attempt: number,
): boolean {
  return slots.some(
    (slot) =>
      captureReviewSlotFamilyId(slot) === captureReviewSlotFamilyId(identity) &&
      sameCaptureReviewAttempt(slot.attempt, attempt),
  );
}

/**
 * Assign the next recapture attempt for one checkpoint family.
 * Leftover chrome is not an input; only prior capture identities occupy attempts.
 */
export function assignCaptureReviewAttempt(input: {
  plannedSlots: readonly CaptureReviewPlannedSlot[];
  captured?: readonly CaptureReviewSlotIdentity[];
  slot: CaptureReviewPlannedSlot;
}): { attempt: number; plannedSlots: CaptureReviewPlannedSlot[] } {
  const family = captureReviewSlotFamilyId(input.slot);
  const planned: CaptureReviewPlannedSlot[] = input.plannedSlots.map((slot) =>
    captureReviewSlotFamilyId(slot) === family && slot.attempt === undefined
      ? withCaptureReviewAttempt(slot, 1)
      : slot,
  );
  if (!planned.some((slot) => captureReviewSlotFamilyId(slot) === family)) {
    planned.push(withCaptureReviewAttempt(input.slot, 1));
  }
  const captured = (input.captured ?? []).filter(
    (identity) => captureReviewSlotFamilyId(identity) === family,
  );
  if (captured.length === 0) return { attempt: 1, plannedSlots: planned };
  const occupied = [
    ...planned
      .filter((slot) => captureReviewSlotFamilyId(slot) === family)
      .map((slot) => normalizedCaptureReviewAttempt(slot.attempt)),
    ...captured.map((identity) => normalizedCaptureReviewAttempt(identity.attempt)),
  ];
  const attempt = Math.max(...occupied) + 1;
  if (!plannedSlotHasAttempt(planned, input.slot, attempt)) {
    planned.push(withCaptureReviewAttempt(input.slot, attempt));
  }
  return { attempt, plannedSlots: planned };
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

export function formatCaptureReviewConfiguration(
  configuration?: CaptureReviewConfiguration,
): string[] {
  if (!configuration) return [];
  return [
    configuration.app,
    configuration.account,
    configuration.browser,
    configuration.viewport,
    configuration.locale,
    configuration.build,
  ].filter((part): part is string => Boolean(part?.trim()));
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

function parseObservedSession(value: unknown): CaptureReviewObservedSession | undefined {
  const payload = record(value);
  if (!payload) return undefined;
  const store = text(payload.sessionStore);
  const sessionStore: BrowserLaneSessionStoreKind | undefined =
    store === "playwright-user-data" || store === "electron-partition" ? store : undefined;
  const observed: CaptureReviewObservedSession = {
    ...(text(payload.laneId) ? { laneId: text(payload.laneId) } : {}),
    ...(text(payload.profileId) ? { profileId: text(payload.profileId) } : {}),
    ...(sessionStore ? { sessionStore } : {}),
  };
  return Object.keys(observed).length ? observed : undefined;
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

export function joinCaptureReviewInvocation(parent: string | undefined, part: string): string {
  return parent ? `${parent}/${part}` : part;
}

export type CaptureReviewRuntimeCursor = {
  requirementId?: string;
  invocation?: string;
  iteration?: number;
  attempt?: number;
  moduleCalls: Map<string, number>;
};

export function captureReviewEnterModule(
  cursor: CaptureReviewRuntimeCursor | undefined,
  recipeId: string,
): CaptureReviewRuntimeCursor {
  const moduleCalls = cursor?.moduleCalls ?? new Map<string, number>();
  const call = moduleCalls.get(recipeId) ?? 0;
  moduleCalls.set(recipeId, call + 1);
  return {
    ...(cursor?.requirementId ? { requirementId: cursor.requirementId } : {}),
    ...(cursor?.attempt !== undefined ? { attempt: cursor.attempt } : {}),
    ...(cursor?.iteration !== undefined ? { iteration: cursor.iteration } : {}),
    invocation: joinCaptureReviewInvocation(cursor?.invocation, `module:${recipeId}#${call}`),
    moduleCalls,
  };
}

export function captureReviewEnterRepeat(
  cursor: CaptureReviewRuntimeCursor | undefined,
  recipeId: string,
  iteration: number,
): CaptureReviewRuntimeCursor {
  return {
    ...(cursor?.requirementId ? { requirementId: cursor.requirementId } : {}),
    ...(cursor?.attempt !== undefined ? { attempt: cursor.attempt } : {}),
    invocation: joinCaptureReviewInvocation(cursor?.invocation, `repeat:${recipeId}`),
    iteration,
    moduleCalls: new Map(),
  };
}

function recipeRecord(
  recipes: Record<string, { steps?: readonly unknown[] }> | undefined,
  recipeId: string,
): { steps?: readonly unknown[] } | undefined {
  return recipes?.[recipeId];
}

function plannedScreenshotSlot(
  input: {
    checkpointId: string;
    caption: string;
    lookFor?: string;
    stepId?: string;
    phase?: string;
    intervalMs?: number;
  },
  context: {
    requirementId?: string;
    configuration?: CaptureReviewConfiguration;
    invocation?: string;
    iteration?: number;
    attempt?: number;
  },
): CaptureReviewPlannedSlot {
  return {
    checkpointId: input.checkpointId,
    caption: input.caption,
    attempt: context.attempt ?? 1,
    ...(context.requirementId ? { requirementId: context.requirementId } : {}),
    ...(context.configuration ? { configuration: context.configuration } : {}),
    ...(context.invocation ? { invocation: context.invocation } : {}),
    ...(context.iteration !== undefined ? { iteration: context.iteration } : {}),
    ...(input.phase ? { phase: input.phase } : {}),
    ...(input.lookFor ? { lookFor: input.lookFor } : {}),
    ...(input.stepId ? { stepId: input.stepId } : {}),
    ...(input.intervalMs !== undefined ? { intervalMs: input.intervalMs } : {}),
  };
}

function screenshotSlots(
  step: Record<string, unknown>,
  path: string,
  context: {
    requirementId?: string;
    configuration?: CaptureReviewConfiguration;
    invocation?: string;
    iteration?: number;
    attempt?: number;
  },
): CaptureReviewPlannedSlot[] {
  const review = record(step.review);
  if (review?.mode !== "later") return [];
  const stepId = text(step.id);
  const checkpointId = text(review.checkpointId) ?? stepId ?? `screenshot:${path}`;
  const defaultCaption = text(step.caption) ?? "screenshot";
  const defaultLookFor = text(review.lookFor);
  const policy = text(review.policy);
  if (policy === "sequence") {
    return namedCaptureSequencePhases(review).map((phase) =>
      plannedScreenshotSlot(
        {
          checkpointId,
          caption: phase.caption ?? defaultCaption,
          ...((phase.lookFor ?? defaultLookFor)
            ? { lookFor: phase.lookFor ?? defaultLookFor }
            : {}),
          ...(stepId ? { stepId } : {}),
          phase: phase.id,
          ...(phase.intervalMs !== undefined ? { intervalMs: phase.intervalMs } : {}),
        },
        context,
      ),
    );
  }
  const phase = text(review.phase);
  return [
    plannedScreenshotSlot(
      {
        checkpointId,
        caption: defaultCaption,
        ...(defaultLookFor ? { lookFor: defaultLookFor } : {}),
        ...(stepId ? { stepId } : {}),
        ...(phase ? { phase } : {}),
      },
      context,
    ),
  ];
}

function pushUniqueCaptureSlot(
  slots: CaptureReviewPlannedSlot[],
  slot: CaptureReviewPlannedSlot,
): void {
  const id = captureReviewSlotId(slot);
  if (slots.some((existing) => captureReviewSlotId(existing) === id)) return;
  slots.push(slot);
}

function walkCaptureSlots(
  steps: readonly unknown[],
  recipes: Record<string, { steps?: readonly unknown[] }> | undefined,
  context: {
    requirementId?: string;
    configuration?: CaptureReviewConfiguration;
    invocation?: string;
    iteration?: number;
    attempt?: number;
    path: string;
  },
  moduleCalls: Map<string, number>,
): CaptureReviewPlannedSlot[] {
  const slots: CaptureReviewPlannedSlot[] = [];
  for (const [index, value] of steps.entries()) {
    const step = record(value);
    if (!step) continue;
    const path = context.path ? `${context.path}.${index}` : String(index);
    const kind = text(step.kind);
    if (kind === "screenshot") {
      for (const slot of screenshotSlots(step, path, context)) pushUniqueCaptureSlot(slots, slot);
      continue;
    }
    if (kind === "module") {
      const recipeId = text(step.recipeId);
      if (!recipeId) continue;
      const call = moduleCalls.get(recipeId) ?? 0;
      moduleCalls.set(recipeId, call + 1);
      const invocation = joinCaptureReviewInvocation(
        context.invocation,
        `module:${recipeId}#${call}`,
      );
      const nested = recipeRecord(recipes, recipeId);
      if (nested?.steps) {
        slots.push(
          ...walkCaptureSlots(nested.steps, recipes, { ...context, invocation, path }, moduleCalls),
        );
      } else {
        slots.push({
          checkpointId: `module:${recipeId}`,
          caption: recipeId,
          invocation,
          ...(context.requirementId ? { requirementId: context.requirementId } : {}),
          ...(context.configuration ? { configuration: context.configuration } : {}),
          ...(context.iteration !== undefined ? { iteration: context.iteration } : {}),
        });
      }
      continue;
    }
    if (kind === "branch") {
      for (const recipeId of [text(step.thenRecipeId), text(step.elseRecipeId)]) {
        if (!recipeId) continue;
        const call = moduleCalls.get(recipeId) ?? 0;
        moduleCalls.set(recipeId, call + 1);
        const invocation = joinCaptureReviewInvocation(
          context.invocation,
          `module:${recipeId}#${call}`,
        );
        const nested = recipeRecord(recipes, recipeId);
        if (nested?.steps) {
          slots.push(
            ...walkCaptureSlots(
              nested.steps,
              recipes,
              { ...context, invocation, path },
              moduleCalls,
            ),
          );
        } else {
          slots.push({
            checkpointId: `module:${recipeId}`,
            caption: recipeId,
            invocation,
            ...(context.requirementId ? { requirementId: context.requirementId } : {}),
            ...(context.configuration ? { configuration: context.configuration } : {}),
            ...(context.iteration !== undefined ? { iteration: context.iteration } : {}),
          });
        }
      }
      continue;
    }
    if (kind === "repeat") {
      const recipeId = text(step.recipeId);
      const count = integerField(step.count) ?? 0;
      if (!recipeId || count <= 0) continue;
      const nested = recipeRecord(recipes, recipeId);
      for (let iteration = 0; iteration < count; iteration += 1) {
        const invocation = joinCaptureReviewInvocation(context.invocation, `repeat:${recipeId}`);
        if (nested?.steps) {
          slots.push(
            ...walkCaptureSlots(
              nested.steps,
              recipes,
              { ...context, invocation, iteration, path: `${path}[${iteration}]` },
              new Map(),
            ),
          );
        } else {
          slots.push({
            checkpointId: `repeat:${recipeId}`,
            caption: recipeId,
            invocation,
            iteration,
            ...(context.requirementId ? { requirementId: context.requirementId } : {}),
            ...(context.configuration ? { configuration: context.configuration } : {}),
          });
        }
      }
      continue;
    }
    if (kind === "loop") {
      const nestedSteps = Array.isArray(step.steps) ? step.steps : undefined;
      const values = Array.isArray(step.values) ? step.values : undefined;
      const count = integerField(step.count) ?? values?.length ?? 0;
      const recipeId = text(step.recipeId);
      const body = nestedSteps ?? recipeRecord(recipes, recipeId ?? "")?.steps;
      for (let iteration = 0; iteration < count; iteration += 1) {
        const invocation = joinCaptureReviewInvocation(
          context.invocation,
          `loop:${recipeId || path}`,
        );
        if (body) {
          slots.push(
            ...walkCaptureSlots(
              body,
              recipes,
              { ...context, invocation, iteration, path: `${path}[${iteration}]` },
              new Map(),
            ),
          );
        }
      }
    }
  }
  return slots;
}

/** Expand the compiled plan into expected capture slots. Captions are labels. */
export function materializeCaptureReviewSlots(input: {
  recipeSteps?: readonly unknown[];
  recipes?: Record<string, { steps?: readonly unknown[] }>;
  plannedSlots?: readonly CaptureReviewPlannedSlot[];
  configuration?: CaptureReviewConfiguration;
  requirementId?: string;
}): CaptureReviewPlannedSlot[] {
  if (input.plannedSlots !== undefined) return [...input.plannedSlots];
  return walkCaptureSlots(
    input.recipeSteps ?? [],
    input.recipes,
    {
      path: "",
      ...(input.requirementId ? { requirementId: input.requirementId } : {}),
      ...(input.configuration ? { configuration: input.configuration } : {}),
    },
    new Map(),
  );
}

function captureReviewArtifact(data: unknown): CaptureReviewItem | undefined {
  const payload = record(data);
  if (!payload) return undefined;
  const caption = text(payload.caption) ?? "screenshot";
  const framePath = text(payload.framePath);
  const imageSha256 = text(payload.imageSha256);
  const status = payload.status === "missing" || !framePath ? "missing" : "pending";
  const configuration = parseConfiguration(payload.configuration);
  const observed = parseObservedSession(payload.observed);
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
        ...(configuration ? { configuration } : {}),
        ...(text(payload.invocation) ? { invocation: text(payload.invocation) } : {}),
        ...(iteration !== undefined ? { iteration } : {}),
        ...(attempt !== undefined ? { attempt } : {}),
        ...(phase ? { phase } : {}),
      }
    : undefined;
  const slotId =
    text(payload.slotId) ?? (slotIdentity ? captureReviewSlotId(slotIdentity) : undefined);
  return {
    captureId: captureReviewId({
      caption,
      ...(framePath ? { framePath } : {}),
      ...(imageSha256 ? { imageSha256 } : {}),
      ...(slotId && !framePath ? { slotId } : {}),
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
  };
}

function plannedItem(slot: CaptureReviewPlannedSlot): CaptureReviewItem {
  const slotId = captureReviewSlotId(slot);
  return {
    captureId: captureReviewId({ caption: slot.caption, slotId }),
    caption: slot.caption,
    status: "missing",
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
  if (artifact.slotId && artifact.slotId === captureReviewSlotId(slot)) return true;
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
      artifact.stepId &&
      artifact.stepId === slot.stepId &&
      sameCaptureReviewPhase(artifact.phase, slot.phase) &&
      captureReviewFillsDestPhase(artifact.phase, slot.phase)
    ) {
      byStep.push(index);
    }
  }
  const candidates = exact.length ? exact : byStep;
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
    if (artifact.kind !== "capture-review") continue;
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
