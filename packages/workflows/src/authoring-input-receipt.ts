import {
  parseAuthoringSession,
  type AuthoringTarget,
  type DurableWorkflowOperationOutput,
} from "@relay/protocol";

/** Reserved before input. A newer screenshot or action count is not a receipt. */
export type AuthoringInputReceiptRef = {
  mutationId: string;
  workflowId: string;
  sessionId: string;
  transitionVersion: number;
  target: AuthoringTarget;
};

export type AuthoringInputReceiptOutcome = "applied" | "failed" | "unknown";

function sameTarget(left: AuthoringTarget, right: AuthoringTarget): boolean {
  return (
    left.kind === right.kind &&
    left.targetId === right.targetId &&
    left.platform === right.platform &&
    (left.kind !== "browser" ||
      (right.kind === "browser" &&
        left.authenticationFixtureId === right.authenticationFixtureId &&
        left.liveSessionId === right.liveSessionId))
  );
}

/** Project only the server's exact successful Authoring mutation. Neither a
 * healthy target nor unrelated writes can release an uncertain input fence. */
export function authoringInputReceiptOutcome(
  output: DurableWorkflowOperationOutput,
  expected: AuthoringInputReceiptRef,
): AuthoringInputReceiptOutcome {
  const record = output.workflow.record;
  let session;
  try {
    session = output.session ? parseAuthoringSession(output.session) : undefined;
  } catch {
    return "unknown";
  }
  if (
    typeof expected.mutationId !== "string" ||
    !expected.mutationId.trim() ||
    record.kind !== "author-test" ||
    record.workflowId !== expected.workflowId ||
    record.resource?.kind !== "authoring-session" ||
    record.resource.id !== expected.sessionId ||
    !session ||
    session.id !== expected.sessionId ||
    session.organizationId !== record.organizationId ||
    session.projectId !== record.projectId ||
    !sameTarget(session.target, expected.target) ||
    record.status !== "active"
  )
    return "unknown";
  if (
    !["authoring-record-completed", "authoring-record-reconciled"].includes(
      record.lastTransition,
    ) ||
    record.version <= expected.transitionVersion ||
    session.state !== "recording" ||
    session.workflowMutation?.workflowId !== expected.workflowId ||
    session.workflowMutation.transitionVersion !== expected.transitionVersion ||
    session.workflowMutation.mutationId !== expected.mutationId ||
    session.workflowMutation.action !== "authoring-record"
  )
    return "unknown";
  return "applied";
}
