/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import type { CombineTriageStatus } from "@relay/protocol";
import { useState } from "react";
import { SelectField } from "../components/filter-select";
import { batchTriageStatusLabel, resolveTriageActor } from "./batch-triage";

const STATUSES: CombineTriageStatus[] = ["unreviewed", "investigating", "resolved", "wont-fix"];

const STATUS_OPTIONS = STATUSES.map((status) => ({
  value: status,
  label: batchTriageStatusLabel(status),
}));

export function BatchTriageControls({
  selectedCount,
  actorId,
  pending,
  noteOpen,
  onNoteOpenChange,
  onStatus,
  onAssignToMe,
  onAddNote,
}: {
  selectedCount: number;
  actorId?: string;
  pending?: boolean;
  noteOpen: boolean;
  onNoteOpenChange: (open: boolean) => void;
  onStatus: (status: CombineTriageStatus) => void;
  onAssignToMe: () => void;
  onAddNote: (text: string) => void;
}) {
  const [note, setNote] = useState("");
  const actor = resolveTriageActor(actorId);
  const disabled = selectedCount === 0 || pending;

  return (
    <div className="grid gap-3" aria-label="Review ownership">
      <div className="flex flex-wrap items-end gap-2">
        <SelectField
          className="w-[11.5rem]"
          label="Review status"
          value=""
          placeholder="Set status"
          disabled={disabled}
          options={STATUS_OPTIONS}
          onValueChange={(status) => onStatus(status as CombineTriageStatus)}
        />
        <Button variant="outline" disabled={disabled || !actor} onClick={onAssignToMe}>
          Assign to me
        </Button>
        <Button variant="ghost" disabled={disabled} onClick={() => onNoteOpenChange(!noteOpen)}>
          Add note
        </Button>
      </div>
      {noteOpen ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!note.trim()) return;
            onAddNote(note);
            setNote("");
            onNoteOpenChange(false);
          }}
        >
          <Input
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
            placeholder="What should a reviewer know?"
            aria-label="Review note"
            maxLength={500}
          />
          <Button type="submit" disabled={!note.trim()}>
            Save note
          </Button>
        </form>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {selectedCount
          ? `${selectedCount} selected. Resolved is a review state, not a passing Run.`
          : "Select a group or case to rerun or assign. Resolved is a review state, not a passing Run."}
      </p>
    </div>
  );
}
