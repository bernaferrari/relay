export type RecordingObservedEffect = "applied" | "not-observed" | "uncertain";

export type RecordingInputOutcome =
  | {
      kind: "confirmed";
      mutationId?: string;
      observed?: RecordingObservedEffect;
      resolvedBy?: { at: number };
    }
  | {
      kind: "not-dispatched";
      message: string;
      mutationId?: string;
      observed?: RecordingObservedEffect;
      resolvedBy?: { at: number };
    }
  | {
      kind: "refresh-failed";
      message: string;
      mutationId?: string;
      observed?: RecordingObservedEffect;
      resolvedBy?: { at: number };
    }
  | {
      kind: "unknown";
      message: string;
      mutationId?: string;
      observed?: RecordingObservedEffect;
      resolvedBy?: { at: number };
    };

export function recordingLedgerStorageKey(workflowId: string): string {
  return `recording-mutation-ledger:${workflowId}`;
}

export function parseRecordingLedger(raw: string | null | undefined): RecordingRecoveryLedger {
  if (!raw) return { mutations: [] };
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !Array.isArray((value as { mutations?: unknown }).mutations)
    ) {
      return { mutations: [] };
    }
    return { mutations: (value as RecordingRecoveryLedger).mutations };
  } catch {
    return { mutations: [] };
  }
}

export function serializeRecordingLedger(ledger: RecordingRecoveryLedger): string {
  return JSON.stringify(ledger);
}

export type RecordingDispatchReceipt =
  | { kind: "local-preflight-refused"; message: string }
  | { kind: "typed"; dispatched: boolean; message?: string };

export type RecordingRecoveryLedger = {
  mutations: RecordingInputOutcome[];
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nextMutationId(): string {
  return `recording-mutation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function withMutationId(outcome: RecordingInputOutcome, mutationId: string): RecordingInputOutcome {
  return { ...outcome, mutationId };
}

/** Post-send transport errors stay unknown unless a typed receipt or a local
 * pre-dispatch check proved the input never left this client. */
export function classifyDispatchFailure(
  error: unknown,
  receipt?: RecordingDispatchReceipt,
): RecordingInputOutcome {
  const message = errorText(error);
  if (receipt?.kind === "local-preflight-refused") {
    return { kind: "not-dispatched", message: receipt.message };
  }
  if (receipt?.kind === "typed" && receipt.dispatched === false) {
    return { kind: "not-dispatched", message: receipt.message ?? message };
  }
  return { kind: "unknown", message };
}

export function recordingInputRecoveryMessage(outcome: RecordingInputOutcome): string | undefined {
  if (outcome.kind === "confirmed") return undefined;
  if (outcome.kind === "not-dispatched") {
    return "The last interaction was not sent. Try it again before stopping.";
  }
  if (outcome.kind === "refresh-failed") {
    return "The interaction reached the app, but Relay could not refresh the recording. Refresh the steps instead of tapping again.";
  }
  return "Relay could not confirm whether the last interaction reached the app. Observe the app before sending more input.";
}

export function recordingRecoveryBlocksSend(ledger: RecordingRecoveryLedger | undefined): boolean {
  return Boolean(
    unresolvedRecordingMutation(ledger, "unknown") ||
    unresolvedRecordingMutation(ledger, "refresh-failed"),
  );
}

/** Latest mutation that still needs refresh-only recovery or an explicit observe.
 * An applied observation unblocks unknown dispatch; Not sure and not-observed do not. */
export function unresolvedRecordingMutation(
  ledger: RecordingRecoveryLedger | undefined,
  kind: "unknown" | "refresh-failed",
): RecordingInputOutcome | undefined {
  return [...(ledger?.mutations ?? [])]
    .reverse()
    .find(
      (mutation) =>
        mutation.kind === kind && (kind === "refresh-failed" || mutation.observed !== "applied"),
    );
}

export function appendRecordingMutation(
  ledger: RecordingRecoveryLedger | undefined,
  outcome: RecordingInputOutcome,
): RecordingRecoveryLedger {
  return { mutations: [...(ledger?.mutations ?? []), outcome] };
}

export function resolveRecordingMutation(
  ledger: RecordingRecoveryLedger,
  mutationId: string,
  resolution: RecordingInputOutcome,
): RecordingRecoveryLedger {
  return {
    mutations: ledger.mutations.map((mutation) =>
      mutation.mutationId === mutationId ? { ...resolution, mutationId } : mutation,
    ),
  };
}

/** Refresh recording evidence without sending input again. */
export async function refreshRecordingEvidence(input: {
  refresh: () => Promise<void>;
  mutationId?: string;
}): Promise<RecordingInputOutcome> {
  const mutationId = input.mutationId ?? nextMutationId();
  try {
    await input.refresh();
    return { kind: "confirmed", mutationId };
  } catch (error) {
    return { kind: "refresh-failed", mutationId, message: errorText(error) };
  }
}

export function reconcileRecordingMutation(
  ledger: RecordingRecoveryLedger,
  mutationId: string,
  observed: RecordingObservedEffect,
  now = Date.now(),
): RecordingRecoveryLedger {
  const current = ledger.mutations.find((mutation) => mutation.mutationId === mutationId);
  if (!current) return ledger;
  const message =
    observed === "not-observed"
      ? "Observed: no visible effect. That does not prove the command never left this client."
      : observed === "uncertain"
        ? "Observed: not sure whether the interaction applied."
        : current.kind === "unknown" || current.kind === "refresh-failed"
          ? current.message
          : undefined;
  return resolveRecordingMutation(ledger, mutationId, {
    ...current,
    ...(message ? { message } : {}),
    observed,
    resolvedBy: { at: now },
  });
}

/** Dispatch and evidence refresh are separate outcomes. A refresh failure must
 * not be treated as "the tap never happened." */
export async function dispatchRecordingInput(input: {
  send: () => Promise<void>;
  refresh: () => Promise<void>;
  preflight?: () => { ok: true } | { ok: false; message: string };
  receipt?: RecordingDispatchReceipt;
  ledger?: RecordingRecoveryLedger;
  mutationId?: string;
}): Promise<RecordingInputOutcome> {
  const mutationId = input.mutationId ?? nextMutationId();
  if (recordingRecoveryBlocksSend(input.ledger)) {
    return {
      kind: "unknown",
      mutationId,
      message:
        "An earlier interaction is still unconfirmed. Observe the app before sending more input.",
    };
  }
  const preflight = input.preflight?.();
  if (preflight && preflight.ok === false) {
    return withMutationId(
      classifyDispatchFailure(new Error(preflight.message), {
        kind: "local-preflight-refused",
        message: preflight.message,
      }),
      mutationId,
    );
  }
  try {
    await input.send();
  } catch (error) {
    return withMutationId(classifyDispatchFailure(error, input.receipt), mutationId);
  }
  try {
    await input.refresh();
    return { kind: "confirmed", mutationId };
  } catch (error) {
    return { kind: "refresh-failed", mutationId, message: errorText(error) };
  }
}
