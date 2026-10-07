import { resolveStepPoint, type AuthoringObservation, type StepTarget } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import {
  INTERACTIVE_SNAPSHOT_ROLES,
  resolveNamedControlOutcome,
} from "./device-target-resolution.js";
import { hasCurrentAuthoringSemantics } from "./authoring-observation-proof.js";
import { recordedControlDisplayName } from "./recorded-control-label.js";

const STRUCTURAL_SNAPSHOT_ROLES = new Set([
  "application",
  "window",
  "navigationbar",
  "toolbar",
  "tabbar",
  "scrollview",
  "horizontalscrollview",
  "table",
  "collectionview",
]);

function isStructuralRegion(node: SnapshotNode): boolean {
  const role = (node.role ?? node.type ?? "").toLowerCase().split(".").at(-1) ?? "";
  return STRUCTURAL_SNAPSHOT_ROLES.has(role);
}

function sameBounds(left: SnapshotNode["rect"], right: NonNullable<SnapshotNode["rect"]>): boolean {
  return (
    left?.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

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
        !isStructuralRegion(node) &&
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
      // Region IDs (toolbars, sections, Compose wrappers) do not identify the
      // clicked control. Prefer its label unless the ID belongs to an actual
      // activation target, including non-hittable native control roles.
      const role = (node.role ?? node.type ?? "").toLowerCase().split(".").at(-1) ?? "";
      if (key === "identifier" && node.hittable !== true && !INTERACTIVE_SNAPSHOT_ROLES.has(role))
        continue;
      // A composer can publish an editable ID around independent buttons.
      // Its ID does not own a click on the smaller activation target inside it.
      if (
        key === "identifier" &&
        node.editable === true &&
        candidates.some((inner) => {
          if (inner === node || !inner.rect) return false;
          const innerRole = (inner.role ?? inner.type ?? "").toLowerCase().split(".").at(-1) ?? "";
          return (
            (inner.hittable === true || innerRole === "button") &&
            inner.rect.width * inner.rect.height < node.rect!.width * node.rect!.height &&
            inner.rect.x >= node.rect!.x &&
            inner.rect.y >= node.rect!.y &&
            inner.rect.x + inner.rect.width <= node.rect!.x + node.rect!.width &&
            inner.rect.y + inner.rect.height <= node.rect!.y + node.rect!.height
          );
        })
      )
        continue;
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
      const ownsBounds =
        rect &&
        sameBounds(node.rect, rect) &&
        (node.hittable === true || INTERACTIVE_SNAPSHOT_ROLES.has(role));
      if (
        !rect ||
        !contains(rect) ||
        rect.width * rect.height > (observation.bounds.width * observation.bounds.height) / 3 ||
        // XCTest can mark a navigation bar hittable and expose "Close" as its
        // label. Neither that region nor a child resolved through its center
        // owns the person's exact tap on the close control.
        (!ownsBounds &&
          nodes.some((region) => isStructuralRegion(region) && sameBounds(region.rect, rect)))
      )
        continue;
      const label = node.label?.trim();
      // A container's label can be its whole text; name the step by the
      // selector then, so it reads like the control the person clicked.
      return {
        target: selector,
        name:
          label && label.length <= 60
            ? label
            : (recordedControlDisplayName(selector, nodes) ?? value),
      };
    }
  }
  return undefined;
}
