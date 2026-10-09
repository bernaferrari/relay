/** @jsxImportSource react */
import { Redo2, Undo2 } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@relay/ui-react/components/dialog";
import { RecordingProblem } from "./recording-shared";

export function TestEditorSettingsPanel({
  name,
  originApplication,
  open,
  saving,
  error,
  onNameChange,
  onOriginChange,
  onOpenChange,
  onRetry,
  onSave,
}: {
  name: string;
  originApplication: string;
  open: boolean;
  saving: boolean;
  error?: unknown;
  onNameChange(name: string): void;
  onOriginChange(originApplication: string): void;
  onOpenChange(open: boolean): void;
  onRetry(): void;
  onSave(): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-label="Test settings">
        <div className="grid gap-1">
          <DialogTitle>Test settings</DialogTitle>
          <DialogDescription>Rename the test or change the app it starts in.</DialogDescription>
        </div>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !saving) onSave();
          }}
        >
          <label className="grid gap-1.5 text-sm font-medium">
            Name
            <Input value={name} onChange={(event) => onNameChange(event.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Starts in
            <Input
              placeholder="https://example.com or com.example.app"
              value={originApplication}
              onChange={(event) => onOriginChange(event.target.value)}
            />
            <span className="text-xs font-normal text-muted-foreground">
              The website address or app the test opens first.
            </span>
          </label>
          <RecordingProblem error={error} onRetry={onRetry} retrying={saving} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TestEditorHistoryBar({
  canRedo,
  canUndo,
  busy,
  latestSummary,
  onRedo,
  onUndo,
}: {
  canRedo: boolean;
  canUndo: boolean;
  busy: boolean;
  latestSummary?: string;
  onRedo(): void;
  onUndo(): void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Editing history">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onUndo}
        disabled={!canUndo || busy}
        aria-label="Undo last saved change"
        title="Undo changes the test. It does not reverse a payment, message, or deletion."
      >
        <Undo2 aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRedo}
        disabled={!canRedo || busy}
        aria-label="Redo last undone change"
      >
        <Redo2 aria-hidden="true" />
      </Button>
      <span className="sr-only">{latestSummary}</span>
    </div>
  );
}
