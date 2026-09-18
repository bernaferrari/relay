import {
  CAPTURE_REVIEW_DEST_PHASE,
  captureReviewLeftoverLastFramePaths,
  destIdentityReviewItems,
  enrichCaptureReviewObservedSession,
  liveCaptureReviewAccount,
  projectCaptureReviewDestIdentity,
  resolveCaptureReviewQueue,
  type CaptureReviewConfiguration,
  type CaptureReviewItem,
  type CaptureReviewObservedSession,
} from "./capture-review.js";

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function artifactRecords(value: unknown): { kind?: string; data?: unknown }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = object(item);
    return record ? [record] : [];
  });
}

export function listedFrames(value: unknown): { path: string; caption?: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [{ path: item.trim() }];
    const record = object(item);
    if (!record) return [];
    const path = typeof record.path === "string" ? record.path.trim() : "";
    if (!path) return [];
    const caption = typeof record.caption === "string" ? record.caption : undefined;
    return [{ path, ...(caption ? { caption } : {}) }];
  });
}

export function compactDestIdentity(
  frames: readonly { path: string; caption?: string }[],
  artifacts: readonly { kind?: string; data?: unknown }[],
): { path: string; caption?: string }[] {
  return projectCaptureReviewDestIdentity(frames, artifacts);
}

/** Leftover Close captions cannot fill dest identity. Unphased dest-wait still
 * keeps leftover rasters on the comparison; destIdentity stays empty. */
export function destIdentityVisualFrames(
  frames: readonly { path: string; caption?: string }[],
): { path: string; caption?: string }[] {
  return projectCaptureReviewDestIdentity([], [], frames);
}

export function listedFramePath(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = object(value);
  const path = typeof record?.path === "string" ? record.path.trim() : "";
  return path || undefined;
}

/** Keep live/fixture account identity on compact CLI/MCP capture-review.
 * SuperGrok* / Lane-name stand-ins stay dropped (same as stamp). Device-observed
 * historical `signed-out` (browser scheduler on an iPad Lane) is also dropped. */
export function compactCaptureReviewConfiguration(
  configuration?: CaptureReviewConfiguration,
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

export function compactCaptureReviewObserved(
  observed?: CaptureReviewObservedSession,
  appName?: string,
): CaptureReviewObservedSession | undefined {
  if (!observed) return undefined;
  const enriched = enrichCaptureReviewObservedSession(
    {
      ...(observed.laneId?.trim() ? { laneId: observed.laneId.trim() } : {}),
      ...(observed.profileId?.trim() ? { profileId: observed.profileId.trim() } : {}),
      ...(observed.sessionStore ? { sessionStore: observed.sessionStore } : {}),
      ...(observed.iosHardwareClass ? { iosHardwareClass: observed.iosHardwareClass } : {}),
    },
    appName,
  );
  return Object.keys(enriched).length ? enriched : undefined;
}

export function compactCaptureReviewItem(
  item: CaptureReviewItem & { runId?: string; attempt?: number },
): Record<string, unknown> {
  const observed = compactCaptureReviewObserved(item.observed, item.configuration?.app);
  const configuration = compactCaptureReviewConfiguration(item.configuration, observed);
  return {
    captureId: item.captureId,
    caption: item.caption,
    status: item.status,
    ...(item.framePath ? { framePath: item.framePath } : {}),
    ...(item.phase ? { phase: item.phase } : {}),
    ...(item.policy ? { policy: item.policy } : {}),
    ...(item.lookFor ? { lookFor: item.lookFor } : {}),
    ...(item.attempt !== undefined ? { attempt: item.attempt } : {}),
    ...(typeof item.runId === "string" ? { runId: item.runId } : {}),
    ...(configuration ? { configuration } : {}),
    ...(observed ? { observed } : {}),
  };
}

export function listedDestIdentity(value: unknown): { path: string; caption?: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [{ path: item.trim() }];
    const record = object(item);
    if (!record) return [];
    const path = typeof record.path === "string" ? record.path.trim() : "";
    if (!path) return [];
    const caption = typeof record.caption === "string" ? record.caption : undefined;
    return [{ path, ...(caption ? { caption } : {}) }];
  });
}

export function visibleDestCaptureReviewItems(
  items: CaptureReviewItem[],
  destPaths: Set<string>,
  leftover: Set<string>,
): CaptureReviewItem[] {
  return destIdentityReviewItems(items).filter((item) => {
    if (!item.framePath) return true;
    if (destPaths.size) return destPaths.has(item.framePath);
    return !leftover.has(item.framePath);
  });
}

export function destIdentityProjection(record: Record<string, unknown>): {
  destIdentity?: { path: string; caption?: string }[];
  captureReview?: Record<string, unknown>[];
} {
  const artifacts = artifactRecords(record.artifacts);
  const frames = listedFrames(record.frames);
  const computed = compactDestIdentity(frames, artifacts);
  const destIdentity = computed.length
    ? computed
    : destIdentityVisualFrames(listedDestIdentity(record.destIdentity));
  const destPaths = new Set(destIdentity.map((frame) => frame.path));
  const leftover = new Set(captureReviewLeftoverLastFramePaths(frames, artifacts));
  const queue = resolveCaptureReviewQueue({
    artifacts,
    decisions: Array.isArray(record.captureReviews) ? record.captureReviews : undefined,
  });
  // Listed destIdentity already falls back without artifacts; listed captureReview
  // must too — otherwise run.list/job.list drop Observe account while Close-drop
  // assertions still pass on an empty queue (MCP runs collection already keeps it).
  let visible = visibleDestCaptureReviewItems(queue.items, destPaths, leftover);
  if (!visible.length && Array.isArray(record.captureReview)) {
    visible = visibleDestCaptureReviewItems(
      record.captureReview as CaptureReviewItem[],
      destPaths,
      leftover,
    );
  }
  const captureReview = visible.map((item) =>
    compactCaptureReviewItem({
      ...item,
      ...(item.framePath && destPaths.has(item.framePath) && !item.phase
        ? { phase: CAPTURE_REVIEW_DEST_PHASE }
        : {}),
    }),
  );
  return {
    ...(destIdentity.length ? { destIdentity } : {}),
    ...(captureReview.length ? { captureReview } : {}),
  };
}
