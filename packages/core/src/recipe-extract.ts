import type { StepTarget } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { nodeMatchesTarget, nodeText } from "./recipe-target-match.js";
import {
  type CurrentActionAssistantTurn,
  type ResponseBoundary,
  listAssistantTurns,
  listQuotaObservations,
  quotasAfterBoundary,
  targetMatched,
  turnsAfterBoundary,
} from "./recipe-response-boundary.js";

export function extractCurrentActionAssistantTurn(
  nodes: readonly SnapshotNode[],
  target: StepTarget,
  boundary?: ResponseBoundary,
): CurrentActionAssistantTurn {
  if (!targetMatched(nodes, target)) {
    throw new Error("extract: target did not match any node");
  }
  if (boundary) {
    const next = turnsAfterBoundary(nodes, target, boundary).filter(
      (turn) => turn.observation === "completed",
    );
    const quota = quotasAfterBoundary(nodes, boundary);
    if (next.length === 1) {
      return {
        text: next[0]!.text,
        responseId: next[0]!.id,
        initiatingActionId: boundary.initiatingActionId,
        observation: "completed",
        target,
      };
    }
    if (next.length > 1) {
      throw new Error("extract: multiple new completed assistant turns matched the current action");
    }
    if (quota.length) {
      throw new Error("extract: no verified new answer (quota or error, leftover is not current)");
    }
    throw new Error("extract: no verified new answer for the current action");
  }
  const completed = listAssistantTurns(nodes, target).filter(
    (turn) => turn.observation === "completed",
  );
  const quota = listQuotaObservations(nodes);
  if (quota.length && completed.length) {
    throw new Error("extract: no verified new answer (quota or error, leftover is not current)");
  }
  if (completed.length === 0) {
    throw new Error("extract: no completed assistant turn matched the current action");
  }
  if (completed.length > 1) {
    throw new Error(
      "extract: multiple completed assistant turns; initiating-action boundary required",
    );
  }
  return {
    text: completed[0]!.text,
    responseId: completed[0]!.id,
    initiatingActionId: undefined,
    observation: "completed",
    target,
  };
}

/** Newest completed assistant turn from the current action, never quota/echo/history. */
export function extractNewestCompletedAssistantTurn(
  nodes: readonly SnapshotNode[],
  target: StepTarget,
  boundary?: ResponseBoundary,
): string {
  return extractCurrentActionAssistantTurn(nodes, target, boundary).text;
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

export function conversationProvenanceFromArtifacts(
  artifacts: readonly { kind: string; data?: unknown }[] | undefined,
): { responseId?: string; initiatingActionId?: string } {
  const data = [...(artifacts ?? [])]
    .reverse()
    .find((item) => item.kind === "conversation-turn")?.data;
  if (!data || typeof data !== "object") return {};
  const record = data as { responseId?: unknown; initiatingActionId?: unknown };
  return {
    ...(typeof record.responseId === "string" ? { responseId: record.responseId } : {}),
    ...(typeof record.initiatingActionId === "string"
      ? { initiatingActionId: record.initiatingActionId }
      : {}),
  };
}
