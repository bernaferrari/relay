import {
  unresolvedRecordingMutation,
  type RecordingInputOutcome,
  type RecordingRecoveryLedger,
} from "./recording-input-outcome";
import type { ProductRecordingState } from "./recording-product-service";

/** The same ledger admission explains the disabled action and protects its
 * final dispatch. An authoritative applied observation resolves unknown input. */
export function recordingStopBlockedReason(
  ledger: RecordingRecoveryLedger,
  fallback?: RecordingInputOutcome,
): string | undefined {
  if (unresolvedRecordingMutation(ledger, "unknown"))
    return "Confirm the last interaction before stopping.";
  if (unresolvedRecordingMutation(ledger, "refresh-failed"))
    return "Refresh the recorded steps before stopping.";
  const last = ledger.mutations.at(-1) ?? fallback;
  if (last?.kind === "unknown" && last.observed !== "applied")
    return "Confirm the last interaction before stopping.";
  if (last?.kind === "refresh-failed") return "Refresh the recorded steps before stopping.";
}

/** Drain the owned input and re-check the canonical recording before Stop.
 * This never dispatches device input or repeats the Stop mutation. */
export async function prepareRecordingStop(input: {
  outcome: Promise<RecordingInputOutcome>;
  ledger(): RecordingRecoveryLedger;
  refreshOnly(): Promise<void>;
  inspect(): Promise<ProductRecordingState>;
}): Promise<string | undefined> {
  const outcome = await input.outcome.catch((): RecordingInputOutcome => ({
    kind: "unknown",
    message: "The last interaction did not finish cleanly.",
  }));
  if (outcome.kind === "refresh-failed") await input.refreshOnly();
  const blocked = recordingStopBlockedReason(input.ledger(), outcome);
  if (blocked) return blocked;
  const latest = await input.inspect();
  if (
    latest.recovery ||
    latest.status !== "recording" ||
    !latest.snapshot?.allowedNextActions.includes("stop")
  )
    return "The recording changed while the interaction was finishing. Refresh before stopping.";
}
