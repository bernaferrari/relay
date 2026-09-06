import { describe, expect, it } from "vitest";
import {
  appendRecordingMutation,
  classifyDispatchFailure,
  dispatchRecordingInput,
  recordingInputRecoveryMessage,
  recordingRecoveryBlocksSend,
  reconcileRecordingMutation,
  refreshRecordingEvidence,
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
    const reconciled = reconcileRecordingMutation(ledger, unknown.mutationId!, "not-applied");
    expect(recordingRecoveryBlocksSend(reconciled)).toBe(false);
    const later = await dispatchRecordingInput({
      ledger: reconciled,
      send: async () => {
        sendCount += 1;
      },
      refresh: async () => undefined,
    });
    expect(later.kind).toBe("confirmed");
    expect(sendCount).toBe(2);
    expect(
      reconciled.mutations.some((mutation) => mutation.mutationId === unknown.mutationId),
    ).toBe(true);
  });
});
