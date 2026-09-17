/** Pixel and region comparison of retained frames; review persistence stays separate. */
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { PNG } from "pngjs";
import type {
  VisualComparisonPolicy,
  VisualDiffMetadata,
  VisualFrameDiff,
  VisualRegion,
  VisualRunSnapshot,
} from "@relay/protocol";
import type { PersistedRun } from "./runs.js";

export function safeFrameName(path: string, index: number): string {
  const file = basename(path);
  if (!file || !/\.png$/iu.test(file)) return `${String(index + 1).padStart(3, "0")}.png`;
  return file;
}

type DecodedPng = { width: number; height: number; data: Buffer };

function regionContains(region: VisualRegion, x: number, y: number): boolean {
  return (
    x >= region.x && y >= region.y && x <= region.x + region.width && y <= region.y + region.height
  );
}

function compareDecodedFrames(
  approved: DecodedPng,
  latest: DecodedPng,
  policy: VisualComparisonPolicy,
  frameIndex: number,
): Pick<
  VisualFrameDiff,
  "code" | "consideredPixels" | "changedPixels" | "changeRatio" | "changedBounds"
> {
  if (approved.width !== latest.width || approved.height !== latest.height) {
    return {
      code: "FRAME_CHANGED",
      consideredPixels: latest.width * latest.height,
      changedPixels: latest.width * latest.height,
      changeRatio: 1,
      changedBounds: { x: 0, y: 0, width: 1, height: 1 },
    };
  }
  const frameRegions = policy.regions.filter((region) => region.frameIndex === frameIndex);
  const compareRegions = frameRegions.filter((region) => region.mode === "compare");
  const ignoredRegions = frameRegions.filter((region) => region.mode === "ignore");
  let consideredPixels = 0;
  let changedPixels = 0;
  let minX = latest.width;
  let minY = latest.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < latest.height; y += 1) {
    const normalizedY = (y + 0.5) / latest.height;
    for (let x = 0; x < latest.width; x += 1) {
      const normalizedX = (x + 0.5) / latest.width;
      if (
        (compareRegions.length > 0 &&
          !compareRegions.some((region) => regionContains(region, normalizedX, normalizedY))) ||
        ignoredRegions.some((region) => regionContains(region, normalizedX, normalizedY))
      ) {
        continue;
      }
      consideredPixels += 1;
      const offset = (y * latest.width + x) * 4;
      let pixelChanged = false;
      for (let channel = 0; channel < 4; channel += 1) {
        if (
          Math.abs(latest.data[offset + channel]! - approved.data[offset + channel]!) >
          policy.pixelThreshold
        ) {
          pixelChanged = true;
          break;
        }
      }
      if (!pixelChanged) continue;
      changedPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const changeRatio = consideredPixels === 0 ? 0 : changedPixels / consideredPixels;
  return {
    code: changeRatio > policy.changeThreshold ? "FRAME_CHANGED" : "FRAME_MATCH",
    consideredPixels,
    changedPixels,
    changeRatio,
    ...(changedPixels > 0
      ? {
          changedBounds: {
            x: minX / latest.width,
            y: minY / latest.height,
            width: (maxX - minX + 1) / latest.width,
            height: (maxY - minY + 1) / latest.height,
          },
        }
      : {}),
  };
}

async function readDecodedPng(path: string): Promise<DecodedPng> {
  return PNG.sync.read(await readFile(path));
}

export async function buildDiff(
  root: string,
  run: PersistedRun,
  approved: VisualRunSnapshot | null,
  latest: VisualRunSnapshot,
  policy: VisualComparisonPolicy,
  expectedVariation: boolean,
): Promise<VisualDiffMetadata> {
  if (!approved) {
    return {
      algorithm: "pixel-rgba-regions-v1",
      code: "VISUAL_BASELINE_MISSING",
      approvedFrameCount: 0,
      latestFrameCount: latest.frameCount,
      matchedFrames: 0,
      changedFrames: 0,
      addedFrames: latest.frameCount,
      removedFrames: 0,
      frames: latest.frames.map((frame) => ({
        index: frame.index,
        code: "FRAME_ADDED",
        latest: frame,
      })),
      policyRevision: policy.revision,
    };
  }
  const frameCount = Math.max(approved.frames.length, latest.frames.length);
  const frames: VisualFrameDiff[] = [];
  for (let index = 0; index < frameCount; index++) {
    const prior = approved.frames[index];
    const current = latest.frames[index];
    if (prior && current) {
      const approvedPath = prior.artifactPath
        ? join(root, prior.artifactPath)
        : join(run.dir, "frames", safeFrameName(prior.path, index));
      const latestPath = join(run.dir, "frames", safeFrameName(current.path, index));
      const pixelDiff =
        prior.sha256 === current.sha256
          ? {
              code: "FRAME_MATCH" as const,
              consideredPixels: (current.width ?? 0) * (current.height ?? 0),
              changedPixels: 0,
              changeRatio: 0,
            }
          : compareDecodedFrames(
              await readDecodedPng(approvedPath),
              await readDecodedPng(latestPath),
              policy,
              index,
            );
      frames.push({ index, approved: prior, latest: current, ...pixelDiff });
    } else {
      frames.push(
        prior
          ? { index, code: "FRAME_REMOVED", approved: prior }
          : { index, code: "FRAME_ADDED", latest: current! },
      );
    }
  }
  const count = (code: VisualFrameDiff["code"]) =>
    frames.filter((frame) => frame.code === code).length;
  const changed = frames.some((frame) => frame.code !== "FRAME_MATCH");
  return {
    algorithm: "pixel-rgba-regions-v1",
    code: changed
      ? expectedVariation
        ? "VISUAL_EXPECTED_VARIATION"
        : "VISUAL_CHANGED"
      : "VISUAL_MATCH",
    approvedFrameCount: approved.frameCount,
    latestFrameCount: latest.frameCount,
    matchedFrames: count("FRAME_MATCH"),
    changedFrames: count("FRAME_CHANGED"),
    addedFrames: count("FRAME_ADDED"),
    removedFrames: count("FRAME_REMOVED"),
    frames,
    policyRevision: policy.revision,
  };
}
