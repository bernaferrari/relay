import type { AuthoringSession } from "@relay/protocol";
import type {
  AuthorTestSnapshot,
  FrozenAuthorTestIdentity,
  WorkflowProblem,
  WorkflowRef,
} from "./types.js";

function fingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function workflowVersionForAuthoringSession(session: AuthoringSession): string {
  const latestReplay = session.take?.replayAttempts.at(-1);
  return `author-v1-${fingerprint(
    JSON.stringify([
      session.id,
      session.state,
      session.updatedAt,
      session.take?.id,
      session.take?.currentRevision,
      latestReplay?.id,
      latestReplay?.outcome,
      session.committedConnectionId,
      session.committedTestId,
      session.error,
      session.archive?.reason,
    ]),
  )}`;
}

function phaseForSession(session: AuthoringSession): AuthorTestSnapshot["phase"] {
  if (session.state === "recording" || session.state === "committing") return "running";
  if (session.state === "preparing" || session.state === "ready") return "paused";
  if (session.state === "reviewing") return "paused";
  if (session.state === "committed") return "succeeded";
  if (session.state === "failed") return "failed";
  return "cancelled";
}

function progressForSession(session: AuthoringSession): AuthorTestSnapshot["progress"] {
  const actionCount = session.take?.revisions.at(-1)?.actions.length;
  if (session.state === "preparing") return { label: "Preparing the selected target" };
  if (session.state === "ready") return { label: "Ready to record" };
  if (session.state === "recording") {
    return {
      label: actionCount ? `Recording · ${actionCount} actions` : "Recording",
      ...(actionCount === undefined ? {} : { completed: actionCount }),
    };
  }
  if (session.state === "reviewing") {
    return {
      label: actionCount ? `Review ${actionCount} recorded actions` : "Review the recording",
      ...(actionCount === undefined ? {} : { completed: actionCount }),
    };
  }
  if (session.state === "committing") return { label: "Approving the reviewed recording" };
  if (session.state === "committed") return { label: "Recording approved" };
  if (session.state === "failed") return { label: "Recording workflow failed" };
  return { label: "Recording cancelled" };
}

function reviewForSession(session: AuthoringSession): AuthorTestSnapshot["review"] {
  const take = session.take;
  const revision = take?.revisions.find((candidate) => candidate.revision === take.currentRevision);
  if (!take || !revision) return undefined;
  const latestReplay = take.replayAttempts.at(-1);
  const approvedReplay = take.replayAttempts.some(
    (attempt) => attempt.takeRevision === revision.revision && attempt.outcome === "passed",
  );
  return {
    actionCount: revision.actions.length,
    actions: revision.actions.map((action) => ({
      id: action.id,
      ...(action.label ? { label: action.label } : {}),
      stepCount: action.steps.length,
      ...(action.proofStatus ? { proofStatus: action.proofStatus } : {}),
    })),
    ...(latestReplay
      ? {
          latestReplay: {
            id: latestReplay.id,
            takeRevision: latestReplay.takeRevision,
            outcome: latestReplay.outcome,
            ...(latestReplay.error ? { error: latestReplay.error } : {}),
          },
        }
      : {}),
    replayRequired: !approvedReplay,
  };
}

function allowedActions(
  session: AuthoringSession,
  review: AuthorTestSnapshot["review"],
): AuthorTestSnapshot["allowedNextActions"] {
  if (session.state === "recording") {
    return ["inspect", "record", "checkpoint", "stop", "cancel"];
  }
  if (session.state === "reviewing" && !session.archive) {
    return [
      "inspect",
      "trim",
      "reorder",
      "replace",
      "replay",
      ...(review && !review.replayRequired ? (["approve"] as const) : []),
      "discard",
      "cancel",
    ];
  }
  if (["preparing", "ready", "failed"].includes(session.state)) return ["inspect", "cancel"];
  return ["inspect"];
}

function problemsForSession(session: AuthoringSession): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  if (
    session.state === "committed" &&
    (!session.committedConnectionId || !session.committedTestId)
  ) {
    problems.push({
      code: "malformed-response",
      title: "The approved recording is incomplete",
      detail: "Canonical state does not contain both the reviewed Connection and its Test.",
      recovery: "Inspect the Authoring Session and App Map before approving or recording again.",
      retryable: false,
    });
  }
  if (session.state === "failed") {
    problems.push({
      code: "operation-unavailable",
      title: "The recording workflow failed",
      detail: session.error ?? "The canonical Authoring Session ended with an error.",
      recovery: "Inspect the target and canonical session, then cancel or begin a new recording.",
      retryable: false,
    });
  }
  const replay = session.take?.replayAttempts.at(-1);
  if (session.state === "reviewing" && replay && replay.outcome !== "passed") {
    problems.push({
      code: "operation-unavailable",
      title: "Replay did not prove the reviewed recording",
      detail: replay.error ?? `The latest replay was ${replay.outcome}.`,
      recovery:
        "Return to the recorded source, repair the reviewed actions if needed, then replay explicitly.",
      retryable: true,
    });
  }
  if (session.state === "reviewing" && session.archive) {
    problems.push({
      code: "unexpected-authoring-state",
      title: "This review is no longer actionable",
      detail: `The canonical Authoring Session was archived as ${session.archive.reason}.`,
      recovery: "Open the newer actionable recording or inspect this session as immutable history.",
      retryable: false,
    });
  }
  return problems;
}

function evidenceForSession(session: AuthoringSession): AuthorTestSnapshot["evidenceRefs"] {
  const evidenceIds = new Set<string>();
  const take = session.take;
  const revision = take?.revisions.find((candidate) => candidate.revision === take.currentRevision);
  for (const item of revision?.evidence ?? []) evidenceIds.add(item.id);
  for (const attempt of take?.replayAttempts ?? []) {
    for (const item of attempt.evidence) evidenceIds.add(item.id);
  }
  return [...evidenceIds].map((id) => ({ kind: "authoring-evidence" as const, id }));
}

export function snapshotFromAuthoringSession(input: {
  ref: WorkflowRef;
  frozen: FrozenAuthorTestIdentity;
  session: AuthoringSession;
  extraProblems?: readonly WorkflowProblem[];
  forceNeedsAttention?: boolean;
}): AuthorTestSnapshot {
  const { ref, frozen, session } = input;
  const review = reviewForSession(session);
  const incompleteCommit =
    session.state === "committed" && (!session.committedConnectionId || !session.committedTestId);
  const needsAttention = input.forceNeedsAttention || incompleteCommit;
  return {
    schemaVersion: 1,
    kind: "author-test",
    title: frozen.title,
    phase: needsAttention ? "needs-attention" : phaseForSession(session),
    stage: session.state,
    version: workflowVersionForAuthoringSession(session),
    ref,
    frozen,
    authoring: {
      sessionId: session.id,
      ...(session.take
        ? { takeId: session.take.id, takeRevision: session.take.currentRevision }
        : {}),
      ...(session.committedConnectionId
        ? { committedConnectionId: session.committedConnectionId }
        : {}),
      ...(session.committedTestId ? { committedTestId: session.committedTestId } : {}),
    },
    ...(review ? { review } : {}),
    progress: needsAttention
      ? { label: "The mutation outcome needs inspection" }
      : progressForSession(session),
    allowedNextActions: needsAttention ? ["inspect"] : allowedActions(session, review),
    problems: [...problemsForSession(session), ...(input.extraProblems ?? [])],
    evidenceRefs: evidenceForSession(session),
  };
}
