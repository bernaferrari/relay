import { describe, expect, it } from "vitest";
import {
  classifyDispatchFailure,
  dispatchRecordingInput,
  recordingInputRecoveryMessage,
} from "./recording-input-outcome";

describe("recording input outcome", () => {
  it("treats a successful send and refresh as confirmed", async () => {
    const outcome = await dispatchRecordingInput({
      send: async () => undefined,
      refresh: async () => undefined,
    });
    expect(outcome).toEqual({ kind: "confirmed" });
    expect(recordingInputRecoveryMessage(outcome)).toBeUndefined();
  });

  it("does not advise another tap when only the recording refresh failed", async () => {
    const outcome = await dispatchRecordingInput({
      send: async () => undefined,
      refresh: async () => {
        throw new Error("snapshot timed out");
      },
    });
    expect(outcome).toEqual({ kind: "refresh-failed", message: "snapshot timed out" });
    expect(recordingInputRecoveryMessage(outcome)).toContain("Refresh the steps");
    expect(recordingInputRecoveryMessage(outcome)).not.toMatch(/try it again/i);
  });

  it("offers a retry only when the interaction was definitely not sent", async () => {
    const outcome = await dispatchRecordingInput({
      send: async () => {
        throw new Error("The live view is still connecting.");
      },
      refresh: async () => {
        throw new Error("should not refresh");
      },
    });
    expect(outcome.kind).toBe("not-dispatched");
    expect(recordingInputRecoveryMessage(outcome)).toContain("was not sent");
  });

  it("asks the user to observe when dispatch outcome is unknown", () => {
    const outcome = classifyDispatchFailure(new Error("XCTest lost the acknowledgement"));
    expect(outcome.kind).toBe("unknown");
    expect(recordingInputRecoveryMessage(outcome)).toContain("Observe the app");
    expect(recordingInputRecoveryMessage(outcome)).not.toMatch(/try it again/i);
  });
});
