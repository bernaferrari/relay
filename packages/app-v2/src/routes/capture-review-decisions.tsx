import { Check, Flag, ImagePlus } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import type { CaptureReviewAction } from "@relay/protocol";

export function CaptureReviewDecisions({
  busy,
  onReview,
}: {
  busy?: boolean;
  onReview(action: CaptureReviewAction): void;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-1 rounded-xl border border-border/60 bg-card/95 p-1.5 shadow-lg backdrop-blur-md"
      aria-label="Screenshot review decision"
      aria-busy={busy}
    >
      <Button
        size="sm"
        className="min-h-10 gap-2 rounded-lg"
        variant="secondary"
        disabled={busy}
        onClick={() => onReview("accept")}
      >
        <Check className="size-4" aria-hidden="true" /> Looks correct
      </Button>
      <Button
        size="sm"
        className="min-h-10 gap-2 rounded-lg"
        variant="ghost"
        disabled={busy}
        onClick={() => onReview("report-issue")}
      >
        <Flag className="size-4" aria-hidden="true" /> Report issue
      </Button>
      <Button
        size="sm"
        className="min-h-10 gap-2 rounded-lg"
        variant="ghost"
        disabled={busy}
        onClick={() => onReview("need-more-evidence")}
      >
        <ImagePlus className="size-4" aria-hidden="true" /> Need more evidence
      </Button>
    </div>
  );
}
