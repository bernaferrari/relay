import type { ActorKind } from "./coordination.js";

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

export type CaptureReviewItem = {
  captureId: string;
  caption: string;
  status: CaptureReviewStatus;
  lookFor?: string;
  framePath?: string;
  imageSha256?: string;
  stepId?: string;
  settled?: boolean;
  samples?: number;
  configuration?: CaptureReviewConfiguration;
  masks?: CaptureReviewMask[];
  decidedAt?: number;
  decidedBy?: CaptureReviewActor;
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
}): string {
  const caption = input.caption.trim() || "screenshot";
  const framePath = input.framePath?.trim();
  const imageSha256 = input.imageSha256?.trim();
  if (!framePath) return `missing::${caption}`;
  if (!imageSha256) return `${framePath}::unhashed`;
  return `${framePath}::${imageSha256}`;
}

export function captureReviewCoverageLine(summary: CaptureReviewSummary): string {
  const total = summary.captured + summary.missing;
  return `${summary.captured}/${total} captured`;
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
  return {
    x,
    y,
    width,
    height,
    ...(text(payload.name) ? { name: text(payload.name) } : {}),
  };
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

function frameIndexFromPath(path?: string): number | undefined {
  const match = /(?:^|\/)frames\/(\d+)\.png$/u.exec(path ?? "");
  if (!match) return undefined;
  const index = Number(match[1]);
  return Number.isInteger(index) && index > 0 ? index - 1 : undefined;
}

function identityMasksForItem(
  item: CaptureReviewItem,
  artifacts: readonly { kind?: string; data?: unknown }[],
): CaptureReviewMask[] {
  const frameIndex = frameIndexFromPath(item.framePath);
  const masks: CaptureReviewMask[] = [];
  for (const artifact of artifacts) {
    if (artifact.kind !== "identity-ignore") continue;
    const payload = record(artifact.data);
    if (!payload) continue;
    const stepId = text(payload.stepId);
    const boundFrame = finiteNumber(payload.frameIndex);
    if (!stepId && boundFrame === undefined) continue;
    if (stepId && item.stepId && stepId !== item.stepId) continue;
    if (boundFrame !== undefined && frameIndex !== undefined && boundFrame !== frameIndex) continue;
    if (stepId && !item.stepId && boundFrame === undefined) continue;
    const mask = parseMask(payload);
    if (mask) masks.push(mask);
  }
  return masks;
}

function captureReviewArtifact(data: unknown): CaptureReviewItem | undefined {
  const payload = record(data);
  if (!payload) return undefined;
  const caption = text(payload.caption) ?? "screenshot";
  const framePath = text(payload.framePath);
  const imageSha256 = text(payload.imageSha256);
  const status = payload.status === "missing" || !framePath ? "missing" : "pending";
  const configuration = parseConfiguration(payload.configuration);
  const masks = Array.isArray(payload.masks)
    ? payload.masks.flatMap((value) => {
        const mask = parseMask(value);
        return mask ? [mask] : [];
      })
    : [];
  return {
    captureId: captureReviewId({
      caption,
      ...(framePath ? { framePath } : {}),
      ...(imageSha256 ? { imageSha256 } : {}),
    }),
    caption,
    status,
    ...(text(payload.lookFor) ? { lookFor: text(payload.lookFor) } : {}),
    ...(framePath ? { framePath } : {}),
    ...(imageSha256 ? { imageSha256 } : {}),
    ...(text(payload.stepId) ? { stepId: text(payload.stepId) } : {}),
    ...(typeof payload.settled === "boolean" ? { settled: payload.settled } : {}),
    ...(typeof payload.samples === "number" && Number.isFinite(payload.samples)
      ? { samples: payload.samples }
      : {}),
    ...(configuration ? { configuration } : {}),
    ...(masks.length ? { masks } : {}),
  };
}

function authoredCaptureCaptions(
  steps: readonly unknown[],
): Array<{ caption: string; lookFor?: string }> {
  const captions: Array<{ caption: string; lookFor?: string }> = [];
  for (const value of steps) {
    const step = record(value);
    if (step?.kind !== "screenshot") continue;
    const review = record(step.review);
    if (review?.mode !== "later") continue;
    captions.push({
      caption: text(step.caption) ?? "screenshot",
      ...(text(review.lookFor) ? { lookFor: text(review.lookFor) } : {}),
    });
  }
  return captions;
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
  };
}

/** Build the human review queue. Decisions never rewrite execution outcome. */
export function resolveCaptureReviewQueue(input: {
  artifacts?: readonly { kind?: string; data?: unknown }[];
  decisions?: readonly CaptureReviewDecision[];
  recipeSteps?: readonly unknown[];
}): CaptureReviewQueue {
  const seen = new Set<string>();
  const items: CaptureReviewItem[] = [];
  for (const artifact of input.artifacts ?? []) {
    if (artifact.kind !== "capture-review") continue;
    const item = captureReviewArtifact(artifact.data);
    if (!item || seen.has(item.captureId)) continue;
    seen.add(item.captureId);
    items.push(overlayDecision(item, input.decisions ?? []));
  }
  for (const authored of authoredCaptureCaptions(input.recipeSteps ?? [])) {
    const already = items.some((item) => item.caption === authored.caption);
    if (already) continue;
    const captureId = captureReviewId({ caption: authored.caption });
    items.push({
      captureId,
      caption: authored.caption,
      status: "missing",
      ...(authored.lookFor ? { lookFor: authored.lookFor } : {}),
    });
  }
  const artifacts = input.artifacts ?? [];
  const withMasks = items.map((item) => {
    if (item.masks?.length) return item;
    const masks = identityMasksForItem(item, artifacts);
    return masks.length ? { ...item, masks } : item;
  });
  return { items: withMasks, summary: summarizeCaptureReview(withMasks) };
}
