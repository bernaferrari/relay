/** @jsxImportSource react */
import { Redo2, Undo2 } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
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
  if (!open) return null;
  return (
    <section
      className="mx-4 mb-4 grid max-w-xl gap-3 rounded-lg border border-border bg-card p-4"
      aria-label="Test settings"
    >
      <div>
        <h2 className="text-sm font-semibold">Test settings</h2>
        <p className="text-xs text-muted-foreground">
          Update the saved Test identity and origin package.
        </p>
      </div>
      <label className="grid gap-1 text-xs font-medium">
        Name
        <Input value={name} onChange={(event) => onNameChange(event.target.value)} />
      </label>
      <label className="grid gap-1 text-xs font-medium">
        Origin application
        <Input
          placeholder="com.example.app"
          value={originApplication}
          onChange={(event) => onOriginChange(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <Button onClick={onSave} disabled={!name.trim() || saving}>
          Save settings
        </Button>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      </div>
      <RecordingProblem error={error} onRetry={onRetry} retrying={saving} />
    </section>
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
        title="Undo changes the Test. It does not reverse a payment, message, or deletion."
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
