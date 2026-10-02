import { isDeepStrictEqual } from "node:util";
import { authoringDispatchIsActive } from "./workflow-authoring-dispatch.js";
import type {
  AuthoringInteraction,
  AuthoringSession,
  DurableWorkflowRecord,
  WorkflowJsonValue,
  WorkflowTransitionInput,
} from "@relay/protocol";
import { redactAuthoringRawInteraction } from "@relay/core";
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

function authoringFrozenIdentityFromSession(
  record: DurableWorkflowRecord,
  session: AuthoringSession,
  allowApprovedTitle = false,
): JsonRecord | undefined {
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
    (!allowApprovedTitle && session.testName !== frozen.title) ||
    session.sourceScreenId !== frozen.sourceScreenId ||
    session.pendingConnectionId !== frozen.pendingConnectionId ||
    session.originApplication !== frozen.originApplication ||
    (session.group?.trim() || undefined) !==
      (typeof frozen.group === "string" ? frozen.group.trim() || undefined : undefined) ||
    !sameTarget(frozen, session)
  )
    return undefined;
  return frozen;
}

export function authoringIdentityFromSession(
  record: DurableWorkflowRecord,
  session: AuthoringSession,
): WorkflowJsonValue | undefined {
  const frozen = authoringFrozenIdentityFromSession(record, session);
  if (!frozen) return undefined;
  return session.expectedAppMapRevision === frozen.appMapRevision ? frozen : undefined;
}

/** A successful Authoring approval advances the App Map exactly once and then
 * stores that new revision on the committed session. The durable workflow
 * deliberately freezes the pre-commit revision, so post-dispatch validation
 * must recognize this one receipt-proved identity transition without making
 * any other frozen field mutable. */
export function authoringIdentityAfterMutation(
  record: DurableWorkflowRecord,
  session: AuthoringSession,
  mutation: { action: AuthoringWorkflowTransitionInput["action"]; transitionVersion: number },
): WorkflowJsonValue | undefined {
  const exact = authoringIdentityFromSession(record, session);
  if (exact) return exact;
  const frozen = authoringFrozenIdentityFromSession(record, session, true);
  if (!frozen) return undefined;
  const frozenRevision = frozen.appMapRevision;
  if (
    mutation.action !== "authoring-approve" ||
    session.state !== "committed" ||
    typeof frozenRevision !== "number" ||
    !Number.isSafeInteger(frozenRevision) ||
    session.expectedAppMapRevision !== frozenRevision + 1 ||
    !session.committedConnectionId ||
    !session.committedTestId ||
    session.workflowMutation?.workflowId !== record.workflowId ||
    session.workflowMutation.transitionVersion !== mutation.transitionVersion ||
    session.workflowMutation.action !== mutation.action
  ) {
    return undefined;
  }
  return frozen;
}

export function authoringIsTerminal(session: AuthoringSession): boolean {
  return (
    session.state === "committed" ||
    session.state === "cancelled" ||
    session.archive?.reason === "discarded"
  );
}

/** Prove the one recoverable failure shape emitted by recording today: the
 * canonical session appended exactly one matching intent and its terminal
 * `failed` outcome, without claiming that an Authoring action succeeded.
 *
 * This is deliberately stricter than "the session changed". Unknown outcomes,
 * extra writes, mismatched commands, and every non-recording mutation remain
 * fenced for inspection by the durable workflow coordinator. */
export function authoringRecordFailureIsProven(
  before: AuthoringSession,
  after: AuthoringSession,
  interaction: AuthoringInteraction,
): boolean {
  if (before.id !== after.id || before.state !== "recording" || after.state !== "recording") {
    return false;
  }
  const beforeEvents = before.take?.rawEvents ?? [];
  const afterEvents = after.take?.rawEvents ?? [];
  if (afterEvents.length !== beforeEvents.length + 2) return false;
  if (beforeEvents.some((event, index) => !isDeepStrictEqual(event, afterEvents[index]))) {
    return false;
  }
  const intent = afterEvents.at(-2);
  const outcome = afterEvents.at(-1);
  return Boolean(
    intent?.kind === "interaction-intent" &&
    outcome?.kind === "interaction-outcome" &&
    outcome.intentEventId === intent.id &&
    outcome.outcome === "failed" &&
    isDeepStrictEqual(intent.interaction, redactAuthoringRawInteraction(interaction)),
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
  const pendingAtRead = pendingAuthoringMutation(workflow.record);
  const matchesWorkflowIdentity = (candidate: AuthoringSession) => {
    const terminalApproveReceiptVersion =
      workflow.record.status === "terminal" &&
      [
        "authoring-approve-completed",
        "authoring-approve-reconciled",
        "authoring-committed",
      ].includes(workflow.record.lastTransition) &&
      candidate.workflowMutation?.workflowId === workflow.record.workflowId &&
      candidate.workflowMutation.action === "authoring-approve" &&
      candidate.workflowMutation.transitionVersion < workflow.record.version
        ? candidate.workflowMutation.transitionVersion
        : undefined;
    return Boolean(
      authoringIdentityFromSession(workflow.record, candidate) ||
      (pendingAtRead &&
        authoringIdentityAfterMutation(workflow.record, candidate, {
          action: pendingAtRead.action as AuthoringWorkflowTransitionInput["action"],
          transitionVersion: pendingAtRead.receiptVersion,
        })) ||
      (terminalApproveReceiptVersion !== undefined &&
        authoringIdentityAfterMutation(workflow.record, candidate, {
          action: "authoring-approve",
          transitionVersion: terminalApproveReceiptVersion,
        })),
    );
  };
  let session: AuthoringSession | undefined;
  if (workflow.record.resource?.kind === "authoring-session") {
    const candidate = await runtime
      .getAuthoringSession(workflow.record.resource.id)
      .catch(() => undefined);
    if (candidate && matchesWorkflowIdentity(candidate)) session = candidate;
  }
  if (!session && workflow.record.resource === undefined) {
    const matches = (await runtime.listAuthoringSessions(scope.projectId)).filter(
      matchesWorkflowIdentity,
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
  const latestRawEvent = session.take?.rawEvents?.at(-1);
  // A GET is allowed to recover an interrupted dispatch, never to race one
  // still executing in this process. Its completion will commit the receipt.
  if (authoringDispatchIsActive(scope, workflow.record.workflowId)) return { workflow, session };
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
  } else if (
    (workflow.record.status === "terminal" ||
      (workflow.record.status === "needs-attention" &&
        !session.error &&
        !session.recoverable &&
        latestRawEvent?.kind === "observation" &&
        ((pending?.action === "authoring-record" &&
          session.recoveredAt !== undefined &&
          latestRawEvent.recordedAt >= session.recoveredAt) ||
          (pending?.action === "authoring-replay" &&
            latestRawEvent.recordedAt > workflow.record.updatedAt)))) &&
    session.state === "reviewing" &&
    !session.archive
  ) {
    // A new explicit observation can recover capture or replay for review.
    // Active dispatches returned above; old observations cannot unlock replay.
    // The interrupted request stays in the audit without a fabricated receipt.
    // observe creates a new revision, so any previous replay proof is invalid.
    const recovered = await runtime.transitionWorkflow({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      workflowId: workflow.record.workflowId,
      expectedVersion: workflow.record.version,
      actorId,
      transition: "authoring-review-recovered",
      status: "active",
      resource: { kind: "authoring-session", id: session.id },
      at,
    });
    if (recovered.status === "updated") workflow = recovered.workflow;
    else if ("current" in recovered) workflow = recovered.current;
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
