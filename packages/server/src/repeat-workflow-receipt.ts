import { currentOperationContext, readDurableWorkflow } from "@relay/core";
import type { RepeatCampaignExecutionIdentity } from "@relay/protocol";
import { HttpError } from "./http.js";
import type { RequestContext } from "./security.js";

export type RepeatWorkflowMutation = NonNullable<
  RepeatCampaignExecutionIdentity["workflowMutation"]
>;

const transitionForAction: Record<RepeatWorkflowMutation["action"], string> = {
  "repeat-pilot": "repeat-pilot-requested",
  "repeat-resume": "repeat-resume-requested",
  "repeat-cancel": "repeat-cancel-requested",
};

export async function assertRepeatWorkflowMutation(input: {
  scope: RequestContext;
  mutation: RepeatWorkflowMutation;
  campaignId?: string;
}): Promise<void> {
  const actorId = currentOperationContext()?.actorId ?? input.scope.subject;
  const workflow = await readDurableWorkflow({
    organizationId: input.scope.organizationId,
    projectId: input.scope.projectId,
    workflowId: input.mutation.workflowId,
  });
  const frozen: Record<string, unknown> | undefined =
    workflow?.record.frozenIdentity &&
    typeof workflow.record.frozenIdentity === "object" &&
    !Array.isArray(workflow.record.frozenIdentity)
      ? (workflow.record.frozenIdentity as Record<string, unknown>)
      : undefined;
  const resource = workflow?.record.resource;
  if (
    !workflow ||
    workflow.record.kind !== "repeat-test" ||
    workflow.record.status !== "active" ||
    workflow.record.version !== input.mutation.transitionVersion ||
    workflow.record.lastTransition !== transitionForAction[input.mutation.action] ||
    frozen?.actorId !== actorId ||
    (input.campaignId !== undefined &&
      (resource?.kind !== "campaign" || resource.id !== input.campaignId)) ||
    (input.campaignId === undefined && resource !== undefined)
  ) {
    throw new HttpError(409, "Durable Repeat reservation is invalid or no longer current");
  }
}
