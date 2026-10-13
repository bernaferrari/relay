/** @jsxImportSource react */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { CaptureReviewItem, ReviewInboxEntry, ReviewInboxResult } from "@relay/protocol";
import { Button } from "@relay/ui-react/components/button";
import { BookmarkPlus } from "lucide-react";
import type { ReviewProductService } from "../data/review-product-service";

type FirstCapture = { entry: ReviewInboxEntry; item: CaptureReviewItem };

/**
 * Screenshots still waiting only because nothing existed to compare them
 * with: no reference yet, on a run that passed. Relay accepts these by itself
 * unless a Plan asked for human review; these are the ones left for a person.
 */
export function firstCapturesFromPassingRuns(
  result: ReviewInboxResult | undefined,
  done: ReadonlySet<string> = new Set(),
): FirstCapture[] {
  return (result?.entries ?? []).flatMap((entry) =>
    entry.outcome === "passed"
      ? entry.items
          .filter(
            (item) =>
              (!item.reference || item.reference.state === "new") &&
              !done.has(`${entry.runId}::${item.captureId}`),
          )
          .map((item) => ({ entry, item }))
      : [],
  );
}

/** One click turns those first screenshots into references for later runs. */
export function AcceptFirstCaptures({
  captures,
  service,
  onAccepted,
  onSettled,
}: {
  captures: readonly FirstCapture[];
  service: ReviewProductService;
  onAccepted(keys: readonly string[]): void;
  onSettled(): void;
}) {
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string>();
  const accept = useMutation({
    mutationFn: async (selected: readonly FirstCapture[]) => {
      const accepted: string[] = [];
      let failed = 0;
      setProgress(0);
      for (const { entry, item } of selected) {
        try {
          const result = await service.review(entry.runId, item, "accept-as-reference");
          if (result.referenceUpdate?.status === "failed") failed += 1;
          else accepted.push(`${entry.runId}::${item.captureId}`);
        } catch {
          failed += 1;
        }
        setProgress((value) => value + 1);
      }
      return { accepted, failed };
    },
    onSuccess: ({ accepted, failed }) => {
      onAccepted(accepted);
      setMessage(
        failed
          ? `Accepted ${accepted.length}. ${failed} could not be saved; they stay in the list.`
          : undefined,
      );
    },
    onSettled,
  });
  if (!captures.length && !message) return null;
  const count = captures.length;
  return (
    <div
      role="region"
      aria-label="First screenshots from passing runs"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/60 bg-muted/30 px-5 py-2.5 text-sm"
    >
      <p className="min-w-0 flex-1 text-muted-foreground">
        {message ??
          `${count} ${count === 1 ? "is a first screenshot" : "are first screenshots"} from runs that passed, with nothing to compare against yet.`}
      </p>
      {count ? (
        <Button
          size="sm"
          variant="outline"
          disabled={accept.isPending}
          onClick={() => accept.mutate([...captures])}
        >
          <BookmarkPlus aria-hidden="true" />
          {accept.isPending
            ? `Accepting ${Math.min(progress + 1, count)} of ${count}…`
            : `Accept ${count} first ${count === 1 ? "screenshot" : "screenshots"} from passing runs`}
        </Button>
      ) : null}
    </div>
  );
}
