import type { DurableWorkflowRead, StoredCombineCampaign } from "@relay/core";
import type { OperationInput } from "@relay/protocol";
import { HttpError } from "./http.js";
import type { RequestContext } from "./security.js";
import {
  reconcileRepeat,
  type RepeatReconciliationRuntime,
} from "./workflow-repeat-reconciliation.js";

export type RepeatWorkflowTransitionInput = Extract<
  OperationInput<"workflow.transition">,
  {
    action:
      | "reserve-repeat-pilot"
      | "attach-repeat"
      | "reserve-repeat-resume"
      | "complete-repeat-resume"
      | "reserve-repeat-cancel"
      | "complete-repeat-cancel";
  }
>;

function requestedAction(
  input: RepeatWorkflowTransitionInput,
): "repeat-pilot" | "repeat-resume" | "repeat-cancel" | undefined {
  if (input.action === "reserve-repeat-pilot") return "repeat-pilot";
  if (input.action === "reserve-repeat-resume") return "repeat-resume";
  if (input.action === "reserve-repeat-cancel") return "repeat-cancel";
  return undefined;
}

export async function transitionRepeatWorkflow(input: {
  scope: RequestContext;
  runtime: RepeatReconciliationRuntime;
  workflow: DurableWorkflowRead;
  body: RepeatWorkflowTransitionInput;
  actorId: string;
  at: number;
  knownCampaign?: StoredCombineCampaign;
}): Promise<Awaited<ReturnType<typeof reconcileRepeat>>> {
  const action = requestedAction(input.body);
  if (action) {
    const pilot = action === "repeat-pilot";
    if (
      input.workflow.record.status !== "active" ||
      input.workflow.record.lastTransition.endsWith("-requested") ||
      input.workflow.record.lastTransition.endsWith("-outcome-unknown") ||
      (pilot
        ? input.workflow.record.lastTransition !== "created" || input.workflow.record.resource
        : input.workflow.record.resource?.kind !== "campaign")
    ) {
      throw new HttpError(409, "Repeat outcome requires inspection before another mutation");
    }
    const reserved = await input.runtime.transitionWorkflow({
      organizationId: input.scope.organizationId,
      projectId: input.scope.projectId,
      workflowId: input.workflow.record.workflowId,
      expectedVersion: input.body.expectedVersion,
      actorId: input.actorId,
      transition: `${action}-requested`,
      status: "active",
      ...(input.workflow.record.resource ? { resource: input.workflow.record.resource } : {}),
      at: input.at,
    });
    if (reserved.status !== "updated") {
      throw new HttpError(409, "Workflow version changed before the Repeat mutation");
    }
    return {
      workflow: reserved.workflow,
      ...(input.knownCampaign ? { campaign: input.knownCampaign } : {}),
    };
  }

  let campaign = input.knownCampaign;
  if (input.body.action === "attach-repeat") {
    campaign =
      (await input.runtime.readRepeatCampaign(input.scope.projectId, input.body.campaignId)) ??
      undefined;
    if (!campaign) throw new HttpError(404, "Workflow not found");
  }
  const reconciled = await reconcileRepeat(
    input.scope,
    input.runtime,
    input.workflow,
    input.actorId,
    input.at,
    campaign ?? undefined,
  );
  const expected =
    input.body.action === "attach-repeat"
      ? "repeat-pilot-reconciled"
      : input.body.action === "complete-repeat-resume"
        ? "repeat-resume-reconciled"
        : "repeat-cancel-reconciled";
  if (reconciled.workflow.record.lastTransition !== expected) {
    throw new HttpError(409, "Repeat mutation outcome is not proven by its exact reservation");
  }
  return reconciled;
}
