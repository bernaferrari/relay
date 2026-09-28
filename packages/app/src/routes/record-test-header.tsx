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

export function RecordTestHeader({
  open,
  onOpenChange,
  interrupted,
  cancelDisabled,
  stopDisabled,
  failed,
  pending,
  stopping,
  onCancel,
  onStop,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  interrupted: boolean;
  cancelDisabled: boolean;
  stopDisabled: boolean;
  failed: boolean;
  pending: boolean;
  stopping: boolean;
  onCancel(): void;
  onStop(): void;
}) {
  return (
    <div className="min-w-0">
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Cancel recording?</DialogTitle>
          <DialogDescription>
            End this recording without saving a Test. Captured evidence remains available in
            Activity. To keep the steps as a Test, choose Stop and review instead.
          </DialogDescription>
          <div className="flex justify-end gap-2 pt-4">
            <DialogClose render={<Button variant="outline">Keep recording</Button>} />
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
          back={
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
          }
          actions={
            <>
              <Button
                className="[-webkit-app-region:no-drag]"
                variant="default"
                size="sm"
                onClick={() => onStop()}
                disabled={stopDisabled}
              >
                {failed
                  ? pending
                    ? "Opening saved steps…"
                    : "Review saved steps"
                  : stopping
                    ? "Finishing interaction…"
                    : "Stop and review"}
              </Button>
            </>
          }
        />
      </Dialog>
    </div>
  );
}
