/** @jsxImportSource react */

import { Button } from "@relay/ui-react/components/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { RunProductService } from "../data/run-product-service";
import { errorMessage } from "./recording-shared";

export function RunReviewControls({
  runId,
  service,
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?(open: boolean): void;
  runId: string;
  service: RunProductService;
}) {
  const [reviewMessage, setReviewMessage] = useState<string>();
  const review = useMutation({
    mutationFn: (action: "approve" | "reject" | "defer") => {
      if (!service.review) throw new TypeError("Run review is unavailable.");
      return service.review({ runId, action, note: "Reviewed in Relay" });
    },
    onSuccess: (decision) => setReviewMessage(`Run review saved: ${decision.status}.`),
  });
  const compare = useMutation({
    mutationFn: () => {
      if (!service.compareVisual) throw new TypeError("Visual comparison is unavailable.");
      return service.compareVisual(runId);
    },
  });
  const visualDecision = useMutation({
    mutationFn: (action: "approve-new-baseline" | "keep-baseline" | "retry") => {
      if (!compare.data) throw new TypeError("Compare this Run before saving a visual decision.");
      if (action === "approve-new-baseline" && service.approveVisualBaseline) {
        return service.approveVisualBaseline({ runId, action, note: "Reviewed in Relay" });
      }
      if (!service.reviewVisual) throw new TypeError("Visual review is unavailable.");
      return service.reviewVisual({
        runId,
        comparisonId: compare.data.id,
        action,
        note: "Reviewed in Relay",
      });
    },
    onSuccess: () => setReviewMessage("Visual decision saved."),
  });
  const problem = review.error ?? compare.error ?? visualDecision.error;

  if (!service.review && !service.compareVisual) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open === undefined ? (
        <DialogTrigger render={<Button size="sm" variant="ghost" />}>Review run</DialogTrigger>
      ) : null}
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogTitle>Review run</DialogTitle>
        <DialogDescription>
          Save your review decision or compare screenshots with the approved baseline.
        </DialogDescription>
        {service.review ? (
          <div className="flex flex-wrap items-center gap-2" aria-label="Run review decision">
            <Button
              size="sm"
              variant="outline"
              disabled={review.isPending}
              onClick={() => review.mutate("approve")}
            >
              Approve run
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={review.isPending}
              onClick={() => review.mutate("defer")}
            >
              Defer
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={review.isPending}
              onClick={() => review.mutate("reject")}
            >
              Reject
            </Button>
          </div>
        ) : null}
        {service.compareVisual ? (
          <div className="grid content-start justify-items-start gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={compare.isPending}
              onClick={() => compare.mutate()}
            >
              {compare.isPending ? "Comparing…" : "Compare screenshots"}
            </Button>
            {compare.data ? (
              <div className="grid gap-2 py-2">
                <strong>{visualComparisonLabel(compare.data.code)}</strong>
                <span>
                  {compare.data.diff.changedFrames} changed · {compare.data.diff.addedFrames} added
                  · {compare.data.diff.removedFrames} removed
                </span>
                <p className="text-sm text-muted-foreground">{visualIgnoreCopy(compare.data)}</p>
                <p className="text-sm text-muted-foreground">
                  {visualPendingCopy(compare.data.code)}
                </p>
                <div
                  className="flex flex-wrap items-center gap-2"
                  aria-label="Visual review decision"
                >
                  <Button
                    size="sm"
                    variant="default"
                    disabled={visualDecision.isPending}
                    onClick={() => visualDecision.mutate("approve-new-baseline")}
                  >
                    Approve new baseline
                  </Button>
                  {canKeepVisualBaseline(compare.data.code) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={visualDecision.isPending}
                      onClick={() => visualDecision.mutate("keep-baseline")}
                    >
                      Keep baseline
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={visualDecision.isPending}
                    onClick={() => visualDecision.mutate("retry")}
                  >
                    {leaveVisualPendingLabel(compare.data.code)}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {reviewMessage ? (
          <p
            className="rounded-md bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-300"
            role="status"
          >
            {reviewMessage}
          </p>
        ) : null}
        {problem ? (
          <p className="mt-3 text-sm leading-relaxed text-destructive" role="alert">
            {errorMessage(problem)}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function visualComparisonLabel(code: string): string {
  if (code === "VISUAL_MATCH") return "Visual evidence matches the baseline";
  if (code === "VISUAL_BASELINE_MISSING") return "No approved visual baseline";
  if (code === "VISUAL_EXPECTED_VARIATION") return "Expected visual variation";
  return "Visual changes need review";
}

export function visualPendingCopy(code?: string): string {
  if (code === "VISUAL_BASELINE_MISSING") {
    return "This compare stays pending until a person approves a baseline. Findings Confirm and Reject never accept. Agents cannot approve.";
  }
  return "Findings Confirm and Reject never accept a visual baseline. Agents cannot approve.";
}

export function canKeepVisualBaseline(code?: string): boolean {
  return code !== "VISUAL_BASELINE_MISSING";
}

export function leaveVisualPendingLabel(code?: string): string {
  return code === "VISUAL_BASELINE_MISSING" ? "Leave pending" : "Retry later";
}

export function visualIgnoreCopy(comparison: {
  code?: string;
  policy?: { regions?: readonly { mode?: string; name?: string }[] };
}): string {
  const ignored = (comparison.policy?.regions ?? []).filter((region) => region.mode === "ignore");
  if (!ignored.length) {
    return comparison.code === "VISUAL_BASELINE_MISSING"
      ? "No ignore regions. Dynamic reply bodies will be compared if you approve this baseline."
      : "No ignore regions on this comparison.";
  }
  const names = [
    ...new Set(
      ignored.map((region) => region.name?.trim()).filter((name): name is string => Boolean(name)),
    ),
  ];
  const sandwich = names.some((name) => /library chrome sandwich/iu.test(name));
  const chrome = sandwich
    ? "One viewport of top and bottom chrome stays compared. Do not survey the feed."
    : "Chrome stays compared.";
  return `${ignored.length} ignore region${ignored.length === 1 ? "" : "s"}${names.length ? ` (${names.join(", ")})` : ""}. ${chrome}`;
}
