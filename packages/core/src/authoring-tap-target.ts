import { resolveStepPoint, type AuthoringObservation, type StepTarget } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { resolveNamedControlOutcome } from "./device-target-resolution.js";
import { hasCurrentAuthoringSemantics } from "./authoring-observation-proof.js";

/** Promote a pixel click only when a fresh tree identifies a unique control at
 * that location. The raw recording retains the original click separately. */
export function semanticTargetForRecording(
  target: StepTarget,
  observation: AuthoringObservation,
): { target: StepTarget; name?: string } | undefined {
  if (!target.point || target.identifier || target.label || target.text) return undefined;
  if (!observation.bounds || !hasCurrentAuthoringSemantics(observation.proof)) return undefined;
  const point = resolveStepPoint(target.point, observation.bounds);
  const nodes = (observation.nodes ?? []) as unknown as SnapshotNode[];
  const contains = (rect: NonNullable<SnapshotNode["rect"]>) =>
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height;
  const candidates = nodes
    .filter(
      (node) =>
        node.visibleToUser !== false &&
        node.enabled !== false &&
        node.rect &&
        node.rect.width > 0 &&
        node.rect.height > 0 &&
        contains(node.rect),
    )
    .sort((a, b) => a.rect!.width * a.rect!.height - b.rect!.width * b.rect!.height);
  // Search every hit control for a unique ID before considering translated labels.
  for (const key of ["identifier", "label"] as const) {
    for (const node of candidates) {
      // A full-screen container's name is not the control the person clicked.
      if (
        node.rect!.width * node.rect!.height >
        (observation.bounds.width * observation.bounds.height) / 3
      )
        continue;
      const value = node[key]?.trim();
      // A card or section reads its whole text as a label; that names a
      // region, not the control the person clicked.
      if (!value || value.length > 60) continue;
      const selector = { [key]: value };
      const result = resolveNamedControlOutcome(nodes, selector);
      if (result.status !== "resolved") continue;
      // Android often activates the clickable row containing its text label.
      // Its center need not lie inside the text, but it must own this click.
      const rect = result.resolution.bounds;
      if (
        !rect ||
        !contains(rect) ||
        rect.width * rect.height > (observation.bounds.width * observation.bounds.height) / 3
      )
        continue;
      const label = node.label?.trim();
      // A container's label can be its whole text; name the step by the
      // selector then, so it reads like the control the person clicked.
      return { target: selector, name: label && label.length <= 60 ? label : value };
    }
  }
  return undefined;
}
