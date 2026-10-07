import { describe, expect, it, vi } from "vitest";
import type { RecordingRecoveryLedger } from "./recording-input-outcome";
import type { ProductRecordingState } from "./recording-product-service";
import { prepareRecordingStop, recordingStopBlockedReason } from "./recording-stop-state";

const ready = {
  status: "recording",
  snapshot: { allowedNextActions: ["stop"] },
} as unknown as ProductRecordingState;

describe("recording Stop admission", () => {
  it("explains unresolved input and does not inspect or Stop while blocked", async () => {
    const ledger: RecordingRecoveryLedger = {
      mutations: [{ kind: "unknown", mutationId: "one", message: "Lost receipt" }],
    };
    expect(recordingStopBlockedReason(ledger)).toBe(
      "Confirm the last interaction before stopping.",
    );
    const inspect = vi.fn(async () => ready);
    await expect(
      prepareRecordingStop({
        outcome: Promise.resolve(ledger.mutations[0]),
        ledger: () => ledger,
        refreshOnly: vi.fn(),
        inspect,
      }),
    ).resolves.toBe("Confirm the last interaction before stopping.");
    expect(inspect).not.toHaveBeenCalled();
  });
  it("permits Stop immediately after an authoritative applied observation without new input", async () => {
    const ledger: RecordingRecoveryLedger = {
      mutations: [
        {
          kind: "unknown",
          mutationId: "one",
          message: "Delayed receipt",
          observed: "applied",
          resolvedBy: { at: 100, authority: "server" },
        },
      ],
    };
    expect(recordingStopBlockedReason(ledger)).toBeUndefined();
    const inspect = vi.fn(async () => ready);
    await expect(
      prepareRecordingStop({
        outcome: Promise.resolve(ledger.mutations[0]),
        ledger: () => ledger,
        refreshOnly: vi.fn(),
        inspect,
      }),
    ).resolves.toBeUndefined();
    expect(inspect).toHaveBeenCalledOnce();
  });
  it("refreshes steps after refresh failure without sending the interaction again", async () => {
    let ledger: RecordingRecoveryLedger = {
      mutations: [{ kind: "refresh-failed", mutationId: "one", message: "Refresh failed" }],
    };
    const outcome = ledger.mutations[0];
    expect(recordingStopBlockedReason(ledger)).toBe("Refresh the recorded steps before stopping.");
    const refreshOnly = vi.fn(async () => {
      ledger = { mutations: [{ kind: "confirmed", mutationId: "one" }] };
    });
    await expect(
      prepareRecordingStop({
        outcome: Promise.resolve(outcome),
        ledger: () => ledger,
        refreshOnly,
        inspect: async () => ready,
      }),
    ).resolves.toBeUndefined();
    expect(refreshOnly).toHaveBeenCalledOnce();
  });
  it("drains input then honors the latest canonical Stop authority", async () => {
    let finish!: () => void;
    const input = new Promise<{ kind: "confirmed" }>((resolve) => {
      finish = () => resolve({ kind: "confirmed" });
    });
    const inspect = vi.fn(
      async () =>
        ({ ...ready, snapshot: { allowedNextActions: [] } }) as unknown as ProductRecordingState,
    );
    const result = prepareRecordingStop({
      outcome: input,
      ledger: () => ({ mutations: [] }),
      refreshOnly: vi.fn(),
      inspect,
    });
    expect(inspect).not.toHaveBeenCalled();
    finish();
    await expect(result).resolves.toMatch(/recording changed/);
    expect(inspect).toHaveBeenCalledOnce();
  });
});
