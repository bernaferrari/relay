import { Check, Flag, ImagePlus } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import type { CaptureReviewAction } from "@relay/protocol";

export function CaptureReviewDecisions({
  busy,
  onReview,
  status,
  bulkCount,
}: {
  busy?: boolean;
  status?: string;
  bulkCount?: number;
  onReview(action: CaptureReviewAction): void;
}) {
  const suffix = bulkCount ? ` for ${bulkCount} selected` : "";
  return (
    <div
      className="flex w-full flex-wrap items-center justify-between gap-x-5 gap-y-3"
      aria-label={
        bulkCount ? `Screenshot review for ${bulkCount} selected` : "Screenshot review decision"
      }
      aria-busy={busy}
    >
      {status ? (
        <div className="min-w-0">
          <p className="text-sm font-medium">Screenshot review</p>
          <p className="mt-0.5 text-xs text-muted-foreground" role="status">
            {busy ? "Saving decision…" : status}
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="min-h-10"
          variant={bulkCount ? "outline" : "default"}
          disabled={busy}
          onClick={() => onReview("accept")}
        >
          <Check className="size-4" aria-hidden="true" /> Looks correct{suffix}
        </Button>
        <Button
          size="sm"
          className="min-h-10"
          variant="ghost"
          disabled={busy}
          onClick={() => onReview("report-issue")}
        >
          <Flag className="size-4" aria-hidden="true" /> Report issue{suffix}
        </Button>
        <Button
          size="sm"
          className="min-h-10"
          variant="ghost"
          disabled={busy}
          onClick={() => onReview("need-more-evidence")}
        >
          <ImagePlus className="size-4" aria-hidden="true" /> Need more evidence{suffix}
        </Button>
      </div>
    </div>
  );
}
