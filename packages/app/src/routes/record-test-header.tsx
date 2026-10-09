/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@relay/ui-react/components/dialog";
import { AuthoringHeader } from "./authoring-header";
import { useEffect, useId, useState } from "react";

/** Always-visible proof that input is being captured, with elapsed time. */
function RecordingIndicator() {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.floor((now - startedAt) / 1_000);
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive"
      role="status"
      aria-label={`Recording, ${elapsed} elapsed`}
    >
      <span className="relative flex size-2" aria-hidden="true">
        <span className="absolute inset-0 animate-ping rounded-full bg-destructive opacity-60 motion-reduce:animate-none" />
        <span className="relative size-2 rounded-full bg-destructive" />
      </span>
      Recording
      <span className="tabular-nums" aria-hidden="true">
        {elapsed}
      </span>
    </span>
  );
}

export function RecordTestHeader({
  open,
  onOpenChange,
  interrupted,
  cancelDisabled,
  stopDisabled,
  stopBlockedReason,
  failed,
  pending,
  stopping,
  onCancel,
  onLeave,
  onStop,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  interrupted: boolean;
  cancelDisabled: boolean;
  stopDisabled: boolean;
  stopBlockedReason?: string;
  failed: boolean;
  pending: boolean;
  stopping: boolean;
  onCancel(): void;
  onLeave(): void;
  onStop(): void;
}) {
  const stopReasonId = useId();
  return (
    <div className="min-w-0">
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Cancel recording?</DialogTitle>
          <DialogDescription>
            End this recording without saving a test. Captured evidence remains available in
            Activity. To keep the steps as a test, choose Stop and review instead.
          </DialogDescription>
          <div className="flex justify-end gap-2 pt-4">
            <DialogClose render={<Button variant="ghost">Keep recording</Button>} />
            <Button
              variant="destructive"
              disabled={cancelDisabled}
              onClick={() => {
                onCancel();
              }}
            >
              Cancel recording
            </Button>
          </div>
        </DialogContent>
        <AuthoringHeader
          title={interrupted ? "Recording interrupted" : "Record test"}
          center={!interrupted && !failed ? <RecordingIndicator /> : undefined}
          back={
            interrupted ? (
              <Button
                className="[-webkit-app-region:no-drag]"
                variant="ghost"
                size="sm"
                onClick={onLeave}
              >
                Back to tests
              </Button>
            ) : (
              <DialogTrigger
                render={
                  <Button
                    className="inline-flex w-fit [-webkit-app-region:no-drag]"
                    variant="ghost"
                    size="sm"
                  />
                }
              >
                Cancel
              </DialogTrigger>
            )
          }
          actions={
            <>
              <Button
                className="[-webkit-app-region:no-drag]"
                variant="default"
                size="sm"
                onClick={() => onStop()}
                disabled={stopDisabled}
                aria-describedby={stopBlockedReason ? stopReasonId : undefined}
              >
                {failed
                  ? pending
                    ? "Opening saved steps…"
                    : "Review saved steps"
                  : stopping
                    ? "Finishing interaction…"
                    : "Stop and review"}
              </Button>
              {stopBlockedReason ? (
                <p
                  id={stopReasonId}
                  className="max-w-xs text-xs text-muted-foreground"
                  role="status"
                >
                  {stopBlockedReason}
                </p>
              ) : null}
            </>
          }
        />
      </Dialog>
    </div>
  );
}
