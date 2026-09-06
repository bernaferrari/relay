export type RecordingInputOutcome =
  | { kind: "confirmed"; mutationId?: string }
  | { kind: "not-dispatched"; message: string; mutationId?: string }
  | { kind: "refresh-failed"; message: string; mutationId?: string }
  | { kind: "unknown"; message: string; mutationId?: string };

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
    ledger?.mutations.some(
      (mutation) => mutation.kind === "unknown" || mutation.kind === "refresh-failed",
    ),
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
  observed: "applied" | "not-applied",
): RecordingRecoveryLedger {
  return resolveRecordingMutation(ledger, mutationId, {
    kind: observed === "applied" ? "confirmed" : "not-dispatched",
    message:
      observed === "not-applied" ? "Observed: the interaction did not reach the app." : undefined,
  } as RecordingInputOutcome);
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
