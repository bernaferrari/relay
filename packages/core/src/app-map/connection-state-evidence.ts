import type { NormalizedSemanticNode } from "@relay/protocol";
import type { AppMap, Connection } from "./model.js";

type StateClaim = { subject: string; state: string };

/**
 * A passive edge may describe a state only when Relay observed that exact
 * state at the destination and a different state at the source. Scrolling to
 * or inspecting a control is not a state change, and missing evidence must not
 * be turned into an authoritative On/Off edge.
 */
export function passiveStateClaimHasEvidence(map: AppMap, connection: Connection): boolean {
  if (!connection.actions.length || connection.actions.some((action) => action.kind !== "passive"))
    return true;
  const claim = stateClaim(connection.label);
  if (!claim || connection.destination.kind !== "screen") return true;
  const before = relatedNodeStates(map, connection.fromScreenId, claim.subject);
  const after = relatedNodeStates(map, connection.destination.screenId, claim.subject);
  const claimedState = claim.state === "on" || claim.state === "enabled";
  return before.includes(!claimedState) && after.includes(claimedState);
}

function stateClaim(label: string | undefined): StateClaim | undefined {
  const normalized = label?.trim().toLowerCase();
  if (!normalized) return undefined;
  const match = normalized.match(/^(.*?)(?:\s*[·:—-]\s*|\s+)(on|off|enabled|disabled)$/);
  if (!match?.[1] || !match[2]) return undefined;
  return { subject: match[1].trim(), state: match[2] };
}

function relatedNodeStates(map: AppMap, screenId: string, subject: string): boolean[] {
  const screen = map.screens[screenId];
  if (!screen) return [];
  return screen.variantIds
    .flatMap((variantId) => map.screenVariants[variantId]?.observation?.nodes ?? [])
    .filter((node) => nodeMatchesSubject(node, subject))
    .map(explicitNodeState)
    .filter((state): state is boolean => state !== undefined);
}

function explicitNodeState(node: NormalizedSemanticNode): boolean | undefined {
  if (node.selected !== undefined) return node.selected;
  const stateText = `${node.label ?? ""} ${node.value ?? ""}`.trim().toLowerCase();
  if (/(?:^|\s)(?:on|enabled)(?:$|\s)/.test(stateText)) return true;
  if (/(?:^|\s)(?:off|disabled)(?:$|\s)/.test(stateText)) return false;
  return undefined;
}

function nodeMatchesSubject(node: NormalizedSemanticNode, subject: string): boolean {
  const label = node.label?.trim().toLowerCase() ?? "";
  const value = node.value?.trim().toLowerCase() ?? "";
  return label === subject || value === subject;
}
