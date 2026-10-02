import { useRef, useState } from "react";
import type { AuthoringRecordingEdit, RecipeStep } from "@relay/protocol";
import type { AuthoringReviewWaitCondition } from "@relay/workflows/types";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@relay/ui-react/components/dialog";
import { SelectField } from "../components/filter-select";

type WaitAction = {
  id: string;
  intent: string;
  waitConditions?: readonly AuthoringReviewWaitCondition[];
};

type EditableWait = {
  kind: AuthoringReviewWaitCondition["kind"];
  condition: AuthoringReviewWaitCondition["condition"];
  strategy: "label" | "identifier";
  value: string;
  seconds: string;
};

function budgetLabel(timeoutMs: number | undefined): string {
  if (timeoutMs === undefined) return "default limit";
  return timeoutMs >= 60_000 && timeoutMs % 60_000 === 0
    ? `up to ${timeoutMs / 60_000} min`
    : `up to ${timeoutMs / 1000} s`;
}

function WaitEditor({
  action,
  canEdit,
  onEdit,
  onSaveWait,
  onSavingChange,
  onClose,
}: {
  action: WaitAction;
  canEdit: boolean;
  onEdit(edit: AuthoringRecordingEdit): void;
  onSaveWait?(edit: AuthoringRecordingEdit): Promise<void>;
  onSavingChange(saving: boolean): void;
  onClose(): void;
}) {
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [conditions, setConditions] = useState<EditableWait[]>(() =>
    (action.waitConditions ?? []).map((condition) => ({
      kind: condition.kind,
      condition: condition.condition,
      strategy: condition.target.identifier !== undefined ? "identifier" : "label",
      value: condition.target.identifier ?? condition.target.label ?? "",
      seconds: condition.timeoutMs === undefined ? "" : String(condition.timeoutMs / 1000),
    })),
  );
  const update = (index: number, change: Partial<EditableWait>) =>
    setConditions((current) =>
      current.map((condition, slot) => (slot === index ? { ...condition, ...change } : condition)),
    );
  const valid =
    conditions.length > 0 &&
    conditions.every(
      (condition) =>
        condition.value.trim().length > 0 &&
        condition.value.trim().length <= 500 &&
        (condition.seconds.trim() === "" ||
          (Number.isFinite(Number(condition.seconds)) &&
            Number(condition.seconds) >= 0 &&
            Number(condition.seconds) <= 900)),
    );
  return (
    <form
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!canEdit || !valid || savingRef.current) return;
        const steps: RecipeStep[] = conditions.map((condition) => {
          const target = { [condition.strategy]: condition.value.trim() };
          const budget =
            condition.seconds.trim() === ""
              ? {}
              : { timeoutMs: Math.round(Number(condition.seconds) * 1000) };
          return condition.kind === "wait-for" && condition.condition === "visible"
            ? { kind: "wait-for", target, ...budget }
            : { kind: "expect", target, condition: condition.condition, ...budget };
        });
        const edit: AuthoringRecordingEdit = {
          kind: "replace",
          actionId: action.id,
          interaction: { kind: "steps", label: action.intent, steps },
        };
        savingRef.current = true;
        setSaving(true);
        onSavingChange(true);
        setSaveError(false);
        try {
          if (onSaveWait) await onSaveWait(edit);
          else onEdit(edit);
          onClose();
        } catch {
          setSaveError(true);
        } finally {
          savingRef.current = false;
          setSaving(false);
          onSavingChange(false);
        }
      }}
    >
      {conditions.map((condition, index) => (
        <fieldset
          key={index}
          disabled={!canEdit || saving}
          className="grid gap-3 rounded-xl bg-muted/40 p-3"
        >
          <legend className="sr-only">Condition {index + 1}</legend>
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label={`Condition ${index + 1}`}
              value={condition.condition}
              disabled={!canEdit || saving}
              options={[
                { value: "visible", label: "Appears" },
                { value: "gone", label: "Disappears" },
              ]}
              onValueChange={(value) =>
                update(index, { condition: value as EditableWait["condition"] })
              }
            />
            <SelectField
              label={`Find control ${index + 1} by`}
              value={condition.strategy}
              disabled={!canEdit || saving}
              options={[
                { value: "label", label: "Label" },
                { value: "identifier", label: "Identifier" },
              ]}
              onValueChange={(value) =>
                update(index, { strategy: value as EditableWait["strategy"] })
              }
            />
          </div>
          <label className="grid gap-1.5 text-sm">
            {condition.strategy === "label" ? "Control label" : "Control identifier"} {index + 1}
            <Input
              value={condition.value}
              maxLength={500}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => update(index, { value: event.currentTarget.value })}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            Maximum wait {index + 1} (seconds)
            <Input
              type="number"
              min={0}
              max={900}
              step={0.001}
              placeholder="Default limit"
              value={condition.seconds}
              onChange={(event) => update(index, { seconds: event.currentTarget.value })}
            />
          </label>
        </fieldset>
      ))}
      {saveError ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn’t save this wait. Your changes are still here.
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canEdit || !valid || saving}>
          {saving ? "Saving…" : "Save wait"}
        </Button>
      </div>
    </form>
  );
}

/** Shows executable control readiness, never an inferred generation outcome. */
export function RecordingWaitConditions({
  action,
  canEdit,
  onEdit,
  onSaveWait,
}: {
  action?: WaitAction;
  canEdit: boolean;
  onEdit(edit: AuthoringRecordingEdit): void;
  onSaveWait?(edit: AuthoringRecordingEdit): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  if (!action?.waitConditions?.length) return null;
  return (
    <section className="grid gap-2" aria-label="Wait conditions">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Wait conditions</h3>
        <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => setOpen(true)}>
          Edit wait
        </Button>
      </div>
      <ol className="grid gap-1.5 text-sm">
        {action.waitConditions.map((condition, index) => (
          <li
            key={index}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
          >
            <span className="min-w-0 break-words">
              {condition.target.label ?? condition.target.identifier}{" "}
              {condition.condition === "gone" ? "disappears" : "appears"}
            </span>
            <span className="text-xs text-muted-foreground">
              {budgetLabel(condition.timeoutMs)}
            </span>
          </li>
        ))}
      </ol>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!savingRef.current) setOpen(nextOpen);
        }}
      >
        <DialogContent
          showCloseButton={!saving}
          className="max-h-[85dvh] overflow-y-auto sm:max-w-md"
        >
          <DialogTitle>Edit wait conditions</DialogTitle>
          <DialogDescription>
            Continue as soon as these conditions are met, in order.
          </DialogDescription>
          <WaitEditor
            key={`${action.id}:${JSON.stringify(action.waitConditions)}`}
            action={action}
            canEdit={canEdit}
            onEdit={onEdit}
            onSaveWait={onSaveWait}
            onSavingChange={(pending) => {
              savingRef.current = pending;
              setSaving(pending);
            }}
            onClose={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
