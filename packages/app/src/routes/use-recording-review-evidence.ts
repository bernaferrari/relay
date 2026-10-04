import { useQuery } from "@tanstack/react-query";
import type { AuthoringReview } from "@relay/workflows";
import type { RecordingProductService } from "../data/recording-product-service";
import { useEvidenceObjectUrl, type ReviewAction } from "./recording-review-presentation";

export function useRecordingReviewEvidence({
  service,
  sessionId,
  action,
  evidenceRole,
  selectedEvidenceId,
  failure,
}: {
  service: RecordingProductService;
  sessionId?: string;
  action?: ReviewAction;
  evidenceRole: "entrance" | "exit";
  selectedEvidenceId?: string;
  failure?: NonNullable<AuthoringReview["latestReplay"]>["failedAction"];
}) {
  const failureEvidence =
    failure && failure.actionId === action?.id ? failure.evidence[0] : undefined;
  const matchingEvidence = action?.evidence?.find(
    (candidate) => candidate.kind === "screenshot" && candidate.roles.includes(evidenceRole),
  );
  const evidence =
    (failureEvidence?.id === selectedEvidenceId ? failureEvidence : undefined) ??
    action?.evidence?.find((candidate) => candidate.id === selectedEvidenceId) ??
    matchingEvidence ??
    action?.evidence?.find((candidate) => candidate.kind === "screenshot");
  const evidencePreview = useQuery({
    queryKey: ["recording-evidence-preview", sessionId ?? "unselected", evidence?.id ?? "none"],
    queryFn: () => service.getEvidencePreview(sessionId!, evidence!.id),
    enabled: Boolean(sessionId && evidence),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return {
    matchingEvidence,
    evidence,
    evidencePreview,
    evidenceUrl: useEvidenceObjectUrl(evidencePreview.data),
    failureEvidence,
    showingReplayFailure: Boolean(evidence && evidence.id === failureEvidence?.id),
  };
}
