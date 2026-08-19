import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiscoveryControl } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { recommendScrollSurfaceCapturePolicy } from "./scroll-surface-policy.js";
import { captureScrollableSurveyForTarget } from "./scrollable-survey.js";
import { annotateVisitedRows } from "./tap-preview.js";

export type DiscoveryVisitTarget = DiscoveryControl["target"];

function targetMatchesNode(node: SnapshotNode, target: DiscoveryVisitTarget): boolean {
  if (target.identifier && node.identifier === target.identifier) return true;
  if (target.ref && (node.ref === target.ref || node.ref === `@${target.ref}`)) return true;
  if (target.label && (node.label === target.label || node.value === target.label)) return true;
  if (target.text && (node.label === target.text || node.value === target.text)) return true;
  return false;
}

export function visitedRowBounds(
  nodes: SnapshotNode[],
  targets: readonly DiscoveryVisitTarget[],
): Array<{ bounds: { x: number; y: number; width: number; height: number } }> {
  return targets.flatMap((target) => {
    const node = nodes.find(
      (candidate) => candidate.visibleToUser !== false && targetMatchesNode(candidate, target),
    );
    if (!node?.rect || node.rect.width < 2 || node.rect.height < 2) return [];
    return [{ bounds: { ...node.rect } }];
  });
}

export function paintVisitedRows(
  png: Buffer,
  nodes: SnapshotNode[],
  targets: readonly DiscoveryVisitTarget[],
  logical?: { width: number; height: number },
): Buffer {
  return annotateVisitedRows(png, visitedRowBounds(nodes, targets), logical);
}

export function shouldCaptureFullSurface(title: string, labels: string[]): boolean {
  return (
    recommendScrollSurfaceCapturePolicy({
      title,
      semanticLabels: labels,
      decidedAt: Date.now(),
    }).captureMode === "full-surface"
  );
}

export async function captureFullSurfaceEvidence(
  serial: string,
  title: string,
  labels: string[],
): Promise<{ pngPath: string; nodes: SnapshotNode[] } | undefined> {
  if (!shouldCaptureFullSurface(title, labels) && labels.length < 10) return undefined;
  try {
    const survey = await captureScrollableSurveyForTarget({ serial, maxScrolls: 12 });
    if (!survey.stitched?.base64 || survey.mergedNodes.length < 2) return undefined;
    const folder = await mkdtemp(join(tmpdir(), "relay-surface-"));
    const pngPath = join(folder, "full.png");
    await writeFile(pngPath, Buffer.from(survey.stitched.base64, "base64"));
    return { pngPath, nodes: survey.mergedNodes };
  } catch (error) {
    console.error("discovery full-surface capture failed", error);
    return undefined;
  }
}
