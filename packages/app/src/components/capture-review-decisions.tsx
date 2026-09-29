import { useId, useRef, useState } from "react";
import { Check, Flag, ImagePlus, MoreHorizontal, BookmarkPlus } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import { Textarea } from "@relay/ui-react/components/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@relay/ui-react/components/dropdown-menu";
import type { CaptureReviewAction, CaptureReviewItem } from "@relay/protocol";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@relay/ui-react/components/dialog";

export function CaptureReviewDecisions({
  busy,
  unavailable = false,
  onReview,
  status,
  reviewStatus,
  bulkCount,
}: {
  busy?: boolean;
  unavailable?: boolean;
  status?: string;
  reviewStatus?: CaptureReviewItem["status"];
  bulkCount?: number;
  onReview(action: CaptureReviewAction, note?: string): void | boolean | Promise<boolean | void>;
}) {
  const suffix = bulkCount ? ` for ${bulkCount} selected` : "";
  const noteId = useId();
  const [note, setNote] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const disabled = busy || saving || unavailable;
  const submit = async (action: CaptureReviewAction) => {
    if (busy || unavailable || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(undefined);
    try {
      const saved = await onReview(
        action,
        action === "report-issue" ? note.trim() || undefined : undefined,
      );
      if (saved === false) {
        setError("Your decision wasn’t saved. Try again.");
        return;
      }
      if (action === "report-issue") {
        setNote("");
        setReportOpen(false);
      }
      if (action === "accept-as-reference") setReferenceOpen(false);
    } catch {
      setError("Your decision wasn’t saved. Try again.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return (
    <div
      className="grid w-full min-w-0 gap-3"
      aria-label={
        bulkCount ? `Screenshot review for ${bulkCount} selected` : "Screenshot review decision"
      }
      aria-busy={busy || saving}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {reviewStatus === "accepted" || status || bulkCount || disabled ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
            {busy || saving ? (
              "Saving decision…"
            ) : bulkCount ? (
              `${bulkCount} ${bulkCount === 1 ? "screenshot" : "screenshots"} selected`
            ) : unavailable ? (
              "Load the screenshot to review it"
            ) : reviewStatus === "accepted" ? (
              <>
                <Check className="size-3.5 text-success-foreground" aria-hidden="true" /> Reviewed
              </>
            ) : (
              status
            )}
          </p>
        ) : null}
        <div className="flex items-center gap-1">
          {reviewStatus !== "accepted" ? (
            <Button
              size="sm"
              className="min-h-10"
              variant="secondary"
              disabled={disabled}
              onClick={() => void submit("accept")}
            >
              <Check className="size-4" aria-hidden="true" /> Looks correct
              <span className="sr-only">{suffix}</span>
            </Button>
          ) : null}
          <Button
            size="sm"
            className="min-h-10"
            variant="ghost"
            disabled={disabled}
            aria-expanded={reportOpen}
            aria-controls={reportOpen ? noteId : undefined}
            onClick={() => {
              setReportOpen((open) => !open);
              setError(undefined);
            }}
          >
            <Flag className="size-4" aria-hidden="true" /> Report issue
            <span className="sr-only">{suffix}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="min-h-10 min-w-10"
                  disabled={disabled}
                />
              }
              aria-label="More review options"
            >
              <MoreHorizontal aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={disabled} onClick={() => setReferenceOpen(true)}>
                <BookmarkPlus aria-hidden="true" /> Accept as reference for future Runs
                <span className="sr-only">{suffix}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={disabled}
                onClick={() => void submit("need-more-evidence")}
              >
                <ImagePlus aria-hidden="true" /> Need more evidence
                <span className="sr-only">{suffix}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {reportOpen ? (
        <form
          className="grid gap-3 border-t border-border/60 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit("report-issue");
          }}
        >
          <label htmlFor={noteId} className="text-sm font-medium">
            What looks wrong? <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id={noteId}
            aria-label="Issue note"
            autoFocus
            value={note}
            disabled={disabled}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Describe the issue in this screenshot…"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => setReportOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={disabled}>
              Save issue{suffix}
            </Button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Dialog open={referenceOpen} onOpenChange={setReferenceOpen}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>
            {bulkCount
              ? `Use ${bulkCount} screenshots as references?`
              : "Use this screenshot as a reference?"}
          </DialogTitle>
          <DialogDescription>
            Relay will compare future Runs with {bulkCount ? "these images" : "this image"}. This
            also marks {bulkCount ? "these screenshots" : "this screenshot"} as correct in this
            review. Choose Looks correct instead if you only want to review this Run.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={disabled} onClick={() => setReferenceOpen(false)}>
              Cancel
            </Button>
            <Button disabled={disabled} onClick={() => void submit("accept-as-reference")}>
              {saving ? "Saving…" : "Use as reference"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
