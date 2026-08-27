import type { AuthoringSession, OperationOutput } from "@relay/protocol";
import { snapshotFromAuthoringSession } from "./authoring-projection.js";
import type { RelayOperationPort } from "./operation-port.js";
import type {
  AuthorTestDecision,
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

function frozenIdentity(intent: AuthorTestIntent, revision: number): FrozenAuthorTestIdentity {
  return {
    title: intent.title.trim(),
    actorId: intent.actorId,
    appMapId: intent.appMapId,
    appMapRevision: revision,
    target: { ...intent.target },
    ...(intent.sourceScreenId ? { sourceScreenId: intent.sourceScreenId } : {}),
    ...(intent.pendingConnectionId ? { pendingConnectionId: intent.pendingConnectionId } : {}),
    ...(intent.group?.trim() ? { group: intent.group.trim() } : {}),
  };
}

function frozenIdentityFromSession(session: AuthoringSession): FrozenAuthorTestIdentity {
  return {
    title: session.group?.trim() || "New Test",
    actorId: session.actorId,
    appMapId: session.appMapId,
    appMapRevision: session.expectedAppMapRevision,
    target: { ...session.target },
    ...(session.sourceScreenId ? { sourceScreenId: session.sourceScreenId } : {}),
    ...(session.pendingConnectionId ? { pendingConnectionId: session.pendingConnectionId } : {}),
    ...(session.group?.trim() ? { group: session.group.trim() } : {}),
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
    left.kind === right.kind && left.platform === right.platform && left.targetId === right.targetId
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
    session.sourceScreenId === intent.sourceScreenId &&
    session.pendingConnectionId === intent.pendingConnectionId &&
    (session.group?.trim() || undefined) === (intent.group?.trim() || undefined) &&
    session.state === "recording" &&
    session.take?.state === "recording",
  );
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
    let output: OperationOutput<"authoring.session.begin">;
    try {
      output = await this.operations.invoke("authoring.session.begin", {
        appMapId: intent.appMapId,
        target: { ...intent.target },
        leaseId: intent.leaseId,
        expectedAppMapRevision: revision,
        ...(intent.sourceScreenId ? { sourceScreenId: intent.sourceScreenId } : {}),
        ...(intent.pendingConnectionId ? { pendingConnectionId: intent.pendingConnectionId } : {}),
        ...(intent.group?.trim() ? { group: intent.group.trim() } : {}),
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
    if (decision.action === "trim") {
      return this.operations.invoke("authoring.take.trim", {
        sessionId,
        ...(decision.fromMs === undefined ? {} : { fromMs: decision.fromMs }),
        ...(decision.toMs === undefined ? {} : { toMs: decision.toMs }),
        ...(decision.actionIds ? { actionIds: [...decision.actionIds] } : {}),
      });
    }
    if (decision.action === "reorder") {
      return this.operations.invoke("authoring.take.reorder", {
        sessionId,
        actionIds: [...decision.actionIds],
      });
    }
    if (decision.action === "replace") {
      return this.operations.invoke("authoring.take.replace", {
        sessionId,
        actionId: decision.actionId,
        interaction: decision.interaction,
      });
    }
    if (decision.action === "replay") {
      return this.operations.invoke("authoring.take.replay", { sessionId });
    }
    if (decision.action === "approve") {
      return this.operations.invoke("authoring.session.commit", {
        sessionId,
        ...(decision.destination ? { destination: decision.destination } : {}),
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
