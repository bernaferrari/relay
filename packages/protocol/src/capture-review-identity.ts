import type { BrowserAuthenticationHealth } from "./browser-authentication-fixture.js";
import { classifyIosHardware } from "./capability-gate.js";
import type { CaptureReviewConfiguration, CaptureReviewObservedSession } from "./capture-review.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

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

/** Device observed session — browser signed-out scheduler identity does not apply. */
export function isDeviceCaptureReviewObserved(observed?: CaptureReviewObservedSession): boolean {
  const profileId = observed?.profileId?.trim() ?? "";
  if (profileId.startsWith("device:")) return true;
  return Boolean(observed?.iosHardwareClass);
}

/** Live page account name. Lane ids, SuperGrok*, and saved fixture names are not identity.
 * Historical iOS dest jobs stamped browser `signed-out` onto a device Lane — drop that
 * when observed is a device profile (pixels were SuperGrok / Bernardo Ferrari). */
export function liveCaptureReviewAccount(
  value?: string,
  observed?: CaptureReviewObservedSession,
): string | undefined {
  const trimmed = value?.replace(/\s+/gu, " ").trim();
  if (!trimmed || trimmed.length > 80) return undefined;
  const key = trimmed.toLocaleLowerCase();
  if (
    CAPTURE_REVIEW_ACCOUNT_STAND_INS.has(key) ||
    key.startsWith("grok-") ||
    key.startsWith("supergrok")
  ) {
    return undefined;
  }
  if (key === "signed-out" && isDeviceCaptureReviewObserved(observed)) {
    return undefined;
  }
  return trimmed;
}

/** Account on the pixels, not a Lane-name overlay. Fixture identity wins;
 * unsigned/signed-out stays signed-out even when the Lane is named grok-lab.
 * Device Lanes are not signed-out grok.com identities; leftover BF / person
 * names win over SuperGrok and grok-ios-daily. Missing targetKind plus a
 * device `unsignedLaneId` must not stamp browser signed-out (historical iOS).
 * Platform ios/android and stamped iosHardwareClass are also device — not
 * browser unsigned — even when targetProfileId is absent. */
export function observedCaptureReviewAccount(input: {
  laneId?: string;
  unsignedLaneId?: string;
  targetKind?: string;
  targetProfileId?: string;
  /** ios / android refuse browser signed-out even without a device: profile. */
  platform?: string;
  iosHardwareClass?: CaptureReviewObservedSession["iosHardwareClass"];
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
  const platform = input.platform?.trim().toLowerCase();
  const observed: CaptureReviewObservedSession = {
    ...(laneId ? { laneId } : {}),
    ...(profileId ? { profileId } : {}),
    ...(input.iosHardwareClass ? { iosHardwareClass: input.iosHardwareClass } : {}),
  };
  if (fixture) {
    if (fixtureCaptureReviewAccountIsBlocked(input)) {
      return { account: BLOCKED_CAPTURE_REVIEW_ACCOUNT, observed };
    }
    // Fixture display names (e.g. "SuperGrok lab signed-in") are not identity.
    // Live page name wins; otherwise keep the fixture id.
    return {
      account: live || fixture,
      observed,
    };
  }
  if (live) return { account: live, observed };
  // Device jobs often omit targetKind while still setting unsignedLaneId to the
  // device Lane id (historical iOS dest). That is not browser unsigned/signed-out.
  const deviceObserved =
    isDeviceCaptureReviewObserved(observed) || platform === "ios" || platform === "android";
  const browserUnsigned =
    Boolean(unsignedLaneId) && input.targetKind !== "device" && !deviceObserved;
  if ((input.signedOut === true || browserUnsigned) && !deviceObserved) {
    return { account: "signed-out", observed };
  }
  const resolved = liveCaptureReviewAccount(input.resolvedAccount, observed);
  // Platform ios/android without device: profile still must not keep resolved
  // "signed-out" (liveCaptureReviewAccount only strips when observed looks device).
  if (resolved === "signed-out" && deviceObserved) {
    return { observed };
  }
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
export function captureReviewFillsDestPhase(
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

export function sameCheckpointFamily(
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
    if (artifact?.kind !== "capture-review") continue;
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
    if (artifact?.kind !== "capture-review") continue;
    const payload = record(artifact.data);
    const framePath = text(payload?.framePath);
    if (!framePath || !isCaptureReviewLeftoverPhase(text(payload?.phase))) continue;
    leftover.push(framePath);
  }
  return leftover;
}

/** Leftover Close / Back / Run saved Test / Transition executed last-frame
 * captions. Dest wait-for Observe is not this. Unphased dest-wait keeps those
 * frames until dest identity also exists. Coverage leftover-skip wrappers
 * (`Transition executed`, `Inspect setup skipped…`) are the same class as
 * Run saved Test — they must not fill dest identity when artifacts are absent. */
export function isCaptureReviewLeftoverCaption(caption?: string): boolean {
  const value = caption?.trim() ?? "";
  if (/^(?:close|back)(?:\s|$)/iu.test(value)) return true;
  if (/^after · run saved test$/iu.test(value)) return true;
  const body = value.replace(/^(?:before|after) · /iu, "").trim();
  if (/^transition executed$/iu.test(body)) return true;
  if (/^inspect setup skipped\b/iu.test(body)) return true;
  return false;
}

/** Opener TAP before/after frames are not dest wait-for. When leftover
 * Transition/Close captions sit beside dest, before · Tap cannot fill dest
 * identity (evidence without slim dest-phase data used to keep it). */
export function isCaptureReviewOpenerCaption(caption?: string): boolean {
  const value = caption?.trim() ?? "";
  const body = value.replace(/^(?:before|after) · /iu, "").trim();
  return /^tap\b/iu.test(body);
}

export function leftoverCloseCaption(caption?: string): boolean {
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

/** Dest-phase identity rasters. Missing dest-phase is not "use the last raw
 * frame": leftover Close / Transition executed / Inspect setup skipped
 * captions cannot fill dest. Unphased Android dest-wait (no leftover caption)
 * keeps every frame. */
export function destIdentitySourceFrames<T extends { path: string; caption?: string }>(
  frames: readonly T[],
  artifacts?: readonly { kind?: string; data?: unknown }[],
): T[] {
  const paths = destIdentityCheckpointFramePaths(frames, artifacts);
  if (!paths.length) return [];
  const keep = new Set(paths);
  return frames.filter((frame) => keep.has(frame.path));
}

/** Dest wait-for checkpoint paths. Leftover Close / Run saved Test last-frame
 * cannot fill dest even without leftover-phase. Opener before · Tap cannot fill
 * dest beside leftover Transition either. Unphased dest-wait keeps listed
 * frames. */
export function destIdentityCheckpointFramePaths(
  frames: readonly { path: string; caption?: string }[],
  artifacts?: readonly { kind?: string; data?: unknown }[],
): string[] {
  const dest = captureReviewIdentityFramePaths(artifacts ?? []);
  if (dest.length) return [...new Set(dest)];
  const leftover = new Set(captureReviewLeftoverLastFramePaths(frames, artifacts));
  const usable = leftover.size ? frames.filter((frame) => !leftover.has(frame.path)) : frames;
  const destCaptions = usable.filter((frame) => !isCaptureReviewLeftoverCaption(frame.caption));
  const leftoverCaptions = usable.filter((frame) => isCaptureReviewLeftoverCaption(frame.caption));
  let waitFor = destCaptions.length && leftoverCaptions.length ? destCaptions : usable;
  if (destCaptions.length && leftoverCaptions.length) {
    const withoutOpeners = waitFor.filter((frame) => !isCaptureReviewOpenerCaption(frame.caption));
    if (withoutOpeners.length) waitFor = withoutOpeners;
  }
  return [
    ...new Set(
      waitFor
        .filter((frame) => !isCaptureReviewLeftoverCaption(frame.caption))
        .map((frame) => frame.path),
    ),
  ];
}

export type CaptureReviewEvidenceFrame = { path: string; caption?: string };

/** One projection for every surface that presents a capture-review destination.
 * New phase-aware artifacts win. Listed legacy identity is only a fallback and
 * goes through the same leftover/opener adapter everywhere. */
export function projectCaptureReviewDestIdentity(
  frames: readonly CaptureReviewEvidenceFrame[],
  artifacts: readonly { kind?: string; data?: unknown }[] = [],
  listedDestIdentity: readonly CaptureReviewEvidenceFrame[] = [],
): CaptureReviewEvidenceFrame[] {
  const paths = destIdentityCheckpointFramePaths(frames, artifacts);
  const byPath = new Map(frames.map((frame) => [frame.path, frame]));
  const source = paths.length
    ? paths.map((path) => byPath.get(path) ?? { path })
    : destIdentityReviewItems(listedDestIdentity);
  const seen = new Set<string>();
  return source.filter((frame) => {
    if (seen.has(frame.path)) return false;
    seen.add(frame.path);
    return true;
  });
}

/** Exclude leftover frames without hiding other checkpoints or configurations.
 * A dest-phase capture in one Run cannot erase an unphased capture in another.
 * Opener before · Tap cannot fill dest beside leftover Transition / Close. */
export function destIdentityReviewItems<T extends { phase?: string; caption?: string }>(
  items: readonly T[],
): T[] {
  const hasLeftover = items.some(
    (item) =>
      isCaptureReviewLeftoverPhase(item.phase) || isCaptureReviewLeftoverCaption(item.caption),
  );
  const kept = items.filter(
    (item) =>
      isCaptureReviewDestPhase(item.phase) ||
      (!isCaptureReviewLeftoverPhase(item.phase) && !isCaptureReviewLeftoverCaption(item.caption)),
  );
  if (!hasLeftover) return kept;
  const withoutOpeners = kept.filter((item) => !isCaptureReviewOpenerCaption(item.caption));
  return withoutOpeners.length ? withoutOpeners : kept;
}

/** Keep stamped iosHardwareClass. Historical iOS dest jobs omitted it — infer
 * from device: serial / iPad app name on read so Plan Gallery does not look
 * like browser coverage. Do not stamp unproven onto Android device: profiles. */
export function enrichCaptureReviewObservedSession(
  observed: CaptureReviewObservedSession,
  appName?: string,
): CaptureReviewObservedSession {
  if (observed.iosHardwareClass) return observed;
  const profileId = observed.profileId?.trim() ?? "";
  const serial = profileId.startsWith("device:") ? profileId.slice("device:".length) : undefined;
  const name = appName?.trim() || undefined;
  if (!serial && !name) return observed;
  const iosHardwareClass = classifyIosHardware({ serial, device: serial, name });
  if (iosHardwareClass === "unproven" && !/ipad|iphone|ipod|simulator/iu.test(name ?? "")) {
    return observed;
  }
  return { ...observed, iosHardwareClass };
}
