export type RecordingObservedEffect = "applied" | "not-observed" | "uncertain";

export type RecordingInputOutcome =
  | {
      kind: "confirmed";
      mutationId?: string;
      observed?: RecordingObservedEffect;
      resolvedBy?: { at: number; actor?: string; authority?: "server" };
    }
  | {
      kind: "not-dispatched";
      message: string;
      mutationId?: string;
      observed?: RecordingObservedEffect;
      resolvedBy?: { at: number; actor?: string; authority?: "server" };
    }
  | {
      kind: "refresh-failed";
      message: string;
      mutationId?: string;
      observed?: RecordingObservedEffect;
      resolvedBy?: { at: number; actor?: string; authority?: "server" };
    }
  | {
      kind: "unknown";
      message: string;
      mutationId?: string;
      observed?: RecordingObservedEffect;
      resolvedBy?: { at: number; actor?: string; authority?: "server" };
    };

export type RecordingReconcileServerOutcome = "applied" | "not-applied" | "ambiguous";

export type RecordingTargetHealthProjection = {
  input: {
    state: "ready" | "blocked" | "uncertain";
    pendingMutationId?: string;
    reason?: string;
  };
};

export type RecordingReconcileAuthorityReceipt = {
  mutationId: string;
  resolutionId?: string;
  outcome?: RecordingReconcileServerOutcome;
  health?: RecordingTargetHealthProjection["input"];
  observation?: unknown;
};

export type RecordingReconcileAuthority = {
  serial: string;
  actor?: string;
  reconcile: (input: {
    serial: string;
    mutationId: string;
    outcome: RecordingReconcileServerOutcome;
  }) => Promise<RecordingReconcileAuthorityReceipt>;
  fetchReceipt?: (input: {
    serial: string;
    mutationId?: string;
    resolutionId?: string;
  }) => Promise<RecordingReconcileAuthorityReceipt>;
};

export async function fetchRecordingReconcileReceipt(input: {
  authority: RecordingReconcileAuthority;
  mutationId?: string;
  resolutionId?: string;
}): Promise<RecordingReconcileAuthorityReceipt> {
  if (!input.authority.fetchReceipt) {
    throw new TypeError("Relay cannot retrieve a reconciliation receipt from this host.");
  }
  const receipt = await input.authority.fetchReceipt({
    serial: input.authority.serial,
    ...(input.mutationId ? { mutationId: input.mutationId } : {}),
    ...(input.resolutionId ? { resolutionId: input.resolutionId } : {}),
  });
  if (input.mutationId && receipt.mutationId !== input.mutationId) {
    throw new TypeError("Relay returned a receipt for a different mutation.");
  }
  if (input.resolutionId && receipt.resolutionId && receipt.resolutionId !== input.resolutionId) {
    throw new TypeError("Relay returned a different reconciliation receipt.");
  }
  return receipt;
}

export function reconcileObservedFromServerReceipt(
  receipt: RecordingReconcileAuthorityReceipt,
): RecordingObservedEffect {
  if (receipt.health?.state === "uncertain") return "uncertain";
  if (receipt.outcome === "not-applied") return "not-observed";
  if (receipt.outcome === "ambiguous") return "uncertain";
  if (receipt.outcome === "applied") return "applied";
  return "uncertain";
}

/** Server outcome is authority. Ready is not applied. A missing outcome is
 * uncertain — never echo the request. */
export function reconcileOutcomeFromServerResponse(input: {
  returned?: RecordingReconcileServerOutcome;
  healthState?: RecordingTargetHealthProjection["input"]["state"];
}): RecordingReconcileServerOutcome {
  if (
    input.returned === "applied" ||
    input.returned === "not-applied" ||
    input.returned === "ambiguous"
  ) {
    return input.returned;
  }
  if (input.healthState === "uncertain") return "ambiguous";
  return "ambiguous";
}

const SUPERVISED_MUTATION_ID = /^(ios-input-|browser-input-)/u;

export function isSupervisedRecordingMutationId(mutationId: string | undefined): boolean {
  return Boolean(mutationId && SUPERVISED_MUTATION_ID.test(mutationId));
}

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
    return {
      mutations: (value as RecordingRecoveryLedger).mutations.map((mutation) => {
        // This exact legacy error was raised by the renderer before onInteraction.
        // Never reinterpret a server-owned mutation or a generic transport failure.
        if (
          mutation.kind === "unknown" &&
          mutation.mutationId?.startsWith("recording-mutation-") &&
          mutation.message === "Relay could not verify the device size. Reconnect before recording."
        ) {
          return {
            ...mutation,
            kind: "not-dispatched" as const,
            message: "Relay couldn’t read the device screen size.",
          };
        }
        return mutation;
      }),
    };
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

/** Prefer the durable supervisor mutation id when the server already assigned one. */
export function supervisedRecordingMutationId(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as { mutationId?: unknown; body?: unknown; cause?: unknown };
  if (typeof record.mutationId === "string" && record.mutationId.trim()) {
    return record.mutationId.trim();
  }
  if (record.body && typeof record.body === "object") {
    const mutationId = (record.body as { mutationId?: unknown }).mutationId;
    if (typeof mutationId === "string" && mutationId.trim()) return mutationId.trim();
  }
  return supervisedRecordingMutationId(record.cause);
}

export function recordingReconcileServerOutcome(
  observed: RecordingObservedEffect,
): RecordingReconcileServerOutcome {
  if (observed === "applied") return "applied";
  if (observed === "not-observed") return "not-applied";
  return "ambiguous";
}

/** Only thrown before a device mutation is dispatched. */
export class RecordingInputNotSentError extends Error {}

/** Post-send transport errors stay unknown unless a typed receipt or a local
 * pre-dispatch check proved the input never left this client. */
export function classifyDispatchFailure(
  error: unknown,
  receipt?: RecordingDispatchReceipt,
): RecordingInputOutcome {
  const message = errorText(error);
  if (error instanceof RecordingInputNotSentError) return { kind: "not-dispatched", message };
  if (receipt?.kind === "local-preflight-refused") {
    return { kind: "not-dispatched", message: receipt.message };
  }
  if (receipt?.kind === "typed" && receipt.dispatched === false) {
    return { kind: "not-dispatched", message: receipt.message ?? message };
  }
  return {
    kind: "unknown",
    message,
    ...(supervisedRecordingMutationId(error)
      ? { mutationId: supervisedRecordingMutationId(error) }
      : {}),
  };
}

export function recordingInputRecoveryMessage(outcome: RecordingInputOutcome): string | undefined {
  if (outcome.kind === "confirmed") return undefined;
  if (outcome.kind === "not-dispatched") {
    return `The interaction was not sent. ${outcome.message} You can try again.`;
  }
  if (outcome.kind === "refresh-failed") {
    return "The interaction reached the app, but Relay could not refresh the recording. Refresh the steps instead of tapping again.";
  }
  return "Recording paused: Relay lost confirmation of the last interaction. Check the app preview below before continuing; sending it again could repeat the action.";
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
  resolvedBy?: { actor?: string; authority?: "server" },
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
    resolvedBy: {
      at: now,
      ...(resolvedBy?.actor ? { actor: resolvedBy.actor } : {}),
      ...(resolvedBy?.authority ? { authority: resolvedBy.authority } : {}),
    },
  });
}

/** Merge a local projection with the durable target fence. Server pending
 * mutation identity wins; client-only unknowns stay so remount cannot invent
 * a dispatch that never reached the supervisor. */
export function hydrateRecordingLedger(input: {
  projection: RecordingRecoveryLedger;
  health: RecordingTargetHealthProjection;
}): RecordingRecoveryLedger {
  const pendingId =
    input.health.input.state === "uncertain"
      ? input.health.input.pendingMutationId?.trim() || undefined
      : undefined;
  const retained = input.projection.mutations.flatMap((mutation) => {
    if (pendingId && mutation.mutationId === pendingId) {
      if (mutation.observed === "applied") {
        const { observed: _observed, resolvedBy: _resolvedBy, ...rest } = mutation;
        return [rest];
      }
      return [mutation];
    }
    if (
      mutation.kind === "unknown" &&
      isSupervisedRecordingMutationId(mutation.mutationId) &&
      !mutation.observed
    ) {
      return [];
    }
    return [mutation];
  });
  if (pendingId && !retained.some((mutation) => mutation.mutationId === pendingId)) {
    return appendRecordingMutation(
      { mutations: retained },
      {
        kind: "unknown",
        mutationId: pendingId,
        message:
          input.health.input.reason?.trim() ||
          "Relay could not confirm whether the last interaction reached the app.",
      },
    );
  }
  return { mutations: retained };
}

export function hydrateRecordingRecoveryView(input: {
  projection: RecordingRecoveryLedger;
  health?: RecordingTargetHealthProjection;
}): {
  ledger: RecordingRecoveryLedger;
  recoveryKind: RecordingInputOutcome["kind"];
  issue?: string;
} {
  const ledger = input.health
    ? hydrateRecordingLedger({ projection: input.projection, health: input.health })
    : input.projection;
  const unresolved =
    unresolvedRecordingMutation(ledger, "unknown") ??
    unresolvedRecordingMutation(ledger, "refresh-failed");
  if (!unresolved) return { ledger, recoveryKind: "confirmed" };
  const issue =
    recordingInputRecoveryMessage(unresolved) ??
    ("message" in unresolved ? unresolved.message : undefined);
  return {
    ledger,
    recoveryKind: unresolved.kind,
    ...(issue ? { issue } : {}),
  };
}

/** Remount prefers the Device fence. A dispatch that landed while health was
 * in flight must not be erased by a stale ready snapshot. */
export function mergeHydratedRecordingLedger(input: {
  stored: RecordingRecoveryLedger;
  inMemory: RecordingRecoveryLedger;
  health?: RecordingTargetHealthProjection;
}): ReturnType<typeof hydrateRecordingRecoveryView> {
  const inFlight = input.inMemory.mutations.length > 0;
  if (inFlight && input.health?.input.state !== "uncertain") {
    return hydrateRecordingRecoveryView({ projection: input.inMemory });
  }
  return hydrateRecordingRecoveryView({
    projection: inFlight ? input.inMemory : input.stored,
    ...(input.health ? { health: input.health } : {}),
  });
}

/** Server receipt is authority. The local ledger is only a projection. */
export async function reconcileRecordingMutationAuthoritatively(input: {
  ledger: RecordingRecoveryLedger;
  mutationId: string;
  observed: RecordingObservedEffect;
  authority: RecordingReconcileAuthority;
  now?: number;
}): Promise<RecordingRecoveryLedger> {
  const receipt = await input.authority.reconcile({
    serial: input.authority.serial,
    mutationId: input.mutationId,
    outcome: recordingReconcileServerOutcome(input.observed),
  });
  if (receipt.mutationId !== input.mutationId) {
    throw new TypeError("Relay reconciled a different mutation.");
  }
  const pending = receipt.health?.pendingMutationId;
  if (pending && pending !== input.mutationId) {
    throw new TypeError("Relay still holds a different pending mutation.");
  }
  return reconcileRecordingMutation(
    input.ledger,
    input.mutationId,
    reconcileObservedFromServerReceipt(receipt),
    input.now ?? Date.now(),
    { actor: input.authority.actor, authority: "server" },
  );
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
    const classified = classifyDispatchFailure(error, input.receipt);
    return withMutationId(classified, classified.mutationId ?? mutationId);
  }
  try {
    await input.refresh();
    return { kind: "confirmed", mutationId };
  } catch (error) {
    return { kind: "refresh-failed", mutationId, message: errorText(error) };
  }
}
