import { isDeepStrictEqual } from "node:util";
import type {
  DurableWorkflowRead,
  StoredCombineCampaign,
  TransitionDurableWorkflowInput,
  DurableWorkflowTransitionResult,
} from "@relay/core";
import type { CombineCampaign, DurableWorkflowRecord, WorkflowJsonValue } from "@relay/protocol";
import { HttpError } from "./http.js";
import type { RequestContext } from "./security.js";

type JsonRecord = Record<string, WorkflowJsonValue>;
function object(value: WorkflowJsonValue | undefined): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

export type RepeatReconciliationRuntime = {
  readRepeatCampaign(projectId: string, campaignId: string): Promise<StoredCombineCampaign | null>;
  findRepeatCampaignsByWorkflow(
    projectId: string,
    workflowId: string,
  ): Promise<StoredCombineCampaign[]>;
  projectRepeatCampaign(campaign: StoredCombineCampaign): Promise<StoredCombineCampaign>;
  assertTargetControl(scope: RequestContext, targetId?: string): Promise<unknown>;
  transitionWorkflow(
    input: TransitionDurableWorkflowInput,
  ): Promise<DurableWorkflowTransitionResult>;
};

function terminal(campaign: CombineCampaign): boolean {
  return ["completed", "completed-with-problems", "cancelled"].includes(campaign.status);
}

function pending(
  record: DurableWorkflowRecord,
):
  | { action: "repeat-pilot" | "repeat-resume" | "repeat-cancel"; receiptVersion: number }
  | undefined {
  for (const action of ["repeat-pilot", "repeat-resume", "repeat-cancel"] as const) {
    if (record.lastTransition === `${action}-requested`) {
      return { action, receiptVersion: record.version };
    }
    if (record.lastTransition === `${action}-outcome-unknown`) {
      return { action, receiptVersion: record.version - 1 };
    }
  }
  return undefined;
}

function campaignFrozenIdentity(
  record: DurableWorkflowRecord,
  campaign: CombineCampaign,
): WorkflowJsonValue | undefined {
  if (record.kind !== "repeat-test" || campaign.projectId !== record.projectId) return undefined;
  const frozen = object(record.frozenIdentity);
  const repeat = campaign.execution?.repeat;
  const target = object(frozen?.target);
  if (
    !frozen ||
    !repeat ||
    campaign.ownerId !== frozen.actorId ||
    campaign.appMapId !== frozen.appMapId ||
    repeat.requestedAppMapRevision !== frozen.requestedAppMapRevision ||
    repeat.testId !== frozen.testId ||
    repeat.testPlanDigest !== frozen.testPlanDigest ||
    !target ||
    target.kind !== repeat.target.kind ||
    target.platform !== repeat.target.platform ||
    target.targetId !== repeat.target.targetId ||
    !isDeepStrictEqual(frozen.repeat, repeat.spec) ||
    !isDeepStrictEqual(frozen.resolved, repeat.resolved) ||
    frozen.evidence !== repeat.evidence ||
    (frozen.rootRecipeId !== undefined && frozen.rootRecipeId !== repeat.rootRecipeId) ||
    (frozen.sourceRevision !== undefined &&
      !isDeepStrictEqual(frozen.sourceRevision, repeat.sourceRevision)) ||
    (frozen.capture !== undefined && !isDeepStrictEqual(frozen.capture, repeat.capture))
  ) {
    return undefined;
  }
  if (
    frozen.executionAppMapRevision !== undefined &&
    frozen.executionAppMapRevision !== repeat.executionAppMapRevision
  )
    return undefined;
  return {
    ...frozen,
    executionAppMapRevision: repeat.executionAppMapRevision,
    rootRecipeId: repeat.rootRecipeId,
  };
}

export function validateLegacyRepeatAdoption(input: {
  projectId: string;
  actorId: string;
  frozenIdentity: WorkflowJsonValue;
  campaign: CombineCampaign;
  pilotJobId: string;
  selectedCaseIds: readonly string[];
}): WorkflowJsonValue | undefined {
  const frozen = object(input.frozenIdentity);
  const repeat = input.campaign.execution?.repeat;
  const target = object(frozen?.target);
  if (
    !frozen ||
    !repeat ||
    input.campaign.projectId !== input.projectId ||
    input.campaign.ownerId !== input.actorId ||
    input.campaign.appMapId !== frozen.appMapId ||
    input.campaign.sourceRevision !== frozen.executionAppMapRevision ||
    repeat.requestedAppMapRevision !== frozen.requestedAppMapRevision ||
    repeat.executionAppMapRevision !== frozen.executionAppMapRevision ||
    repeat.testId !== frozen.testId ||
    repeat.testPlanDigest !== frozen.testPlanDigest ||
    repeat.rootRecipeId !== frozen.rootRecipeId ||
    repeat.evidence !== frozen.evidence ||
    repeat.pilotJobId !== input.pilotJobId ||
    !isDeepStrictEqual(repeat.selectedCaseIds, input.selectedCaseIds) ||
    !isDeepStrictEqual(input.campaign.execution?.selectedCellIds, input.selectedCaseIds) ||
    !isDeepStrictEqual(repeat.spec, frozen.repeat) ||
    !isDeepStrictEqual(repeat.resolved, frozen.resolved) ||
    !isDeepStrictEqual(repeat.sourceRevision, frozen.sourceRevision) ||
    !isDeepStrictEqual(repeat.capture, frozen.capture) ||
    !target ||
    target.kind !== repeat.target.kind ||
    target.platform !== repeat.target.platform ||
    target.targetId !== repeat.target.targetId
  )
    return undefined;
  return { ...frozen, actorId: input.actorId };
}

function receiptMatches(record: DurableWorkflowRecord, campaign: CombineCampaign): boolean {
  const expected = pending(record);
  const receipt = campaign.execution?.repeat?.workflowMutation;
  return Boolean(
    expected &&
    receipt?.workflowId === record.workflowId &&
    receipt.transitionVersion === expected.receiptVersion &&
    receipt.action === expected.action,
  );
}

export async function assertRepeatWorkflowAccess(
  scope: RequestContext,
  runtime: RepeatReconciliationRuntime,
  workflow: DurableWorkflowRead,
  actorId: string,
): Promise<StoredCombineCampaign | undefined> {
  const frozen = object(workflow.record.frozenIdentity);
  const target = object(frozen?.target);
  if (
    workflow.record.kind !== "repeat-test" ||
    !frozen ||
    frozen.actorId !== actorId ||
    !target ||
    typeof target.targetId !== "string"
  ) {
    throw new HttpError(404, "Workflow not found");
  }
  await runtime.assertTargetControl(scope, target.targetId);
  if (workflow.record.resource?.kind !== "campaign") return undefined;
  const campaign = await runtime.readRepeatCampaign(scope.projectId, workflow.record.resource.id);
  if (!campaign || !campaignFrozenIdentity(workflow.record, campaign)) {
    throw new HttpError(404, "Workflow not found");
  }
  return campaign;
}

export async function reconcileRepeat(
  scope: RequestContext,
  runtime: RepeatReconciliationRuntime,
  input: DurableWorkflowRead,
  actorId: string,
  at: number,
  knownCampaign?: StoredCombineCampaign,
): Promise<{ workflow: DurableWorkflowRead; campaign?: StoredCombineCampaign }> {
  let workflow = input;
  if (workflow.record.status !== "expired" && workflow.record.expiresAt <= at) {
    const expired = await runtime.transitionWorkflow({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      workflowId: workflow.record.workflowId,
      expectedVersion: workflow.record.version,
      actorId,
      transition: "expired",
      status: "active",
      at,
    });
    if (expired.status === "expired") workflow = expired.current;
  }
  if (workflow.record.status === "expired") return { workflow };

  let campaign = knownCampaign;
  if (!campaign && workflow.record.resource?.kind === "campaign") {
    campaign =
      (await runtime.readRepeatCampaign(scope.projectId, workflow.record.resource.id)) ?? undefined;
  }
  if (!campaign && workflow.record.resource === undefined) {
    const matches = (
      await runtime.findRepeatCampaignsByWorkflow(scope.projectId, workflow.record.workflowId)
    ).filter((candidate) => Boolean(campaignFrozenIdentity(workflow.record, candidate)));
    if (matches.length === 1) campaign = matches[0];
    else if (matches.length > 1) {
      const ambiguous = await runtime.transitionWorkflow({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        workflowId: workflow.record.workflowId,
        expectedVersion: workflow.record.version,
        actorId,
        transition: "repeat-reconciliation-ambiguous",
        status: "needs-attention",
        at,
      });
      if (ambiguous.status === "updated") workflow = ambiguous.workflow;
    }
  }
  if (!campaign) {
    const requested = pending(workflow.record);
    if (requested && workflow.record.lastTransition.endsWith("-requested")) {
      const uncertain = await runtime.transitionWorkflow({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        workflowId: workflow.record.workflowId,
        expectedVersion: workflow.record.version,
        actorId,
        transition: `${requested.action}-outcome-unknown`,
        status: "needs-attention",
        at,
      });
      if (uncertain.status === "updated") workflow = uncertain.workflow;
    }
    return { workflow };
  }

  campaign = await runtime.projectRepeatCampaign(campaign);
  const frozenIdentity = campaignFrozenIdentity(workflow.record, campaign);
  if (!frozenIdentity) throw new HttpError(404, "Workflow not found");
  const currentPending = pending(workflow.record);
  if (currentPending && receiptMatches(workflow.record, campaign)) {
    const reconciled = await runtime.transitionWorkflow({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      workflowId: workflow.record.workflowId,
      expectedVersion: workflow.record.version,
      actorId,
      transition: `${currentPending.action}-reconciled`,
      status: terminal(campaign) ? "terminal" : "active",
      resource: { kind: "campaign", id: campaign.id },
      frozenIdentity,
      at,
    });
    if (reconciled.status === "updated") workflow = reconciled.workflow;
    else if ("current" in reconciled) workflow = reconciled.current;
  } else if (
    currentPending &&
    workflow.record.lastTransition.endsWith("-requested") &&
    workflow.record.status === "active"
  ) {
    const uncertain = await runtime.transitionWorkflow({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      workflowId: workflow.record.workflowId,
      expectedVersion: workflow.record.version,
      actorId,
      transition: `${currentPending.action}-outcome-unknown`,
      status: "needs-attention",
      resource: { kind: "campaign", id: campaign.id },
      frozenIdentity,
      at,
    });
    if (uncertain.status === "updated") workflow = uncertain.workflow;
  } else if (terminal(campaign) && workflow.record.status !== "terminal") {
    const completed = await runtime.transitionWorkflow({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      workflowId: workflow.record.workflowId,
      expectedVersion: workflow.record.version,
      actorId,
      transition: "repeat-completed",
      status: "terminal",
      resource: { kind: "campaign", id: campaign.id },
      frozenIdentity,
      at,
    });
    if (completed.status === "updated") workflow = completed.workflow;
  }
  return { workflow, campaign };
}
