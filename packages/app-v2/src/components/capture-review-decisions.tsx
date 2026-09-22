import { useId, useRef, useState } from "react";
import { Check, Flag, ImagePlus, MoreHorizontal } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import { Textarea } from "@relay/ui-react/components/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@relay/ui-react/components/dropdown-menu";
import type { CaptureReviewAction } from "@relay/protocol";

export function CaptureReviewDecisions({
  busy,
  unavailable = false,
  onReview,
  status,
  bulkCount,
}: {
  busy?: boolean;
  unavailable?: boolean;
  status?: string;
  bulkCount?: number;
  onReview(action: CaptureReviewAction, note?: string): void | boolean | Promise<boolean | void>;
}) {
  const suffix = bulkCount ? ` for ${bulkCount} selected` : "";
  const noteId = useId();
  const [note, setNote] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
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
        {status || bulkCount || disabled ? (
          <p className="text-xs text-muted-foreground" role="status">
            {busy || saving
              ? "Saving decision…"
              : bulkCount
                ? `${bulkCount} ${bulkCount === 1 ? "screenshot" : "screenshots"} selected`
                : unavailable
                  ? "Load the screenshot to review it"
                  : status}
          </p>
        ) : null}
        <div className="flex items-center gap-1">
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
    </div>
  );
}
