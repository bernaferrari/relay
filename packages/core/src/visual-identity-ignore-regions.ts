import type { VisualComparisonPolicy, VisualRegion } from "@relay/protocol";
import { GROK_WEB_APP_POLICY } from "./app-identity-policy.js";

type PixelRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
};

type FrameSize = {
  index: number;
  width?: number;
  height?: number;
  stepId?: string;
};

type BoundPixelRegion = PixelRegion & { frameIndex?: number; stepId?: string };

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

const COMPOSER_ROLE = /^(?:textbox|textarea|searchbox)$/iu;
const REPLY_SIGNAL = /continue your conversation|you said|^you$/iu;
const PAYWALL_SIGNAL = /continue your conversation/iu;
const USER_BUBBLE_SIGNAL = /^(?:you|you said)$/iu;
const HEADER_MAX_Y = 100;
const NAV_RAIL_MAX_X = 88;
const COMPOSER_MIN_WIDTH = 40;
const COMPOSER_MIN_HEIGHT = 8;
const COMPOSER_MAX_HEIGHT = 80;
const COMPOSER_MAX_WIDTH_RATIO = 0.72;

function nodeRole(node: Record<string, unknown>): string {
  return String(node.role ?? node.type ?? "")
    .trim()
    .toLocaleLowerCase();
}

function snapshotNodes(data: unknown): readonly Record<string, unknown>[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const nodes = (data as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.filter((node): node is Record<string, unknown> =>
    Boolean(node && typeof node === "object" && !Array.isArray(node)),
  );
}

function nodeBox(node: Record<string, unknown>): Record<string, unknown> | undefined {
  const rect = node.rect;
  if (!rect || typeof rect !== "object" || Array.isArray(rect)) return undefined;
  const box = rect as Record<string, unknown>;
  if (
    !finitePositive(box.x) ||
    !finitePositive(box.y) ||
    !finitePositive(box.width) ||
    !finitePositive(box.height)
  ) {
    return undefined;
  }
  return box;
}

function nodeLabel(node: Record<string, unknown>): string {
  return String(node.label ?? node.value ?? "").trim();
}

function placeholderHint(): RegExp | undefined {
  const hint = GROK_WEB_APP_POLICY.composer?.placeholderHint;
  if (!hint) return undefined;
  return new RegExp(hint.source, hint.flags.replaceAll("g", ""));
}

function isTightComposerBox(
  box: Record<string, unknown>,
  frame: { width: number; height: number },
): boolean {
  const width = Number(box.width);
  const height = Number(box.height);
  if (width < COMPOSER_MIN_WIDTH || height < COMPOSER_MIN_HEIGHT || height > COMPOSER_MAX_HEIGHT) {
    return false;
  }
  if (width / frame.width > COMPOSER_MAX_WIDTH_RATIO || height / frame.height > 0.2) return false;
  return true;
}

function namedComposerBox(box: Record<string, unknown>): PixelRegion {
  return {
    x: Number(box.x),
    y: Number(box.y),
    width: Number(box.width),
    height: Number(box.height),
    name: "composer placeholder",
  };
}

/** Tight composer field only. Full-viewport roots and paywall cards stay compared. */
function composerPlaceholderIgnoreFromSnapshot(
  data: unknown,
  frame: { width: number; height: number },
): PixelRegion | undefined {
  if (!frame.width || !frame.height || frame.width <= 0 || frame.height <= 0) return undefined;
  const nodes = snapshotNodes(data);
  const ident = GROK_WEB_APP_POLICY.composer?.inputIdentifier ?? /^chat-input$/u;
  for (const node of nodes) {
    if (!ident.test(String(node.identifier ?? ""))) continue;
    const box = nodeBox(node);
    if (!box || !isTightComposerBox(box, frame)) continue;
    return namedComposerBox(box);
  }
  const hint = placeholderHint();
  const role = GROK_WEB_APP_POLICY.composer?.role ?? COMPOSER_ROLE;
  const matches: PixelRegion[] = [];
  for (const node of nodes) {
    if (!role.test(nodeRole(node))) continue;
    if (!hint?.test(nodeLabel(node))) continue;
    const box = nodeBox(node);
    if (!box || !isTightComposerBox(box, frame)) continue;
    matches.push(namedComposerBox(box));
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/** Unique product-tour dialog. Composer placeholder rotation stays a separate mask. */
function introOverlayIgnoreFromSnapshot(
  data: unknown,
  frame: { width: number; height: number },
): PixelRegion | undefined {
  if (!frame.width || !frame.height || frame.width <= 0 || frame.height <= 0) return undefined;
  const matches: PixelRegion[] = [];
  for (const node of snapshotNodes(data)) {
    if (nodeRole(node) !== "dialog") continue;
    if (!/introducing build mode/iu.test(nodeLabel(node))) continue;
    const box = nodeBox(node);
    if (!box) continue;
    matches.push({
      x: Number(box.x),
      y: Number(box.y),
      width: Number(box.width),
      height: Number(box.height),
      name: "intro overlay",
    });
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function artifactsIncludePaywall(artifacts: readonly { kind?: string; data?: unknown }[]): boolean {
  return artifacts.some((artifact) => {
    if (artifact.kind !== "ui-tree") return false;
    return snapshotNodes(artifact.data).some((node) => PAYWALL_SIGNAL.test(nodeLabel(node)));
  });
}

/** User bubble only. The Continue-your-conversation paywall card stays compared. */
function userBubbleIgnoreFromSnapshot(
  nodes: readonly Record<string, unknown>[],
): PixelRegion | undefined {
  for (const node of nodes) {
    if (nodeRole(node) !== "article") continue;
    if (!USER_BUBBLE_SIGNAL.test(String(node.label ?? node.value ?? "").trim())) continue;
    const box = nodeBox(node);
    if (!box) continue;
    return {
      x: Number(box.x),
      y: Number(box.y),
      width: Number(box.width),
      height: Number(box.height),
      name: "user bubble",
    };
  }
  return undefined;
}

/** Measured transcript column from a live ui-tree. Chrome stays compared. */
export function replyBodyIgnoreFromSnapshot(
  data: unknown,
  frame: { width: number; height: number },
): PixelRegion | undefined {
  if (!frame.width || !frame.height || frame.width <= 0 || frame.height <= 0) return undefined;
  const nodes = snapshotNodes(data);
  const paywall = nodes.some((node) => PAYWALL_SIGNAL.test(String(node.label ?? node.value ?? "")));
  if (paywall) return userBubbleIgnoreFromSnapshot(nodes);
  const conversation = nodes.some((node) => {
    const role = nodeRole(node);
    const label = String(node.label ?? node.value ?? "");
    return role === "article" || REPLY_SIGNAL.test(label);
  });
  if (!conversation) return undefined;
  let bottom = frame.height * 0.85;
  for (const node of nodes) {
    const rect = node.rect;
    if (!rect || typeof rect !== "object" || Array.isArray(rect)) continue;
    const box = rect as Record<string, unknown>;
    if (!finitePositive(box.y) || !finitePositive(box.height)) continue;
    if (COMPOSER_ROLE.test(nodeRole(node))) {
      bottom = Math.min(bottom, Number(box.y));
    }
    if (
      nodeRole(node) === "dialog" &&
      /cookie|introducing build mode/iu.test(String(node.label ?? ""))
    ) {
      bottom = Math.min(bottom, Number(box.y));
    }
  }
  const y = Math.min(HEADER_MAX_Y, Math.round(frame.height * 0.125));
  const x = Math.min(NAV_RAIL_MAX_X, Math.round(frame.width * (NAV_RAIL_MAX_X / 1280)));
  const height = bottom - y;
  if (height < 40) return undefined;
  return {
    x,
    y,
    width: Math.max(40, frame.width - x),
    height,
    name: "reply body",
  };
}

function identityIgnoreRegion(data: unknown): BoundPixelRegion | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  if (
    !finitePositive(record.x) ||
    !finitePositive(record.y) ||
    !finitePositive(record.width) ||
    !finitePositive(record.height) ||
    record.width === 0 ||
    record.height === 0
  ) {
    return undefined;
  }
  return {
    x: record.x,
    y: record.y,
    width: record.width,
    height: record.height,
    ...(typeof record.name === "string" && record.name.trim() ? { name: record.name.trim() } : {}),
    ...(Number.isInteger(record.frameIndex) && (record.frameIndex as number) >= 0
      ? { frameIndex: record.frameIndex as number }
      : {}),
    ...(typeof record.stepId === "string" && record.stepId.trim()
      ? { stepId: record.stepId.trim() }
      : {}),
  };
}

function artifactStepId(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const stepId = (data as { stepId?: unknown }).stepId;
  return typeof stepId === "string" && stepId.trim() ? stepId.trim() : undefined;
}

function framesForIgnore(ignore: BoundPixelRegion, frames: readonly FrameSize[]): FrameSize[] {
  if (typeof ignore.frameIndex === "number") {
    return frames.filter((frame) => frame.index === ignore.frameIndex);
  }
  if (ignore.stepId) {
    return frames.filter((frame) => frame.stepId === ignore.stepId);
  }
  // Unscoped identity-ignore is identity-only. A single-frame run can still
  // use it as a visual mask; later screens must not inherit it.
  return frames.length === 1 ? [...frames] : [];
}

function alreadyNormalized(region: PixelRegion): boolean {
  return (
    region.x <= 1 &&
    region.y <= 1 &&
    region.width <= 1 &&
    region.height <= 1 &&
    region.x + region.width <= 1.000_001 &&
    region.y + region.height <= 1.000_001
  );
}

function normalizeRegion(
  region: PixelRegion,
  frame: FrameSize,
): { x: number; y: number; width: number; height: number } | undefined {
  if (alreadyNormalized(region)) {
    return { x: region.x, y: region.y, width: region.width, height: region.height };
  }
  if (!frame.width || !frame.height || frame.width <= 0 || frame.height <= 0) return undefined;
  const x = region.x / frame.width;
  const y = region.y / frame.height;
  const width = region.width / frame.width;
  const height = region.height / frame.height;
  if (x >= 1 || y >= 1 || width <= 0 || height <= 0) return undefined;
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    width: Math.max(0, Math.min(1 - Math.max(0, x), width)),
    height: Math.max(0, Math.min(1 - Math.max(0, y), height)),
  };
}

/** Identity-ignore rectangles become visual ignore regions. They never approve a baseline. */
export function visualIgnoreRegionsFromIdentityArtifacts(
  artifacts: readonly { kind?: string; data?: unknown }[],
  frames: readonly FrameSize[],
): VisualRegion[] {
  const regions: VisualRegion[] = [];
  const authored = artifacts.some((artifact) => artifact.kind === "identity-ignore");
  const paywall = artifactsIncludePaywall(artifacts);
  const ignores = artifacts.flatMap((artifact) => {
    if (artifact.kind === "identity-ignore") {
      const region = identityIgnoreRegion(artifact.data);
      return region ? [region] : [];
    }
    if (artifact.kind === "ui-tree") {
      const stepId = artifactStepId(artifact.data);
      const frame =
        (stepId ? frames.find((item) => item.stepId === stepId && item.width && item.height) : undefined) ??
        (frames.length === 1 ? frames.find((item) => item.width && item.height) : undefined);
      if (!frame?.width || !frame.height) return [];
      const size = { width: frame.width, height: frame.height };
      const extra: BoundPixelRegion[] = [];
      if (!paywall) {
        const composer = composerPlaceholderIgnoreFromSnapshot(artifact.data, size);
        if (composer) extra.push({ ...composer, ...(stepId ? { stepId } : { frameIndex: frame.index }) });
      }
      const intro = introOverlayIgnoreFromSnapshot(artifact.data, size);
      if (intro) extra.push({ ...intro, ...(stepId ? { stepId } : { frameIndex: frame.index }) });
      if (!authored) {
        const reply = replyBodyIgnoreFromSnapshot(artifact.data, size);
        if (reply) extra.push({ ...reply, ...(stepId ? { stepId } : { frameIndex: frame.index }) });
      }
      return extra;
    }
    return [];
  });
  for (const [ignoreIndex, ignore] of ignores.entries()) {
    for (const frame of framesForIgnore(ignore, frames)) {
      const normalized = normalizeRegion(ignore, frame);
      if (!normalized || normalized.width <= 0 || normalized.height <= 0) continue;
      regions.push({
        id: `identity-ignore:${ignore.name ?? ignoreIndex}:${frame.index}`,
        name: ignore.name ?? "identity-ignore",
        mode: "ignore",
        frameIndex: frame.index,
        ...normalized,
      });
    }
  }
  return regions;
}

export function withIdentityIgnoreRegions(
  policy: VisualComparisonPolicy,
  artifacts: readonly { kind?: string; data?: unknown }[],
  frames: readonly FrameSize[],
): VisualComparisonPolicy {
  const extra = visualIgnoreRegionsFromIdentityArtifacts(artifacts, frames);
  if (!extra.length) return policy;
  const known = new Set(policy.regions.map((region) => region.id));
  const regions = [...policy.regions];
  for (const region of extra) {
    if (known.has(region.id)) continue;
    known.add(region.id);
    regions.push(region);
  }
  return { ...policy, regions };
}
