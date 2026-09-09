import type { SnapshotNode } from "./device.js";
import { resolveNamedControlOutcome, type NamedControlTarget } from "./device-target-resolution.js";

/** Translate selectors using app resources; retained native evidence stays untouched. */
export function resolveLocalizedRecipeTarget(
  nodes: SnapshotNode[],
  taught: NamedControlTarget,
  localization: { packageName: string; translate(text: string): string | undefined },
) {
  if (taught.relation) return undefined;
  const label = taught.label ? localization.translate(taught.label) : undefined;
  const text = taught.text ? localization.translate(taught.text) : undefined;
  if ((!label || label === taught.label) && (!text || text === taught.text)) return undefined;
  const { point: _recordedPoint, ...semantic } = taught;
  const target: NamedControlTarget = {
    ...semantic,
    ...(label ? { label } : {}),
    ...(text ? { text } : {}),
  };
  const outcome = resolveNamedControlOutcome(
    nodes.filter((node) => node.bundleId === localization.packageName),
    target,
  );
  return { target, outcome };
}
