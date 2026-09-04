import type http from "node:http";
import { createHash } from "node:crypto";
import {
  createDurableWorkflow,
  currentOperationContext,
  parseLegacyWorkflowAdoption,
} from "@relay/core";
import type { OperationInput, WorkflowJsonValue } from "@relay/protocol";
import { HttpError, json, parseJsonBody } from "./http.js";
import { assertJobAccess } from "./access-control.js";
import { recordAudit, type RequestContext } from "./security.js";
import { validateLegacyRepeatAdoption } from "./workflow-repeat-reconciliation.js";
import type { WorkflowRouteRuntime } from "./workflow-routes.js";

const DEFAULT_WORKFLOW_LIFETIME_MS = 24 * 60 * 60 * 1_000;
type JsonRecord = Record<string, WorkflowJsonValue>;

function jsonRecord(value: WorkflowJsonValue | undefined): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function scopedWorkflowId(scope: RequestContext, requestId: string): string {
  const digest = createHash("sha256")
    .update(scope.organizationId, "utf8")
    .update("\0")
    .update(scope.projectId, "utf8")
    .update("\0")
    .update(requestId, "utf8")
    .digest("hex");
  return `wf_${digest}`;
}

function workflowNotFound(): never {
  throw new HttpError(404, "Workflow not found");
}

export async function handleWorkflowCreateRoute(input: {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  runtime: WorkflowRouteRuntime;
  actorId: string;
  at: number;
}): Promise<boolean> {
  if (input.method !== "POST" || input.pathname !== "/workflows") return false;

  const body = (await parseJsonBody(input.request)) as OperationInput<"workflow.create">;
  const operation = currentOperationContext();
  if (!operation) throw new HttpError(400, "Actor-aware operation context is required");
  const adoption = body.legacyRef ? parseLegacyWorkflowAdoption(body.legacyRef) : undefined;
  if (body.legacyRef && !adoption) throw new HttpError(400, "Legacy workflow reference is invalid");
  if (adoption && adoption.kind !== "run-test" && adoption.kind !== "repeat-test") {
    throw new HttpError(400, "Only legacy Run and Repeat references can be adopted safely");
  }
  const requestIdentity = adoption?.digest ?? body.workflowId ?? operation.requestId;
  if (!adoption && body.kind === "run-test") {
    const frozen = body.frozenIdentity ? jsonRecord(body.frozenIdentity) : undefined;
    if (typeof frozen?.workflowRequestId !== "string" || !frozen.workflowRequestId) {
      throw new HttpError(400, "Run workflow request identity is missing");
    }
  }
  if (!adoption && body.kind === "author-test") {
    const frozen = body.frozenIdentity ? jsonRecord(body.frozenIdentity) : undefined;
    if (
      typeof frozen?.workflowRequestId !== "string" ||
      !frozen.workflowRequestId ||
      frozen.actorId !== input.actorId
    ) {
      throw new HttpError(400, "Authoring workflow request identity is missing or unauthorized");
    }
  }
  if (!adoption && body.kind === "repeat-test") {
    const frozen = body.frozenIdentity ? jsonRecord(body.frozenIdentity) : undefined;
    if (
      typeof frozen?.workflowRequestId !== "string" ||
      !frozen.workflowRequestId ||
      frozen.actorId !== input.actorId
    ) {
      throw new HttpError(400, "Repeat workflow request identity is missing or unauthorized");
    }
  }
  if (adoption?.resource.kind === "job") {
    const adoptedJob = input.runtime.getJob(adoption.resource.id);
    assertJobAccess(input.scope, adoptedJob);
  }
  if (adoption?.resource.kind === "campaign") {
    const campaign = await input.runtime.readRepeatCampaign(
      input.scope.projectId,
      adoption.resource.id,
    );
    const repeatIdentity = adoption.repeatIdentity;
    if (!campaign || !repeatIdentity) workflowNotFound();
    const legacyFrozen = validateLegacyRepeatAdoption({
      projectId: input.scope.projectId,
      actorId: input.actorId,
      frozenIdentity: adoption.frozenIdentity,
      campaign,
      pilotJobId: repeatIdentity.pilotJobId,
      selectedCaseIds: repeatIdentity.selectedCaseIds,
    });
    if (!legacyFrozen) workflowNotFound();
    const target = jsonRecord(jsonRecord(legacyFrozen)?.target);
    if (!target || typeof target.targetId !== "string") workflowNotFound();
    await input.runtime.assertTargetControl(input.scope, target.targetId);
    adoption.frozenIdentity = legacyFrozen;
  }
  const created = await createDurableWorkflow({
    organizationId: input.scope.organizationId,
    projectId: input.scope.projectId,
    workflowId: scopedWorkflowId(input.scope, requestIdentity),
    kind: adoption?.kind ?? body.kind!,
    frozenIdentity: adoption?.frozenIdentity ?? body.frozenIdentity!,
    ...(adoption ? { resource: adoption.resource, adoptedLegacyRefDigest: adoption.digest } : {}),
    actorId: input.actorId,
    at: input.at,
    expiresAt: body.expiresAt ?? input.at + DEFAULT_WORKFLOW_LIFETIME_MS,
    transition: adoption ? "legacy-v1-adopted" : "created",
  });
  if (created.status === "conflict") {
    recordAudit(input.scope, {
      action: "workflow.create",
      resource: created.current.record.workflowId,
      result: "deny",
    });
    throw new HttpError(409, "Workflow request id is already bound to another intent");
  }
  recordAudit(input.scope, {
    action: "workflow.create",
    resource: created.workflow.record.workflowId,
    result: "allow",
  });
  json(input.response, created.status === "created" ? 201 : 200, {
    disposition: created.status === "created" ? "created" : "existing",
    workflow: created.workflow,
    ...(adoption?.resource.kind === "job"
      ? { job: input.runtime.getJob(adoption.resource.id) as unknown as Record<string, unknown> }
      : adoption?.resource.kind === "campaign"
        ? {
            campaign: (await input.runtime.projectRepeatCampaign(
              (await input.runtime.readRepeatCampaign(
                input.scope.projectId,
                adoption.resource.id,
              ))!,
            )) as unknown as Record<string, unknown>,
          }
        : {}),
  });
  return true;
}
