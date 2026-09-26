import {
  authoringCaptureNeedsReplay,
  authoringCaptureProvenance,
  captureProofForAuthoring,
  type AuthoringSession,
} from "@relay/protocol";
import type {
  AuthorTestSnapshot,
  AuthoringReviewActionKind,
  FrozenAuthorTestIdentity,
  DurableWorkflowHandle,
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

/** Step names stay one line: long page text is cut at a word boundary. */
function shortName(value: string, max = 48): string {
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function semanticIntent(
  action: NonNullable<AuthoringSession["take"]>["revisions"][number]["actions"][number],
): string {
  if (action.label?.trim()) return shortName(action.label);
  const step = action.steps[0] as unknown as Record<string, unknown> | undefined;
  if (action.steps.length !== 1 || !step) return `${action.steps.length} recorded steps`;
  if (step.kind === "tap") {
    const target = step.target as Record<string, unknown> | undefined;
    const name = [target?.label, target?.identifier, target?.text].find(
      (value): value is string => typeof value === "string" && Boolean(value.trim()),
    );
    if (name) return `Tap “${shortName(name)}”`;
    const point = target?.point as Record<string, unknown> | undefined;
    if (
      point &&
      typeof point.x === "number" &&
      Number.isFinite(point.x) &&
      typeof point.y === "number" &&
      Number.isFinite(point.y)
    ) {
      return `Tap at ${Math.round(point.x)}, ${Math.round(point.y)}`;
    }
    return "Tap the captured target";
  }
  if (step.kind === "type") {
    const text = typeof step.text === "string" ? step.text.trim() : "";
    const target = step.target as Record<string, unknown> | undefined;
    const field = [target?.label, target?.identifier, target?.text]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    // Never echo what was typed into a secret field.
    if (!text || /pass|secret|token|otp|code|pin/i.test(field)) return "Type text";
    return `Type “${shortName(text)}”`;
  }
  if (step.kind === "sleep") return `Wait ${String(step.ms ?? "")} ms`.trim();
  if (step.kind === "screenshot") return "Checkpoint";
  if (step.kind === "launch") return "Open app";
  if (step.kind === "swipe") return "Swipe";
  if (step.kind === "key") {
    if (step.key === "home") return "Go to home screen";
    if (step.key === "recents") return "Open recent apps";
    return `Press ${String(step.key ?? "key")}`;
  }
  return "Recorded action";
}

type ReviewEvidenceRole = "action" | "entrance" | "exit";

type AuthoringRevision = NonNullable<AuthoringSession["take"]>["revisions"][number];

function observationsForRevision(
  revision: AuthoringRevision,
): Map<string, NonNullable<AuthoringRevision["observations"]>[number]> {
  const observations = new Map<string, NonNullable<AuthoringRevision["observations"]>[number]>();
  for (const observation of revision.observations ?? []) {
    observations.set(observation.id, observation);
  }
  if (revision.before) observations.set(revision.before.id, revision.before);
  if (revision.after) observations.set(revision.after.id, revision.after);
  return observations;
}

function reviewActionKind(
  action: NonNullable<AuthoringSession["take"]>["revisions"][number]["actions"][number],
): AuthoringReviewActionKind {
  const kinds = [...new Set(action.steps.map((step) => step.kind))];
  if (kinds.length === 0) return "observe";
  if (kinds.length === 1) return kinds[0]!;
  return "mixed";
}

function reviewEvidenceForAction(
  action: NonNullable<AuthoringSession["take"]>["revisions"][number]["actions"][number],
  revision: NonNullable<AuthoringSession["take"]>["revisions"][number],
): {
  evidenceIds: string[];
  evidence: Array<{
    id: string;
    kind: "screenshot" | "snapshot" | "video";
    capturedAt: number;
    roles: ReviewEvidenceRole[];
  }>;
} {
  const rolesByEvidenceId = new Map<string, Set<ReviewEvidenceRole>>();
  const add = (id: string, role: ReviewEvidenceRole) => {
    const roles = rolesByEvidenceId.get(id) ?? new Set<ReviewEvidenceRole>();
    roles.add(role);
    rolesByEvidenceId.set(id, roles);
  };
  for (const id of action.evidenceIds) add(id, "action");

  const observations = observationsForRevision(revision);
  for (const [observationId, role] of [
    [action.entranceObservationId, "entrance"],
    [action.exitObservationId, "exit"],
  ] as const) {
    if (!observationId) continue;
    for (const id of observations.get(observationId)?.evidenceIds ?? []) add(id, role);
  }

  const evidenceById = new Map(revision.evidence.map((item) => [item.id, item]));
  const evidence = [...rolesByEvidenceId].flatMap(([id, roles]) => {
    const item = evidenceById.get(id);
    // Keep dangling links as IDs below, but never invent evidence metadata.
    if (!item) return [];
    return [
      {
        id: item.id,
        kind: item.kind,
        capturedAt: item.capturedAt,
        roles: [...roles],
      },
    ];
  });
  return { evidenceIds: [...rolesByEvidenceId.keys()], evidence };
}

function timelineForRevision(
  revision: NonNullable<AuthoringSession["take"]>["revisions"][number],
): NonNullable<AuthorTestSnapshot["review"]>["timeline"] {
  const observations = observationsForRevision(revision);
  const timestamps = [
    ...revision.actions.flatMap((action) => [action.startedAt, action.finishedAt]),
    ...revision.evidence.map((item) => item.capturedAt),
    ...[...observations.values()].map((observation) => observation.capturedAt),
  ].filter((value) => Number.isFinite(value));
  const startedAt = Math.min(...(timestamps.length ? timestamps : [revision.createdAt]));
  const finishedAt = Math.max(...(timestamps.length ? timestamps : [revision.createdAt]));
  return {
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    actionCount: revision.actions.length,
    evidenceCount: revision.evidence.length,
    observationCount: observations.size,
  };
}

export function workflowVersionForAuthoringSession(session: AuthoringSession): string {
  const latestReplay = session.take?.replayAttempts.at(-1);
  return `author-v1-${fingerprint(
    JSON.stringify([
      session.id,
      session.testName,
      authoringCaptureProvenance(session.captureProvenance).mode,
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
  const captureProvenance = authoringCaptureProvenance(session.captureProvenance);
  return {
    actionCount: revision.actions.length,
    currentRevision: revision.revision,
    revisionCount: take.revisions.length,
    ...(revision.videoClip ? { videoClip: { ...revision.videoClip } } : {}),
    actions: revision.actions.map((action) => {
      const linkedEvidence = reviewEvidenceForAction(action, revision);
      return {
        id: action.id,
        intent: semanticIntent(action),
        ...(action.label ? { label: action.label } : {}),
        stepCount: action.steps.length,
        kind: reviewActionKind(action),
        startedAt: action.startedAt,
        finishedAt: action.finishedAt,
        durationMs: Math.max(0, action.finishedAt - action.startedAt),
        evidenceIds: linkedEvidence.evidenceIds,
        evidenceCount: linkedEvidence.evidenceIds.length,
        evidenceKinds: [...new Set(linkedEvidence.evidence.map((item) => item.kind))],
        evidence: linkedEvidence.evidence,
        ...(action.fullPage ? { fullPage: structuredClone(action.fullPage) } : {}),
        ...(action.proofStatus ? { proofStatus: action.proofStatus } : {}),
        captureProof: captureProofForAuthoring(captureProvenance, approvedReplay),
      };
    }),
    timeline: timelineForRevision(revision),
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
      "edit",
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
  const captureProvenance = authoringCaptureProvenance(session.captureProvenance);
  const revision = session.take?.revisions.find(
    (candidate) => candidate.revision === session.take?.currentRevision,
  );
  const replayPassed = session.take?.replayAttempts.some(
    (attempt) => attempt.takeRevision === revision?.revision && attempt.outcome === "passed",
  );
  if (
    session.state === "reviewing" &&
    captureProvenance.mode === "watch-and-infer" &&
    !replayPassed
  ) {
    problems.push({
      code: "operation-unavailable",
      title: "Inferred actions are not proved yet",
      detail: "Watch-and-infer observations describe a proposed path, not commands Relay proved.",
      recovery: "Replay this exact reviewed revision before approval.",
      retryable: true,
    });
  }
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
  ref?: WorkflowRef;
  workflow?: DurableWorkflowHandle;
  frozen: FrozenAuthorTestIdentity;
  session: AuthoringSession;
  extraProblems?: readonly WorkflowProblem[];
  forceNeedsAttention?: boolean;
}): AuthorTestSnapshot {
  const { ref, frozen, session } = input;
  const captureProvenance = authoringCaptureProvenance(session.captureProvenance);
  const review = reviewForSession(session);
  const incompleteCommit =
    session.state === "committed" && (!session.committedConnectionId || !session.committedTestId);
  const needsAttention = input.forceNeedsAttention || incompleteCommit;
  return {
    schemaVersion: 1,
    kind: "author-test",
    // The public Test name is chosen at approval time. The authoring session is
    // canonical here so a refresh after commit shows that final name rather
    // than the temporary label used to start capture.
    title: session.testName ?? frozen.title,
    phase: needsAttention ? "needs-attention" : phaseForSession(session),
    stage: session.state,
    version: input.workflow
      ? `workflow-v${input.workflow.expectedVersion}`
      : workflowVersionForAuthoringSession(session),
    ...(input.workflow ? { workflow: input.workflow } : {}),
    ...(ref ? { ref } : {}),
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
    capture: {
      mode: captureProvenance.mode,
      provenance: captureProvenance,
      proof: captureProofForAuthoring(
        captureProvenance,
        session.take?.replayAttempts.some(
          (attempt) =>
            attempt.takeRevision === session.take?.currentRevision && attempt.outcome === "passed",
        ) === true,
      ),
      replayRequiredBeforeApproval: authoringCaptureNeedsReplay(captureProvenance),
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
