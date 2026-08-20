/**
 * Exact-once policy for physical iOS XCTest mutations.
 *
 * This is intentionally separate from device.ts: read retries and native
 * mutation safety are different concerns, and keeping them together makes it
 * too easy to reintroduce a generic retry around a tap.
 */
import { cooperativeCheckpoint, raceCancel, throwIfCancelled } from "./control.js";
import { currentTargetContext } from "./target-context.js";
import { TargetControlReservedError } from "./target-control.js";

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
  outcome: "completed" | "selector-miss" | "outcome-unknown";
  retry: {
    attempts: 0;
    decision: "not-needed" | "safe-selector-fallback" | "blocked";
    reason:
      | "native-command-completed"
      | "selector-was-not-dispatched"
      | "native-command-outcome-unknown";
  };
  intervention: {
    required: boolean;
    action: "none" | "capture-current-screen-before-any-retry";
  };
  at: number;
};

const iosMutationAttemptDiagnostics = new Map<string, IosMutationAttemptDiagnostic>();
const iosMutationSequences = new Map<string, number>();

export function lastIosMutationAttemptDiagnostic(
  serial: string,
): IosMutationAttemptDiagnostic | undefined {
  const value = iosMutationAttemptDiagnostics.get(serial);
  return value ? structuredClone(value) : undefined;
}

/** A typed, reviewable stop rather than an optimistic second device command. */
export class IosMutationOutcomeUnknownError extends Error {
  readonly iosMutation: IosMutationAttemptDiagnostic;
  readonly cause: unknown;

  constructor(diagnostic: IosMutationAttemptDiagnostic, cause: unknown) {
    super(
      `The iOS ${diagnostic.operation} may already have reached the device. Relay did not retry it. Capture the current screen, review the outcome, then explicitly choose retry or repair.`,
    );
    this.name = "IosMutationOutcomeUnknownError";
    this.iosMutation = diagnostic;
    this.cause = cause;
  }
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
  if (error instanceof IosMutationOutcomeUnknownError) return mutationErrorMessage(error.cause);
  return error instanceof Error ? error.message : String(error);
}

/**
 * Only a native, selector-specific rejection is safe to reinterpret as “no
 * command was dispatched”. Timeout, connection, runner, or generic lookup
 * failures remain ambiguous and must stop for evidence rather than trying a
 * coordinate press.
 */
export function iosSelectorWasNotDispatched(error: unknown): boolean {
  const message = mutationErrorMessage(error).trim();
  return /^(?:native )?(?:selector )?(?:did not match an element|no match(?:ing element)?|element not found)(?:[.!])?$/i.test(
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
): IosMutationAttemptDiagnostic {
  const selectorMiss = outcome === "selector-miss";
  const unknown = outcome === "outcome-unknown";
  return {
    sequence: (iosMutationSequences.get(serial) ?? 0) + 1,
    operation,
    nativeAttempts: 1,
    outcome,
    retry: {
      attempts: 0,
      decision: selectorMiss ? "safe-selector-fallback" : unknown ? "blocked" : "not-needed",
      reason: selectorMiss
        ? "selector-was-not-dispatched"
        : unknown
          ? "native-command-outcome-unknown"
          : "native-command-completed",
    },
    intervention: {
      required: unknown,
      action: unknown ? "capture-current-screen-before-any-retry" : "none",
    },
    at: Date.now(),
  };
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
  try {
    const result = await raceCancel(op());
    const diagnostic = mutationDiagnostic(serial, operation, "completed");
    iosMutationSequences.set(serial, diagnostic.sequence);
    iosMutationAttemptDiagnostics.set(serial, diagnostic);
    return result;
  } catch (error) {
    // The target lane rejects before it invokes the native SDK callback, so
    // this is not an ambiguous device outcome and must not manufacture a
    // “one native attempt” diagnostic for a command that never left Relay.
    if (error instanceof TargetControlReservedError) throw error;
    const diagnostic = mutationDiagnostic(
      serial,
      operation,
      iosSelectorWasNotDispatched(error) ? "selector-miss" : "outcome-unknown",
    );
    iosMutationSequences.set(serial, diagnostic.sequence);
    iosMutationAttemptDiagnostics.set(serial, diagnostic);
    attachIosMutationDiagnostic(error, diagnostic);
    // Preserve cancellation semantics for the job controller, while still
    // recording that an already-dispatched command has an unknown outcome.
    if (error instanceof Error && error.name === "JobCancelledError") throw error;
    if (diagnostic.outcome === "selector-miss") throw error;
    throw new IosMutationOutcomeUnknownError(diagnostic, error);
  }
}
