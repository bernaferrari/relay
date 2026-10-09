import { createRelayRunOutcomeJobs } from "@relay/workflows/run-outcomes";
import type {
  AppMapTestStartup,
  AuthoringTarget,
  BrowserEngine,
  SourceRevision,
} from "@relay/protocol";
import type { RelayInvokeClient } from "@relay/workflows/operation-port";
import type {
  DurableWorkflowHandle,
  RunTestSnapshot,
  WorkflowPhase,
  WorkflowProblem,
  WorkflowSnapshot,
} from "@relay/workflows/types";
import { capturedSetupRecovery, projectError, type HumanError } from "./errors.js";
import { routeUrls } from "./routes.js";

/** Product actions are intents; Relay remains the authority for whether they
 * are currently valid and for the resulting phase. */
export type ProductRunAction = "start" | "inspect" | "watch" | "cancel";

export type ProductRunRecovery = HumanError & {
  code: WorkflowProblem["code"] | "transport";
  /** Stable diagnostic identity for Audit and support surfaces. */
  sourceCode?: string;
  action?: ProductRunAction;
};

export type ProductRunStatus = "idle" | WorkflowPhase;

/** The intentionally small snapshot exposed to framework adapters. In
 * particular, compiled plans, legacy refs, frozen identity details, and raw
 * provider/job payloads never cross this boundary. */
export type ProductRunSnapshot = {
  readonly schemaVersion: 1;
  readonly kind: "run-test";
  readonly title: string;
  readonly phase: WorkflowPhase;
  readonly version: string;
  readonly workflow?: DurableWorkflowHandle;
  readonly target?: AuthoringTarget;
  readonly execution?: { readonly jobId: string; readonly runId?: string };
  readonly progress: {
    readonly label: string;
    readonly completed?: number;
    readonly total?: number;
  };
  readonly allowedNextActions: readonly ("inspect" | "cancel")[];
  readonly problems: readonly WorkflowProblem[];
  readonly evidenceRefs: readonly { readonly kind: "run"; readonly id: string }[];
};

/** A completed report is a durable Run identity plus a canonical route. It
 * carries no locally calculated verdict; `phase` is the server's outcome. */
export type ProductRunReport = {
  readonly id: string;
  readonly reportId: string;
  readonly runId: string;
  readonly title: string;
  readonly phase: Extract<WorkflowPhase, "succeeded" | "failed" | "cancelled">;
  readonly target?: AuthoringTarget;
  readonly problems: readonly WorkflowProblem[];
  readonly evidenceRefs: readonly { readonly kind: "run"; readonly id: string }[];
  readonly navigation: {
    readonly route: string;
    readonly href: string;
  };
};

export type ProductRunState = {
  readonly status: ProductRunStatus;
  /** Durable continuation identity suitable for persistence across routes. */
  readonly workflow?: DurableWorkflowHandle;
  /** Canonical execution identities; no provider payload is retained here. */
  readonly run?: { readonly jobId: string; readonly runId?: string };
  readonly snapshot?: ProductRunSnapshot;
  readonly report?: ProductRunReport;
  readonly recovery?: ProductRunRecovery;
};

/** Exact account fixture or an attested clean signed-out state. A missing
 * account is not signed-out. */
export type ProductRunAccountBinding =
  | { kind: "fixture"; accountId: string; accountRevision: string; reference?: string }
  | { kind: "signed-out"; attested: true };

export type ProductRunStartInput = {
  /** The saved Test's durable identity. */
  testId: string;
  /** Optional when exactly one App is available; Relay resolves it canonically. */
  appMapId?: string;
  /** Exact saved App Map revision acknowledged by the visible Test editor. */
  documentRevision?: number;
  /** A selected ready target. Relay rejects targets that are not runnable. */
  targetId?: string;
  /** Optional saved evidence profile; distinct from the runtime target id. */
  targetProfileId?: string;
  sourceRevision?: SourceRevision;
  startup?: AppMapTestStartup;
  /** Runtime values resolved and frozen by canonical saved Test admission. */
  variables?: Record<string, string>;
  confirmRisk?: true;
  /** Requested browser engine. Omitted only when the target is not a browser. */
  engine?: BrowserEngine;
  /** Exact authentication identity for this start. Never inferred from targetId. */
  account?: ProductRunAccountBinding;
};

export type ProductRunBuildOption = {
  id: string;
  name: string;
  platform: "android" | "ios" | "web";
  status: "uploaded" | "ready" | "failed" | "archived";
  sourceSha?: string;
};

export type ProductRunProfileOption = {
  id: string;
  name: string;
  targetId: string;
  platform: "android" | "ios" | "browser";
  account?: { id: string; name: string };
};

export type ProductRunWatchInput = {
  /** Durable workflow this watch is bound to. A selected-Run pointer is
   * navigation only; omitting this falls back to the current selection. */
  workflowId?: string;
  signal?: AbortSignal;
  onState?: (state: ProductRunState) => void;
  disconnectedRefreshMs?: number;
  reconnectMs?: number;
};

export type ProductRunCancelInput = {
  /** Durable workflow to cancel. Required for safe concurrent Runs. */
  workflowId?: string;
  expectedVersion?: number;
};

export type ProductRunJourney = {
  state(): ProductRunState;
  start(input: ProductRunStartInput): Promise<ProductRunState>;
  /** Adopt a durable workflow after navigation or renderer reload. */
  inspect(workflowId?: string): Promise<ProductRunState>;
  /** Follow server-owned progress until Relay reports a terminal phase. */
  watch(input?: ProductRunWatchInput): Promise<ProductRunState>;
  /** Cancel the named durable workflow. A selected-Run pointer is never
   * substituted for a different Run's identity. */
  cancel(input?: ProductRunCancelInput): Promise<ProductRunState>;
};

type RunJobs = {
  run: (intent: import("@relay/workflows/types").RunTestOutcomeIntent) => Promise<RunTestSnapshot>;
  inspect: (input: { workflowId: string }) => Promise<WorkflowSnapshot>;
  watchWorkflow: (input: {
    workflowId: string;
    initial: WorkflowSnapshot;
    signal?: AbortSignal;
    onSnapshot?: (snapshot: WorkflowSnapshot) => void;
    disconnectedRefreshMs?: number;
    reconnectMs?: number;
  }) => Promise<WorkflowSnapshot>;
  cancelRun: (
    input: import("@relay/workflows/types").CancelRunOutcomeIntent,
  ) => Promise<RunTestSnapshot>;
};

const MAX_STRING_CHARS = 8_192;
const MAX_PROBLEMS = 64;
const MAX_EVIDENCE_REFS = 128;

function boundedString(value: string): string {
  return value.slice(0, MAX_STRING_CHARS);
}

function copyProblem(problem: WorkflowProblem): WorkflowProblem {
  const capturedSetup = capturedSetupRecovery(problem);
  if (capturedSetup) return { code: problem.code, ...capturedSetup };
  if (problem.sourceCode === "raw-evidence-recapture-required") {
    return {
      code: problem.code,
      title: "The starting screen needs a fresh capture",
      detail: "Relay does not have enough saved screen information to run this test safely.",
      recovery: "Open the test, record its starting screen again, then save it.",
      retryable: false,
      sourceCode: problem.sourceCode,
    };
  }
  return {
    code: problem.code,
    title: boundedString(problem.title),
    detail: boundedString(problem.detail),
    recovery: boundedString(problem.recovery),
    retryable: problem.retryable,
    ...(problem.sourceCode ? { sourceCode: boundedString(problem.sourceCode) } : {}),
    ...(problem.sourceStepId ? { sourceStepId: boundedString(problem.sourceStepId) } : {}),
  };
}

function copyTarget(target: AuthoringTarget): AuthoringTarget {
  if (target.kind === "browser") {
    return { kind: "browser", platform: "browser", targetId: boundedString(target.targetId) };
  }
  return {
    kind: "device",
    platform: target.platform,
    targetId: boundedString(target.targetId),
  };
}

function copySnapshot(snapshot: RunTestSnapshot): ProductRunSnapshot {
  return {
    schemaVersion: 1,
    kind: "run-test",
    title: boundedString(snapshot.title),
    phase: snapshot.phase,
    version: boundedString(snapshot.version),
    ...(snapshot.workflow
      ? {
          workflow: {
            workflowId: boundedString(snapshot.workflow.workflowId),
            expectedVersion: snapshot.workflow.expectedVersion,
          },
        }
      : {}),
    ...(snapshot.frozen?.target ? { target: copyTarget(snapshot.frozen.target) } : {}),
    ...(snapshot.execution
      ? {
          execution: {
            jobId: boundedString(snapshot.execution.jobId),
            ...(snapshot.execution.runId ? { runId: boundedString(snapshot.execution.runId) } : {}),
          },
        }
      : {}),
    progress: {
      label: boundedString(snapshot.progress.label),
      ...(snapshot.progress.completed === undefined
        ? {}
        : { completed: snapshot.progress.completed }),
      ...(snapshot.progress.total === undefined ? {} : { total: snapshot.progress.total }),
    },
    allowedNextActions: snapshot.allowedNextActions.filter(
      (action): action is "inspect" | "cancel" => action === "inspect" || action === "cancel",
    ),
    problems: snapshot.problems.slice(-MAX_PROBLEMS).map(copyProblem),
    evidenceRefs: snapshot.evidenceRefs.slice(0, MAX_EVIDENCE_REFS).map((ref) => ({
      kind: "run" as const,
      id: boundedString(ref.id),
    })),
  };
}

function phaseStatus(snapshot: RunTestSnapshot | undefined): ProductRunStatus {
  return snapshot?.phase ?? "idle";
}

function recoveryFromProblem(
  problem: WorkflowProblem,
  action?: ProductRunAction,
): ProductRunRecovery {
  return { ...copyProblem(problem), ...(action ? { action } : {}) };
}

function recoveryFromError(error: unknown, action?: ProductRunAction): ProductRunRecovery {
  return { ...projectError(error), code: "transport", ...(action ? { action } : {}) };
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError",
  );
}

function asRunSnapshot(snapshot: WorkflowSnapshot): RunTestSnapshot {
  if (snapshot.kind !== "run-test") {
    throw new TypeError("The durable workflow is not a test run.");
  }
  return snapshot;
}

function isTerminal(phase: WorkflowPhase): phase is "succeeded" | "failed" | "cancelled" {
  return phase === "succeeded" || phase === "failed" || phase === "cancelled";
}

function reportFromSnapshot(snapshot: RunTestSnapshot): ProductRunReport | undefined {
  const runId = snapshot.execution?.runId;
  if (!runId || !isTerminal(snapshot.phase)) return undefined;
  const id = boundedString(runId);
  return {
    id,
    reportId: id,
    runId: id,
    title: boundedString(snapshot.title),
    phase: snapshot.phase,
    ...(snapshot.frozen?.target ? { target: copyTarget(snapshot.frozen.target) } : {}),
    problems: snapshot.problems.slice(-MAX_PROBLEMS).map(copyProblem),
    evidenceRefs: snapshot.evidenceRefs.slice(0, MAX_EVIDENCE_REFS).map((ref) => ({
      kind: "run" as const,
      id: boundedString(ref.id),
    })),
    navigation: {
      route: routeUrls.run(id),
      href: routeUrls.run(id),
    },
  };
}

/** Create the framework-neutral Product Run boundary over canonical
 * outcome jobs. This controller never invokes HTTP or decides an outcome. */
export function createProductRunJourney(input: { jobs: RunJobs }): ProductRunJourney {
  const jobs = input.jobs;
  const byWorkflow = new Map<string, RunTestSnapshot>();
  let selectedWorkflowId: string | undefined;
  let current: ProductRunState = { status: "idle" };

  function selectedCanonical(): RunTestSnapshot | undefined {
    return selectedWorkflowId ? byWorkflow.get(selectedWorkflowId) : undefined;
  }

  function exposedState(): ProductRunState {
    const snapshot = current.snapshot;
    return {
      status: current.status,
      ...(snapshot?.workflow ? { workflow: structuredClone(snapshot.workflow) } : {}),
      ...(snapshot?.execution ? { run: structuredClone(snapshot.execution) } : {}),
      ...(snapshot ? { snapshot: structuredClone(snapshot) } : {}),
      ...(current.report ? { report: structuredClone(current.report) } : {}),
      ...(current.recovery ? { recovery: { ...current.recovery } } : {}),
    };
  }

  function stateFromSnapshot(
    snapshot: RunTestSnapshot,
    action?: ProductRunAction,
  ): ProductRunState {
    const bounded = copySnapshot(snapshot);
    const problem = bounded.problems.at(-1);
    return {
      status: phaseStatus(snapshot),
      snapshot: bounded,
      ...(reportFromSnapshot(snapshot) ? { report: reportFromSnapshot(snapshot) } : {}),
      ...(problem ? { recovery: recoveryFromProblem(problem, action) } : {}),
    };
  }

  function expose(state: ProductRunState): ProductRunState {
    const snapshot = state.snapshot;
    return {
      status: state.status,
      ...(snapshot?.workflow ? { workflow: structuredClone(snapshot.workflow) } : {}),
      ...(snapshot?.execution ? { run: structuredClone(snapshot.execution) } : {}),
      ...(snapshot ? { snapshot: structuredClone(snapshot) } : {}),
      ...(state.report ? { report: structuredClone(state.report) } : {}),
      ...(state.recovery ? { recovery: { ...state.recovery } } : {}),
    };
  }

  function publish(
    snapshot: RunTestSnapshot,
    action?: ProductRunAction,
    options: { select?: boolean; expectedWorkflowId?: string } = {},
  ): ProductRunState {
    const workflowId = snapshot.workflow?.workflowId;
    if (options.expectedWorkflowId && workflowId !== options.expectedWorkflowId) {
      return options.expectedWorkflowId
        ? stateForWorkflow(options.expectedWorkflowId)
        : exposedState();
    }
    if (workflowId && isStaleSnapshot(snapshot, byWorkflow.get(workflowId))) {
      return stateForWorkflow(workflowId);
    }
    if (workflowId) byWorkflow.set(workflowId, snapshot);
    const next = stateFromSnapshot(snapshot, action);
    const shouldSelect = options.select === true || workflowId === selectedWorkflowId;
    if (shouldSelect && workflowId) {
      selectedWorkflowId = workflowId;
      current = next;
    }
    return expose(next);
  }

  function publishIdleRecovery(error: unknown, action: ProductRunAction): ProductRunState {
    return expose({ status: "idle", recovery: recoveryFromError(error, action) });
  }

  function publishRecovery(
    error: unknown,
    action: ProductRunAction,
    workflowId: string,
  ): ProductRunState {
    const recovery = recoveryFromError(error, action);
    if (workflowId !== selectedWorkflowId) {
      const stored = byWorkflow.get(workflowId);
      return expose({
        ...(stored ? stateFromSnapshot(stored, action) : { status: "idle" }),
        recovery,
      });
    }
    current = {
      ...current,
      recovery,
    };
    return exposedState();
  }

  function stateForWorkflow(workflowId: string): ProductRunState {
    const stored = byWorkflow.get(workflowId);
    if (!stored) {
      return { status: "idle" };
    }
    return expose(stateFromSnapshot(stored));
  }

  function isStaleSnapshot(next: RunTestSnapshot, stored: RunTestSnapshot | undefined): boolean {
    if (!stored) return false;
    const nextVersion = next.workflow?.expectedVersion;
    const storedVersion = stored.workflow?.expectedVersion;
    if (nextVersion === undefined || storedVersion === undefined) return false;
    return nextVersion < storedVersion;
  }

  async function start(input: ProductRunStartInput): Promise<ProductRunState> {
    if (!input.testId.trim()) {
      return publishIdleRecovery(
        new TypeError("Starting a run requires a saved test identifier."),
        "start",
      );
    }
    try {
      const snapshot = await jobs.run({
        kind: "run-test",
        testId: input.testId,
        ...(input.appMapId ? { appMapId: input.appMapId } : {}),
        ...(input.documentRevision !== undefined
          ? { revision: { exact: input.documentRevision } }
          : {}),
        ...(input.targetId ? { targetId: input.targetId } : {}),
        ...(input.targetProfileId ? { targetProfileId: input.targetProfileId } : {}),
        ...(input.sourceRevision ? { sourceRevision: structuredClone(input.sourceRevision) } : {}),
        ...(input.startup ? { startup: structuredClone(input.startup) } : {}),
        ...(input.variables ? { variables: { ...input.variables } } : {}),
        ...(input.engine ? { engine: input.engine } : {}),
        ...(input.account ? { account: structuredClone(input.account) } : {}),
        ...(input.confirmRisk ? { confirmRisk: true } : {}),
      });
      return publish(snapshot, "start", { select: true });
    } catch (error) {
      return publishIdleRecovery(error, "start");
    }
  }

  async function inspect(
    workflowId = selectedCanonical()?.workflow?.workflowId,
  ): Promise<ProductRunState> {
    if (!workflowId?.trim()) {
      return publishIdleRecovery(
        new TypeError("A durable run workflow identifier is required."),
        "inspect",
      );
    }
    try {
      return publish(asRunSnapshot(await jobs.inspect({ workflowId })), "inspect", {
        select: true,
        expectedWorkflowId: workflowId,
      });
    } catch (error) {
      return publishRecovery(error, "inspect", workflowId);
    }
  }

  async function watch(input: ProductRunWatchInput = {}): Promise<ProductRunState> {
    const requested = input.workflowId?.trim();
    if (!requested && !selectedCanonical()?.workflow?.workflowId) {
      const inspected = await inspect();
      if (!selectedCanonical()?.workflow?.workflowId) return inspected;
    }
    const workflowId = requested || selectedCanonical()!.workflow!.workflowId;
    let initial = byWorkflow.get(workflowId);
    if (!initial?.workflow?.workflowId) {
      const inspected = await inspect(workflowId);
      initial = byWorkflow.get(workflowId);
      if (!initial?.workflow?.workflowId) return inspected;
    }
    let notifiedVersion: string | undefined;
    try {
      const snapshot = await jobs.watchWorkflow({
        workflowId,
        initial,
        signal: input.signal,
        disconnectedRefreshMs: input.disconnectedRefreshMs,
        reconnectMs: input.reconnectMs,
        onSnapshot: (next) => {
          try {
            const run = asRunSnapshot(next);
            if (run.workflow?.workflowId !== workflowId) return;
            const state = publish(run, "watch", { expectedWorkflowId: workflowId });
            notifiedVersion = run.version;
            input.onState?.(state);
          } catch (error) {
            publishRecovery(error, "watch", workflowId);
          }
        },
      });
      const run = asRunSnapshot(snapshot);
      if (run.workflow?.workflowId !== workflowId) return stateForWorkflow(workflowId);
      const state = publish(run, "watch", { expectedWorkflowId: workflowId });
      if (run.version !== notifiedVersion) input.onState?.(state);
      return state;
    } catch (error) {
      if (isAbortError(error)) return stateForWorkflow(workflowId);
      return publishRecovery(error, "watch", workflowId);
    }
  }

  async function cancel(input: ProductRunCancelInput = {}): Promise<ProductRunState> {
    const workflowId = input.workflowId?.trim() || selectedCanonical()?.workflow?.workflowId;
    if (!workflowId) {
      return publishIdleRecovery(new TypeError("No durable run is selected."), "cancel");
    }
    const stored = byWorkflow.get(workflowId);
    const expectedVersion = input.expectedVersion ?? stored?.workflow?.expectedVersion;
    if (expectedVersion === undefined) {
      return publishRecovery(
        new TypeError("Cancel requires the durable workflow version for this run."),
        "cancel",
        workflowId,
      );
    }
    try {
      return publish(
        await jobs.cancelRun({
          kind: "cancel-run",
          workflowId,
          expectedVersion,
          confirmCancel: true,
        }),
        "cancel",
        { select: true, expectedWorkflowId: workflowId },
      );
    } catch (error) {
      return publishRecovery(error, "cancel", workflowId);
    }
  }

  return { state: exposedState, start, inspect, watch, cancel } satisfies ProductRunJourney;
}

/** Convenience constructor for adapters that own a Relay client. */
export function createProductRunJourneyFromClient(input: {
  client: RelayInvokeClient;
  actorId: string;
}): ProductRunJourney {
  return createProductRunJourney({
    jobs: createRelayRunOutcomeJobs(input.client, { actorId: input.actorId }),
  });
}
