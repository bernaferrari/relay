import { CheckCircle2 } from "lucide-react";

/** Show the consequence beside the work, including the frozen execution target. */
export function RecordingReviewStatus({
  canApprove,
  runsBeforeSave,
  pendingAction,
  savePhase,
  deviceName,
  deviceDetail,
  replayOutcome,
  verificationSource,
}: {
  canApprove: boolean;
  runsBeforeSave: boolean;
  pendingAction?: "replay" | "edit" | "approve";
  savePhase?: "checking" | "saving";
  deviceName: string;
  deviceDetail?: string;
  replayOutcome?: string;
  verificationSource?: string;
}) {
  const label =
    pendingAction === "edit"
      ? "Saving step changes…"
      : pendingAction === "replay" || savePhase === "checking"
        ? `Running on ${deviceName}…`
        : pendingAction === "approve"
          ? "Saving test…"
          : canApprove && !runsBeforeSave
            ? "Verified"
            : replayOutcome === "failed"
              ? "Run failed"
              : replayOutcome === "cancelled"
                ? "Run cancelled"
                : runsBeforeSave
                  ? `Runs on ${deviceName}`
                  : undefined;
  if (!label) return null;
  return (
    <p
      className={`flex flex-wrap items-center gap-1.5 text-xs ${canApprove && !runsBeforeSave && !pendingAction ? "text-success" : "text-muted-foreground"}`}
      role="status"
      aria-label="Recording status"
      title={
        canApprove && !runsBeforeSave
          ? `${verificationSource === "recording" ? "Recording" : "Replay"} verified on ${deviceName}. Ready to save.`
          : undefined
      }
    >
      {canApprove && !runsBeforeSave && !pendingAction ? (
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
      ) : null}
      <span>{label}</span>
      {runsBeforeSave && deviceDetail && deviceDetail !== deviceName ? (
        <span>· {deviceDetail}</span>
      ) : null}
    </p>
  );
}
