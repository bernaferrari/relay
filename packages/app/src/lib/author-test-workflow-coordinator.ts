import { createSignal } from "solid-js";
import type { AuthoringInteraction, AuthoringRecordingEdit } from "@relay/protocol";
import type {
  AuthorTestDecision,
  AuthorTestIntent,
  AuthorTestSnapshot,
  RelayWorkflows,
  WorkflowRef,
  WorkflowProblem,
} from "@relay/workflows";
import { createRelayWorkflows, type RelayInvokeClient } from "@relay/workflows";

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
  | { action: "cancel" };

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
  const references = new Map<string, WorkflowRef>();
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
  const storageKey = (sessionId: string) => `relay:author-test-workflow:v1:${sessionId}`;
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

  function remember(sessionId: string, ref: WorkflowRef): void {
    references.set(sessionId, ref);
    try {
      storage?.setItem(storageKey(sessionId), ref);
    } catch {
      // A private window can deny session storage. The in-memory reference is
      // still sufficient for the current authoring session.
    }
  }

  function referenceFor(sessionId: string): WorkflowRef | undefined {
    const active = references.get(sessionId);
    if (active) return active;
    try {
      const restored = storage?.getItem(storageKey(sessionId));
      if (!restored) return undefined;
      const ref = restored as WorkflowRef;
      references.set(sessionId, ref);
      return ref;
    } catch {
      return undefined;
    }
  }

  async function publish(
    snapshot: AuthorTestSnapshot,
    options: { acknowledgeAttention?: boolean } = {},
  ): Promise<AuthorTestSnapshot> {
    const sessionId = snapshot.authoring?.sessionId;
    if (sessionId && snapshot.ref) remember(sessionId, snapshot.ref);
    if (options.acknowledgeAttention && snapshot.phase !== "needs-attention") {
      clearAttention(snapshot);
    } else {
      storeAttention(snapshot);
    }
    await input.onSnapshot(snapshot);
    return snapshot;
  }

  async function start(intent: AuthorTestIntent): Promise<AuthorTestSnapshot> {
    const snapshot = await input.workflows.start(intent);
    if (snapshot.phase !== "needs-attention") clearAttention(snapshot);
    return publish(snapshot);
  }

  async function readCanonical(sessionId: string): Promise<AuthorTestSnapshot | undefined> {
    const ref = referenceFor(sessionId);
    if (ref) {
      const inspected = await input.workflows.inspect(ref);
      if (inspected.kind === "author-test") return inspected;
      references.delete(sessionId);
      try {
        storage?.removeItem(storageKey(sessionId));
      } catch {
        // Recovery below still reads canonical state directly.
      }
    }
    return input.workflows.recover({ kind: "author-test", sessionId });
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

  async function advance(
    sessionId: string,
    action: AuthorTestWorkflowAction,
  ): Promise<AuthorTestSnapshot | undefined> {
    return queued(sessionId, async () => {
      const canonical = await readCanonical(sessionId);
      const current = canonical ? await publish(applyStoredAttention(canonical)) : undefined;
      if (
        !current?.ref ||
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
        ref: current.ref,
        expectedVersion: current.version,
      } as AuthorTestDecision;
      const snapshot = await input.workflows.advance(decision);
      return snapshot.kind === "author-test" ? publish(snapshot) : undefined;
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

  return {
    start,
    hydrate,
    inspect,
    advance,
    proved,
    record: (sessionId: string, interaction: AuthoringInteraction) =>
      proved(sessionId, { action: "record", interaction }),
    hasSession: (sessionId: string) => Boolean(referenceFor(sessionId)),
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
