import { useBlocker } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@relay/ui-react/components/dialog";

/** Keep unapplied edits in place until the user explicitly leaves the editor. */
export function TestEditorDoneButton({
  saving,
  hasUnsavedChanges,
  hasUnsavedCheckpoint,
  onLeave,
  showDoneButton = true,
}: {
  saving: boolean;
  hasUnsavedChanges: boolean;
  hasUnsavedCheckpoint: boolean;
  onLeave(): void;
  showDoneButton?: boolean;
}) {
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      (saving || hasUnsavedChanges) && current.pathname !== next.pathname,
    enableBeforeUnload: saving || hasUnsavedChanges,
    withResolver: true,
  });
  return (
    <>
      {showDoneButton ? (
        <Button
          disabled={saving}
          onClick={() => {
            if (saving) return;
            onLeave();
          }}
        >
          {saving ? "Saving…" : "Done editing"}
        </Button>
      ) : null}
      <Dialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <DialogContent>
          <DialogTitle>
            {saving ? "Wait for changes to save" : "Leave with unsaved changes?"}
          </DialogTitle>
          <DialogDescription>
            Your changes have not been applied to this Test. Stay in the editor to save them before
            running it.
            {hasUnsavedCheckpoint
              ? " The new screenshot checkpoint will be discarded if you leave."
              : ""}
          </DialogDescription>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => {
                if (saving) return;
                blocker.proceed?.();
              }}
            >
              Leave without saving
            </Button>
            <Button autoFocus onClick={() => blocker.reset?.()}>
              Keep editing
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
