/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@relay/ui-react/components/dropdown-menu";
import { MoreHorizontal, Redo2, RotateCcw, Save, Undo2 } from "lucide-react";

export function RecordingReviewActions(props: {
  editing: boolean;
  pending: boolean;
  canEdit: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canSave: boolean;
  canReplay: boolean;
  autoSave: boolean;
  runsBeforeSave: boolean;
  saveDisabled: boolean;
  saveLabel: string;
  saving?: "checking" | "saving";
  replaying: boolean;
  deviceName: string;
  onUndo(): void;
  onRedo(): void;
  onEdit(): void;
  onReplay(): void;
  onSave(): void;
  onSaveDraft?(): void;
}) {
  return (
    <>
      {props.editing ? (
        <div className="flex items-center gap-2" aria-label="Edit history">
          <Button
            size="sm"
            variant="ghost"
            onClick={props.onUndo}
            disabled={!props.canEdit || !props.canUndo}
          >
            <Undo2 aria-hidden="true" /> Undo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={props.onRedo}
            disabled={!props.canEdit || !props.canRedo}
          >
            <Redo2 aria-hidden="true" /> Redo
          </Button>
        </div>
      ) : null}
      <Button
        variant="ghost"
        aria-pressed={props.editing}
        onClick={props.onEdit}
        disabled={props.pending}
      >
        {props.editing ? "Done editing" : "Edit steps"}
      </Button>
      {props.canReplay && !props.autoSave ? (
        <Button
          variant={props.canSave ? "ghost" : "default"}
          title={`Replay on ${props.deviceName}`}
          onClick={props.onReplay}
          disabled={props.pending}
        >
          <RotateCcw aria-hidden="true" />
          {props.replaying ? "Replaying…" : "Run test"}
        </Button>
      ) : null}
      {props.canSave ? (
        <Button
          variant="default"
          onClick={props.onSave}
          disabled={props.pending || props.saveDisabled}
          aria-busy={Boolean(props.saving)}
          title={props.runsBeforeSave ? `Run on ${props.deviceName}, then save` : undefined}
        >
          <Save aria-hidden="true" />
          {props.saving === "checking"
            ? "Running before save…"
            : props.saving === "saving"
              ? "Saving…"
              : props.runsBeforeSave
                ? "Run and save"
                : props.saveLabel}
        </Button>
      ) : null}
      {props.canReplay && props.autoSave ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="More review actions"
                disabled={props.pending}
              />
            }
          >
            <MoreHorizontal aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={props.onReplay}>
              <RotateCcw aria-hidden="true" />
              Run without saving
            </DropdownMenuItem>
            {props.onSaveDraft ? (
              <DropdownMenuItem onClick={props.onSaveDraft}>Save draft and close</DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}
