/**
 * Exact-once policy for physical iOS XCTest mutations.
 *
 * This is intentionally separate from device.ts: read retries and native
 * mutation safety are different concerns, and keeping them together makes it
 * too easy to reintroduce a generic retry around a tap.
 */
import { InputOutcomeUnknownError } from "./input-not-dispatched.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { cooperativeCheckpoint, raceCancel, throwIfCancelled } from "./control.js";
import { noteConfirmedIosSnapshotInput } from "./ios-snapshot-flight.js";
import { unknownErrorMessage } from "./ios-runner-listener-command.js";
import { IosHidUnavailableError } from "./workspace-ios-raw.js";
import { currentTargetContext } from "./target-context.js";
import { TargetControlReservedError } from "./target-control.js";
import { invalidateTargetSemanticControl } from "./target-runtime-readiness.js";
import {
  currentTargetSupervisorStore,
  type SupervisedTarget,
  type TargetSupervisorStore,
} from "./target-supervisor-store.js";

export type IosMutationOperation =
  | "app-open"
  | "app-close"
  | "url-open"
  | "press"
  | "long-press"
  | "fill"
  | "type"
  | "swipe"
  | "scroll"
  | "back"
  | "home"
  | "clipboard-write"
  | "clipboard-paste"
  | "clipboard-copy"
  | "app-switcher"
  | "rotate"
  | "keyboard"
  | "alert"
  | "settings"
  | "video";

export type IosMutationAttemptDiagnostic = {
  /** Monotonic per-device token so callers never attach an older command. */
  sequence: number;
  operation: IosMutationOperation;
  /** Native XCTest commands issued for this user/agent intention. Always one. */
  nativeAttempts: 1;
  outcome: "completed" | "selector-miss" | "selector-rejected" | "outcome-unknown";
  retry: {
    attempts: 0;
    decision: "not-needed" | "safe-selector-fallback" | "blocked";
    reason:
      | "native-command-completed"
      | "selector-was-not-dispatched"
      | "native-selector-rejected"
      | "native-command-outcome-unknown";
  };
  intervention: {
    required: boolean;
    action: "none" | "capture-current-screen-before-any-retry";
  };
  /**
   * Cancellation was observed only after Relay began the one native attempt.
   * It is evidence, not proof that XCTest did not receive the command.
   */
  cancellation?: {
    observedAfterAttemptStarted: true;
  };
  at: number;
};

/** Video capture is evidence transport, not a UI input. Every other exact-once
 * operation can alter the visible or semantic surface, including app launch,
 * keyboard dismissal, clipboard paste, and device rotation. */
function changesIosSemanticSurface(operation: IosMutationOperation): boolean {
  return operation !== "video";
}

/**
 * Advance both semantic fences only after the one native iOS command returned
 * success. In particular, a selector miss is known pre-dispatch and an
 * outcome-unknown error has no proof of input, so neither may discard a tree
 * or make a caller hide usable current semantics.
 */
function recordConfirmedIosInput(serial: string, operation: IosMutationOperation): void {
  if (!changesIosSemanticSurface(operation)) return;
  noteConfirmedIosSnapshotInput(serial);
  invalidateTargetSemanticControl({ serial, platform: "ios" }, "input-changed");
}

const iosMutationAttemptDiagnostics = new Map<string, IosMutationAttemptDiagnostic>();
const iosMutationSequences = new Map<string, number>();

type SupervisedIosMutationReceipt = {
  store: TargetSupervisorStore;
  target: SupervisedTarget;
  mutationId: string;
};

type SupervisedIosMutationContext = {
  serial: string;
  operation: IosMutationOperation;
  receipt?: SupervisedIosMutationReceipt;
  finished?: boolean;
};

const supervisedIosMutations = new AsyncLocalStorage<SupervisedIosMutationContext>();

/**
 * Controls whether a physical iOS dispatch may proceed without the durable
 * supervisor. Production target scopes use `required`; the two explicit
 * escape hatches are reserved for low-level tests and carefully isolated
 * diagnostics that cannot persist a receipt.
 */
export type IosSupervisionMode = "required" | "test-optional" | "unsupervised";

const iosSupervisionModes = new AsyncLocalStorage<IosSupervisionMode>();

/** Run an iOS mutation under an explicit supervision policy. */
export function runWithIosSupervisionMode<T>(mode: IosSupervisionMode, operation: () => T): T {
  return iosSupervisionModes.run(mode, operation);
}

export function currentIosSupervisionMode(): IosSupervisionMode {
  return iosSupervisionModes.getStore() ?? "required";
}

/** Raised before any native callback when required durability is unavailable. */
export class IosSupervisionRequiredError extends Error {
  readonly serial: string;

  constructor(
    serial: string,
    message = `Physical iOS mutation for ${serial} requires a durable supervisor before native dispatch`,
  ) {
    super(message);
    this.name = "IosSupervisionRequiredError";
    this.serial = serial;
  }
}

/** A native reply's structured dispatch proof outranks its human message. */
export class IosNativeMutationError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly dispatched: "no" | "unknown",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "IosNativeMutationError";
  }
}

function assertActiveIosIntention(active: SupervisedIosMutationContext | undefined): void {
  if (active?.finished) throw new Error("The physical iOS intention has already terminated");
}

/** Adopted input has no administrative prepare path: every production post
 * must belong to the exact-once intention for this physical target. */
export function assertAdoptedIosMutationIntention(targetId: string): void {
  const active = supervisedIosMutations.getStore();
  assertActiveIosIntention(active);
  if (currentIosSupervisionMode() === "required" && (!active || active.serial !== targetId)) {
    throw new IosSupervisionRequiredError(
      targetId,
      `Physical iOS mutation for ${targetId} requires a matching active intention before native dispatch`,
    );
  }
}

/** Only the structured identifier ambiguity route may retire its refused
 * dispatch before ranking a fresh point. Failed persistence and late replies
 * leave the existing receipt intact and cannot authorize another input. */
export async function finishRejectedIosIdentifierDispatch(
  targetId: string,
  failure: IosNativeMutationError,
): Promise<void> {
  await cooperativeCheckpoint();
  if (failure.code !== "AMBIGUOUS_MATCH" || failure.dispatched !== "no") throw failure;
  const active = supervisedIosMutations.getStore();
  assertActiveIosIntention(active);
  if (!active || active.serial !== targetId || !active.receipt) return;
  const result = finishSupervisedIosMutation(
    active,
    "not-dispatched",
    "The native identifier selector was ambiguous before input dispatch.",
  );
  if (result.persistenceError) {
    throw new IosNativeMutationError(
      "Could not persist the native selector refusal",
      undefined,
      "unknown",
      { cause: result.persistenceError },
    );
  }
  delete active.receipt;
}

/**
 * Enter the durable supervisor exactly at the private native transport seam.
 * Target-lane admission has already succeeded when this callback runs, while
 * no SDK command has been sent yet. The enclosing exact-once policy owns the
 * terminal receipt because only it can distinguish a proven selector miss
 * from an acknowledgement loss.
 */
export async function dispatchSupervisedIosMutation<T>(
  targetId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const supervisionMode = currentIosSupervisionMode();
  if (supervisionMode === "unsupervised") return operation();
  const store = currentTargetSupervisorStore();
  if (!store) {
    if (supervisionMode === "required") throw new IosSupervisionRequiredError(targetId);
    return operation();
  }
  const active = supervisedIosMutations.getStore();
  assertActiveIosIntention(active);
  if (!active || active.serial !== targetId) return operation();
  if (active.receipt) {
    throw new Error("A physical iOS intention attempted more than one native dispatch");
  }
  const target = { id: targetId, kind: "ios" } as const;
  const mutationId = `ios-input-${randomUUID()}`;
  store.transition(target, {
    kind: "input.intent-persisted",
    mutationId,
    intent: `Physical iOS ${active.operation}`,
  });
  active.receipt = { store, target, mutationId };
  try {
    store.transition(target, { kind: "input.dispatched", mutationId });
  } catch (error) {
    // No native command has run. Clear the durable intention when storage is
    // available so a persistence failure cannot strand a false in-flight input.
    try {
      store.transition(target, {
        kind: "input.not-dispatched",
        mutationId,
        reason: "Relay could not durably record the native dispatch.",
      });
    } catch {
      // The store is still unavailable; the original persistence error is the
      // actionable failure and a later store read rehydrates durable truth.
    }
    throw error;
  }
  return operation();
}

type SupervisedIosMutationFinish = {
  mutationId?: string;
  persistenceError?: unknown;
};

function finishSupervisedIosMutation(
  active: SupervisedIosMutationContext,
  outcome: "completed" | "not-dispatched" | "outcome-unknown",
  reason?: string,
): SupervisedIosMutationFinish {
  const receipt = active.receipt;
  if (!receipt) return {};
  try {
    if (outcome === "completed") {
      receipt.store.transition(receipt.target, {
        kind: "input.completed",
        mutationId: receipt.mutationId,
      });
      return { mutationId: receipt.mutationId };
    }
    receipt.store.transition(receipt.target, {
      kind: outcome === "not-dispatched" ? "input.not-dispatched" : "input.outcome-unknown",
      mutationId: receipt.mutationId,
      reason:
        reason?.trim() ||
        (outcome === "not-dispatched"
          ? "The selector was rejected before native dispatch."
          : "The native mutation acknowledgement was lost."),
    });
    return { mutationId: receipt.mutationId };
  } catch (persistenceError) {
    return { mutationId: receipt.mutationId, persistenceError };
  }
}

export function lastIosMutationAttemptDiagnostic(
  serial: string,
): IosMutationAttemptDiagnostic | undefined {
  const value = iosMutationAttemptDiagnostics.get(serial);
  return value ? structuredClone(value) : undefined;
}

/**
 * Record that one native iOS mutation already left Relay and must not be
 * replayed. Used when the dispatch happened outside `runIosMutationOnce`
 * (CoreDevice HID) and the acknowledgement was then lost.
 */
export async function stopUnknownIosMutation(
  serial: string,
  operation: IosMutationOperation,
  error: unknown,
): Promise<never> {
  rethrowIosMutationOutcomeUnknown(error);
  await runIosMutationOnce(serial, operation, async () => {
    throw error;
  });
  throw error instanceof Error ? error : new Error(String(error));
}

/** A typed, reviewable stop rather than an optimistic second device command. */
export class IosMutationOutcomeUnknownError extends Error {
  readonly iosMutation: IosMutationAttemptDiagnostic;
  readonly cause: unknown;
  readonly supervisedMutation?: { serial: string; mutationId: string };

  constructor(
    diagnostic: IosMutationAttemptDiagnostic,
    cause: unknown,
    supervisedMutation?: { serial: string; mutationId: string },
  ) {
    super(
      `The iOS ${diagnostic.operation} may already have reached the device. Relay did not retry it. Capture the current screen, review the outcome, then explicitly choose retry or repair.`,
    );
    this.name = "IosMutationOutcomeUnknownError";
    this.iosMutation = diagnostic;
    this.cause = cause;
    this.supervisedMutation = supervisedMutation;
  }
}

/** A structured native refusal proves no gesture occurred, but does not
 * authorize a different selector, coordinate fallback or optional recovery. */
export class IosMutationRejectedError extends Error {
  constructor(
    readonly iosMutation: IosMutationAttemptDiagnostic,
    readonly cause: IosNativeMutationError,
  ) {
    super(
      `The iOS ${iosMutation.operation} was rejected before input: ${cause.code}: ${cause.message}. Relay stopped without retrying.`,
    );
    this.name = "IosMutationRejectedError";
  }
}

export function isTerminalIosMutationError(
  error: unknown,
): error is IosMutationOutcomeUnknownError | IosMutationRejectedError {
  return (
    error instanceof IosMutationOutcomeUnknownError || error instanceof IosMutationRejectedError
  );
}

/**
 * Recovery code may handle selector misses and ordinary adapter failures, but
 * it must never reinterpret a terminal native refusal or unknown input as either.
 * Keep this guard explicit at every catch-all recovery boundary.
 */
export function rethrowIosMutationOutcomeUnknown(error: unknown): void {
  if (isTerminalIosMutationError(error) || error instanceof InputOutcomeUnknownError) throw error;
}

export function currentIosDeviceSerial(): string | undefined {
  try {
    const context = currentTargetContext();
    return context.kind === "device" && context.platform === "ios" ? context.serial : undefined;
  } catch {
    return undefined;
  }
}

function mutationErrorMessage(error: unknown): string {
  if (isTerminalIosMutationError(error)) return mutationErrorMessage(error.cause);
  return unknownErrorMessage(error);
}

/**
 * Only a native rejection that proves the command never left the host is
 * safe to reinterpret as “no command was dispatched”. Timeout, connection,
 * runner, or generic lookup failures remain ambiguous and must stop for
 * evidence rather than trying a coordinate press.
 * "No active session" is the adapter refusing before it has a session.
 */
export function iosSelectorWasNotDispatched(error: unknown): boolean {
  if (isTerminalIosMutationError(error)) return false;
  if (error instanceof IosNativeMutationError) {
    return error.dispatched === "no" && error.code === "ELEMENT_NOT_FOUND";
  }
  if (error instanceof IosHidUnavailableError) return true;
  const message = mutationErrorMessage(error).trim();
  if (/^no active session\. run open first\.?$/i.test(message)) return true;
  if (
    /^(?:native )?(?:selector )?(?:did not match an element|no match(?:ing element)?|element not found)(?:[.!])?$/i.test(
      message,
    )
  ) {
    return true;
  }
  return /(?:^|:\s*)(?:element not found|did not match an element|no matching element|no focused (?:text )?field|no first responder|Copy probe, not the product app)\b/i.test(
    message,
  );
}

function attachIosMutationDiagnostic(
  error: unknown,
  diagnostic: IosMutationAttemptDiagnostic,
): void {
  if (error instanceof Error) {
    Object.defineProperty(error, "iosMutation", {
      configurable: true,
      enumerable: true,
      value: structuredClone(diagnostic),
    });
  }
}

function mutationDiagnostic(
  serial: string,
  operation: IosMutationOperation,
  outcome: IosMutationAttemptDiagnostic["outcome"],
  cancelledAfterAttemptStarted = false,
): IosMutationAttemptDiagnostic {
  const selectorMiss = outcome === "selector-miss";
  const selectorRejected = outcome === "selector-rejected";
  const unknown = outcome === "outcome-unknown";
  return {
    sequence: (iosMutationSequences.get(serial) ?? 0) + 1,
    operation,
    nativeAttempts: 1,
    outcome,
    retry: {
      attempts: 0,
      decision: selectorMiss
        ? "safe-selector-fallback"
        : unknown || selectorRejected
          ? "blocked"
          : "not-needed",
      reason: selectorMiss
        ? "selector-was-not-dispatched"
        : selectorRejected
          ? "native-selector-rejected"
          : unknown
            ? "native-command-outcome-unknown"
            : "native-command-completed",
    },
    intervention: {
      required: unknown,
      action: unknown ? "capture-current-screen-before-any-retry" : "none",
    },
    ...(cancelledAfterAttemptStarted
      ? { cancellation: { observedAfterAttemptStarted: true as const } }
      : {}),
    at: Date.now(),
  };
}

function isJobCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "JobCancelledError";
}

/**
 * Run exactly one iOS mutation. The error path is deliberately an intervention
 * boundary: callers get structured evidence that no implicit retry or
 * semantic-to-point fallback is safe until the current device state is seen.
 */
export async function runIosMutationOnce<T>(
  serial: string,
  operation: IosMutationOperation,
  op: () => Promise<T>,
): Promise<T> {
  await cooperativeCheckpoint();
  throwIfCancelled();
  const supervised: SupervisedIosMutationContext = { serial, operation };
  let result: T;
  try {
    result = await supervisedIosMutations.run(supervised, () => raceCancel(op()));
  } catch (error) {
    supervised.finished = true;
    // The target lane rejects before it invokes the native SDK callback, so
    // this is not an ambiguous device outcome and must not manufacture a
    // “one native attempt” diagnostic for a command that never left Relay.
    if (
      error instanceof TargetControlReservedError ||
      error instanceof IosSupervisionRequiredError
    ) {
      throw error;
    }
    const selectorRejected =
      error instanceof IosNativeMutationError &&
      error.dispatched === "no" &&
      (error.code === "AMBIGUOUS_MATCH" || error.code === "ELEMENT_OFFSCREEN");
    let diagnostic = mutationDiagnostic(
      serial,
      operation,
      iosSelectorWasNotDispatched(error)
        ? "selector-miss"
        : selectorRejected
          ? "selector-rejected"
          : "outcome-unknown",
      isJobCancellation(error),
    );
    const supervisedFinish = finishSupervisedIosMutation(
      supervised,
      diagnostic.outcome === "selector-miss" ||
        (error instanceof IosNativeMutationError && error.dispatched === "no")
        ? "not-dispatched"
        : "outcome-unknown",
      mutationErrorMessage(error),
    );
    // A refusal cannot release the durable intention unless its receipt was
    // saved. Preserve the pending fence and terminal uncertainty on failure.
    if (supervisedFinish.persistenceError) {
      diagnostic = mutationDiagnostic(
        serial,
        operation,
        "outcome-unknown",
        isJobCancellation(error),
      );
    }
    iosMutationSequences.set(serial, diagnostic.sequence);
    iosMutationAttemptDiagnostics.set(serial, diagnostic);
    attachIosMutationDiagnostic(error, diagnostic);
    if (diagnostic.outcome === "selector-miss") throw error;
    if (diagnostic.outcome === "selector-rejected" && error instanceof IosNativeMutationError) {
      throw new IosMutationRejectedError(diagnostic, error);
    }
    throw new IosMutationOutcomeUnknownError(
      diagnostic,
      supervisedFinish.persistenceError ?? error,
      supervisedFinish.mutationId ? { serial, mutationId: supervisedFinish.mutationId } : undefined,
    );
  }
  supervised.finished = true;
  const supervisedFinish = finishSupervisedIosMutation(supervised, "completed");
  if (supervisedFinish.persistenceError) {
    const diagnostic = mutationDiagnostic(serial, operation, "outcome-unknown", false);
    iosMutationSequences.set(serial, diagnostic.sequence);
    iosMutationAttemptDiagnostics.set(serial, diagnostic);
    throw new IosMutationOutcomeUnknownError(
      diagnostic,
      supervisedFinish.persistenceError,
      supervisedFinish.mutationId ? { serial, mutationId: supervisedFinish.mutationId } : undefined,
    );
  }
  const diagnostic = mutationDiagnostic(serial, operation, "completed");
  iosMutationSequences.set(serial, diagnostic.sequence);
  iosMutationAttemptDiagnostics.set(serial, diagnostic);
  recordConfirmedIosInput(serial, operation);
  return result;
}
