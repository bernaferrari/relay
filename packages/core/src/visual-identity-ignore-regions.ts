import type { VisualComparisonPolicy, VisualRegion } from "@relay/protocol";

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
};

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

const COMPOSER_ROLE = /^(?:textbox|textarea|searchbox)$/iu;
const REPLY_SIGNAL = /continue your conversation|you said|^you$/iu;
const PAYWALL_SIGNAL = /continue your conversation/iu;
const USER_BUBBLE_SIGNAL = /^(?:you|you said)$/iu;
const HEADER_MAX_Y = 100;
const NAV_RAIL_MAX_X = 88;

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
    if (nodeRole(node) === "dialog" && /cookie/iu.test(String(node.label ?? ""))) {
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

function identityIgnoreRegion(data: unknown): PixelRegion | undefined {
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
  };
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
  const ignores = artifacts.flatMap((artifact) => {
    if (artifact.kind === "identity-ignore") {
      const region = identityIgnoreRegion(artifact.data);
      return region ? [region] : [];
    }
    if (artifact.kind === "ui-tree") {
      if (authored) return [];
      const frame = frames.find((item) => item.width && item.height);
      if (!frame?.width || !frame.height) return [];
      const region = replyBodyIgnoreFromSnapshot(artifact.data, {
        width: frame.width,
        height: frame.height,
      });
      return region ? [region] : [];
    }
    return [];
  });
  for (const [ignoreIndex, ignore] of ignores.entries()) {
    for (const frame of frames) {
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
