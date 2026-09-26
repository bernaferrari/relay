/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@relay/ui-react/components/dialog";
import type { CaptureReviewItem } from "@relay/protocol";
import { createReviewProductService } from "../data/review-product-service";
import { ReviewCompare, type CompareMode } from "./review-compare";

/** One line under a run screenshot: how it compares with its reference, and a way to look. */
export function ReferenceCompareLine({
  runId,
  item,
  finishedAt,
}: {
  runId: string;
  item: CaptureReviewItem;
  finishedAt?: number;
}) {
  const { platform } = useRouteContext({ from: "__root__" });
  const service = useMemo(() => createReviewProductService(platform), [platform]);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CompareMode>("diff");
  const reference = item.reference;
  if (!reference) return null;
  const label =
    reference.state === "changed"
      ? reference.sizeChanged
        ? "Different size from the reference"
        : `Changed ${Math.max(0.1, (reference.changeRatio ?? 0) * 100).toFixed(1)}% from the reference`
      : reference.state === "match"
        ? "Matches the reference"
        : "No reference yet — Looks correct makes this the reference";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{label}</span>
      {reference.state !== "new" ? (
        <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
          Compare
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] w-[min(96vw,80rem)] max-w-none overflow-y-auto sm:max-w-none">
          <DialogHeader>
            <DialogTitle>Compare with reference</DialogTitle>
            <DialogDescription>{label}</DialogDescription>
          </DialogHeader>
          {open ? (
            <ReviewCompare
              service={service}
              runId={runId}
              item={item}
              finishedAt={finishedAt ?? reference.comparedAt}
              mode={mode}
              onModeChange={setMode}
              editingIgnore={false}
              onSaveIgnore={() => undefined}
              onCancelIgnore={() => undefined}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
