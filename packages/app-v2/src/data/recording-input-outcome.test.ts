import { describe, expect, it } from "vitest";
import {
  appendRecordingMutation,
  classifyDispatchFailure,
  dispatchRecordingInput,
  recordingInputRecoveryMessage,
  recordingRecoveryBlocksSend,
  hydrateRecordingLedger,
  hydrateRecordingRecoveryView,
  isSupervisedRecordingMutationId,
  mergeHydratedRecordingLedger,
  reconcileRecordingMutation,
  reconcileObservedFromServerReceipt,
  reconcileRecordingMutationAuthoritatively,
  recordingReconcileServerOutcome,
  supervisedRecordingMutationId,
  refreshRecordingEvidence,
  unresolvedRecordingMutation,
} from "./recording-input-outcome";

describe("recording input outcome", () => {
  it("treats a successful send and refresh as confirmed", async () => {
    const outcome = await dispatchRecordingInput({
      send: async () => undefined,
      refresh: async () => undefined,
    });
    expect(outcome).toMatchObject({ kind: "confirmed" });
    expect(recordingInputRecoveryMessage(outcome)).toBeUndefined();
  });

  it("does not advise another tap when only the recording refresh failed", async () => {
    const outcome = await dispatchRecordingInput({
      send: async () => undefined,
      refresh: async () => {
        throw new Error("snapshot timed out");
      },
    });
    expect(outcome).toMatchObject({ kind: "refresh-failed", message: "snapshot timed out" });
    expect(recordingInputRecoveryMessage(outcome)).toContain("Refresh the steps");
    expect(recordingInputRecoveryMessage(outcome)).not.toMatch(/try it again/i);
  });

  it("offers a retry only when a local preflight refused to send", async () => {
    let sendCount = 0;
    const outcome = await dispatchRecordingInput({
      preflight: () => ({ ok: false, message: "The live view is still connecting." }),
      send: async () => {
        sendCount += 1;
      },
      refresh: async () => {
        throw new Error("should not refresh");
      },
    });
    expect(outcome.kind).toBe("not-dispatched");
    expect(sendCount).toBe(0);
    expect(recordingInputRecoveryMessage(outcome)).toContain("was not sent");
  });

  it("keeps post-send not-ready wording unknown", async () => {
    const outcome = await dispatchRecordingInput({
      send: async () => {
        throw new Error("Input submitted; runner not ready to acknowledge");
      },
      refresh: async () => {
        throw new Error("should not refresh");
      },
    });
    expect(outcome.kind).toBe("unknown");
    expect(
      classifyDispatchFailure(new Error("Input submitted; runner not ready to acknowledge")).kind,
    ).toBe("unknown");
    expect(recordingInputRecoveryMessage(outcome)).toContain("Observe the app");
    expect(recordingInputRecoveryMessage(outcome)).not.toMatch(/try it again/i);
  });

  it("asks the user to observe when dispatch outcome is unknown", () => {
    const outcome = classifyDispatchFailure(new Error("XCTest lost the acknowledgement"));
    expect(outcome.kind).toBe("unknown");
    expect(recordingInputRecoveryMessage(outcome)).toContain("Observe the app");
    expect(recordingInputRecoveryMessage(outcome)).not.toMatch(/try it again/i);
  });

  it("recovers a refresh failure without sending input again", async () => {
    let sendCount = 0;
    let refreshCount = 0;
    const first = await dispatchRecordingInput({
      send: async () => {
        sendCount += 1;
      },
      refresh: async () => {
        refreshCount += 1;
        throw new Error("snapshot timed out");
      },
    });
    expect(first.kind).toBe("refresh-failed");
    expect(sendCount).toBe(1);
    const recovered = await refreshRecordingEvidence({
      mutationId: first.mutationId,
      refresh: async () => {
        refreshCount += 1;
      },
    });
    expect(recovered.kind).toBe("confirmed");
    expect(sendCount).toBe(1);
    expect(refreshCount).toBe(2);
  });

  it("blocks the next send until an unknown mutation is reconciled", async () => {
    let sendCount = 0;
    const unknown = await dispatchRecordingInput({
      send: async () => {
        sendCount += 1;
        throw new Error("Input submitted; runner not ready to acknowledge");
      },
      refresh: async () => undefined,
    });
    const ledger = appendRecordingMutation(undefined, unknown);
    expect(recordingRecoveryBlocksSend(ledger)).toBe(true);
    const blocked = await dispatchRecordingInput({
      ledger,
      send: async () => {
        sendCount += 1;
      },
      refresh: async () => undefined,
    });
    expect(blocked.kind).toBe("unknown");
    expect(sendCount).toBe(1);
    const reconciled = reconcileRecordingMutation(ledger, unknown.mutationId!, "not-observed");
    expect(reconciled.mutations[0]?.kind).toBe("unknown");
    expect(reconciled.mutations[0]?.observed).toBe("not-observed");
    expect(recordingRecoveryBlocksSend(reconciled)).toBe(true);
    const later = await dispatchRecordingInput({
      ledger: reconciled,
      send: async () => {
        sendCount += 1;
      },
      refresh: async () => undefined,
    });
    expect(later.kind).toBe("unknown");
    expect(sendCount).toBe(1);
    expect(
      reconciled.mutations.some((mutation) => mutation.mutationId === unknown.mutationId),
    ).toBe(true);
    expect(unresolvedRecordingMutation(ledger, "unknown")?.mutationId).toBe(unknown.mutationId);
    expect(unresolvedRecordingMutation(reconciled, "unknown")?.mutationId).toBe(unknown.mutationId);
  });

  it("keeps an applied observation on the same mutation identity without rewriting dispatch", () => {
    const ledger = appendRecordingMutation(undefined, {
      kind: "unknown",
      mutationId: "recording-mutation-observe",
      message: "Input submitted; runner not ready to acknowledge",
    });
    const applied = reconcileRecordingMutation(ledger, "recording-mutation-observe", "applied");
    expect(applied.mutations).toEqual([
      expect.objectContaining({
        kind: "unknown",
        observed: "applied",
        mutationId: "recording-mutation-observe",
      }),
    ]);
    expect(recordingRecoveryBlocksSend(applied)).toBe(false);
  });

  it("keeps Not sure as an observation that still blocks dependent input", () => {
    const ledger = appendRecordingMutation(undefined, {
      kind: "unknown",
      mutationId: "recording-mutation-unsure",
      message: "Input submitted; runner not ready to acknowledge",
    });
    const unsure = reconcileRecordingMutation(ledger, "recording-mutation-unsure", "uncertain");
    expect(unsure.mutations[0]?.kind).toBe("unknown");
    expect(unsure.mutations[0]?.observed).toBe("uncertain");
    expect(recordingRecoveryBlocksSend(unsure)).toBe(true);
  });

  it("keeps the server mutation identity and maps Not sure to ambiguous", () => {
    expect(
      supervisedRecordingMutationId({
        body: { mutationId: "ios-input-reviewed" },
      }),
    ).toBe("ios-input-reviewed");
    expect(recordingReconcileServerOutcome("applied")).toBe("applied");
    expect(recordingReconcileServerOutcome("not-observed")).toBe("not-applied");
    expect(recordingReconcileServerOutcome("uncertain")).toBe("ambiguous");
    expect(
      reconcileObservedFromServerReceipt({
        mutationId: "mut",
        outcome: "not-applied",
        health: { state: "ready" },
      }),
    ).toBe("not-observed");
    expect(
      reconcileObservedFromServerReceipt({
        mutationId: "mut",
        outcome: "applied",
        health: { state: "ready" },
      }),
    ).toBe("applied");
  });

  it("does not apply a local observation until the server receipt matches", async () => {
    const ledger = appendRecordingMutation(undefined, {
      kind: "unknown",
      mutationId: "ios-input-reviewed",
      message: "Input submitted; runner not ready to acknowledge",
    });
    const calls: unknown[] = [];
    await expect(
      reconcileRecordingMutationAuthoritatively({
        ledger,
        mutationId: "ios-input-reviewed",
        observed: "applied",
        authority: {
          serial: "emulator-5554",
          actor: "human:qa",
          reconcile: async () => {
            throw new Error("The target has no matching uncertain mutation to reconcile");
          },
        },
      }),
    ).rejects.toThrow(/matching uncertain mutation/i);
    expect(recordingRecoveryBlocksSend(ledger)).toBe(true);
    const applied = await reconcileRecordingMutationAuthoritatively({
      ledger,
      mutationId: "ios-input-reviewed",
      observed: "applied",
      authority: {
        serial: "emulator-5554",
        actor: "human:qa",
        reconcile: async (input) => {
          calls.push(input);
          return { mutationId: input.mutationId, outcome: input.outcome };
        },
      },
    });
    expect(calls).toEqual([
      { serial: "emulator-5554", mutationId: "ios-input-reviewed", outcome: "applied" },
    ]);
    expect(applied.mutations[0]).toMatchObject({
      kind: "unknown",
      observed: "applied",
      mutationId: "ios-input-reviewed",
      resolvedBy: { actor: "human:qa", authority: "server" },
    });
    expect(recordingRecoveryBlocksSend(applied)).toBe(false);
  });

  it("keeps the mutation uncertain when the server health is still uncertain", async () => {
    const ledger = appendRecordingMutation(undefined, {
      kind: "unknown",
      mutationId: "ios-input-reviewed",
      message: "Input submitted; runner not ready to acknowledge",
    });
    const next = await reconcileRecordingMutationAuthoritatively({
      ledger,
      mutationId: "ios-input-reviewed",
      observed: "applied",
      authority: {
        serial: "emulator-5554",
        actor: "human:qa",
        reconcile: async (input) => ({
          mutationId: input.mutationId,
          outcome: "applied",
          health: { state: "uncertain", pendingMutationId: "ios-input-reviewed" },
        }),
      },
    });
    expect(next.mutations[0]?.observed).toBe("uncertain");
    expect(recordingRecoveryBlocksSend(next)).toBe(true);
  });

  it("hydrates an empty projection from the Device pending mutation", () => {
    expect(isSupervisedRecordingMutationId("ios-input-reviewed")).toBe(true);
    expect(isSupervisedRecordingMutationId("recording-mutation-local")).toBe(false);
    const hydrated = hydrateRecordingLedger({
      projection: { mutations: [] },
      health: {
        input: {
          state: "uncertain",
          pendingMutationId: "ios-input-reviewed",
          reason: "acknowledgement lost",
        },
      },
    });
    expect(hydrated.mutations).toEqual([
      expect.objectContaining({
        kind: "unknown",
        mutationId: "ios-input-reviewed",
        message: "acknowledgement lost",
      }),
    ]);
    expect(recordingRecoveryBlocksSend(hydrated)).toBe(true);
    const view = hydrateRecordingRecoveryView({
      projection: { mutations: [] },
      health: {
        input: {
          state: "uncertain",
          pendingMutationId: "ios-input-reviewed",
          reason: "acknowledgement lost",
        },
      },
    });
    expect(view.recoveryKind).toBe("unknown");
    expect(view.issue).toContain("Observe the app");
  });

  it("does not let a stale local unknown outrank a ready Device fence", () => {
    const projection = appendRecordingMutation(undefined, {
      kind: "unknown",
      mutationId: "ios-input-stale",
      message: "Input submitted; runner not ready to acknowledge",
    });
    const hydrated = hydrateRecordingLedger({
      projection,
      health: { input: { state: "ready" } },
    });
    expect(hydrated.mutations).toEqual([]);
    expect(recordingRecoveryBlocksSend(hydrated)).toBe(false);
  });

  it("keeps a client-only unknown when the Device has no matching receipt", () => {
    const projection = appendRecordingMutation(undefined, {
      kind: "unknown",
      mutationId: "recording-mutation-local",
      message: "The live view disconnected before Relay saw an acknowledgement.",
    });
    const hydrated = hydrateRecordingLedger({
      projection,
      health: { input: { state: "ready" } },
    });
    expect(hydrated.mutations[0]?.mutationId).toBe("recording-mutation-local");
    expect(recordingRecoveryBlocksSend(hydrated)).toBe(true);
  });

  it("keeps Not sure on the same mutation when the Device still fences it", () => {
    const projection = reconcileRecordingMutation(
      appendRecordingMutation(undefined, {
        kind: "unknown",
        mutationId: "ios-input-reviewed",
        message: "Input submitted; runner not ready to acknowledge",
      }),
      "ios-input-reviewed",
      "uncertain",
    );
    const hydrated = hydrateRecordingLedger({
      projection,
      health: {
        input: { state: "uncertain", pendingMutationId: "ios-input-reviewed" },
      },
    });
    expect(hydrated.mutations[0]?.observed).toBe("uncertain");
    expect(recordingRecoveryBlocksSend(hydrated)).toBe(true);
  });

  it("does not drop an in-flight unknown when a stale ready health arrives", () => {
    const inMemory = appendRecordingMutation(undefined, {
      kind: "unknown",
      mutationId: "ios-input-live",
      message: "Input submitted; runner not ready to acknowledge",
    });
    const merged = mergeHydratedRecordingLedger({
      stored: { mutations: [] },
      inMemory,
      health: { input: { state: "ready" } },
    });
    expect(merged.ledger.mutations[0]?.mutationId).toBe("ios-input-live");
    expect(merged.recoveryKind).toBe("unknown");
  });
});
