import {
  operationDefinition,
  parseAuthoringSession,
  type AuthoringTarget,
  type DurableWorkflowOperationOutput,
} from "@relay/protocol";
import type { DurableAuthorTestDecision } from "./types.js";

function sameTarget(value: unknown, expected: AuthoringTarget): boolean {
  if (!value || typeof value !== "object") return false;
  const target = value as AuthoringTarget;
  return (
    typeof expected.targetId === "string" &&
    Boolean(expected.targetId.trim()) &&
    ((expected.kind === "device" &&
      (expected.platform === "ios" || expected.platform === "android")) ||
      (expected.kind === "browser" && expected.platform === "browser")) &&
    target.kind === expected.kind &&
    target.platform === expected.platform &&
    target.targetId === expected.targetId &&
    (expected.kind !== "browser" ||
      (target.kind === "browser" &&
        target.authenticationFixtureId === expected.authenticationFixtureId &&
        target.liveSessionId === expected.liveSessionId))
  );
}

/** Only a typed response to this submitted read-only condition can prove its
 * failure. A subsequent healthy inspection has no such request attribution. */
export function recordedConditionFailureReceipt(
  error: unknown,
  decision: DurableAuthorTestDecision,
): DurableWorkflowOperationOutput | undefined {
  if (
    decision.action !== "record" ||
    decision.interaction.kind !== "steps" ||
    decision.interaction.applied ||
    !decision.interaction.steps.length ||
    !decision.interaction.steps.every(
      (step) => step.kind === "wait-for" || step.kind === "expect" || step.kind === "sleep",
    )
  )
    return;
  if (
    !error ||
    typeof error !== "object" ||
    !("status" in error) ||
    error.status !== 422 ||
    !("body" in error) ||
    !error.body ||
    typeof error.body !== "object"
  )
    return;
  const body = error.body as { code?: unknown; workflow?: unknown; session?: unknown };
  if (body.code !== "AUTHORING_INTERACTION_FAILED") return;
  try {
    const output = operationDefinition("workflow.transition").output.parse({
      workflow: body.workflow,
      session: body.session,
    }) as DurableWorkflowOperationOutput;
    const record = output.workflow.record;
    const session = parseAuthoringSession(output.session);
    const frozen = record.frozenIdentity;
    if (!frozen || typeof frozen !== "object" || Array.isArray(frozen)) return;
    const identity = frozen as Record<string, unknown>;
    if (
      record.kind !== "author-test" ||
      record.workflowId !== decision.workflowId ||
      record.version !== decision.expectedVersion + 2 ||
      record.status !== "active" ||
      record.lastTransition !== "authoring-record-failed" ||
      record.resource?.kind !== "authoring-session" ||
      record.resource.id !== session.id ||
      session.state !== "recording" ||
      session.organizationId !== record.organizationId ||
      session.projectId !== record.projectId ||
      !sameTarget(identity.target, session.target) ||
      identity.actorId !== session.actorId ||
      identity.appMapId !== session.appMapId ||
      identity.appMapRevision !== session.expectedAppMapRevision ||
      identity.title !== session.testName ||
      identity.workflowRequestId !== session.workflowRequestId ||
      identity.originApplication !== session.originApplication
    )
      return;
    const events = session.take?.rawEvents;
    if (!Array.isArray(events)) return;
    const intent = events.at(-2);
    const outcome = events.at(-1);
    if (
      intent?.kind !== "interaction-intent" ||
      outcome?.kind !== "interaction-outcome" ||
      !intent.id ||
      outcome.intentEventId !== intent.id ||
      outcome.outcome !== "failed" ||
      intent.interaction.kind !== "steps" ||
      intent.interaction.stepCount !== decision.interaction.steps.length ||
      Boolean(intent.interaction.hasLabel) !== Boolean(decision.interaction.label) ||
      intent.interaction.applied ||
      !Number.isSafeInteger(intent.sequence) ||
      intent.sequence < 1 ||
      outcome.sequence !== intent.sequence + 1 ||
      !Number.isFinite(intent.startedAt) ||
      !Number.isFinite(outcome.finishedAt) ||
      outcome.finishedAt < intent.startedAt ||
      record.updatedAt < outcome.finishedAt ||
      intent.source.kind !== "authoring-runtime" ||
      outcome.source.kind !== "authoring-runtime" ||
      !sameTarget(intent.source.target, session.target) ||
      !sameTarget(outcome.source.target, session.target)
    )
      return;
    return output;
  } catch {
    return;
  }
}
