import type {
  AuthoringSession,
  DurableWorkflowRecord,
  WorkflowJsonValue,
  WorkflowTransitionInput,
} from "@relay/protocol";
import type {
  DurableWorkflowRead,
  TransitionDurableWorkflowInput,
  DurableWorkflowTransitionResult,
} from "@relay/core";
import type { RequestContext } from "./security.js";

export type AuthoringWorkflowTransitionInput = Exclude<
  WorkflowTransitionInput,
  { action: "attach-run" | "cancel-run" | "start-authoring" | "authoring-abandon" }
>;

export type AuthoringReconciliationRuntime = {
  getAuthoringSession(id: string): Promise<AuthoringSession>;
  listAuthoringSessions(projectId: string): Promise<AuthoringSession[]>;
  transitionWorkflow(
    input: TransitionDurableWorkflowInput,
  ): Promise<DurableWorkflowTransitionResult>;
};

type JsonRecord = Record<string, WorkflowJsonValue>;
function jsonRecord(value: WorkflowJsonValue | undefined): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function sameTarget(frozen: JsonRecord, session: AuthoringSession): boolean {
  const target = jsonRecord(frozen.target);
  return Boolean(
    target &&
    target.kind === session.target.kind &&
    target.platform === session.target.platform &&
    target.targetId === session.target.targetId,
  );
}

export function authoringIdentityFromSession(
  record: DurableWorkflowRecord,
  session: AuthoringSession,
): WorkflowJsonValue | undefined {
  if (
    record.kind !== "author-test" ||
    session.organizationId !== record.organizationId ||
    session.projectId !== record.projectId
  )
    return undefined;
  const frozen = jsonRecord(record.frozenIdentity);
  if (!frozen || typeof frozen.workflowRequestId !== "string") return undefined;
  if (
    session.workflowRequestId !== frozen.workflowRequestId ||
    session.actorId !== frozen.actorId ||
    session.appMapId !== frozen.appMapId ||
    session.expectedAppMapRevision !== frozen.appMapRevision ||
    session.testName !== frozen.title ||
    session.sourceScreenId !== frozen.sourceScreenId ||
    session.pendingConnectionId !== frozen.pendingConnectionId ||
    (session.group?.trim() || undefined) !==
      (typeof frozen.group === "string" ? frozen.group.trim() || undefined : undefined) ||
    !sameTarget(frozen, session)
  )
    return undefined;
  return frozen;
}

export function authoringIsTerminal(session: AuthoringSession): boolean {
  return (
    session.state === "committed" ||
    session.state === "cancelled" ||
    session.archive?.reason === "discarded"
  );
}

function pendingAuthoringMutation(
  record: DurableWorkflowRecord,
): { action: string; receiptVersion: number; exactReceiptRequired: boolean } | undefined {
  if (record.lastTransition.endsWith("-requested")) {
    const action = record.lastTransition.slice(0, -"-requested".length);
    return {
      action,
      receiptVersion: record.version,
      exactReceiptRequired: action !== "start-authoring",
    };
  }
  if (record.lastTransition.endsWith("-outcome-unknown")) {
    const action = record.lastTransition.slice(0, -"-outcome-unknown".length);
    return {
      action,
      receiptVersion: record.version - 1,
      exactReceiptRequired: action !== "start-authoring",
    };
  }
  return undefined;
}

function pendingOutcomeIsProven(record: DurableWorkflowRecord, session: AuthoringSession): boolean {
  const pending = pendingAuthoringMutation(record);
  if (!pending) return false;
  if (!pending.exactReceiptRequired) {
    return Boolean(authoringIdentityFromSession(record, session));
  }
  if (
    session.workflowMutation?.workflowId === record.workflowId &&
    session.workflowMutation.transitionVersion === pending.receiptVersion &&
    session.workflowMutation.action === pending.action
  )
    return true;
  return false;
}

async function expire(
  scope: RequestContext,
  runtime: AuthoringReconciliationRuntime,
  workflow: DurableWorkflowRead,
  actorId: string,
  at: number,
): Promise<DurableWorkflowRead> {
  if (workflow.record.status === "expired" || workflow.record.expiresAt > at) return workflow;
  const result = await runtime.transitionWorkflow({
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    workflowId: workflow.record.workflowId,
    expectedVersion: workflow.record.version,
    actorId,
    transition: "expired",
    status: "active",
    at,
  });
  return result.status === "expired" ? result.current : workflow;
}

export async function reconcileAuthoring(
  scope: RequestContext,
  runtime: AuthoringReconciliationRuntime,
  input: DurableWorkflowRead,
  actorId: string,
  at: number,
): Promise<{ workflow: DurableWorkflowRead; session?: AuthoringSession }> {
  let workflow = await expire(scope, runtime, input, actorId, at);
  if (workflow.record.status === "expired") return { workflow };
  let session: AuthoringSession | undefined;
  if (workflow.record.resource?.kind === "authoring-session") {
    const candidate = await runtime
      .getAuthoringSession(workflow.record.resource.id)
      .catch(() => undefined);
    if (candidate && authoringIdentityFromSession(workflow.record, candidate)) session = candidate;
  }
  if (!session && workflow.record.resource === undefined) {
    const matches = (await runtime.listAuthoringSessions(scope.projectId)).filter((candidate) =>
      Boolean(authoringIdentityFromSession(workflow.record, candidate)),
    );
    if (matches.length === 1) {
      session = matches[0]!;
      const attached = await runtime.transitionWorkflow({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        workflowId: workflow.record.workflowId,
        expectedVersion: workflow.record.version,
        actorId,
        transition: "authoring-reconciled",
        status: authoringIsTerminal(session) ? "terminal" : "active",
        resource: { kind: "authoring-session", id: session.id },
        at,
      });
      if (attached.status === "updated") workflow = attached.workflow;
      else if ("current" in attached) workflow = attached.current;
    } else if (matches.length > 1) {
      const ambiguous = await runtime.transitionWorkflow({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        workflowId: workflow.record.workflowId,
        expectedVersion: workflow.record.version,
        actorId,
        transition: "authoring-reconciliation-ambiguous",
        status: "needs-attention",
        at,
      });
      if (ambiguous.status === "updated") workflow = ambiguous.workflow;
    }
  }
  if (!session) return { workflow };
  const pending = pendingAuthoringMutation(workflow.record);
  const transition =
    pending && pendingOutcomeIsProven(workflow.record, session)
      ? `${pending.action}-reconciled`
      : undefined;
  if (transition) {
    const reconciled = await runtime.transitionWorkflow({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      workflowId: workflow.record.workflowId,
      expectedVersion: workflow.record.version,
      actorId,
      transition,
      status: authoringIsTerminal(session) ? "terminal" : "active",
      resource: { kind: "authoring-session", id: session.id },
      at,
    });
    if (reconciled.status === "updated") workflow = reconciled.workflow;
    else if ("current" in reconciled) workflow = reconciled.current;
  } else if (
    pending &&
    workflow.record.lastTransition.endsWith("-requested") &&
    workflow.record.status === "active"
  ) {
    const uncertain = await runtime.transitionWorkflow({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      workflowId: workflow.record.workflowId,
      expectedVersion: workflow.record.version,
      actorId,
      transition: `${pending.action}-outcome-unknown`,
      status: "needs-attention",
      resource: { kind: "authoring-session", id: session.id },
      at,
    });
    if (uncertain.status === "updated") workflow = uncertain.workflow;
    else if ("current" in uncertain) workflow = uncertain.current;
  } else if (authoringIsTerminal(session) && workflow.record.status !== "terminal") {
    const terminal = await runtime.transitionWorkflow({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      workflowId: workflow.record.workflowId,
      expectedVersion: workflow.record.version,
      actorId,
      transition: `authoring-${session.state}`,
      status: "terminal",
      resource: { kind: "authoring-session", id: session.id },
      at,
    });
    if (terminal.status === "updated") workflow = terminal.workflow;
    else if ("current" in terminal) workflow = terminal.current;
  }
  return { workflow, session };
}

export function authoringActionIsAllowed(
  session: AuthoringSession,
  action: AuthoringWorkflowTransitionInput["action"],
): boolean {
  if (["authoring-record", "authoring-checkpoint", "authoring-stop"].includes(action)) {
    return session.state === "recording";
  }
  if (
    ["authoring-edit", "authoring-replay", "authoring-approve", "authoring-discard"].includes(
      action,
    )
  ) {
    return session.state === "reviewing" && !session.archive;
  }
  return !authoringIsTerminal(session);
}
