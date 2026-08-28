import { createSignal } from "solid-js";
import type { AuthoringInteraction, AuthoringRecordingEdit } from "@relay/protocol";
import type {
  AuthorTestDecision,
  AuthorTestIntent,
  AuthorTestSnapshot,
  DurableAuthorTestDecision,
  DurableWorkflowHandle,
  RelayWorkflows,
  WorkflowProblem,
} from "@relay/workflows";
import { createRelayWorkflows, type RelayInvokeClient } from "@relay/workflows";
import { goldenLoopTelemetry } from "./golden-loop-telemetry";

export type AuthorTestWorkflowAction =
  | {
      action: "record";
      interaction: Extract<AuthorTestDecision, { action: "record" }>["interaction"];
    }
  | { action: "checkpoint"; label?: string }
  | { action: "stop" }
  | { action: "edit"; edit: AuthoringRecordingEdit }
  | { action: "replay" }
  | {
      action: "approve";
      destination?: Extract<AuthorTestDecision, { action: "approve" }>["destination"];
    }
  | { action: "discard" }
  | { action: "cancel" }
  | { action: "abandon"; reason: string };

type AbandonUnprovenStartAction = Extract<AuthorTestWorkflowAction, { action: "abandon" }>;

function telemetryJourneyKey(snapshot: AuthorTestSnapshot, fallback: string): string {
  if (snapshot.authoring?.committedTestId) return snapshot.authoring.committedTestId;
  if (snapshot.authoring?.sessionId) return `test-${snapshot.authoring.sessionId}`;
  return fallback;
}

export function canRetireUnprovenRecording(snapshot: AuthorTestSnapshot | undefined): boolean {
  return Boolean(
    snapshot?.workflow &&
    snapshot.phase === "needs-attention" &&
    !snapshot.authoring?.sessionId &&
    snapshot.allowedNextActions.includes("abandon"),
  );
}

/**
 * Keeps the opaque workflow reference out of the recorder UI. Every decision
 * first inspects canonical state and then performs at most one mutation.
 */
export function createAuthorTestWorkflowCoordinator(input: {
  workflows: RelayWorkflows;
  onSnapshot: (snapshot: AuthorTestSnapshot) => Promise<void> | void;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}) {
  type AttentionMarker = { problem: WorkflowProblem };
  const handles = new Map<string, DurableWorkflowHandle>();
  const attentionMarkers = new Map<string, AttentionMarker>();
  const sessionQueues = new Map<string, Promise<void>>();
  let storage = input.storage;
  if (!storage) {
    try {
      storage = globalThis.sessionStorage;
    } catch {
      storage = undefined;
    }
  }
  const storageKey = (sessionId: string) => `relay:author-test-workflow:v2:${sessionId}`;
  const workflowScopeKey = (snapshot: AuthorTestSnapshot) =>
    snapshot.frozen?.workflowRequestId
      ? `relay:author-test-workflow-scope:v2:${snapshot.frozen.workflowRequestId}`
      : undefined;
  const attentionKey = (sessionId: string) => `relay:author-test-attention:v1:${sessionId}`;
  const scopeKey = (snapshot: AuthorTestSnapshot) => {
    const frozen = snapshot.frozen;
    return frozen
      ? `relay:author-test-attention-scope:v1:${frozen.appMapId}:${frozen.target.kind}:${frozen.target.targetId}`
      : undefined;
  };
  function readMarker(snapshot: AuthorTestSnapshot): AttentionMarker | undefined {
    const keys = [
      ...(snapshot.authoring?.sessionId ? [attentionKey(snapshot.authoring.sessionId)] : []),
      ...(scopeKey(snapshot) ? [scopeKey(snapshot)!] : []),
    ];
    for (const key of keys) {
      const active = attentionMarkers.get(key);
      if (active) return active;
      try {
        const value = storage?.getItem(key);
        if (value) return JSON.parse(value) as AttentionMarker;
      } catch {
        // Malformed or unavailable renderer storage cannot become canonical
        // recording truth. The server recovery read remains authoritative.
      }
    }
    return undefined;
  }

  function storeAttention(snapshot: AuthorTestSnapshot): void {
    if (snapshot.phase !== "needs-attention") return;
    const problem = snapshot.problems.at(-1);
    if (!problem) return;
    const key = snapshot.authoring?.sessionId
      ? attentionKey(snapshot.authoring.sessionId)
      : scopeKey(snapshot);
    try {
      if (key) {
        const marker = { problem } satisfies AttentionMarker;
        attentionMarkers.set(key, marker);
        storage?.setItem(key, JSON.stringify(marker));
      }
    } catch {
      // The in-memory snapshot still fails closed for this renderer lifetime.
    }
  }

  function clearAttention(snapshot: AuthorTestSnapshot): void {
    const keys = [
      ...(snapshot.authoring?.sessionId ? [attentionKey(snapshot.authoring.sessionId)] : []),
      ...(scopeKey(snapshot) ? [scopeKey(snapshot)!] : []),
    ];
    for (const key of keys) {
      attentionMarkers.delete(key);
      try {
        storage?.removeItem(key);
      } catch {
        // A denied cleanup only leaves the workflow conservatively blocked.
      }
    }
  }

  function applyStoredAttention(snapshot: AuthorTestSnapshot): AuthorTestSnapshot {
    const marker = readMarker(snapshot);
    return marker
      ? {
          ...snapshot,
          phase: "needs-attention",
          progress: { label: "The mutation outcome needs inspection" },
          allowedNextActions: ["inspect"],
          problems: [...snapshot.problems, marker.problem],
        }
      : snapshot;
  }

  async function queued<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    const before = sessionQueues.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = before.then(() => current);
    sessionQueues.set(sessionId, tail);
    await before;
    try {
      return await run();
    } finally {
      release();
      if (sessionQueues.get(sessionId) === tail) sessionQueues.delete(sessionId);
    }
  }

  function remember(snapshot: AuthorTestSnapshot, handle: DurableWorkflowHandle): void {
    const keys = [
      ...(snapshot.authoring?.sessionId ? [storageKey(snapshot.authoring.sessionId)] : []),
      ...(workflowScopeKey(snapshot) ? [workflowScopeKey(snapshot)!] : []),
    ];
    if (snapshot.authoring?.sessionId) handles.set(snapshot.authoring.sessionId, handle);
    try {
      for (const key of keys) storage?.setItem(key, JSON.stringify(handle));
    } catch {
      // A private window can deny session storage. The in-memory reference is
      // still sufficient for the current authoring session.
    }
  }

  function handleFor(sessionId: string): DurableWorkflowHandle | undefined {
    const active = handles.get(sessionId);
    if (active) return active;
    try {
      const restored = storage?.getItem(storageKey(sessionId));
      if (!restored) return undefined;
      const parsed = JSON.parse(restored) as Partial<DurableWorkflowHandle>;
      if (
        typeof parsed.workflowId !== "string" ||
        !parsed.workflowId ||
        !Number.isSafeInteger(parsed.expectedVersion) ||
        parsed.expectedVersion! < 1
      ) {
        return undefined;
      }
      const handle = {
        workflowId: parsed.workflowId,
        expectedVersion: parsed.expectedVersion!,
      };
      handles.set(sessionId, handle);
      return handle;
    } catch {
      return undefined;
    }
  }

  function scopedHandle(snapshot: AuthorTestSnapshot): DurableWorkflowHandle | undefined {
    const key = workflowScopeKey(snapshot);
    if (!key) return undefined;
    try {
      const restored = storage?.getItem(key);
      if (!restored) return undefined;
      const parsed = JSON.parse(restored) as Partial<DurableWorkflowHandle>;
      return typeof parsed.workflowId === "string" &&
        parsed.workflowId &&
        Number.isSafeInteger(parsed.expectedVersion) &&
        parsed.expectedVersion! >= 1
        ? { workflowId: parsed.workflowId, expectedVersion: parsed.expectedVersion! }
        : undefined;
    } catch {
      return undefined;
    }
  }

  async function publish(
    snapshot: AuthorTestSnapshot,
    options: { acknowledgeAttention?: boolean } = {},
  ): Promise<AuthorTestSnapshot> {
    if (snapshot.workflow) remember(snapshot, snapshot.workflow);
    if (options.acknowledgeAttention && snapshot.phase !== "needs-attention") {
      clearAttention(snapshot);
    } else {
      storeAttention(snapshot);
    }
    await input.onSnapshot(snapshot);
    return snapshot;
  }

  async function start(intent: AuthorTestIntent): Promise<AuthorTestSnapshot> {
    const startedAt = Date.now();
    const workflowRequestId = intent.workflowRequestId ?? crypto.randomUUID();
    const snapshot = await input.workflows.start({
      ...intent,
      workflowRequestId,
      continuation: "durable",
    });
    const journeyKey = telemetryJourneyKey(snapshot, workflowRequestId);
    for (const boundary of ["connect", "record"] as const) {
      void goldenLoopTelemetry.emit({
        projectKey: intent.appMapId,
        journeyKey,
        type: "boundary",
        boundary,
        outcome: boundary === "connect" ? "completed" : "started",
      });
    }
    void goldenLoopTelemetry.emit({
      projectKey: intent.appMapId,
      journeyKey,
      type: "action-latency",
      action: "record",
      durationMs: Math.max(0, Date.now() - startedAt),
    });
    if (snapshot.stage === "recording") {
      void goldenLoopTelemetry.emit({
        projectKey: intent.appMapId,
        journeyKey,
        type: "boundary",
        boundary: "record",
        outcome: "completed",
      });
    }
    if (snapshot.phase !== "needs-attention") clearAttention(snapshot);
    return publish(snapshot);
  }

  async function readCanonical(sessionId: string): Promise<AuthorTestSnapshot | undefined> {
    const handle = handleFor(sessionId);
    if (handle) {
      const inspected = await input.workflows.inspectAuthoring(handle.workflowId);
      if (inspected.kind === "author-test") return inspected;
      handles.delete(sessionId);
      try {
        storage?.removeItem(storageKey(sessionId));
      } catch {
        // Recovery below still reads canonical state directly.
      }
    }
    const recovered = await input.workflows.recover({ kind: "author-test", sessionId });
    const recoveredHandle = scopedHandle(recovered);
    if (!recoveredHandle) return recovered;
    const inspected = await input.workflows.inspectAuthoring(recoveredHandle.workflowId);
    return inspected.kind === "author-test" ? inspected : recovered;
  }

  async function hydrate(sessionId: string): Promise<AuthorTestSnapshot | undefined> {
    const snapshot = await readCanonical(sessionId);
    return snapshot ? publish(applyStoredAttention(snapshot)) : undefined;
  }

  async function inspect(sessionId: string): Promise<AuthorTestSnapshot | undefined> {
    return queued(sessionId, async () => {
      const snapshot = await readCanonical(sessionId);
      return snapshot ? publish(snapshot, { acknowledgeAttention: true }) : undefined;
    });
  }

  async function inspectDurable(snapshot: AuthorTestSnapshot): Promise<AuthorTestSnapshot> {
    if (!snapshot.workflow) throw new Error("This recording attempt cannot be inspected safely");
    return queued(snapshot.workflow.workflowId, async () =>
      publish(await input.workflows.inspectAuthoring(snapshot.workflow!.workflowId), {
        acknowledgeAttention: true,
      }),
    );
  }

  async function advance(
    sessionId: string,
    action: AuthorTestWorkflowAction,
  ): Promise<AuthorTestSnapshot | undefined> {
    return queued(sessionId, async () => {
      const canonical = await readCanonical(sessionId);
      const current = canonical ? await publish(applyStoredAttention(canonical)) : undefined;
      if (
        !current?.workflow ||
        current.version === "unavailable" ||
        current.phase === "needs-attention"
      ) {
        return current;
      }
      if (!current.allowedNextActions.includes(action.action)) {
        return publish({
          ...current,
          problems: [
            ...current.problems,
            {
              code: "unexpected-authoring-state",
              title: "This recording is not ready for that decision",
              detail: `${action.action} is not allowed while the canonical session is ${current.stage}.`,
              recovery: "Choose an action listed by the latest recording snapshot.",
              retryable: false,
            },
          ],
        });
      }
      const decision = {
        ...action,
        workflowId: current.workflow.workflowId,
        expectedVersion: current.workflow.expectedVersion,
      } as DurableAuthorTestDecision;
      const startedAt = Date.now();
      const next = await publish(await input.workflows.advanceAuthoring(decision));
      const projectKey = next.frozen?.appMapId ?? current.frozen?.appMapId;
      const journeyKey = telemetryJourneyKey(
        next,
        next.frozen?.workflowRequestId ?? current.frozen?.workflowRequestId ?? sessionId,
      );
      if (projectKey && journeyKey) {
        const boundary =
          action.action === "checkpoint"
            ? "checkpoint"
            : action.action === "replay"
              ? "replay"
              : action.action === "approve"
                ? "approve"
                : undefined;
        const latencyAction =
          action.action === "edit"
            ? "edit-recording"
            : action.action === "stop"
              ? "compile"
              : boundary;
        if (latencyAction) {
          void goldenLoopTelemetry.emit({
            projectKey,
            journeyKey,
            type: "action-latency",
            action: latencyAction,
            durationMs: Math.max(0, Date.now() - startedAt),
          });
        }
        if (boundary && next.phase !== "needs-attention") {
          void goldenLoopTelemetry.emit({
            projectKey,
            journeyKey,
            type: "boundary",
            boundary,
            outcome: "completed",
          });
        }
        if (action.action === "stop" && next.stage === "reviewing") {
          for (const completed of ["compile", "review"] as const) {
            void goldenLoopTelemetry.emit({
              projectKey,
              journeyKey,
              type: "boundary",
              boundary: completed,
              outcome: "completed",
            });
          }
        }
        if (["cancel", "discard"].includes(action.action)) {
          void goldenLoopTelemetry.emit({
            projectKey,
            journeyKey,
            type: "boundary",
            boundary: action.action === "cancel" ? "record" : "review",
            outcome: "abandoned",
          });
        }
      }
      return next;
    });
  }

  async function proved(
    sessionId: string,
    action: AuthorTestWorkflowAction,
  ): Promise<AuthorTestSnapshot> {
    const snapshot = await advance(sessionId, action);
    const problem = snapshot?.problems.at(-1);
    const proofFailure = snapshot?.problems.find((candidate) =>
      [
        "mutation-outcome-unknown",
        "stale-workflow-version",
        "unexpected-authoring-state",
        "malformed-response",
        "invalid-workflow-ref",
      ].includes(candidate.code),
    );
    if (!snapshot || snapshot.phase === "needs-attention" || proofFailure) {
      throw new Error(
        proofFailure?.detail || problem?.detail || "Relay could not prove the authoring change",
      );
    }
    return snapshot;
  }

  async function retireUnprovenRecording(
    snapshot: AuthorTestSnapshot,
    action: AbandonUnprovenStartAction,
  ): Promise<AuthorTestSnapshot> {
    if (!canRetireUnprovenRecording(snapshot) || !snapshot.workflow) {
      throw new Error("This recording attempt can still be inspected or continued safely");
    }
    return queued(snapshot.workflow.workflowId, async () => {
      const canonical = await publish(
        await input.workflows.inspectAuthoring(snapshot.workflow!.workflowId),
        { acknowledgeAttention: true },
      );
      if (!canRetireUnprovenRecording(canonical) || !canonical.workflow) {
        throw new Error("This recording attempt can still be inspected or continued safely");
      }
      const workflowId = canonical.workflow.workflowId;
      const decision: DurableAuthorTestDecision = {
        ...action,
        workflowId,
        expectedVersion: canonical.workflow.expectedVersion,
      };
      const retired = await publish(await input.workflows.advanceAuthoring(decision));
      if (retired.stage !== "cancelled" || retired.phase !== "cancelled") {
        throw new Error(
          retired.problems.at(-1)?.detail || "Relay could not retire this recording attempt",
        );
      }
      if (retired.frozen) {
        void goldenLoopTelemetry.emit({
          projectKey: retired.frozen.appMapId,
          journeyKey: telemetryJourneyKey(retired, retired.frozen.workflowRequestId ?? workflowId),
          type: "boundary",
          boundary: "record",
          outcome: "abandoned",
        });
      }
      return retired;
    });
  }

  return {
    start,
    hydrate,
    inspect,
    inspectDurable,
    advance,
    proved,
    retireUnprovenRecording,
    record: (sessionId: string, interaction: AuthoringInteraction) =>
      proved(sessionId, { action: "record", interaction }),
    hasSession: (sessionId: string) => Boolean(handleFor(sessionId)),
  };
}

/** Bind the app's canonical transport and refresh projections in one place so
 * RecorderProvider consumes the workflow without re-implementing its state. */
export function createAuthorTestWorkflowBoundary(input: {
  client: RelayInvokeClient;
  refreshAuthoringSessions: () => Promise<unknown>;
  refreshAppMaps: () => Promise<unknown>;
}) {
  const [snapshot, setSnapshot] = createSignal<AuthorTestSnapshot>();
  const workflow = createAuthorTestWorkflowCoordinator({
    workflows: createRelayWorkflows(input.client),
    onSnapshot: async (next) => {
      setSnapshot(next);
      if (next.authoring?.sessionId && next.phase !== "needs-attention") {
        await input.refreshAuthoringSessions();
      }
      if (next.stage === "committed") await input.refreshAppMaps();
    },
  });
  return { workflow, snapshot };
}
