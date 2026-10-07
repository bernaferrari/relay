import { useMemo } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { RecordingInputOutcome } from "../data/recording-input-outcome";
import type {
  ProductRecordingState,
  RecordingProductService,
} from "../data/recording-product-service";
import { refreshRecording } from "../data/recording-queries";
import { useRecordingInputReceipt } from "./use-recording-input-receipt";

export function recordingConditionUnconfirmed(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "mutation-outcome-unknown",
  );
}

/** A condition with a lost response keeps its draft and blocks a second
 * dispatch. Only this condition's exact applied receipt can release it. */
export function useRecordingConditionRecovery({
  action,
  recording,
  workflowId,
  service,
  queryClient,
}: {
  action: { isError: boolean; error: unknown; variables?: { action: string }; reset(): void };
  recording?: ProductRecordingState;
  workflowId: string;
  service: RecordingProductService;
  queryClient: QueryClient;
}) {
  const error =
    action.isError && action.variables?.action === "condition" ? action.error : undefined;
  const target = recording?.selectedTarget ?? recording?.snapshot?.frozen?.target;
  const failure = useMemo<RecordingInputOutcome | undefined>(() => {
    if (!recordingConditionUnconfirmed(error)) return;
    const reference =
      "recordingMutation" in (error as object)
        ? (error as Extract<RecordingInputOutcome, { kind: "unknown" }>).recordingMutation
        : undefined;
    return {
      kind: "unknown",
      message: error instanceof Error ? error.message : "Condition outcome unknown",
      ...(reference ? { mutationId: reference.mutationId, recordingMutation: reference } : {}),
    };
  }, [error]);
  useRecordingInputReceipt({
    failure,
    workflowId,
    target,
    service,
    onConfirmed: async (_failure, isCurrent) => {
      const current = await refreshRecording(queryClient, service, workflowId);
      if (isCurrent() && !current.recovery && current.snapshot?.workflow?.workflowId === workflowId)
        action.reset();
    },
  });
  return recordingConditionUnconfirmed(error);
}
