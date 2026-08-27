import type { RecipeStep, StepTarget } from "./recipes.js";

export const AUTHORING_SESSION_STATES = [
  "preparing",
  "ready",
  "recording",
  "reviewing",
  "committing",
  "committed",
  "failed",
  "cancelled",
] as const;

export type AuthoringSessionState = (typeof AUTHORING_SESSION_STATES)[number];

export type AuthoringTarget =
  | { kind: "device"; platform: "android" | "ios"; targetId: string }
  | { kind: "browser"; platform: "browser"; targetId: string };

export type AuthoringEvidence = {
  id: string;
  kind: "screenshot" | "snapshot" | "video";
  capturedAt: number;
  /** Immutable server-side content reference. Clients never execute this path. */
  uri: string;
  mime?: string;
  bytes?: number;
  sha256?: string;
  startMs?: number;
  endMs?: number;
};

export type AuthoringScreenObservation = {
  id: string;
  fingerprint: string;
  capturedAt: number;
  source: "recording" | "discovery" | "run" | "manual";
  deviceId?: string;
};

/**
 * The viewport raster and semantic tree are independent observations. Keeping
 * their timestamps and availability separate prevents a delayed iOS AX query
 * from being presented as if it were part of the same instant as the pixels.
 */
export type AuthoringObservationProof = {
  schemaVersion: 1;
  /** Physical iOS captures must serialize pixels before XCTest; other targets
   * may acquire both planes concurrently. This is evidence ordering, not a
   * claim that the two planes have identical timestamps. */
  captureOrder: "pixels-first" | "pixels-ax-pixels" | "semantics-first" | "concurrent";
  pixels: {
    status: "captured" | "unavailable";
    capturedAt?: number;
    fingerprint?: string;
    width?: number;
    height?: number;
    /** A physical iOS AX tree is promotable only when rasters taken directly
     * before and after its bounded read still describe the same surface.
     * The primary `capturedAt` / `fingerprint` fields describe the first
     * raster; this optional record retains the closing raster separately. */
    bracket?: {
      status: "coherent" | "changed" | "unavailable";
      afterCapturedAt?: number;
      afterFingerprint?: string;
    };
  };
  semantics: {
    status: "current" | "stale" | "unavailable";
    capturedAt?: number;
    fingerprint?: string;
  };
};

/** Capture diagnostics retained with an observation so a later optimizer can
 * distinguish a real semantic tree from an unavailable, rebound, or
 * pixels-only capture without reconnecting the device. */
export type AuthoringCaptureContext = {
  snapshotSource?: "sdk" | "android-system" | "pixels-only";
  inspectable?: boolean;
  inspectionState?: "active" | "keyguard" | "asleep" | "unavailable" | "unknown";
  bindingState?: "matched" | "rebound" | "unavailable";
  treeApp?: string;
  visualFingerprint?: string;
};

/** The honest validation level for one recorded action's entrance and exit.
 * Pixels-only remains a usable, reviewable device path; it is never reported
 * as a current semantic proof. */
export type AuthoringTransitionProofStatus = "verified" | "pixels-only" | "unresolved";

export type AuthoringObservation = {
  id: string;
  capturedAt: number;
  screen: AuthoringScreenObservation;
  evidenceIds: string[];
  /** Exact capture-plane facts for this entrance or exit observation. */
  proof?: AuthoringObservationProof;
  /** Safe capture provenance retained alongside the immutable evidence files. */
  capture?: AuthoringCaptureContext;
  bounds?: { width: number; height: number };
  /** Exact foreground owner observed with the screenshot/tree. */
  foregroundApp?: string;
  /** A bounded semantic snapshot retained for selector repair and screen identity. */
  nodes?: Array<Record<string, unknown>>;
};

export type AuthoringActionSource = "captured" | "manual" | "reusable";

export type AuthoringVideoClip = { startMs: number; endMs: number };

export type AuthoringAction = {
  id: string;
  source: AuthoringActionSource;
  recordedAt: number;
  startedAt: number;
  finishedAt: number;
  /** Empty means an intentional observe-only/no-op transition. */
  steps: RecipeStep[];
  evidenceIds: string[];
  /** The observation immediately before and after this action. They make an
   * action's source and destination reviewable without reusing a later screen
   * as its entrance proof. */
  entranceObservationId?: string;
  exitObservationId?: string;
  proofStatus?: AuthoringTransitionProofStatus;
  label?: string;
};

/** Whether one replay action ran, failed, or could only be observed as part
 * of an older all-steps batch. `unobserved` never claims an endpoint proof. */
export type AuthoringReplayActionOutcome = "passed" | "failed" | "unobserved" | "not-run";

/**
 * A semantic identity result for one replayed action. This stays separate
 * from proofStatus: a wait can be well-evidenced and intentionally unchanged,
 * while an unproven semantic identity must never establish a new map edge.
 */
export type AuthoringReplayActionTransition = "changed" | "unchanged" | "unproven";

/** Current replay evidence for one action. Its observation ids resolve only
 * against the owning replay attempt's bounded `observations` collection. */
export type AuthoringReplayActionProof = {
  actionId: string;
  outcome: AuthoringReplayActionOutcome;
  proofStatus: AuthoringTransitionProofStatus;
  transition: AuthoringReplayActionTransition;
  entranceObservationId?: string;
  exitObservationId?: string;
  evidenceIds: string[];
  error?: string;
};

export type AuthoringInteraction =
  | { kind: "tap"; target: StepTarget; expectedApp?: string; applied?: boolean }
  | {
      kind: "type";
      text: string;
      target?: StepTarget;
      mode?: "append" | "replace";
      applied?: boolean;
    }
  /** Device-level actions stay first-class in a Take so humans and agents
   * can author the same scenario without falling back to opaque custom steps. */
  | {
      kind: "clipboard";
      action: "write" | "read" | "paste" | "copy";
      text?: string;
      target?: StepTarget;
      expect?: string;
      match?: "exact" | "contains";
      applied?: boolean;
    }
  | {
      kind: "app";
      action:
        | "open"
        | "close"
        | "switcher"
        | "inspect"
        | "assert-installed"
        | "assert-not-installed"
        | "install"
        | "update"
        | "uninstall";
      app?: string;
      url?: string;
      relaunch?: boolean;
      artifact?: string;
      as?: string;
      version?: string;
      versionMatch?: "exact" | "contains";
      applied?: boolean;
    }
  | {
      kind: "device";
      action: "lock" | "unlock" | "keyboard-dismiss" | "keyboard-enter";
      applied?: boolean;
    }
  | {
      kind: "rotate";
      orientation: "portrait" | "portrait-upside-down" | "landscape-left" | "landscape-right";
      applied?: boolean;
    }
  | {
      kind: "swipe";
      from: { x: number; y: number };
      to: { x: number; y: number };
      durationMs?: number;
      applied?: boolean;
    }
  | { kind: "key"; key: "back" | "home"; applied?: boolean }
  | { kind: "wait"; ms: number }
  | { kind: "observe"; label?: string }
  | { kind: "screenshot"; label?: string }
  | { kind: "reusable"; recipeId: string; bindings?: Record<string, string> }
  | { kind: "steps"; steps: RecipeStep[]; label?: string; applied?: boolean };

export type AuthoringTakeRevision = {
  id: string;
  takeId: string;
  revision: number;
  createdAt: number;
  createdBy: string;
  reason: "recording" | "trim" | "reorder" | "replace" | "manual";
  actions: AuthoringAction[];
  evidence: AuthoringEvidence[];
  /** Bounded, immutable observation index for this revision's action links.
   * The initial/final observations remain explicit for backward compatibility. */
  observations?: AuthoringObservation[];
  before?: AuthoringObservation;
  after?: AuthoringObservation;
  videoClip?: AuthoringVideoClip;
};

export type AuthoringReplayAttempt = {
  id: string;
  takeId: string;
  takeRevision: number;
  startedAt: number;
  finishedAt: number;
  outcome: "passed" | "failed" | "cancelled";
  evidence: AuthoringEvidence[];
  /** `per-action` captures an entrance and exit around each action. Older
   * runtimes retain the safe `final-only` fallback instead of inventing links. */
  captureMode?: "per-action" | "final-only";
  /** Bounded, immutable resolver for actionProofs observation ids. */
  observations?: AuthoringObservation[];
  /** Current replay evidence keyed by the durable authored action id. */
  actionProofs?: Record<string, AuthoringReplayActionProof>;
  before?: AuthoringObservation;
  after?: AuthoringObservation;
  error?: string;
};

/** Raw authoring capture is deliberately separate from an editable Take
 * revision. Revisions describe the reviewed replay path; these events retain
 * the append-only source record that produced it. A missing stream is valid
 * for Takes saved before raw capture shipped. Version 2 splits the source
 * record for an interaction into an immutable
 * pre-dispatch intent and a separately appended terminal outcome. Version 1
 * remains readable so a Relay update never invalidates an in-flight Take. */
export const AUTHORING_RAW_CAPTURE_VERSION = 2 as const;

export type AuthoringRawCaptureVersion = 1 | typeof AUTHORING_RAW_CAPTURE_VERSION;

/** A selector-shaped record with no copied selector strings. Raw capture must
 * not become a second place that stores user-generated copy or identifiers. */
export type AuthoringRawTargetMetadata = {
  strategies: Array<"identifier" | "ref" | "label" | "text" | "relation" | "point">;
  point?: {
    x: number;
    y: number;
    referenceBounds?: { width: number; height: number };
    anchored?: boolean;
    relative?: boolean;
  };
};

/** Typed and clipboard values are represented only by non-reversible shape
 * metadata. In particular, raw capture never stores their value or a digest
 * that could be checked against guesses. */
export type AuthoringRawRedactedValue = {
  redacted: true;
  length: number;
  lineCount: number;
  hasNonAscii: boolean;
};

export type AuthoringRawInteraction =
  | {
      kind: "tap";
      target?: AuthoringRawTargetMetadata;
      hasExpectedApp?: boolean;
      applied?: boolean;
    }
  | {
      kind: "type";
      target?: AuthoringRawTargetMetadata;
      mode?: "append" | "replace";
      value: AuthoringRawRedactedValue;
      applied?: boolean;
    }
  | {
      kind: "clipboard";
      action: "write" | "read" | "paste" | "copy";
      target?: AuthoringRawTargetMetadata;
      value?: AuthoringRawRedactedValue;
      expectation?: AuthoringRawRedactedValue;
      match?: "exact" | "contains";
      applied?: boolean;
    }
  | {
      kind: "app";
      action:
        | "open"
        | "close"
        | "switcher"
        | "inspect"
        | "assert-installed"
        | "assert-not-installed"
        | "install"
        | "update"
        | "uninstall";
      hasApp?: boolean;
      hasUrl?: boolean;
      hasArtifact?: boolean;
      hasVersion?: boolean;
      relaunch?: boolean;
      applied?: boolean;
    }
  | {
      kind: "device";
      action: "lock" | "unlock" | "keyboard-dismiss" | "keyboard-enter";
      applied?: boolean;
    }
  | {
      kind: "rotate";
      orientation: "portrait" | "portrait-upside-down" | "landscape-left" | "landscape-right";
      applied?: boolean;
    }
  | {
      kind: "swipe";
      from: { x: number; y: number };
      to: { x: number; y: number };
      durationMs?: number;
      applied?: boolean;
    }
  | { kind: "key"; key: "back" | "home"; applied?: boolean }
  | { kind: "wait"; ms: number }
  | { kind: "observe"; hasLabel?: boolean }
  | { kind: "screenshot"; hasLabel?: boolean }
  | { kind: "reusable"; hasRecipe?: boolean; bindingCount: number }
  | { kind: "steps"; stepCount: number; hasLabel?: boolean; applied?: boolean };

/** Bounded reference to durable capture facts. It intentionally excludes the
 * semantic tree and every visible value; those remain in their evidence item
 * under the workspace evidence policy. */
export type AuthoringRawObservationLink = {
  observationId: string;
  capturedAt: number;
  evidenceIds: string[];
  viewport?: { width: number; height: number };
  focus?: { status: "captured" | "unavailable"; target?: AuthoringRawTargetMetadata };
};

export type AuthoringRawCaptureSource = {
  kind: "authoring-runtime";
  target: AuthoringTarget;
};

type AuthoringRawEventBase = {
  id: string;
  /** Strictly append-only, one-based order within the Take. */
  sequence: number;
  recordedAt: number;
  source: AuthoringRawCaptureSource;
};

export type AuthoringRawTakeStartEvent = AuthoringRawEventBase & {
  kind: "take-start";
  trigger: "recording" | "capture";
  observation: AuthoringRawObservationLink;
};

export type AuthoringRawObservationEvent = AuthoringRawEventBase & {
  kind: "observation";
  observation: AuthoringRawObservationLink;
};

/** The completed-interaction event written by raw capture version 1. Keep it
 * in the union for historical recordings; new version 2 captures use the
 * intent/outcome pair below instead of rewriting an intent after dispatch. */
export type AuthoringRawInteractionEvent = AuthoringRawEventBase & {
  kind: "interaction";
  startedAt: number;
  finishedAt: number;
  interaction: AuthoringRawInteraction;
  links: {
    actionId: string;
    entranceObservationId?: string;
    exitObservationId?: string;
    evidenceIds: string[];
  };
};

/** A durable command fact written before Relay invokes the native target
 * adapter. Its event id is the immutable key used by a later outcome event. */
export type AuthoringRawInteractionIntentEvent = AuthoringRawEventBase & {
  kind: "interaction-intent";
  startedAt: number;
  interaction: AuthoringRawInteraction;
  links: {
    entranceObservationId?: string;
    evidenceIds: string[];
  };
};

/** Terminal dispatch status for a prior intent. Errors themselves are never
 * copied here because platform diagnostics can contain private text. An
 * absent outcome is therefore an explicitly recoverable pending intent, not
 * a completed interaction with missing evidence. */
export type AuthoringRawInteractionOutcomeEvent = AuthoringRawEventBase & {
  kind: "interaction-outcome";
  intentEventId: string;
  outcome: "succeeded" | "failed" | "unknown";
  finishedAt: number;
  links: {
    actionId?: string;
    exitObservationId?: string;
    evidenceIds: string[];
  };
};

export type AuthoringRawTakeStopEvent = AuthoringRawEventBase & {
  kind: "take-stop";
  observation: AuthoringRawObservationLink;
  evidenceIds: string[];
};

export type AuthoringRawEvent =
  | AuthoringRawTakeStartEvent
  | AuthoringRawObservationEvent
  | AuthoringRawInteractionEvent
  | AuthoringRawInteractionIntentEvent
  | AuthoringRawInteractionOutcomeEvent
  | AuthoringRawTakeStopEvent;

/** A deterministic review queue derived from raw events. It carries no
 * mutations and cannot replace the original raw source or a Take revision. */
export type AuthoringRawOptimizationProposal = {
  schemaVersion: 1;
  kind: "authoring-raw-optimization";
  reviewOnly: true;
  takeId: string;
  captureVersion: AuthoringRawCaptureVersion;
  baseRevision: number;
  sourceEventIds: string[];
  suggestions: Array<{
    kind: "review-observe-only" | "review-wait";
    rawEventId: string;
    actionId: string;
    reason: string;
  }>;
};

/** Read-only result for the deterministic raw-recording review queue. A null
 * proposal means this Take predates raw capture (or has no Take), rather than
 * inviting a caller to infer or reconstruct private historical input. */
export type AuthoringRawOptimizationProposalResponse = {
  proposal: AuthoringRawOptimizationProposal | null;
};

export type AuthoringTake = {
  id: string;
  state: "recording" | "reviewing" | "committed" | "discarded";
  createdAt: number;
  updatedAt: number;
  currentRevision: number;
  revisions: AuthoringTakeRevision[];
  replayAttempts: AuthoringReplayAttempt[];
  /** Optional for backward compatibility with recordings created before raw
   * capture. Once present, this is append-only and never rewritten by trim,
   * reorder, replacement, or optimizer review. */
  rawCaptureVersion?: AuthoringRawCaptureVersion;
  rawEvents?: AuthoringRawEvent[];
};

export type AuthoringCommitDestination =
  | { kind: "new-screen"; title?: string }
  | { kind: "screen"; screenId: string }
  | { kind: "end" };

export type AuthoringSession = {
  schemaVersion: 1;
  id: string;
  organizationId: string;
  projectId: string;
  actorId: string;
  actorKind: "human" | "agent" | "system";
  appMapId: string;
  state: AuthoringSessionState;
  target: AuthoringTarget;
  leaseId: string;
  expectedAppMapRevision: number;
  sourceScreenId?: string;
  pendingConnectionId?: string;
  destination?: AuthoringCommitDestination;
  group?: string;
  take?: AuthoringTake;
  createdAt: number;
  updatedAt: number;
  recoveredAt?: number;
  recoverable?: boolean;
  error?: string;
  commitTransactionId?: string;
  /** Durable intent recorded before the atomic App Map transaction. Recovery
   * uses this to prove the Test and Connection crossed the same commit point. */
  commitTestId?: string;
  committedConnectionId?: string;
  committedTestId?: string;
  /** Terminal review disposition. This is server-owned so another renderer
   * cannot revive an already decided or replaced Take after a refresh. */
  archive?: {
    reason: "committed" | "discarded" | "superseded";
    archivedAt: number;
    /** The newer session that made this review non-actionable. */
    supersededBySessionId?: string;
  };
};

export type CreateAuthoringSessionInput = {
  appMapId: string;
  target: AuthoringTarget;
  leaseId: string;
  expectedAppMapRevision: number;
  sourceScreenId?: string;
  pendingConnectionId?: string;
  group?: string;
};

export type AuthoringSessionRef = { sessionId: string };

export type TrimAuthoringTakeInput = AuthoringSessionRef & {
  fromMs?: number;
  toMs?: number;
  actionIds?: string[];
};

export type ReorderAuthoringTakeInput = AuthoringSessionRef & { actionIds: string[] };

export type ReplaceAuthoringActionInput = AuthoringSessionRef & {
  actionId: string;
  interaction: AuthoringInteraction;
};

export type CommitAuthoringSessionInput = AuthoringSessionRef & {
  destination?: AuthoringCommitDestination;
  /** Create the first runnable Test in the same App Map transaction as the
   * reviewed Connection. */
  createTest?: true;
};

export type AuthoringSessionResponse = { session: AuthoringSession };
export type AuthoringSessionListResponse = { sessions: AuthoringSession[] };

export type AuthoringSessionSummary = {
  id: string;
  actorId: string;
  actorKind: "human" | "agent" | "system";
  appMapId: string;
  state: AuthoringSessionState;
  target: AuthoringTarget;
  sourceScreenId?: string;
  committedConnectionId?: string;
  committedTestId?: string;
  error?: string;
  archive?: AuthoringSession["archive"];
  take?: {
    id: string;
    state: AuthoringTake["state"];
    revision: number;
    actionCount: number;
    evidenceCount: number;
    actions: Array<{
      id: string;
      label?: string;
      stepCount: number;
      proofStatus?: AuthoringTransitionProofStatus;
    }>;
    latestReplay?: {
      id: string;
      outcome: AuthoringReplayAttempt["outcome"];
      takeRevision: number;
      durationMs: number;
      error?: string;
      actionProofs?: Record<
        string,
        Pick<AuthoringReplayActionProof, "outcome" | "proofStatus" | "transition">
      >;
    };
    /** Safe recovery signal only: it reveals counts, never private command
     * values, selectors, labels, recipe ids, or platform diagnostics. */
    rawCapture?: {
      version: AuthoringRawCaptureVersion;
      eventCount: number;
      pendingIntentCount: number;
    };
  };
};

function pendingRawIntentCount(events: readonly AuthoringRawEvent[]): number {
  const outcomes = new Set(
    events
      .filter(
        (event): event is AuthoringRawInteractionOutcomeEvent =>
          event.kind === "interaction-outcome",
      )
      .map((event) => event.intentEventId),
  );
  return events.filter(
    (event): event is AuthoringRawInteractionIntentEvent =>
      event.kind === "interaction-intent" && !outcomes.has(event.id),
  ).length;
}

/** Progressive-disclosure representation for CLI and MCP mutations.
 * Full revisions, semantic trees, and evidence stay available through the
 * explicit session-get operation instead of being repeated after every tap. */
export function summarizeAuthoringSession(session: AuthoringSession): AuthoringSessionSummary {
  const take = session.take;
  const revision = take?.revisions.find((item) => item.revision === take.currentRevision);
  const replay = take?.replayAttempts
    .filter((attempt) => attempt.takeRevision === revision?.revision)
    .at(-1);
  return {
    id: session.id,
    actorId: session.actorId,
    actorKind: session.actorKind,
    appMapId: session.appMapId,
    state: session.state,
    target: structuredClone(session.target),
    ...(session.sourceScreenId ? { sourceScreenId: session.sourceScreenId } : {}),
    ...(session.committedConnectionId
      ? { committedConnectionId: session.committedConnectionId }
      : {}),
    ...(session.committedTestId ? { committedTestId: session.committedTestId } : {}),
    ...(session.error ? { error: session.error } : {}),
    ...(session.archive ? { archive: structuredClone(session.archive) } : {}),
    ...(take
      ? {
          take: {
            id: take.id,
            state: take.state,
            revision: take.currentRevision,
            actionCount: revision?.actions.length ?? 0,
            evidenceCount: revision?.evidence.length ?? 0,
            actions: (revision?.actions ?? []).map((action) => ({
              id: action.id,
              ...(action.label ? { label: action.label } : {}),
              stepCount: action.steps.length,
              ...(action.proofStatus ? { proofStatus: action.proofStatus } : {}),
            })),
            ...(replay
              ? {
                  latestReplay: {
                    id: replay.id,
                    outcome: replay.outcome,
                    takeRevision: replay.takeRevision,
                    durationMs: Math.max(0, replay.finishedAt - replay.startedAt),
                    ...(replay.error ? { error: replay.error } : {}),
                    ...(replay.actionProofs
                      ? {
                          actionProofs: Object.fromEntries(
                            Object.entries(replay.actionProofs).map(([actionId, proof]) => [
                              actionId,
                              {
                                outcome: proof.outcome,
                                proofStatus: proof.proofStatus,
                                transition: proof.transition,
                              },
                            ]),
                          ),
                        }
                      : {}),
                  },
                }
              : {}),
            ...(take.rawCaptureVersion !== undefined && take.rawEvents !== undefined
              ? {
                  rawCapture: {
                    version: take.rawCaptureVersion,
                    eventCount: take.rawEvents.length,
                    pendingIntentCount: pendingRawIntentCount(take.rawEvents),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}

export function summarizeAuthoringOperationResult(operationId: string, result: unknown): unknown {
  if (operationId === "authoring.session.get") return result;
  if (operationId === "authoring.take.optimization.get") {
    try {
      return parseAuthoringRawOptimizationProposalResponse(result);
    } catch {
      return result;
    }
  }
  if (operationId === "authoring.session.list") {
    try {
      return {
        sessions: parseAuthoringSessionListResponse(result).sessions.map(summarizeAuthoringSession),
      };
    } catch {
      return result;
    }
  }
  if (!operationId.startsWith("authoring.")) {
    return result;
  }
  try {
    return { session: summarizeAuthoringSession(parseAuthoringSessionResponse(result).session) };
  } catch {
    return result;
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}

export function parseAuthoringSession(value: unknown): AuthoringSession {
  const input = object(value, "authoring session");
  if (input.schemaVersion !== 1) throw new TypeError("authoring session schemaVersion must be 1");
  const state = nonEmpty(input.state, "authoring session state") as AuthoringSessionState;
  if (!AUTHORING_SESSION_STATES.includes(state)) {
    throw new TypeError(`unsupported authoring session state ${state}`);
  }
  object(input.target, "authoring session target");
  return input as AuthoringSession;
}

export function parseAuthoringSessionResponse(value: unknown): AuthoringSessionResponse {
  const input = object(value, "authoring session response");
  return { session: parseAuthoringSession(input.session) };
}

export function parseAuthoringSessionListResponse(value: unknown): AuthoringSessionListResponse {
  const input = object(value, "authoring session list response");
  if (!Array.isArray(input.sessions)) throw new TypeError("sessions must be an array");
  return { sessions: input.sessions.map(parseAuthoringSession) };
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function uniqueNonEmptyStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new TypeError(`${label} must be an array of non-empty strings`);
  }
  const strings = value.map((item) => item.trim());
  if (new Set(strings).size !== strings.length) {
    throw new TypeError(`${label} must not contain duplicates`);
  }
  return strings;
}

/** Parse and project the deliberately small review payload. This is kept
 * separate from full session parsing so a future raw-event field can never
 * accidentally become part of the optimization API response. */
export function parseAuthoringRawOptimizationProposalResponse(
  value: unknown,
): AuthoringRawOptimizationProposalResponse {
  const input = object(value, "authoring raw optimization response");
  if (input.proposal === null) return { proposal: null };
  const proposal = object(input.proposal, "authoring raw optimization proposal");
  if (proposal.schemaVersion !== 1) {
    throw new TypeError("authoring raw optimization proposal schemaVersion must be 1");
  }
  if (proposal.kind !== "authoring-raw-optimization") {
    throw new TypeError("authoring raw optimization proposal kind is unsupported");
  }
  if (proposal.reviewOnly !== true) {
    throw new TypeError("authoring raw optimization proposal must be review-only");
  }
  const captureVersion = proposal.captureVersion;
  if (captureVersion !== 1 && captureVersion !== AUTHORING_RAW_CAPTURE_VERSION) {
    throw new TypeError("authoring raw optimization proposal captureVersion is unsupported");
  }
  if (!Array.isArray(proposal.suggestions)) {
    throw new TypeError("authoring raw optimization proposal suggestions must be an array");
  }
  const suggestions = proposal.suggestions.map((value, index) => {
    const suggestion = object(value, `authoring raw optimization suggestion ${index + 1}`);
    let kind: AuthoringRawOptimizationProposal["suggestions"][number]["kind"];
    if (suggestion.kind === "review-observe-only" || suggestion.kind === "review-wait") {
      kind = suggestion.kind;
    } else {
      throw new TypeError(`authoring raw optimization suggestion ${index + 1} kind is unsupported`);
    }
    const reason = nonEmpty(
      suggestion.reason,
      `authoring raw optimization suggestion ${index + 1} reason`,
    );
    if (reason.length > 480) {
      throw new TypeError(`authoring raw optimization suggestion ${index + 1} reason is too long`);
    }
    return {
      kind,
      rawEventId: nonEmpty(
        suggestion.rawEventId,
        `authoring raw optimization suggestion ${index + 1} rawEventId`,
      ),
      actionId: nonEmpty(
        suggestion.actionId,
        `authoring raw optimization suggestion ${index + 1} actionId`,
      ),
      reason,
    };
  });
  return {
    proposal: {
      schemaVersion: 1,
      kind: "authoring-raw-optimization",
      reviewOnly: true,
      takeId: nonEmpty(proposal.takeId, "authoring raw optimization proposal takeId"),
      captureVersion,
      baseRevision: nonNegativeInteger(
        proposal.baseRevision,
        "authoring raw optimization proposal baseRevision",
      ),
      sourceEventIds: uniqueNonEmptyStrings(
        proposal.sourceEventIds,
        "authoring raw optimization proposal sourceEventIds",
      ),
      suggestions,
    },
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

/** Stable wire/disk representation for signatures, snapshots, and recovery tests. */
export function serializeAuthoringSession(session: AuthoringSession): string {
  return canonicalJson(parseAuthoringSession(session));
}

export function assertAuthoringSessionRef(value: unknown): void {
  const input = object(value, "authoring session input");
  nonEmpty(input.sessionId, "sessionId");
}
