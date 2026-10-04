import {
  parseAuthoringSession,
  type AuthoringSession,
  type DurableWorkflowOperationOutput,
  type OperationInput,
  type OperationOutput,
} from "@relay/protocol";
import { snapshotFromAuthoringSession } from "./authoring-projection.js";
import type { RelayOperationPort } from "./operation-port.js";
import type {
  AuthorTestDecision,
  DurableAuthorTestDecision,
  DurableWorkflowHandle,
  AuthorTestIntent,
  AuthorTestRecoveryIntent,
  AuthorTestSnapshot,
  FrozenAuthorTestIdentity,
  WorkflowProblem,
  WorkflowRef,
} from "./types.js";
import { encodeAuthoringWorkflowRef, type AuthoringWorkflowReference } from "./workflow-ref.js";

function errorDetail(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Relay did not return a usable response.";
}

function unavailableProblem(stage: string, error: unknown): WorkflowProblem {
  return {
    code: "operation-unavailable",
    title: `Relay could not ${stage}`,
    detail: errorDetail(error),
    recovery: "Resolve the reported Relay problem, then start this workflow again explicitly.",
    retryable: true,
  };
}

function mutationUnknownProblem(action: string, error: unknown): WorkflowProblem {
  const body = error && typeof error === "object" && "body" in error ? error.body : undefined;
  if (
    body &&
    typeof body === "object" &&
    "code" in body &&
    body.code === "input-not-dispatched" &&
    "dispatched" in body &&
    body.dispatched === false
  ) {
    return {
      code: "input-not-dispatched",
      title: "The interaction was not sent",
      detail: errorDetail(error),
      recovery: "Reconnect the device, then try again.",
      retryable: true,
    };
  }
  return {
    code: "mutation-outcome-unknown",
    title: `Relay cannot prove whether ${action}`,
    detail: errorDetail(error),
    recovery:
      "Inspect the canonical Authoring Session before taking another action. Relay will not retry this mutation.",
    retryable: false,
  };
}

function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function canonicalTestName(session: AuthoringSession): string {
  return session.testName?.trim() || "New Test";
}

function frozenIdentity(intent: AuthorTestIntent, revision: number): FrozenAuthorTestIdentity {
  return {
    title: intent.title.trim(),
    actorId: intent.actorId,
    appMapId: intent.appMapId,
    appMapRevision: revision,
    target: { ...intent.target },
    ...(intent.originApplication?.trim()
      ? { originApplication: intent.originApplication.trim() }
      : {}),
    ...(intent.sourceScreenId ? { sourceScreenId: intent.sourceScreenId } : {}),
    ...(intent.pendingConnectionId ? { pendingConnectionId: intent.pendingConnectionId } : {}),
    ...(intent.group?.trim() ? { group: intent.group.trim() } : {}),
    ...(intent.debugOrigin ? { debugOrigin: structuredClone(intent.debugOrigin) } : {}),
    ...(intent.workflowRequestId ? { workflowRequestId: intent.workflowRequestId } : {}),
  };
}

function frozenIdentityFromSession(session: AuthoringSession): FrozenAuthorTestIdentity {
  return {
    title: canonicalTestName(session),
    actorId: session.actorId,
    appMapId: session.appMapId,
    appMapRevision: session.expectedAppMapRevision,
    target: { ...session.target },
    ...(session.originApplication ? { originApplication: session.originApplication } : {}),
    ...(session.sourceScreenId ? { sourceScreenId: session.sourceScreenId } : {}),
    ...(session.pendingConnectionId ? { pendingConnectionId: session.pendingConnectionId } : {}),
    ...(session.group?.trim() ? { group: session.group.trim() } : {}),
    ...(session.debugOrigin ? { debugOrigin: structuredClone(session.debugOrigin) } : {}),
    ...(session.workflowRequestId ? { workflowRequestId: session.workflowRequestId } : {}),
  };
}

function initialProblem(input: {
  intent: AuthorTestIntent;
  problem: WorkflowProblem;
  frozen?: FrozenAuthorTestIdentity;
  phase?: AuthorTestSnapshot["phase"];
}): AuthorTestSnapshot {
  return {
    schemaVersion: 1,
    kind: "author-test",
    title: input.intent.title.trim() || "New Test",
    phase: input.phase ?? "blocked",
    stage: "unstarted",
    version: "unstarted",
    ...(input.frozen ? { frozen: input.frozen } : {}),
    progress: { label: input.problem.title },
    allowedNextActions: [],
    problems: [input.problem],
    evidenceRefs: [],
  };
}

function sameTarget(left: AuthoringSession["target"], right: AuthoringSession["target"]): boolean {
  return (
    left.kind === right.kind &&
    left.platform === right.platform &&
    left.targetId === right.targetId &&
    (left.kind !== "browser" ||
      (right.kind === "browser" &&
        left.authenticationFixtureId === right.authenticationFixtureId &&
        left.liveSessionId === right.liveSessionId))
  );
}

function validStartedSession(
  session: AuthoringSession,
  intent: AuthorTestIntent,
  revision: number,
) {
  return Boolean(
    session.id &&
    session.actorId === intent.actorId &&
    session.appMapId === intent.appMapId &&
    session.expectedAppMapRevision === revision &&
    session.leaseId === intent.leaseId &&
    sameTarget(session.target, intent.target) &&
    session.originApplication === (intent.originApplication?.trim() || undefined) &&
    session.sourceScreenId === intent.sourceScreenId &&
    session.pendingConnectionId === intent.pendingConnectionId &&
    session.testName === intent.title.trim() &&
    session.workflowRequestId === intent.workflowRequestId &&
    (session.group?.trim() || undefined) === (intent.group?.trim() || undefined) &&
    session.state === "recording" &&
    session.take?.state === "recording",
  );
}

function unavailableDurableAuthor(input: {
  workflow: DurableWorkflowHandle;
  frozen?: FrozenAuthorTestIdentity;
  problem: WorkflowProblem;
  sessionId?: string;
  canAbandon?: boolean;
  unavailable?: boolean;
}): AuthorTestSnapshot {
  return {
    schemaVersion: 1,
    kind: "author-test",
    title: input.frozen?.title ?? "New Test",
    phase: "needs-attention",
    stage: "unknown",
    version: input.unavailable ? "unavailable" : `workflow-v${input.workflow.expectedVersion}`,
    workflow: input.workflow,
    ...(input.frozen ? { frozen: input.frozen } : {}),
    ...(input.sessionId ? { authoring: { sessionId: input.sessionId } } : {}),
    progress: { label: input.problem.title },
    allowedNextActions: input.canAbandon ? ["inspect", "abandon"] : ["inspect"],
    problems: [input.problem],
    evidenceRefs: [],
  };
}

function durableAuthorSnapshot(
  output: DurableWorkflowOperationOutput,
  fallbackFrozen?: FrozenAuthorTestIdentity,
): AuthorTestSnapshot {
  const record = output.workflow.record;
  const workflow = { workflowId: record.workflowId, expectedVersion: record.version };
  const frozen = (
    record.frozenIdentity && typeof record.frozenIdentity === "object"
      ? record.frozenIdentity
      : fallbackFrozen
  ) as FrozenAuthorTestIdentity | undefined;
  let session: AuthoringSession | undefined;
  try {
    if (output.session) session = parseAuthoringSession(output.session);
  } catch {
    session = undefined;
  }
  if (record.resolution?.kind === "abandoned" && frozen) {
    return {
      schemaVersion: 1,
      kind: "author-test",
      title: frozen.title,
      phase: "cancelled",
      stage: "cancelled",
      version: `workflow-v${workflow.expectedVersion}`,
      workflow,
      frozen,
      ...(record.resource?.kind === "authoring-session"
        ? { authoring: { sessionId: record.resource.id } }
        : {}),
      progress: { label: "Recording workflow abandoned after review" },
      allowedNextActions: ["inspect"],
      problems: [],
      evidenceRefs: [],
    };
  }
  if (!frozen || record.kind !== "author-test" || !session) {
    const canAbandon =
      record.resource?.kind !== "authoring-session" &&
      (record.status === "needs-attention" ||
        record.lastTransition === "start-authoring-requested" ||
        record.lastTransition === "start-authoring-outcome-unknown");
    return unavailableDurableAuthor({
      workflow,
      ...(frozen ? { frozen } : {}),
      ...(record.resource?.kind === "authoring-session" ? { sessionId: record.resource.id } : {}),
      ...(canAbandon ? { canAbandon: true } : {}),
      problem: {
        code: "mutation-outcome-unknown",
        title: "The recording still needs reconciliation",
        detail: "Relay cannot yet prove one canonical Authoring Session for this workflow.",
        recovery: "Inspect this workflow again. Do not start or mutate another recording.",
        retryable: false,
      },
    });
  }
  const uncertain =
    record.status === "needs-attention" || record.lastTransition.endsWith("-outcome-unknown");
  const snapshot = snapshotFromAuthoringSession({
    workflow,
    frozen,
    session,
    ...(uncertain
      ? {
          forceNeedsAttention: true,
          extraProblems: [
            {
              code: "mutation-outcome-unknown" as const,
              title: "The last recording mutation has an uncertain outcome",
              detail: `Relay stopped at ${record.lastTransition} and will not issue it again automatically.`,
              recovery: "Inspect the canonical recording evidence before taking another action.",
              retryable: false,
            },
          ],
        }
      : {}),
  });
  // An active request is still executing; inspection must not turn it into
  // an uncertain outcome or offer a second mutation before its receipt.
  if (record.status === "active" && record.lastTransition.endsWith("-requested")) {
    return {
      ...snapshot,
      allowedNextActions: ["inspect"],
      progress: { label: "Finishing interaction…" },
    };
  }
  if (
    uncertain &&
    record.lastTransition === "authoring-replay-outcome-unknown" &&
    session.state === "reviewing" &&
    snapshot.review
  ) {
    return { ...snapshot, review: { ...snapshot.review, recovery: "observe" } };
  }
  return snapshot;
}

function durableTransitionInput(
  decision: DurableAuthorTestDecision,
): OperationInput<"workflow.transition"> {
  const fence = {
    workflowId: decision.workflowId,
    expectedVersion: decision.expectedVersion,
  };
  if (decision.action === "record") {
    return {
      ...fence,
      action: "authoring-record",
      interaction: decision.interaction,
      ...(decision.mutationId ? { mutationId: decision.mutationId } : {}),
    };
  }
  if (decision.action === "checkpoint") {
    return {
      ...fence,
      action: "authoring-checkpoint",
      ...(decision.label ? { label: decision.label } : {}),
    };
  }
  if (decision.action === "stop") return { ...fence, action: "authoring-stop" };
  if (decision.action === "edit") {
    return { ...fence, action: "authoring-edit", edit: structuredClone(decision.edit) };
  }
  if (decision.action === "replay") return { ...fence, action: "authoring-replay" };
  if (decision.action === "approve") {
    return {
      ...fence,
      action: "authoring-approve",
      ...(decision.destination ? { destination: decision.destination } : {}),
      ...(decision.testName ? { testName: decision.testName } : {}),
    };
  }
  if (decision.action === "discard") return { ...fence, action: "authoring-discard" };
  if (decision.action === "abandon") {
    return { ...fence, action: "authoring-abandon", reason: decision.reason };
  }
  return { ...fence, action: "authoring-cancel" };
}

export class CanonicalAuthoringWorkflow {
  constructor(private readonly operations: RelayOperationPort) {}

  async start(intent: AuthorTestIntent): Promise<AuthorTestSnapshot> {
    if (
      !intent.title.trim() ||
      !intent.actorId.trim() ||
      !intent.appMapId.trim() ||
      !intent.leaseId.trim()
    ) {
      return initialProblem({
        intent,
        problem: {
          code: "invalid-intent",
          title: "The recording intent is incomplete",
          detail: "A title, App Map identifier, and actor-owned lease are required.",
          recovery: "Choose a Test title and a controlled target, then start again.",
          retryable: false,
        },
      });
    }
    if (intent.continuation === "durable" && !intent.workflowRequestId) {
      return initialProblem({
        intent,
        problem: {
          code: "invalid-intent",
          title: "The durable recording has no stable request identity",
          detail: "Server-owned continuation requires one request ID before target control.",
          recovery: "Start a new recording with one stable workflow request ID.",
          retryable: false,
        },
      });
    }

    let revision: number;
    if (intent.revision && intent.revision !== "current") {
      revision = intent.revision.exact;
      if (!validRevision(revision)) {
        return initialProblem({
          intent,
          problem: {
            code: "invalid-intent",
            title: "The requested revision is invalid",
            detail: "An exact App Map revision must be a non-negative integer.",
            recovery: "Choose current or provide a valid exact revision.",
            retryable: false,
          },
        });
      }
    } else {
      try {
        const current = await this.operations.invoke("app-map.get", { appMapId: intent.appMapId });
        revision = current.appMap.revision;
        if (!validRevision(revision)) throw new TypeError("App Map response has no valid revision");
      } catch (error) {
        return initialProblem({
          intent,
          problem: unavailableProblem("read the current App Map", error),
        });
      }
    }

    const frozen = frozenIdentity(intent, revision);
    if (intent.continuation === "durable" && intent.workflowRequestId) {
      let durable: OperationOutput<"workflow.create">;
      try {
        durable = await this.operations.invoke("workflow.create", {
          workflowId: intent.workflowRequestId,
          kind: "author-test",
          frozenIdentity: frozen,
        });
      } catch (error) {
        return initialProblem({
          intent,
          frozen,
          problem: unavailableProblem("reserve the durable recording workflow", error),
        });
      }
      if (durable.disposition === "existing") {
        try {
          return durableAuthorSnapshot(
            await this.operations.invoke("workflow.get", {
              workflowId: durable.workflow.record.workflowId,
            }),
            frozen,
          );
        } catch (error) {
          return unavailableDurableAuthor({
            workflow: {
              workflowId: durable.workflow.record.workflowId,
              expectedVersion: durable.workflow.record.version,
            },
            frozen,
            problem: mutationUnknownProblem("the existing recording was reconciled", error),
          });
        }
      }
      try {
        return durableAuthorSnapshot(
          await this.operations.invoke("workflow.transition", {
            workflowId: durable.workflow.record.workflowId,
            expectedVersion: durable.workflow.record.version,
            action: "start-authoring",
            leaseId: intent.leaseId,
          }),
          frozen,
        );
      } catch (error) {
        return unavailableDurableAuthor({
          workflow: {
            workflowId: durable.workflow.record.workflowId,
            expectedVersion: durable.workflow.record.version,
          },
          frozen,
          problem: mutationUnknownProblem("the Authoring Session began", error),
        });
      }
    }
    let output: OperationOutput<"authoring.session.begin">;
    try {
      output = await this.operations.invoke("authoring.session.begin", {
        appMapId: intent.appMapId,
        testName: intent.title.trim(),
        target: { ...intent.target },
        ...(intent.originApplication?.trim()
          ? { originApplication: intent.originApplication.trim() }
          : {}),
        leaseId: intent.leaseId,
        expectedAppMapRevision: revision,
        ...(intent.sourceScreenId ? { sourceScreenId: intent.sourceScreenId } : {}),
        ...(intent.pendingConnectionId ? { pendingConnectionId: intent.pendingConnectionId } : {}),
        ...(intent.group?.trim() ? { group: intent.group.trim() } : {}),
        ...(intent.debugOrigin ? { debugOrigin: structuredClone(intent.debugOrigin) } : {}),
      });
    } catch (error) {
      const reconciled = await this.reconcileStartedSession(intent, revision);
      if (reconciled) return reconciled;
      return initialProblem({
        intent,
        frozen,
        phase: "needs-attention",
        problem: mutationUnknownProblem("the Authoring Session began", error),
      });
    }

    if (!validStartedSession(output.session, intent, revision)) {
      return initialProblem({
        intent,
        frozen,
        phase: "needs-attention",
        problem: mutationUnknownProblem(
          "the Authoring Session began",
          "The begin response failed canonical session identity validation.",
        ),
      });
    }
    return this.snapshotForSession(output.session, frozen);
  }

  async recover(intent: AuthorTestRecoveryIntent): Promise<AuthorTestSnapshot> {
    try {
      const output = await this.operations.invoke("authoring.session.get", {
        sessionId: intent.sessionId,
      });
      return this.snapshotForSession(output.session, frozenIdentityFromSession(output.session));
    } catch (error) {
      return {
        schemaVersion: 1,
        kind: "author-test",
        title: "Recover recording",
        phase: "needs-attention",
        stage: "unknown",
        version: "unavailable",
        authoring: { sessionId: intent.sessionId },
        progress: { label: "The Authoring Session needs inspection" },
        allowedNextActions: ["inspect"],
        problems: [unavailableProblem("recover the canonical Authoring Session", error)],
        evidenceRefs: [],
      };
    }
  }

  async inspectDurable(workflowId: string): Promise<AuthorTestSnapshot> {
    try {
      return durableAuthorSnapshot(await this.operations.invoke("workflow.get", { workflowId }));
    } catch (error) {
      return unavailableDurableAuthor({
        workflow: { workflowId, expectedVersion: 1 },
        unavailable: true,
        problem: {
          ...unavailableProblem("inspect the durable recording workflow", error),
          recovery:
            "Restore Relay connectivity, then inspect this workflow ID again. Do not start another recording.",
        },
      });
    }
  }

  snapshotDurable(output: DurableWorkflowOperationOutput): AuthorTestSnapshot {
    return durableAuthorSnapshot(output);
  }

  async advanceDurable(decision: DurableAuthorTestDecision): Promise<AuthorTestSnapshot> {
    try {
      return durableAuthorSnapshot(
        await this.operations.invoke("workflow.transition", durableTransitionInput(decision)),
      );
    } catch (error) {
      try {
        const inspected = durableAuthorSnapshot(
          await this.operations.invoke("workflow.get", { workflowId: decision.workflowId }),
        );
        return {
          ...inspected,
          problems: [
            ...inspected.problems,
            mutationUnknownProblem("the recording decision completed", error),
          ],
        };
      } catch {
        // A failed read cannot justify issuing the mutation again.
      }
      return unavailableDurableAuthor({
        unavailable: true,
        workflow: {
          workflowId: decision.workflowId,
          expectedVersion: decision.expectedVersion,
        },
        problem: mutationUnknownProblem("the recording decision completed", error),
      });
    }
  }

  private async reconcileStartedSession(
    intent: AuthorTestIntent,
    revision: number,
  ): Promise<AuthorTestSnapshot | undefined> {
    try {
      const output = await this.operations.invoke("authoring.session.list", {});
      const matches = output.sessions.filter((session) =>
        validStartedSession(session, intent, revision),
      );
      return matches.length === 1
        ? this.snapshotForSession(matches[0]!, frozenIdentity(intent, revision))
        : undefined;
    } catch {
      return undefined;
    }
  }

  private snapshotForSession(
    session: AuthoringSession,
    frozen: FrozenAuthorTestIdentity,
  ): AuthorTestSnapshot {
    const ref = encodeAuthoringWorkflowRef({
      schemaVersion: 1,
      kind: "author-test",
      sessionId: session.id,
      frozen,
    });
    try {
      return snapshotFromAuthoringSession({ ref, frozen, session });
    } catch (error) {
      return {
        schemaVersion: 1,
        kind: "author-test",
        title: frozen.title,
        phase: "needs-attention",
        stage: "unknown",
        version: "unavailable",
        ref,
        frozen,
        authoring: { sessionId: session.id },
        progress: { label: "The Authoring Session needs inspection" },
        allowedNextActions: ["inspect"],
        problems: [mutationUnknownProblem("the Authoring Session began", error)],
        evidenceRefs: [],
      };
    }
  }

  async inspect(ref: WorkflowRef, reference: AuthoringWorkflowReference) {
    return this.readSession(ref, reference);
  }

  async advance(
    decision: AuthorTestDecision,
    reference: AuthoringWorkflowReference,
  ): Promise<AuthorTestSnapshot> {
    const current = await this.readSession(decision.ref, reference);
    if (current.version === "unavailable") return current;
    if (current.version !== decision.expectedVersion) {
      return {
        ...current,
        problems: [
          ...current.problems,
          {
            code: "stale-workflow-version",
            title: "This recording changed before the decision",
            detail:
              "The supplied workflow version no longer matches the canonical Authoring Session.",
            recovery: "Review the latest snapshot and explicitly choose the next action again.",
            retryable: true,
          },
        ],
      };
    }
    if (!current.allowedNextActions.includes(decision.action)) {
      return {
        ...current,
        problems: [
          ...current.problems,
          {
            code: "unexpected-authoring-state",
            title: "This recording is not ready for that decision",
            detail: `${decision.action} is not allowed while the canonical session is ${current.stage}.`,
            recovery: "Use a decision listed in allowedNextActions on the latest snapshot.",
            retryable: false,
          },
        ],
      };
    }

    try {
      const output = await this.invokeDecision(reference.sessionId, decision);
      if (!this.sessionMatches(output.session, reference)) {
        throw new TypeError("Authoring response does not identify the workflow session");
      }
      return snapshotFromAuthoringSession({
        ref: decision.ref,
        frozen: reference.frozen,
        session: output.session,
      });
    } catch (error) {
      const body = error && typeof error === "object" && "body" in error ? error.body : undefined;
      if (
        body &&
        typeof body === "object" &&
        "code" in body &&
        body.code === "input-not-dispatched" &&
        "dispatched" in body &&
        body.dispatched === false
      ) {
        return {
          ...current,
          problems: [
            {
              code: "input-not-dispatched",
              title: "The interaction was not sent",
              detail: errorDetail(error),
              recovery: "Reconnect the device, then try again.",
              retryable: true,
            },
          ],
        };
      }
      return {
        ...current,
        phase: "needs-attention",
        progress: { label: "The mutation outcome needs inspection" },
        allowedNextActions: ["inspect"],
        problems: [
          ...current.problems,
          mutationUnknownProblem(this.mutationLabel(decision), error),
        ],
      };
    }
  }

  private async invokeDecision(
    sessionId: string,
    decision: AuthorTestDecision,
  ): Promise<{ session: AuthoringSession }> {
    if (decision.action === "record") {
      return this.operations.invoke("authoring.session.interact", {
        sessionId,
        interaction: decision.interaction,
      });
    }
    if (decision.action === "checkpoint") {
      return this.operations.invoke("authoring.session.interact", {
        sessionId,
        interaction: { kind: "screenshot", ...(decision.label ? { label: decision.label } : {}) },
      });
    }
    if (decision.action === "stop") {
      return this.operations.invoke("authoring.session.stop", { sessionId });
    }
    if (decision.action === "edit") {
      return this.operations.invoke("authoring.take.edit", {
        sessionId,
        edit: structuredClone(decision.edit),
      });
    }
    if (decision.action === "replay") {
      return this.operations.invoke("authoring.take.replay", { sessionId });
    }
    if (decision.action === "approve") {
      return this.operations.invoke("authoring.session.commit", {
        sessionId,
        ...(decision.destination ? { destination: decision.destination } : {}),
        ...(decision.testName ? { testName: decision.testName } : {}),
        createTest: true,
      });
    }
    if (decision.action === "discard") {
      return this.operations.invoke("authoring.session.discard", { sessionId });
    }
    return this.operations.invoke("authoring.session.cancel", { sessionId });
  }

  private mutationLabel(decision: AuthorTestDecision): string {
    if (decision.action === "record") return "the interaction was recorded";
    if (decision.action === "checkpoint") return "the checkpoint was recorded";
    if (decision.action === "stop") return "the recording was compiled for review";
    if (decision.action === "replay") return "the reviewed recording was replayed";
    if (decision.action === "approve") return "the reviewed recording was approved";
    if (decision.action === "discard") return "the reviewed recording was discarded";
    if (decision.action === "cancel") return "the recording was cancelled";
    return "the reviewed recording was edited";
  }

  private sessionMatches(
    session: AuthoringSession,
    reference: AuthoringWorkflowReference,
  ): boolean {
    return (
      session.id === reference.sessionId &&
      session.actorId === reference.frozen.actorId &&
      session.appMapId === reference.frozen.appMapId &&
      session.expectedAppMapRevision === reference.frozen.appMapRevision &&
      canonicalTestName(session) === reference.frozen.title &&
      session.originApplication === reference.frozen.originApplication &&
      sameTarget(session.target, reference.frozen.target)
    );
  }

  private async readSession(
    ref: WorkflowRef,
    reference: AuthoringWorkflowReference,
  ): Promise<AuthorTestSnapshot> {
    try {
      const output = await this.operations.invoke("authoring.session.get", {
        sessionId: reference.sessionId,
      });
      if (!this.sessionMatches(output.session, reference)) {
        throw new TypeError("Authoring response does not identify the workflow session");
      }
      return snapshotFromAuthoringSession({
        ref,
        frozen: reference.frozen,
        session: output.session,
      });
    } catch (error) {
      return {
        schemaVersion: 1,
        kind: "author-test",
        title: reference.frozen.title,
        phase: "needs-attention",
        stage: "unknown",
        version: "unavailable",
        ref,
        frozen: reference.frozen,
        authoring: { sessionId: reference.sessionId },
        progress: { label: "Relay could not inspect the canonical Authoring Session" },
        allowedNextActions: ["inspect"],
        problems: [
          {
            code: "malformed-response",
            title: "Relay could not inspect this recording",
            detail: errorDetail(error),
            recovery:
              "Restore Relay connectivity or repair the response contract, then inspect again.",
            retryable: true,
          },
        ],
        evidenceRefs: [],
      };
    }
  }
}
