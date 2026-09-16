import type { StepTarget } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { nodeMatchesTarget } from "./recipe-target-match.js";

const ASSISTANT_SLOT =
  /^(?:assistant-message|assistant-output|last-reply-container|response-.+)$/iu;
const USER_SLOT = /^(?:user-message)$/iu;
const QUOTA =
  /try again(?:\s+in|\s+later)?\b|\bbefore limit is gone\b|\blimit (?:is )?reached\b|\bminutes remaining\b/iu;
const ERROR_REPLY = /no answer generated|model\s+v?\d+\s+failed/iu;

export type AssistantTurnObservation = "completed" | "quota" | "error";

export type AssistantTurnRecord = {
  readonly id: string;
  readonly text: string;
  readonly observation: AssistantTurnObservation;
};

export type ResponseBoundary = {
  readonly source: "initiating-action" | "wait-response";
  readonly initiatingActionId?: string;
  readonly turnIds: readonly string[];
  readonly quotaIds: readonly string[];
  readonly capturedAt: number;
};

export type CurrentActionAssistantTurn = {
  readonly text: string;
  readonly responseId: string;
  readonly initiatingActionId?: string;
  readonly observation: "completed";
  readonly target: StepTarget;
};

export function isUserEcho(node: SnapshotNode): boolean {
  const identifier = (node.identifier ?? "").trim();
  if (USER_SLOT.test(identifier)) return true;
  return (
    (node.role ?? "").toLocaleLowerCase() === "article" && /^(?:you)$/iu.test(node.label ?? "")
  );
}

export function isAssistantSlot(node: SnapshotNode): boolean {
  const identifier = (node.identifier ?? "").trim();
  if (ASSISTANT_SLOT.test(identifier)) return true;
  return (
    (node.role ?? "").toLocaleLowerCase() === "article" && /^(?:grok)$/iu.test(node.label ?? "")
  );
}

export function compactAssistantNode(node: SnapshotNode): string {
  const value = typeof node.value === "string" ? node.value.trim() : "";
  const content = typeof node.content === "string" ? node.content.trim() : "";
  if (isAssistantSlot(node)) return content || value;
  return [node.label, value, content]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => part.trim())
    .join("\n")
    .trim();
}

export function turnObservation(text: string): AssistantTurnObservation {
  if (QUOTA.test(text)) return "quota";
  if (ERROR_REPLY.test(text)) return "error";
  return "completed";
}

function fnv1a(text: string): string {
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function assignIds(items: readonly { slot: string; text: string }[], kind: string): string[] {
  const counts = new Map<string, number>();
  return items.map((item) => {
    // Slot + content is the turn identity. Accessibility node refs are
    // reminted across snapshots and must not make an unchanged leftover
    // look like a new answer. Identical consecutive answers share the
    // hash and are distinguished by occurrence (#0, #1, …).
    const key = `${kind}:${item.slot}:${fnv1a(item.text)}`;
    const occurrence = counts.get(key) ?? 0;
    counts.set(key, occurrence + 1);
    return `${key}#${occurrence}`;
  });
}

function slotName(node: SnapshotNode): string {
  return (node.identifier ?? node.role ?? "node").trim() || "node";
}

export function listQuotaObservations(nodes: readonly SnapshotNode[]): AssistantTurnRecord[] {
  const items = nodes.flatMap((node) => {
    if (isUserEcho(node) || isAssistantSlot(node)) return [];
    const text = `${node.label ?? ""} ${node.value ?? ""} ${node.content ?? ""}`.trim();
    if (!text || turnObservation(text) === "completed") return [];
    return [
      {
        slot: slotName(node),
        text,
        observation: turnObservation(text),
      },
    ];
  });
  const ids = assignIds(items, "quota");
  return items.map((item, index) => ({
    id: ids[index]!,
    text: item.text,
    observation: item.observation,
  }));
}

export function listAssistantTurns(
  nodes: readonly SnapshotNode[],
  target?: StepTarget,
): AssistantTurnRecord[] {
  const scoped = target
    ? nodes.filter((node) => nodeMatchesTarget(node, target) && !isUserEcho(node))
    : nodes.filter((node) => isAssistantSlot(node) && !isUserEcho(node));
  const slotted = scoped.filter(isAssistantSlot);
  const pool = target && slotted.length === 0 ? scoped : slotted.length ? slotted : scoped;
  const items = pool.flatMap((node) => {
    const text = compactAssistantNode(node);
    if (!text) return [];
    return [
      {
        slot: slotName(node),
        text,
        // Assistant prose can discuss quotas without being the quota banner.
        observation: "completed" as const,
      },
    ];
  });
  const ids = assignIds(items, "turn");
  return items.map((item, index) => ({
    id: ids[index]!,
    text: item.text,
    observation: item.observation,
  }));
}

export function captureResponseBoundary(
  nodes: readonly SnapshotNode[],
  source: ResponseBoundary["source"],
  initiatingActionId?: string,
): ResponseBoundary {
  return {
    source,
    ...(initiatingActionId?.trim() ? { initiatingActionId: initiatingActionId.trim() } : {}),
    turnIds: listAssistantTurns(nodes).map((turn) => turn.id),
    quotaIds: listQuotaObservations(nodes).map((item) => item.id),
    capturedAt: Date.now(),
  };
}

export function turnsAfterBoundary(
  nodes: readonly SnapshotNode[],
  target: StepTarget,
  boundary: ResponseBoundary,
): AssistantTurnRecord[] {
  const known = new Set(boundary.turnIds);
  return listAssistantTurns(nodes, target).filter((turn) => !known.has(turn.id));
}

export function quotasAfterBoundary(
  nodes: readonly SnapshotNode[],
  boundary: ResponseBoundary,
): AssistantTurnRecord[] {
  const known = new Set(boundary.quotaIds);
  return listQuotaObservations(nodes).filter((item) => !known.has(item.id));
}

export function targetMatched(nodes: readonly SnapshotNode[], target: StepTarget): boolean {
  return nodes.some((node) => nodeMatchesTarget(node, target));
}
