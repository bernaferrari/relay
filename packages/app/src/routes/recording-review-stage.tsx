/** @jsxImportSource react */
import type { AuthoringTarget } from "@relay/protocol";
import type { ComponentProps } from "react";
import { LiveNativeRunPreview } from "./live-native-run-preview";
import { RecordingEvidencePanel } from "./recording-review-panels";
import type { useRecordingReviewEvidence } from "./use-recording-review-evidence";

type EvidencePanelProps = ComponentProps<typeof RecordingEvidencePanel>;

/** Watch execution without exposing device controls or changing the reviewed capture. */
export function RecordingReviewStage({
  replaying,
  target,
  targetName,
  evidence,
  ...capture
}: Pick<
  EvidencePanelProps,
  | "action"
  | "stepNumber"
  | "evidenceRole"
  | "onEvidenceSelect"
  | "onEvidenceRoleChange"
  | "onShowReplayFailure"
> & {
  replaying: boolean;
  target?: AuthoringTarget;
  targetName: string;
  evidence: ReturnType<typeof useRecordingReviewEvidence>;
}) {
  if (
    replaying &&
    target?.kind === "device" &&
    (target.platform === "android" || target.platform === "ios")
  ) {
    return (
      <div className="flex h-full min-h-0 p-3">
        <LiveNativeRunPreview
          target={{ platform: target.platform, targetId: target.targetId }}
          targetName={targetName}
          fallbackCaption="Recorded screenshot · not live"
          fallback={
            evidence.evidenceUrl ? (
              <img
                src={evidence.evidenceUrl}
                alt="Recorded screenshot"
                className="block max-h-full max-w-full rounded-md object-contain"
              />
            ) : undefined
          }
        />
      </div>
    );
  }
  return (
    <RecordingEvidencePanel
      {...capture}
      exactMoment={Boolean(evidence.matchingEvidence)}
      controls={evidence.evidencePreview.data?.controls ?? []}
      previewUrl={evidence.evidenceUrl}
      loading={Boolean(
        evidence.evidence &&
        !evidence.evidencePreview.error &&
        (!evidence.evidencePreview.data || !evidence.evidenceUrl),
      )}
      fullPage={evidence.evidencePreview.data?.fullPage}
      failureEvidence={Boolean(evidence.failureEvidence)}
      showingReplayFailure={evidence.showingReplayFailure}
    />
  );
}
