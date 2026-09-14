import type { StepTarget } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { nodeMatchesTarget, nodeText } from "./recipe-target-match.js";

const ASSISTANT_SLOT = /^(?:assistant-message|last-reply-container|response-.+)$/iu;
const USER_SLOT = /^(?:user-message)$/iu;
const QUOTA_OR_FAILURE =
  /try again(?:\s+in|\s+later)?\b|\bbefore limit is gone\b|\blimit (?:is )?reached\b|\bminutes remaining\b|no answer generated|free tier/iu;

function compact(node: SnapshotNode): string {
  const value = typeof node.value === "string" ? node.value.trim() : "";
  const content = typeof node.content === "string" ? node.content.trim() : "";
  if (isAssistantSlot(node)) return content || value;
  return nodeText(node).join("\n").trim();
}

function isUserEcho(node: SnapshotNode): boolean {
  const identifier = (node.identifier ?? "").trim();
  if (USER_SLOT.test(identifier)) return true;
  return (
    (node.role ?? "").toLocaleLowerCase() === "article" && /^(?:you)$/iu.test(node.label ?? "")
  );
}

function isQuotaOrFailureChrome(node: SnapshotNode): boolean {
  return QUOTA_OR_FAILURE.test(`${node.label ?? ""} ${node.value ?? ""} ${node.content ?? ""}`);
}

function isAssistantSlot(node: SnapshotNode): boolean {
  const identifier = (node.identifier ?? "").trim();
  if (ASSISTANT_SLOT.test(identifier)) return true;
  return (
    (node.role ?? "").toLocaleLowerCase() === "article" && /^(?:grok)$/iu.test(node.label ?? "")
  );
}

function documentOrder(left: SnapshotNode, right: SnapshotNode): number {
  const leftY = left.rect?.y ?? -Infinity;
  const rightY = right.rect?.y ?? -Infinity;
  if (leftY !== rightY) return leftY - rightY;
  return (left.index ?? 0) - (right.index ?? 0);
}

/** Newest completed assistant turn from the current action, never quota/echo/history. */
export function extractNewestCompletedAssistantTurn(
  nodes: readonly SnapshotNode[],
  target: StepTarget,
): string {
  const matched = nodes.filter((node) => nodeMatchesTarget(node, target));
  const candidates = (matched.length ? matched : [...nodes]).filter(
    (node) => !isUserEcho(node) && !isQuotaOrFailureChrome(node),
  );
  const slots = candidates.filter(isAssistantSlot);
  const pool = slots.length ? slots : candidates;
  const latestEcho = [...nodes.filter(isUserEcho)].sort(documentOrder).at(-1);
  const currentAction = latestEcho
    ? pool.filter((node) => documentOrder(node, latestEcho) > 0)
    : pool;
  const newest = [...currentAction].sort(documentOrder).at(-1);
  const text = newest ? compact(newest) : "";
  if (!text) {
    throw new Error("extract: no completed assistant turn matched the current action");
  }
  return text;
}

export function extractJoinedTargetText(
  nodes: readonly SnapshotNode[],
  target: StepTarget,
): string {
  const matches = nodes.filter((node) => nodeMatchesTarget(node, target));
  const values = [...new Set(matches.flatMap(nodeText))];
  if (values.length === 0) {
    throw new Error("extract: no accessible content matched the target");
  }
  return values.join("\n");
}
