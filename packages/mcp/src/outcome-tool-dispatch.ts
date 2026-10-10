import type { AuthoringInteraction, RepeatSpec } from "@relay/protocol";
import type { RelayOutcomeJobs } from "@relay/workflows";
import type { RelayOutcomeToolDescriptor } from "./outcome-tools.js";
import type { WorkflowRef } from "@relay/workflows";

type Parser = { parse(value: unknown): unknown };

export type OutcomeToolDispatchDependencies = {
  descriptors: readonly RelayOutcomeToolDescriptor[];
  assertRawOutcomeInputBounds: (
    name: RelayOutcomeToolDescriptor["name"],
    value: Record<string, unknown>,
  ) => void;
  replayLabTracePacks: Parser;
};

export async function dispatchRelayOutcomeTool(
  input: {
    name: RelayOutcomeToolDescriptor["name"];
    argumentsValue: Record<string, unknown>;
    confirmed: boolean;
    jobs: RelayOutcomeJobs;
  },
  dependencies: OutcomeToolDispatchDependencies,
): Promise<unknown> {
  const descriptor = dependencies.descriptors.find(({ name }) => name === input.name);
  if (!descriptor) throw new TypeError(`Unknown Relay outcome tool: ${input.name}`);
  const readOnlyGoalInspection =
    input.name === "relay_goal" &&
    (typeof input.argumentsValue.inspectSessionId === "string" ||
      typeof input.argumentsValue.inspectExplorationId === "string");
  if (descriptor.requiresConfirmation && !input.confirmed && !readOnlyGoalInspection) {
    throw new TypeError(`${descriptor.name} requires confirm: true.`);
  }
  dependencies.assertRawOutcomeInputBounds(input.name, input.argumentsValue);
  let parsed = descriptor.inputSchema.parse(input.argumentsValue) as Record<string, unknown>;
  if (input.name === "relay_replay_lab") {
    parsed = {
      ...parsed,
      tracePacks: dependencies.replayLabTracePacks.parse(parsed.tracePacks),
    };
  }
  const { jobs } = input;

  function goalValues(raw: unknown): { values?: Record<string, string> } {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const entries = Object.entries(raw as Record<string, unknown>).filter(
      ([, value]) => typeof value === "string",
    );
    return entries.length > 0
      ? { values: Object.fromEntries(entries) as Record<string, string> }
      : {};
  }
  if (input.name === "relay_connect_target") {
    return jobs.connect({
      kind: "connect-target",
      ...(typeof parsed.targetId === "string" ? { targetId: parsed.targetId } : {}),
      ...(parsed.targetKind === "device" || parsed.targetKind === "browser"
        ? { targetKind: parsed.targetKind }
        : {}),
      ...(parsed.phase === "android" || parsed.phase === "ios" ? { phase: parsed.phase } : {}),
    });
  }
  if (input.name === "relay_observe_target") {
    return jobs.observe({
      kind: "observe-target",
      ...(typeof parsed.targetId === "string" ? { targetId: parsed.targetId } : {}),
    });
  }
  if (input.name === "relay_goal") {
    if (typeof parsed.cancelSessionId === "string") {
      return jobs.cancelGoal({ kind: "goal-cancel", sessionId: parsed.cancelSessionId });
    }
    if (typeof parsed.inspectSessionId === "string") {
      return jobs.inspectGoal({ kind: "goal-inspect", sessionId: parsed.inspectSessionId });
    }
    if (typeof parsed.inspectExplorationId === "string") {
      return jobs.inspectExploration({
        kind: "goal-explore-inspect",
        explorationId: parsed.inspectExplorationId,
      });
    }
    if (typeof parsed.reproduceSessionId === "string") {
      return jobs.reproduceGoal({ kind: "goal-reproduce", sessionId: parsed.reproduceSessionId });
    }
    if (typeof parsed.promoteSessionId === "string") {
      return jobs.promoteGoal({
        kind: "goal-promote",
        sessionId: parsed.promoteSessionId,
        ...(typeof parsed.appMapId === "string" ? { appMapId: parsed.appMapId } : {}),
        ...(typeof parsed.title === "string" ? { title: parsed.title } : {}),
        confirmControl: true,
      });
    }
    if (typeof parsed.resumeExplorationId === "string") {
      return jobs.resumeExploration({
        kind: "goal-explore-resume",
        explorationId: parsed.resumeExplorationId,
      });
    }
    if (typeof parsed.resumeSessionId === "string") {
      return jobs.resumeGoal({ kind: "goal-resume", sessionId: parsed.resumeSessionId });
    }
    if (typeof parsed.agents === "number" && parsed.agents > 1) {
      return jobs.explore({
        kind: "goal-explore",
        goal: parsed.goal as string,
        ...(typeof parsed.startUrl === "string" ? { startUrl: parsed.startUrl } : {}),
        ...(typeof parsed.targetId === "string" ? { targetId: parsed.targetId } : {}),
        ...(typeof parsed.authenticationFixtureReference === "string"
          ? { authenticationFixtureReference: parsed.authenticationFixtureReference }
          : {}),
        ...(typeof parsed.model === "string" ? { model: parsed.model } : {}),
        ...(typeof parsed.maxSteps === "number" ? { maxSteps: parsed.maxSteps } : {}),
        ...(typeof parsed.maxDurationMs === "number"
          ? { maxDurationMs: parsed.maxDurationMs }
          : {}),
        ...(Array.isArray(parsed.missions) ? { missions: parsed.missions } : {}),
        ...(goalValues(parsed.values).values ? { values: goalValues(parsed.values).values } : {}),
        agents: parsed.agents,
      });
    }
    return jobs.goal({
      kind: "goal-start",
      goal: parsed.goal as string,
      ...(typeof parsed.startUrl === "string" ? { startUrl: parsed.startUrl } : {}),
      ...(typeof parsed.targetId === "string" ? { targetId: parsed.targetId } : {}),
      ...(typeof parsed.laneId === "string" ? { laneId: parsed.laneId } : {}),
      ...(typeof parsed.authenticationFixtureReference === "string"
        ? { authenticationFixtureReference: parsed.authenticationFixtureReference }
        : {}),
      ...(typeof parsed.model === "string" ? { model: parsed.model } : {}),
      ...(typeof parsed.maxSteps === "number" ? { maxSteps: parsed.maxSteps } : {}),
      ...(typeof parsed.maxDurationMs === "number" ? { maxDurationMs: parsed.maxDurationMs } : {}),
      ...(typeof parsed.agents === "number" ? { agents: parsed.agents } : {}),
      ...(goalValues(parsed.values).values ? { values: goalValues(parsed.values).values } : {}),
    });
  }
  if (input.name === "relay_record_test") {
    return jobs.record({
      kind: "record-test",
      ...(typeof parsed.appMapId === "string" ? { appMapId: parsed.appMapId } : {}),
      title: parsed.title as string,
      confirmControl: true,
      ...(typeof parsed.targetId === "string" ? { targetId: parsed.targetId } : {}),
      ...(parsed.targetKind === "device" || parsed.targetKind === "browser"
        ? { targetKind: parsed.targetKind }
        : {}),
      ...(typeof parsed.originApplication === "string"
        ? { originApplication: parsed.originApplication }
        : {}),
    });
  }
  if (input.name === "relay_repeat_test") {
    return jobs.repeat({
      kind: "repeat-test",
      ...(typeof parsed.appMapId === "string" ? { appMapId: parsed.appMapId } : {}),
      testId: parsed.testId as string,
      repeat: parsed.repeat as RepeatSpec,
      ...(parsed.evidence === "visual" || parsed.evidence === "smoke"
        ? { evidence: parsed.evidence }
        : {}),
      ...(typeof parsed.targetId === "string" ? { targetId: parsed.targetId } : {}),
      ...(input.confirmed ? { confirmRisk: true } : {}),
    });
  }
  if (input.name === "relay_record_action") {
    return jobs.advanceRecording({
      action: "record",
      workflowId: parsed.workflowId as string,
      expectedVersion: parsed.expectedVersion as number,
      interaction: parsed.interaction as AuthoringInteraction,
    });
  }
  if (input.name === "relay_add_checkpoint") {
    return jobs.advanceRecording({
      action: "checkpoint",
      workflowId: parsed.workflowId as string,
      expectedVersion: parsed.expectedVersion as number,
      ...(typeof parsed.label === "string" ? { label: parsed.label } : {}),
    });
  }
  if (input.name === "relay_stop_recording") {
    return jobs.advanceRecording({
      action: "stop",
      workflowId: parsed.workflowId as string,
      expectedVersion: parsed.expectedVersion as number,
    });
  }
  if (input.name === "relay_edit_recording") {
    return jobs.editRecording({
      kind: "edit-recording",
      workflowId: parsed.workflowId as string,
      expectedVersion: parsed.expectedVersion as number,
      edit: parsed.edit as Parameters<RelayOutcomeJobs["editRecording"]>[0]["edit"],
    });
  }
  if (input.name === "relay_replay_recording") {
    return jobs.advanceRecording({
      action: "replay",
      workflowId: parsed.workflowId as string,
      expectedVersion: parsed.expectedVersion as number,
    });
  }
  if (input.name === "relay_approve_recording") {
    return jobs.advanceRecording({
      action: "approve",
      workflowId: parsed.workflowId as string,
      expectedVersion: parsed.expectedVersion as number,
    });
  }
  if (input.name === "relay_inspect_workflow") {
    return typeof parsed.workflowId === "string"
      ? jobs.inspect({ workflowId: parsed.workflowId })
      : jobs.inspect({ legacyRef: parsed.legacyRef as WorkflowRef });
  }
  if (input.name === "relay_cancel_run") {
    return jobs.cancelRun({
      kind: "cancel-run",
      workflowId: parsed.workflowId as string,
      expectedVersion: parsed.expectedVersion as number,
      confirmCancel: true,
    });
  }
  if (input.name === "relay_continue_repeat") {
    return jobs.continueRepeat({
      workflowId: parsed.workflowId as string,
      expectedVersion: parsed.expectedVersion as number,
      confirmRemaining: true,
    });
  }
  if (input.name === "relay_replay_lab") {
    return jobs.replayLab({
      kind: "replay-lab",
      analysis: parsed.analysis as "compare" | "visual-localization" | "all",
      tracePacks: parsed.tracePacks as Parameters<RelayOutcomeJobs["replayLab"]>[0]["tracePacks"],
    });
  }
  if (input.name === "relay_prove_change") {
    return jobs.proveChange({
      kind: "prove-change",
      ...(typeof parsed.proofId === "string" ? { proofId: parsed.proofId } : {}),
      ...(typeof parsed.baseRef === "string" ? { baseRef: parsed.baseRef } : {}),
      ...(typeof parsed.pullRequest === "number" ? { pullRequest: parsed.pullRequest } : {}),
      ...(parsed.agentClaim ? { agentClaim: parsed.agentClaim as never } : {}),
      ...(Array.isArray(parsed.targetIds) ? { targetIds: parsed.targetIds as string[] } : {}),
      ...(Array.isArray(parsed.buildIds) ? { buildIds: parsed.buildIds as string[] } : {}),
      ...(typeof parsed.expectedVersion === "number"
        ? { expectedVersion: parsed.expectedVersion }
        : {}),
      ...(typeof parsed.wait === "boolean" ? { wait: parsed.wait } : {}),
    });
  }
  if (input.name === "relay_inspect_proof") {
    return jobs.inspectProof({
      kind: "inspect-proof",
      proofId: parsed.proofId as string,
      ...(typeof parsed.includeHistory === "boolean"
        ? { includeHistory: parsed.includeHistory }
        : {}),
    });
  }
  if (input.name === "relay_propose_repair") {
    return jobs.proposeRepair({
      kind: "propose-repair",
      runId: parsed.runId as string,
      checkId: parsed.checkId as string,
      proposal: parsed.proposal as "accept-current" | "disable",
      reason: parsed.reason as string,
    });
  }
  return jobs.exportEvidence({ kind: "export-evidence", runId: parsed.runId as string });
}
