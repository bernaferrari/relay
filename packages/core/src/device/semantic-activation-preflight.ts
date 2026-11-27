/**
 * Offline semantic activation preflight: prove or refute a semantic repair
 * against a frozen accessibility tree without touching hardware. Extracted
 * from device-target-resolution.ts to keep both modules inside the source
 * line budget; the resolver itself lives there.
 */
import type { SnapshotNode } from "./device.js";
import { relationAnchorMatches } from "../semantic/semantic-row-activation.js";
import {
  resolveFollowingRowControl,
  resolveNamedControlOutcome,
  type NamedControlResolution,
  type NamedControlTarget,
} from "./device-target-resolution.js";

export type SemanticActivationPreflight =
  | { status: "proven"; resolution: NamedControlResolution }
  | { status: "blocked"; code: "absent" | "ambiguous" | "heading-only-noop"; detail: string };

/** Pure offline selector check over a frozen raw accessibility tree. It uses
 * the same resolver as the device path, so a repair can be validated without
 * reconnecting hardware. */
export function preflightSemanticActivation(
  nodes: SnapshotNode[],
  target: NamedControlTarget,
): SemanticActivationPreflight {
  if (target.relation) {
    const related = resolveFollowingRowControl(nodes, target.relation);
    return related.status === "resolved"
      ? { status: "proven", resolution: related.resolution }
      : {
          status: "blocked",
          code: related.status === "ambiguous" ? "ambiguous" : "absent",
          detail: related.detail,
        };
  }
  const outcome = resolveNamedControlOutcome(nodes, target);
  if (outcome.status !== "resolved") {
    return {
      status: "blocked",
      code: outcome.status === "ambiguous" ? "ambiguous" : "absent",
      detail: outcome.detail,
    };
  }
  const semantic = {
    ...(target.identifier ? { identifier: target.identifier } : {}),
    ...(target.label ? { label: target.label } : {}),
    ...(target.role ? { role: target.role } : {}),
    ...(target.text ? { text: target.text } : {}),
  };
  const matches = nodes.filter((node) =>
    relationAnchorMatches(node, {
      kind: "following-row",
      anchor: semantic,
    }),
  );
  const descriptiveOnly =
    matches.length > 0 &&
    matches.every((node) => {
      const role = (node.role ?? node.type ?? "").toLocaleLowerCase();
      return node.hittable !== true && /heading|header|statictext|textview/.test(role);
    });
  if (descriptiveOnly && outcome.resolution.activation !== "snapshot-point") {
    const relation = resolveFollowingRowControl(nodes, {
      kind: "following-row",
      anchor: semantic,
    });
    if (relation.status === "resolved") {
      return {
        status: "blocked",
        code: "heading-only-noop",
        detail:
          "selector resolves only to descriptive heading bounds; use a following-row semantic relation",
      };
    }
  }
  return { status: "proven", resolution: outcome.resolution };
}
