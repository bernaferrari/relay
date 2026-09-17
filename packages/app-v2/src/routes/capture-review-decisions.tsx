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
      {status || bulkCount ? (
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {bulkCount
              ? `${bulkCount} ${bulkCount === 1 ? "screenshot" : "screenshots"} selected`
              : "Screenshot review"}
          </p>
          {busy || status ? (
            <p className="mt-0.5 text-xs text-muted-foreground" role="status">
              {busy ? "Saving decision…" : status}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="min-h-11"
          variant={bulkCount ? "outline" : "default"}
          disabled={busy}
          onClick={() => onReview("accept")}
        >
          <Check className="size-4" aria-hidden="true" /> Looks correct
          <span className="sr-only">{suffix}</span>
        </Button>
        <Button
          size="sm"
          className="min-h-11"
          variant="ghost"
          disabled={busy}
          onClick={() => onReview("report-issue")}
        >
          <Flag className="size-4" aria-hidden="true" /> Report issue
          <span className="sr-only">{suffix}</span>
        </Button>
        <Button
          size="sm"
          className="min-h-11"
          variant="ghost"
          disabled={busy}
          onClick={() => onReview("need-more-evidence")}
        >
          <ImagePlus className="size-4" aria-hidden="true" /> Need more evidence
          <span className="sr-only">{suffix}</span>
        </Button>
      </div>
    </div>
  );
}
