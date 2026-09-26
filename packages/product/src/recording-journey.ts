import type {
  AuthoringCommitDestination,
  AuthoringInteraction,
  AuthoringRecordingEdit,
  AuthoringTarget,
} from "@relay/protocol";
import { createRelayRecordingOutcomeJobs } from "@relay/workflows/recording-outcomes";
import {
  type AuthorTestSnapshot,
  type DurableAuthorTestDecision,
  type RecordingPathContext,
  type RelayOutcomeJobs,
  type WorkflowProblem,
} from "@relay/workflows/types";
import type { RelayInvokeClient } from "@relay/workflows/operation-port";
import { projectError, type HumanError } from "./errors.js";

/** Actions exposed by the Product recording journey.
 *
 * The server remains the authority for which action is currently valid. This
 * type only describes the small set of user intents needed by the recording
 * surface; it does not describe a second workflow state machine.
 */
export type ProductRecordingAction =
  | { action: "record"; interaction: AuthoringInteraction }
  | { action: "checkpoint"; label?: string }
  | { action: "stop" }
  | { action: "cancel" }
  | { action: "edit"; edit: AuthoringRecordingEdit }
  | { action: "replay" }
  | { action: "approve"; testName?: string; destination?: AuthoringCommitDestination };

export type ProductRecordingRecovery = HumanError & {
  code: WorkflowProblem["code"] | "transport";
  action?: ProductRecordingAction["action"];
};

export type ProductRecordingStatus =
  | "idle"
  | "target-selection"
  | "recording"
  | "reviewing"
  | "saved"
  | "needs-attention";

/** Bounded state for a framework adapter. No AuthoringSession or frame data is
 * exposed here; the workflow package supplies the safe reviewed projection. */
export type ProductRecordingState = {
  readonly status: ProductRecordingStatus;
  readonly targets: readonly AuthoringTarget[];
  readonly selectedTarget?: AuthoringTarget;
  readonly snapshot?: AuthorTestSnapshot;
  readonly recovery?: ProductRecordingRecovery;
};

export type ProductRecordingBeginInput = RecordingPathContext & {
  title: string;
  appMapId?: string;
  targetId?: string;
  originApplication?: string;
  /** Saved browser login to record as. */
  authenticationFixtureId?: string;
};

export type ProductRecordingJourney = {
  state(): ProductRecordingState;
  connect(input?: { targetId?: string }): Promise<ProductRecordingState>;
  begin(input: ProductRecordingBeginInput): Promise<ProductRecordingState>;
  /** Adopt and inspect a durable workflow after reload. */
  inspect(workflowId?: string): Promise<ProductRecordingState>;
  transition(action: ProductRecordingAction): Promise<ProductRecordingState>;
  record(interaction: AuthoringInteraction): Promise<ProductRecordingState>;
  checkpoint(label?: string): Promise<ProductRecordingState>;
  stop(): Promise<ProductRecordingState>;
  edit(edit: AuthoringRecordingEdit): Promise<ProductRecordingState>;
  /** Public journey name for the server's authoring-stop transition. */
  compileReview(): Promise<ProductRecordingState>;
  replay(): Promise<ProductRecordingState>;
  approve(
    testName?: string,
    destination?: AuthoringCommitDestination,
  ): Promise<ProductRecordingState>;
  /** Public journey name for the server's authoring-approve transition. */
  commit(
    testName?: string,
    destination?: AuthoringCommitDestination,
  ): Promise<ProductRecordingState>;
};

type RecordingJobs = Pick<RelayOutcomeJobs, "connect" | "record" | "inspect" | "advanceRecording">;

function copySnapshot(snapshot: AuthorTestSnapshot | undefined): AuthorTestSnapshot | undefined {
  if (snapshot === undefined) return undefined;
  // Pick the documented workflow projection explicitly. A permissive adapter
  // must not accidentally expose a raw AuthoringSession or provider payload
  // added to a transport response in the future.
  return structuredClone({
    schemaVersion: snapshot.schemaVersion,
    kind: snapshot.kind,
    title: snapshot.title,
    phase: snapshot.phase,
    stage: snapshot.stage,
    version: snapshot.version,
    ...(snapshot.workflow ? { workflow: snapshot.workflow } : {}),
    ...(snapshot.ref ? { ref: snapshot.ref } : {}),
    ...(snapshot.frozen ? { frozen: snapshot.frozen } : {}),
    ...(snapshot.authoring ? { authoring: snapshot.authoring } : {}),
    ...(snapshot.capture ? { capture: snapshot.capture } : {}),
    ...(snapshot.review ? { review: snapshot.review } : {}),
    progress: snapshot.progress,
    allowedNextActions: snapshot.allowedNextActions,
    problems: snapshot.problems,
    evidenceRefs: snapshot.evidenceRefs,
  });
}

function statusFor(
  snapshot: AuthorTestSnapshot | undefined,
  selectedTarget: boolean,
): ProductRecordingStatus {
  if (!snapshot) return selectedTarget ? "target-selection" : "idle";
  if (snapshot.phase === "needs-attention") return "needs-attention";
  if (snapshot.stage === "committed") return "saved";
  if (snapshot.stage === "reviewing") return "reviewing";
  if (
    snapshot.stage === "recording" ||
    snapshot.stage === "preparing" ||
    snapshot.stage === "ready" ||
    snapshot.stage === "committing"
  ) {
    return "recording";
  }
  return "needs-attention";
}

function recoveryFromProblem(
  problem: WorkflowProblem,
  action?: ProductRecordingAction["action"],
): ProductRecordingRecovery {
  return { ...problem, ...(action ? { action } : {}) };
}

function recoveryFromError(
  error: unknown,
  action?: ProductRecordingAction["action"],
): ProductRecordingRecovery {
  return { ...projectError(error), code: "transport", ...(action ? { action } : {}) };
}

function recoveryFromSnapshot(
  snapshot: AuthorTestSnapshot,
  action?: ProductRecordingAction["action"],
): ProductRecordingRecovery | undefined {
  const problem = snapshot.problems.at(-1);
  return problem ? recoveryFromProblem(problem, action) : undefined;
}

function unexpectedAction(
  snapshot: AuthorTestSnapshot,
  action: ProductRecordingAction["action"],
): ProductRecordingRecovery {
  return {
    code: "unexpected-authoring-state",
    title: "This recording is not ready for that action",
    detail: `${action} is not allowed while the recording is ${snapshot.stage}.`,
    recovery: "Choose an action listed by the latest recording state.",
    retryable: false,
    action,
  };
}

function asAuthorTest(
  snapshot: Awaited<ReturnType<RelayOutcomeJobs["inspect"]>>,
): AuthorTestSnapshot {
  if (snapshot.kind !== "author-test") {
    throw new TypeError("The durable workflow is not an author-test recording.");
  }
  return snapshot;
}

function decisionFor(
  snapshot: AuthorTestSnapshot,
  action: ProductRecordingAction,
): DurableAuthorTestDecision {
  if (!snapshot.workflow) throw new TypeError("The recording has no durable workflow handle.");
  return {
    workflowId: snapshot.workflow.workflowId,
    expectedVersion: snapshot.workflow.expectedVersion,
    ...action,
  } as DurableAuthorTestDecision;
}

/**
 * Create the framework-neutral recording boundary used by Product V2.
 * `jobs` is deliberately the existing outcome-job seam: this controller never
 * constructs HTTP requests or decides server-side workflow transitions.
 */
export function createProductRecordingJourney(input: {
  jobs: RecordingJobs;
}): ProductRecordingJourney {
  const jobs = input.jobs;
  let current: ProductRecordingState = {
    status: "idle",
    targets: [],
  };

  function exposedState(): ProductRecordingState {
    return {
      status: current.status,
      targets: current.targets.map((target) => ({ ...target })),
      ...(current.selectedTarget ? { selectedTarget: { ...current.selectedTarget } } : {}),
      ...(current.snapshot ? { snapshot: copySnapshot(current.snapshot) } : {}),
      ...(current.recovery ? { recovery: { ...current.recovery } } : {}),
    };
  }

  function publish(input: {
    targets?: readonly AuthoringTarget[];
    selectedTarget?: AuthoringTarget;
    clearSelectedTarget?: boolean;
    snapshot?: AuthorTestSnapshot;
    recovery?: ProductRecordingRecovery;
  }): ProductRecordingState {
    const targets = input.targets ?? current.targets;
    const selectedTarget = input.clearSelectedTarget
      ? undefined
      : (input.selectedTarget ?? current.selectedTarget);
    current = {
      status: statusFor(input.snapshot ?? current.snapshot, Boolean(selectedTarget)),
      targets: targets.map((target) => ({ ...target })),
      ...(selectedTarget ? { selectedTarget: { ...selectedTarget } } : {}),
      ...(input.snapshot !== undefined
        ? { snapshot: copySnapshot(input.snapshot) }
        : current.snapshot
          ? { snapshot: copySnapshot(current.snapshot) }
          : {}),
      ...(input.recovery ? { recovery: { ...input.recovery } } : {}),
    };
    return exposedState();
  }

  function publishSnapshot(
    snapshot: AuthorTestSnapshot,
    action?: ProductRecordingAction["action"],
  ): ProductRecordingState {
    const recovery = recoveryFromSnapshot(snapshot, action);
    return publish({
      snapshot,
      ...(snapshot.frozen?.target ? { selectedTarget: snapshot.frozen.target } : {}),
      ...(recovery ? { recovery } : {}),
    });
  }

  async function connect(input: { targetId?: string } = {}): Promise<ProductRecordingState> {
    try {
      const result = await jobs.connect({ kind: "connect-target", ...input });
      return publish({
        targets: result.targets,
        ...(result.current ? { selectedTarget: result.current } : {}),
        ...(!result.current ? { clearSelectedTarget: true } : {}),
      });
    } catch (error) {
      return publish({ recovery: recoveryFromError(error) });
    }
  }

  async function begin(input: ProductRecordingBeginInput): Promise<ProductRecordingState> {
    try {
      const snapshot = await jobs.record({
        kind: "record-test",
        title: input.title,
        ...(input.appMapId ? { appMapId: input.appMapId } : {}),
        ...((input.targetId ?? current.selectedTarget?.targetId)
          ? { targetId: input.targetId ?? current.selectedTarget?.targetId }
          : {}),
        ...(input.originApplication?.trim()
          ? { originApplication: input.originApplication.trim() }
          : {}),
        ...(input.authenticationFixtureId?.trim()
          ? { authenticationFixtureId: input.authenticationFixtureId.trim() }
          : {}),
        ...(input.sourceScreenId ? { sourceScreenId: input.sourceScreenId } : {}),
        ...(input.pendingConnectionId ? { pendingConnectionId: input.pendingConnectionId } : {}),
        ...(input.group ? { group: input.group } : {}),
        confirmControl: true,
      });
      return publishSnapshot(snapshot);
    } catch (error) {
      return publish({ recovery: recoveryFromError(error) });
    }
  }

  async function inspect(
    workflowId = current.snapshot?.workflow?.workflowId,
  ): Promise<ProductRecordingState> {
    if (!workflowId?.trim()) {
      return publish({
        recovery: {
          code: "invalid-intent",
          title: "The recording cannot be restored yet",
          detail: "A durable recording workflow identifier is required.",
          recovery:
            "Start a recording or restore its saved workflow identifier, then inspect again.",
          retryable: false,
        },
      });
    }
    try {
      return publishSnapshot(asAuthorTest(await jobs.inspect({ workflowId })));
    } catch (error) {
      return publish({ recovery: recoveryFromError(error) });
    }
  }

  async function transition(action: ProductRecordingAction): Promise<ProductRecordingState> {
    const workflowId = current.snapshot?.workflow?.workflowId;
    if (!workflowId) {
      return publish({
        recovery: recoveryFromError(new Error("No durable recording is selected."), action.action),
      });
    }

    // A fresh canonical read is intentional. The local projection is never
    // treated as authority for allowed actions or for the CAS version.
    let snapshot: AuthorTestSnapshot;
    try {
      snapshot = asAuthorTest(await jobs.inspect({ workflowId }));
    } catch (error) {
      return publish({ recovery: recoveryFromError(error, action.action) });
    }
    publishSnapshot(snapshot, action.action);
    if (!snapshot.allowedNextActions.includes(action.action)) {
      return publish({ recovery: unexpectedAction(snapshot, action.action) });
    }
    try {
      return publishSnapshot(
        await jobs.advanceRecording(decisionFor(snapshot, action)),
        action.action,
      );
    } catch (error) {
      return publish({ recovery: recoveryFromError(error, action.action) });
    }
  }

  return {
    state: exposedState,
    connect,
    begin,
    inspect,
    transition,
    record: (interaction) => transition({ action: "record", interaction }),
    checkpoint: (label) => transition({ action: "checkpoint", ...(label ? { label } : {}) }),
    stop: () => transition({ action: "stop" }),
    edit: (edit) => transition({ action: "edit", edit }),
    compileReview: () => transition({ action: "stop" }),
    replay: () => transition({ action: "replay" }),
    approve: (testName, destination) =>
      transition({
        action: "approve",
        ...(testName?.trim() ? { testName: testName.trim() } : {}),
        ...(destination ? { destination } : {}),
      }),
    commit: (testName, destination) =>
      transition({
        action: "approve",
        ...(testName?.trim() ? { testName: testName.trim() } : {}),
        ...(destination ? { destination } : {}),
      }),
  } satisfies ProductRecordingJourney;
}

/** Convenience constructor for framework adapters that own a Relay client. */
export function createProductRecordingJourneyFromClient(input: {
  client: RelayInvokeClient;
  actorId: string;
}): ProductRecordingJourney {
  return createProductRecordingJourney({
    jobs: createRelayRecordingOutcomeJobs(input.client, { actorId: input.actorId }),
  });
}
