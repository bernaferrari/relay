/**
 * Deterministic per-target supervision policy.
 *
 * The module never touches a target. Callers persist checkpoints, feed facts
 * through `transition`, and execute only the returned read/recovery effects.
 * There is deliberately no input-dispatch effect: an uncertain mutation can
 * only be reconciled from a new observation, never retried by this machine.
 */
import type {
  TargetKind,
  TargetRecoveryChannel,
  TargetRecoveryStage,
  TargetSupervisorEventCode,
  TargetSupervisorHealth,
  TargetSupervisorRecoveryEvent,
} from "@relay/protocol";
import {
  deriveTargetSupervisorOverall,
  deriveTargetSupervisorReadiness,
  initialTargetSupervisorCounters,
  summarizeTargetSupervisorLatency,
} from "./target-supervisor-health.js";
import {
  boundedText,
  boundedId,
  normalizedContext,
  finiteDuration,
  cloneCheckpoint,
  validateCheckpoint,
} from "./target-supervisor-checkpoint.js";

export type TargetSupervisorClock = { now(): number };

export type TargetSupervisorOptions = {
  clock?: TargetSupervisorClock;
  maxEvents?: number;
  recoveryAttemptsPerStage?: number;
  quarantineAfterFailures?: number;
};

export type TargetSupervisorContext = {
  foregroundApp?: string;
  screenFingerprint?: string;
  runCursor?: { runId: string; stepId?: string; index?: number };
};

type Traversal = {
  token: string;
  startedAt: number;
  startedSequence: number;
  targetEpoch: number;
  sessionEpoch: number;
};

type PendingMutation = {
  id: string;
  intent: string;
  persistedAt: number;
  dispatchedAt?: number;
  uncertainAt?: number;
};

type AutomaticRecoveryChannel = Exclude<TargetRecoveryChannel, "input">;
type AutomaticRecoveryStage = Exclude<TargetRecoveryStage, "reconcile-observation">;

type ActiveRecovery =
  | {
      channel: AutomaticRecoveryChannel;
      stage: AutomaticRecoveryStage;
      attempt: number;
      startedAt: number;
    }
  | {
      channel: "input";
      stage: "reconcile-observation";
      attempt: 1;
      startedAt: number;
    };

type Counters = TargetSupervisorHealth["counters"];

export type TargetSupervisorCheckpoint = {
  schemaVersion: 1;
  target: { id: string; kind: TargetKind };
  targetEpoch: number;
  semanticSessionEpoch: number;
  sequence: number;
  pixels: {
    state: TargetSupervisorHealth["pixels"]["state"];
    lastCapturedAt?: number;
    lastError?: string;
    lastErrorAt?: number;
  };
  semantics: {
    state: TargetSupervisorHealth["semantics"]["state"];
    lastCapturedAt?: number;
    lastError?: string;
    lastErrorAt?: number;
    invalidatedAt?: number;
    traversal?: Traversal;
  };
  input: { pending?: PendingMutation; blockedReason?: string };
  control: TargetSupervisorHealth["control"];
  context: TargetSupervisorContext;
  recovery?: ActiveRecovery;
  needsHuman: boolean;
  quarantined: boolean;
  counters: Counters;
  latencySamples: { pixels: number[]; semantics: number[]; recovery: number[] };
  events: TargetSupervisorRecoveryEvent[];
};

export type TargetSupervisorEvent =
  | { kind: "context.updated"; context: TargetSupervisorContext }
  | { kind: "control.updated"; control: TargetSupervisorHealth["control"] }
  | { kind: "pixels.captured"; durationMs?: number }
  | { kind: "pixels.delayed"; reason: string }
  | { kind: "pixels.unavailable"; reason: string }
  | { kind: "semantics.traversal-started" }
  | {
      kind: "semantics.traversal-completed";
      token: string;
      usable: boolean;
      freshness?: "current" | "stale";
      durationMs?: number;
      reason?: string;
    }
  | { kind: "semantics.traversal-timed-out"; token: string; durationMs?: number }
  | { kind: "semantics.traversal-wedged"; token: string; reason: string }
  | { kind: "semantics.invalidated"; reason: string }
  | { kind: "input.intent-persisted"; mutationId: string; intent: string }
  | { kind: "input.dispatched"; mutationId: string }
  | { kind: "input.not-dispatched"; mutationId: string; reason: string }
  | { kind: "input.completed"; mutationId: string }
  | { kind: "input.outcome-unknown"; mutationId: string; reason: string }
  | {
      kind: "input.reconciled";
      mutationId: string;
      observationId: string;
      outcome: "applied" | "not-applied" | "ambiguous";
    }
  | { kind: "recovery.requested"; channel: TargetRecoveryChannel }
  | {
      kind: "recovery.receipt";
      channel: AutomaticRecoveryChannel;
      outcome: "succeeded" | "failed";
      reason: string;
    }
  | {
      kind: "recovery.step-completed";
      channel: AutomaticRecoveryChannel;
      stage: AutomaticRecoveryStage;
      outcome: "succeeded" | "failed";
      durationMs?: number;
      reason?: string;
    }
  | { kind: "operator.human-cleared" }
  | { kind: "operator.quarantined"; reason: string };

export type TargetSupervisorEffect =
  | {
      kind: "recover";
      channel: Exclude<TargetRecoveryChannel, "input">;
      stage: Exclude<TargetRecoveryStage, "reconcile-observation">;
      attempt: number;
    }
  | { kind: "capture-reconcile-observation"; mutationId: string };

export type TargetSupervisorTransition = {
  health: TargetSupervisorHealth;
  effects: readonly TargetSupervisorEffect[];
  traversalToken?: string;
};

const DEFAULT_MAX_EVENTS = 32;
const MAX_LATENCY_SAMPLES = 32;
const DEFAULT_ATTEMPTS_PER_STAGE = 1;
const DEFAULT_QUARANTINE_AFTER_FAILURES = 6;

const RECOVERY_STAGES: Record<AutomaticRecoveryChannel, AutomaticRecoveryStage[]> = {
  pixels: ["refresh-pixels", "prepare-platform-services"],
  semantics: ["refresh-semantics", "restart-semantic-runner", "prepare-platform-services"],
};

export class TargetSupervisor {
  private readonly clock: TargetSupervisorClock;
  private readonly maxEvents: number;
  private readonly attemptsPerStage: number;
  private readonly quarantineAfterFailures: number;
  private state: TargetSupervisorCheckpoint;

  private constructor(state: TargetSupervisorCheckpoint, options: TargetSupervisorOptions = {}) {
    this.clock = options.clock ?? { now: () => Date.now() };
    this.maxEvents = Math.floor(
      Math.max(1, Math.min(128, options.maxEvents ?? DEFAULT_MAX_EVENTS)),
    );
    this.attemptsPerStage = Math.max(
      1,
      Math.floor(Math.min(3, options.recoveryAttemptsPerStage ?? DEFAULT_ATTEMPTS_PER_STAGE)),
    );
    this.quarantineAfterFailures = Math.floor(
      Math.max(1, options.quarantineAfterFailures ?? DEFAULT_QUARANTINE_AFTER_FAILURES),
    );
    this.state = state;
  }

  static start(
    target: { id: string; kind: TargetKind },
    options: TargetSupervisorOptions = {},
  ): TargetSupervisor {
    if (!target.id.trim()) throw new Error("TargetSupervisor target id is required");
    const supervisor = new TargetSupervisor(
      {
        schemaVersion: 1,
        target: { id: boundedId(target.id, "Target id"), kind: target.kind },
        targetEpoch: 1,
        semanticSessionEpoch: 1,
        sequence: 0,
        pixels: { state: "delayed" },
        semantics: { state: "unavailable" },
        input: {},
        control: { state: "available" },
        context: {},
        needsHuman: false,
        quarantined: false,
        counters: initialTargetSupervisorCounters(),
        latencySamples: { pixels: [], semantics: [], recovery: [] },
        events: [],
      },
      options,
    );
    supervisor.record(
      "TARGET_SUPERVISOR_STARTED",
      "Target supervision started without assuming liveness.",
    );
    return supervisor;
  }

  static rehydrate(
    checkpoint: TargetSupervisorCheckpoint,
    options: TargetSupervisorOptions = {},
  ): TargetSupervisor {
    validateCheckpoint(checkpoint);
    const state = cloneCheckpoint(checkpoint);
    state.events = state.events.slice(-Math.floor(options.maxEvents ?? DEFAULT_MAX_EVENTS));
    state.latencySamples = {
      pixels: state.latencySamples.pixels.slice(-MAX_LATENCY_SAMPLES),
      semantics: state.latencySamples.semantics.slice(-MAX_LATENCY_SAMPLES),
      recovery: state.latencySamples.recovery.slice(-MAX_LATENCY_SAMPLES),
    };
    state.targetEpoch += 1;
    state.pixels.state = state.pixels.lastCapturedAt === undefined ? "unavailable" : "delayed";
    state.semantics.state = state.semantics.lastCapturedAt === undefined ? "unavailable" : "stale";
    delete state.semantics.traversal;
    if (state.input.pending?.dispatchedAt !== undefined) {
      state.input.pending.uncertainAt ??= options.clock?.now() ?? Date.now();
      state.input.blockedReason = "A dispatched mutation crossed restart and requires observation.";
    }
    if (state.recovery) {
      delete state.recovery;
      state.needsHuman = true;
      state.input.blockedReason ??= "Recovery crossed restart and requires an explicit decision.";
    }
    const supervisor = new TargetSupervisor(state, options);
    supervisor.record(
      "TARGET_SUPERVISOR_REHYDRATED",
      "Durable state was restored; prior liveness was downgraded until fresh proof arrives.",
    );
    return supervisor;
  }

  transition(event: TargetSupervisorEvent): TargetSupervisorTransition {
    const effects: TargetSupervisorEffect[] = [];
    let traversalToken: string | undefined;
    switch (event.kind) {
      case "context.updated":
        this.state.context = normalizedContext(event.context);
        this.record("TARGET_CONTEXT_UPDATED", "Last-known target context was updated.");
        break;
      case "control.updated":
        this.state.control = this.normalizeControl(event.control);
        this.record("TARGET_CONTROL_UPDATED", `Target control is ${this.state.control.state}.`);
        break;
      case "pixels.captured":
        this.capturePixels(event.durationMs);
        break;
      case "pixels.delayed":
        this.state.pixels = {
          ...this.state.pixels,
          state: "delayed",
          lastError: boundedText(event.reason),
          lastErrorAt: this.clock.now(),
        };
        this.record("PIXELS_DELAYED", event.reason);
        break;
      case "pixels.unavailable":
        this.state.pixels = {
          ...this.state.pixels,
          state: "unavailable",
          lastError: boundedText(event.reason),
          lastErrorAt: this.clock.now(),
        };
        this.record("PIXELS_UNAVAILABLE", event.reason);
        break;
      case "semantics.traversal-started":
        traversalToken = this.beginSemanticTraversal();
        break;
      case "semantics.traversal-completed":
        this.completeSemanticTraversal(event);
        break;
      case "semantics.traversal-timed-out":
        this.timeoutSemanticTraversal(event.token, event.durationMs);
        break;
      case "semantics.traversal-wedged":
        this.wedgeSemanticTraversal(event.token, event.reason);
        break;
      case "semantics.invalidated":
        this.invalidateSemantics();
        this.record("SEMANTIC_TRAVERSAL_STALE", event.reason);
        break;
      case "input.intent-persisted":
        this.persistInputIntent(event.mutationId, event.intent);
        break;
      case "input.dispatched":
        this.markInputDispatched(event.mutationId);
        break;
      case "input.not-dispatched":
        this.rejectInputBeforeDispatch(event.mutationId, event.reason);
        break;
      case "input.completed":
        this.completeInput(event.mutationId);
        break;
      case "input.outcome-unknown":
        effects.push(this.markInputUnknown(event.mutationId, event.reason));
        break;
      case "input.reconciled":
        this.reconcileInput(event);
        break;
      case "recovery.requested":
        effects.push(this.requestRecovery(event.channel));
        break;
      case "recovery.receipt":
        this.recordRecoveryReceipt(event);
        break;
      case "recovery.step-completed":
        effects.push(...this.completeRecoveryStep(event));
        break;
      case "operator.human-cleared":
        if (this.state.input.pending?.uncertainAt !== undefined) {
          throw new Error("Uncertain input requires reconciliation evidence before recovery");
        }
        this.state.quarantined = false;
        this.state.needsHuman = false;
        this.state.counters.recoveryFailures = 0;
        this.state.input.blockedReason = this.state.input.pending
          ? this.state.input.blockedReason
          : undefined;
        this.record("RECOVERY_COMPLETED", "A human cleared the target for bounded recovery.");
        break;
      case "operator.quarantined":
        this.state.quarantined = true;
        this.state.needsHuman = true;
        delete this.state.recovery;
        this.record("TARGET_QUARANTINED", event.reason);
        break;
    }
    return {
      health: this.health(),
      effects,
      ...(traversalToken ? { traversalToken } : {}),
    };
  }

  health(): TargetSupervisorHealth {
    const pending = this.state.input.pending;
    const control = this.effectiveControl();
    const inputState = pending?.uncertainAt
      ? "uncertain"
      : pending || this.state.input.blockedReason || control.state === "held-by-other"
        ? "blocked"
        : "ready";
    const overall = deriveTargetSupervisorOverall({
      quarantined: this.state.quarantined,
      needsHuman: this.state.needsHuman,
      recovering: Boolean(this.state.recovery),
      pixels: this.state.pixels.state,
      semantics: this.state.semantics.state,
      targetInput: inputState,
    });
    return {
      schemaVersion: 1,
      target: { ...this.state.target },
      observedAt: this.clock.now(),
      epochs: { target: this.state.targetEpoch, semanticSession: this.state.semanticSessionEpoch },
      pixels: {
        state: this.state.pixels.state,
        ...(this.state.pixels.lastCapturedAt !== undefined
          ? { lastCapturedAt: this.state.pixels.lastCapturedAt }
          : {}),
        ...(this.state.pixels.lastError ? { lastError: this.state.pixels.lastError } : {}),
      },
      semantics: {
        state: this.state.semantics.state,
        ...(this.state.semantics.lastCapturedAt !== undefined
          ? { lastCapturedAt: this.state.semantics.lastCapturedAt }
          : {}),
        ...(this.state.semantics.lastError ? { lastError: this.state.semantics.lastError } : {}),
        ...(this.state.semantics.traversal
          ? {
              traversal: {
                token: this.state.semantics.traversal.token,
                startedAt: this.state.semantics.traversal.startedAt,
              },
            }
          : {}),
      },
      input: {
        state: inputState,
        ...(pending ? { pendingMutationId: pending.id } : {}),
        ...(this.state.input.blockedReason
          ? { reason: this.state.input.blockedReason }
          : control.state === "held-by-other"
            ? { reason: "Another actor currently controls this target." }
            : {}),
      },
      control,
      overall,
      context: structuredClone(this.state.context),
      ...(this.state.recovery ? { recovery: { ...this.state.recovery } } : {}),
      counters: { ...this.state.counters },
      latency: {
        pixels: summarizeTargetSupervisorLatency(this.state.latencySamples.pixels),
        semantics: summarizeTargetSupervisorLatency(this.state.latencySamples.semantics),
        recovery: summarizeTargetSupervisorLatency(this.state.latencySamples.recovery),
      },
      readiness: deriveTargetSupervisorReadiness(this.state, this.clock.now()),
      events: this.state.events
        .slice(-this.maxEvents)
        .reverse()
        .map((entry) => ({ ...entry })),
    };
  }

  checkpoint(): TargetSupervisorCheckpoint {
    return cloneCheckpoint(this.state);
  }

  private capturePixels(durationMs?: number): void {
    const at = this.clock.now();
    this.state.pixels = { state: "ready", lastCapturedAt: at };
    this.state.counters.pixelCaptures += 1;
    this.sample("pixels", durationMs);
    this.record("PIXELS_CAPTURED", "Fresh pixels are available.");
    this.clearStaleHumanHold("Fresh pixels prove the device is observable again.");
  }

  /**
   * Recovery exhaustion sets `needsHuman` and nothing else clears it, so one
   * bad stretch (a locked screen, a wedged runner) blocks every later tap and
   * launch even after the device is healthy. A fresh observation is proof the
   * device is reachable again. Quarantine is deliberate and stays until an
   * explicit clear; an uncertain in-flight mutation still needs its receipt.
   */
  private clearStaleHumanHold(reason: string): void {
    if (!this.state.needsHuman || this.state.quarantined) return;
    if (this.state.input.pending?.uncertainAt !== undefined) return;
    this.state.needsHuman = false;
    if (!this.state.input.pending) delete this.state.input.blockedReason;
    this.record("RECOVERY_COMPLETED", reason);
  }

  private beginSemanticTraversal(): string {
    if (this.state.quarantined) throw new Error("Quarantined target cannot start semantics");
    if (this.state.semantics.traversal) {
      throw new Error("Target already has one semantic traversal in flight");
    }
    const token = `semantic:${this.state.targetEpoch}:${this.state.semanticSessionEpoch}:${this.state.sequence + 1}`;
    const startedAt = this.clock.now();
    this.state.semantics.traversal = {
      token,
      startedAt,
      startedSequence: this.state.sequence + 1,
      targetEpoch: this.state.targetEpoch,
      sessionEpoch: this.state.semanticSessionEpoch,
    };
    this.state.semantics.state = "refreshing";
    this.state.counters.semanticTraversals += 1;
    this.record("SEMANTIC_TRAVERSAL_STARTED", "A single semantic traversal started.", {
      traversalToken: token,
    });
    return token;
  }

  private completeSemanticTraversal(
    event: Extract<TargetSupervisorEvent, { kind: "semantics.traversal-completed" }>,
  ): void {
    const traversal = this.matchTraversal(event.token);
    if (!traversal) return;
    delete this.state.semantics.traversal;
    this.sample("semantics", event.durationMs ?? this.clock.now() - traversal.startedAt);
    const invalidatedAfterStart =
      this.state.semantics.invalidatedAt !== undefined &&
      this.state.semantics.invalidatedAt >= traversal.startedSequence;
    if (event.usable && !invalidatedAfterStart && event.freshness !== "stale") {
      this.state.semantics = { state: "current", lastCapturedAt: this.clock.now() };
      this.record("SEMANTIC_TRAVERSAL_COMPLETED", "Fresh semantic evidence is current.", {
        traversalToken: event.token,
      });
      this.clearStaleHumanHold("Fresh semantic evidence proves the device is observable again.");
      return;
    }
    if (event.usable) {
      this.state.semantics.state = "stale";
      this.state.semantics.lastCapturedAt = this.clock.now();
      this.record(
        "SEMANTIC_TRAVERSAL_STALE",
        "The traversal began before newer input and remains stale.",
        {
          traversalToken: event.token,
        },
      );
      return;
    }
    this.state.semantics.state = "unavailable";
    this.state.semantics.lastError = boundedText(event.reason ?? "Semantic evidence was unusable.");
    this.state.semantics.lastErrorAt = this.clock.now();
    this.record("SEMANTIC_TRAVERSAL_UNAVAILABLE", this.state.semantics.lastError, {
      traversalToken: event.token,
    });
  }

  private timeoutSemanticTraversal(token: string, durationMs?: number): void {
    const traversal = this.requireTraversal(token);
    this.state.semantics.state = "refreshing";
    this.state.counters.semanticTimeouts += 1;
    this.sample("semantics", durationMs ?? this.clock.now() - traversal.startedAt);
    this.record(
      "SEMANTIC_TRAVERSAL_TIMED_OUT",
      "The bounded wait ended while the single native traversal remains in flight.",
      { traversalToken: token },
    );
  }

  private wedgeSemanticTraversal(token: string, reason: string): void {
    this.requireTraversal(token);
    this.state.semantics.state = "wedged";
    this.state.semantics.lastError = boundedText(reason);
    this.state.semantics.lastErrorAt = this.clock.now();
    this.state.counters.semanticWedges += 1;
    this.record("SEMANTIC_TRAVERSAL_WEDGED", reason, { traversalToken: token });
  }

  private persistInputIntent(mutationId: string, intent: string): void {
    if (this.state.quarantined || this.state.needsHuman) {
      throw new Error("Target input is blocked pending human review");
    }
    if (this.state.input.pending) {
      throw new Error("Target already has a pending or uncertain mutation");
    }
    if (this.effectiveControl().state === "held-by-other") {
      throw new Error("Another actor currently controls this target");
    }
    const id = boundedId(mutationId, "Mutation id");
    if (!intent.trim()) throw new Error("Mutation intent is required");
    this.state.input.pending = {
      id,
      intent: boundedText(intent),
      persistedAt: this.clock.now(),
    };
    this.state.input.blockedReason = "Mutation intent is durable and awaiting one dispatch.";
    this.record("INPUT_INTENT_PERSISTED", "Mutation intent was persisted before dispatch.", {
      mutationId,
    });
  }

  private markInputDispatched(mutationId: string): void {
    const mutation = this.requireMutation(mutationId);
    if (mutation.dispatchedAt !== undefined) throw new Error("Mutation was already dispatched");
    mutation.dispatchedAt = this.clock.now();
    this.state.input.blockedReason = "One native mutation is in flight.";
    this.record("INPUT_DISPATCHED", "Exactly one native mutation was dispatched.", { mutationId });
  }

  private completeInput(mutationId: string): void {
    const mutation = this.requireMutation(mutationId);
    if (mutation.dispatchedAt === undefined) throw new Error("Mutation was not dispatched");
    if (mutation.uncertainAt !== undefined) {
      throw new Error("Uncertain mutation can only complete through reconciliation evidence");
    }
    this.invalidateSemantics();
    delete this.state.input.pending;
    delete this.state.input.blockedReason;
    this.record("INPUT_COMPLETED", "The one dispatched mutation completed.", { mutationId });
  }

  private rejectInputBeforeDispatch(mutationId: string, reason: string): void {
    this.requireMutation(mutationId);
    delete this.state.input.pending;
    delete this.state.input.blockedReason;
    this.record(
      "INPUT_NOT_DISPATCHED",
      `The native adapter proved that no input was dispatched: ${boundedText(reason)}`,
      { mutationId },
    );
  }

  private markInputUnknown(mutationId: string, reason: string): TargetSupervisorEffect {
    const mutation = this.requireMutation(mutationId);
    if (mutation.dispatchedAt === undefined) throw new Error("Mutation was not dispatched");
    if (mutation.uncertainAt !== undefined)
      throw new Error("Mutation outcome is already uncertain");
    mutation.uncertainAt = this.clock.now();
    this.state.input.blockedReason = boundedText(reason);
    this.state.counters.uncertainMutations += 1;
    this.record("INPUT_OUTCOME_UNKNOWN", reason, { mutationId });
    return { kind: "capture-reconcile-observation", mutationId };
  }

  private reconcileInput(
    event: Extract<TargetSupervisorEvent, { kind: "input.reconciled" }>,
  ): void {
    const mutation = this.requireMutation(event.mutationId);
    if (mutation.uncertainAt === undefined) throw new Error("Mutation outcome is not uncertain");
    boundedId(event.observationId, "Reconciliation observation id");
    this.state.counters.reconciliations += 1;
    if (event.outcome === "ambiguous") {
      delete this.state.recovery;
      this.state.needsHuman = true;
      this.state.input.blockedReason =
        "The reconciliation observation could not prove the mutation outcome.";
      this.record("INPUT_RECONCILIATION_AMBIGUOUS", this.state.input.blockedReason, {
        mutationId: event.mutationId,
      });
      this.record("TARGET_NEEDS_HUMAN", "A human must review the uncertain mutation evidence.");
      return;
    }
    if (event.outcome === "applied") this.invalidateSemantics();
    delete this.state.recovery;
    delete this.state.input.pending;
    delete this.state.input.blockedReason;
    this.record(
      "INPUT_RECONCILED",
      `Durable observation proved the mutation was ${event.outcome}. No retry was issued.`,
      { mutationId: event.mutationId },
    );
  }

  private requestRecovery(channel: TargetRecoveryChannel): TargetSupervisorEffect {
    if (this.state.quarantined) throw new Error("Quarantined target cannot recover automatically");
    if (this.state.recovery) throw new Error("Target recovery is already active");
    if (channel === "input") {
      const mutation = this.state.input.pending;
      if (!mutation?.uncertainAt) throw new Error("Input recovery requires an uncertain mutation");
      this.state.recovery = {
        channel,
        stage: "reconcile-observation",
        attempt: 1,
        startedAt: this.clock.now(),
      };
      this.state.counters.recoveryAttempts += 1;
      this.record("RECOVERY_STARTED", "Input recovery will only capture reconciliation evidence.", {
        channel,
        stage: "reconcile-observation",
        mutationId: mutation.id,
      });
      return { kind: "capture-reconcile-observation", mutationId: mutation.id };
    }
    const stage = RECOVERY_STAGES[channel][0]!;
    this.state.recovery = { channel, stage, attempt: 1, startedAt: this.clock.now() };
    this.state.counters.recoveryAttempts += 1;
    this.record("RECOVERY_STARTED", `Bounded ${channel} recovery started.`, { channel, stage });
    return { kind: "recover", channel, stage, attempt: 1 };
  }

  private completeRecoveryStep(
    event: Extract<TargetSupervisorEvent, { kind: "recovery.step-completed" }>,
  ): TargetSupervisorEffect[] {
    const active = this.state.recovery;
    if (!active || active.channel !== event.channel || active.stage !== event.stage) {
      throw new Error("Recovery result does not match the active recovery step");
    }
    this.sample("recovery", event.durationMs ?? this.clock.now() - active.startedAt);
    if (event.outcome === "succeeded") {
      if (active.stage === "restart-semantic-runner") {
        this.state.semanticSessionEpoch += 1;
        delete this.state.semantics.traversal;
      }
      if (active.channel === "semantics") this.state.semantics.state = "refreshing";
      else this.state.pixels.state = "delayed";
      delete this.state.recovery;
      this.state.needsHuman = false;
      if (!this.state.input.pending) {
        delete this.state.input.blockedReason;
      }
      this.record(
        "RECOVERY_COMPLETED",
        `Recovery step ${active.stage} completed; fresh proof is still required.`,
        {
          channel: active.channel,
          stage: active.stage,
        },
      );
      return [];
    }
    this.state.counters.recoveryFailures += 1;
    const plan = RECOVERY_STAGES[active.channel];
    let nextStage = active.stage;
    let nextAttempt = active.attempt + 1;
    if (nextAttempt > this.attemptsPerStage) {
      nextStage = plan[plan.indexOf(active.stage) + 1]!;
      nextAttempt = 1;
    }
    if (nextStage) {
      this.state.recovery = {
        channel: active.channel,
        stage: nextStage,
        attempt: nextAttempt,
        startedAt: this.clock.now(),
      };
      this.state.counters.recoveryAttempts += 1;
      this.record("RECOVERY_ESCALATED", event.reason ?? `Recovery escalated to ${nextStage}.`, {
        channel: active.channel,
        stage: nextStage,
      });
      return [{ kind: "recover", channel: active.channel, stage: nextStage, attempt: nextAttempt }];
    }
    delete this.state.recovery;
    this.state.needsHuman = true;
    this.record(
      "RECOVERY_EXHAUSTED",
      event.reason ?? "The bounded recovery budget was exhausted.",
      {
        channel: active.channel,
        stage: active.stage,
      },
    );
    if (this.state.counters.recoveryFailures >= this.quarantineAfterFailures) {
      this.state.quarantined = true;
      this.record(
        "TARGET_QUARANTINED",
        "Repeated bounded recovery failures quarantined the target.",
      );
    } else {
      this.record("TARGET_NEEDS_HUMAN", "Automatic recovery stopped and requires a human.");
    }
    return [];
  }

  private recordRecoveryReceipt(
    event: Extract<TargetSupervisorEvent, { kind: "recovery.receipt" }>,
  ): void {
    if (this.state.recovery) throw new Error("A recovery receipt cannot replace an active step");
    this.state.counters.recoveryAttempts += 1;
    if (event.outcome === "failed") {
      this.state.counters.recoveryFailures += 1;
      this.state.needsHuman = true;
      this.record("RECOVERY_EXHAUSTED", event.reason, { channel: event.channel });
      this.record("TARGET_NEEDS_HUMAN", "Observed target recovery failed and requires a human.");
      return;
    }
    this.state.needsHuman = false;
    if (event.channel === "pixels") this.state.pixels.state = "delayed";
    else this.state.semantics.state = "refreshing";
    this.record("RECOVERY_COMPLETED", event.reason, { channel: event.channel });
  }

  private effectiveControl(): TargetSupervisorHealth["control"] {
    const control = this.state.control;
    if (control.expiresAt !== undefined && control.expiresAt <= this.clock.now()) {
      return { state: "available" };
    }
    return { ...control };
  }

  private normalizeControl(
    control: TargetSupervisorHealth["control"],
  ): TargetSupervisorHealth["control"] {
    if (control.state === "available") return { state: "available" };
    const ownerId = boundedId(control.ownerId ?? "", "Control owner id");
    const expiresAt = control.expiresAt;
    return {
      state: control.state,
      ownerId,
      ...(expiresAt !== undefined && Number.isFinite(expiresAt) ? { expiresAt } : {}),
    };
  }

  private invalidateSemantics(): void {
    this.state.semantics.invalidatedAt = this.state.sequence + 1;
    if (this.state.semantics.lastCapturedAt !== undefined) this.state.semantics.state = "stale";
  }

  private requireMutation(mutationId: string): PendingMutation {
    const mutation = this.state.input.pending;
    if (!mutation || mutation.id !== mutationId)
      throw new Error("Mutation does not match pending input");
    return mutation;
  }

  private requireTraversal(token: string): Traversal {
    const traversal = this.state.semantics.traversal;
    if (!traversal || traversal.token !== token)
      throw new Error("Semantic traversal token is not active");
    return traversal;
  }

  private matchTraversal(token: string): Traversal | undefined {
    const traversal = this.state.semantics.traversal;
    if (
      !traversal ||
      traversal.token !== token ||
      traversal.targetEpoch !== this.state.targetEpoch ||
      traversal.sessionEpoch !== this.state.semanticSessionEpoch
    ) {
      this.record(
        "STALE_COMPLETION_IGNORED",
        "A semantic completion from an old traversal was ignored.",
        {
          traversalToken: token,
        },
      );
      return undefined;
    }
    return traversal;
  }

  private sample(
    channel: keyof TargetSupervisorCheckpoint["latencySamples"],
    value?: number,
  ): void {
    const duration = finiteDuration(value);
    if (duration === undefined) return;
    const samples = this.state.latencySamples[channel];
    samples.push(duration);
    if (samples.length > MAX_LATENCY_SAMPLES)
      samples.splice(0, samples.length - MAX_LATENCY_SAMPLES);
  }

  private record(
    code: TargetSupervisorEventCode,
    message: string,
    fields: Partial<
      Pick<TargetSupervisorRecoveryEvent, "channel" | "stage" | "mutationId" | "traversalToken">
    > = {},
  ): void {
    this.state.sequence += 1;
    this.state.events.push({
      sequence: this.state.sequence,
      at: this.clock.now(),
      code,
      message: boundedText(message),
      ...fields,
    });
    if (this.state.events.length > this.maxEvents) {
      this.state.events.splice(0, this.state.events.length - this.maxEvents);
    }
  }
}
