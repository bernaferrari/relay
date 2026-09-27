/** @jsxImportSource react */
import type {
  AppMapScenarioTestEdit,
  AppMapScenarioTestStep,
  AppMapTestBindingCandidate,
  AppMapTestStepPlacement,
} from "@relay/protocol";
import { BindingRepair } from "./test-editor-binding";
import { unrecordedProductName } from "@relay/protocol";
import { Alert, AlertDescription, AlertTitle } from "@relay/ui-react/components/alert";
import { Button } from "@relay/ui-react/components/button";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { Textarea } from "@relay/ui-react/components/textarea";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { sameValidationDraft } from "./test-editor-assertion-model";
import {
  checkpointBindingCopy,
  isValidationDraftReady,
  stepBindingCopy,
  validationBindingFromDraft,
  validationDraft,
  ValidationExpectationEditor,
  type ValidationDraft,
} from "./test-editor-assertion";

export type StepEntry = {
  step: AppMapScenarioTestStep;
  depth: number;
  number: string;
  placement?: AppMapTestStepPlacement;
  siblingIds: readonly string[];
  index: number;
};

export type EditTransaction = {
  label: string;
  forward: readonly AppMapScenarioTestEdit[];
  reverse: readonly AppMapScenarioTestEdit[];
};

export type { ValidationDraft } from "./test-editor-assertion";

export type StepDraft = {
  intent: string;
  note: string;
  capture: boolean;
  expected?: ValidationDraft;
};

export function SelectedStepEditor({
  entry,
  draft,
  onDraftChange,
  busy,
  unsavedCheckpoint = false,
  onSave,
  onBind,
  onRemove,
  onAddChild,
  platformBlocker,
  hasRememberableReply = false,
  savedPaths = [],
  appMapId,
}: {
  entry: StepEntry;
  draft?: StepDraft;
  onDraftChange?(draft: StepDraft): void;
  busy: boolean;
  unsavedCheckpoint?: boolean;
  onSave(transaction: EditTransaction): void;
  onBind(transaction: EditTransaction): void;
  onRemove(): void;
  onAddChild(branch: "then" | "else" | "steps"): void;
  platformBlocker?: string;
  hasRememberableReply?: boolean;
  savedPaths?: readonly AppMapTestBindingCandidate[];
  appMapId?: string;
}) {
  const [intent, setIntent] = useState(draft?.intent ?? entry.step.intent);
  const [note, setNote] = useState(draft?.note ?? entry.step.note ?? "");
  const [capture, setCapture] = useState(draft?.capture ?? entry.step.capture === true);
  const [expected, setExpected] = useState<ValidationDraft | undefined>(
    draft?.expected ?? validationDraft(entry.step),
  );
  const [removeArmed, setRemoveArmed] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  useEffect(() => {
    setIntent(draft?.intent ?? entry.step.intent);
    setNote(draft?.note ?? entry.step.note ?? "");
    setCapture(draft?.capture ?? entry.step.capture === true);
    setExpected(draft?.expected ?? validationDraft(entry.step));
    setRemoveArmed(false);
  }, [draft, entry.step]);
  function updateDraft(next: Partial<StepDraft>) {
    const value = {
      intent,
      note,
      capture,
      ...(expected ? { expected } : {}),
      ...next,
    };
    onDraftChange?.(value);
  }
  const cleanIntent = intent.trim();
  const changed =
    cleanIntent !== entry.step.intent ||
    note.trim() !== (entry.step.note ?? "") ||
    capture !== (entry.step.capture === true) ||
    !sameValidationDraft(expected, validationDraft(entry.step));
  const expectedReady =
    entry.step.kind !== "validation" || !expected || isValidationDraftReady(expected);

  return (
    <form
      className="grid min-w-0 grid-cols-1 gap-3 px-3 pt-2 pb-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !changed || !cleanIntent || !expectedReady) return;
        onSave({
          label: `Updated ${cleanIntent}`,
          forward: [
            {
              kind: "step.patch",
              stepId: entry.step.id,
              patch: {
                intent: cleanIntent,
                note: note.trim() || null,
                capture,
                ...(entry.step.kind === "validation" && expected
                  ? { binding: validationBindingFromDraft(expected) }
                  : {}),
              },
            },
          ],
          reverse: [
            {
              kind: "step.patch",
              stepId: entry.step.id,
              patch: {
                intent: entry.step.intent,
                note: entry.step.note ?? null,
                capture: entry.step.capture === true,
                ...(entry.step.kind === "validation"
                  ? { binding: structuredClone(entry.step.binding) }
                  : {}),
              },
            },
          ],
        });
      }}
    >
      {entry.step.kind === "decision" || entry.step.kind === "loop" ? (
        <div className="grid gap-2 pb-1">
          <strong className="text-xs font-semibold text-muted-foreground">Add to branch</strong>
          <div className="flex flex-wrap gap-1.5">
            {entry.step.kind === "decision" ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onAddChild("then")}
                >
                  Then
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onAddChild("else")}
                >
                  Else
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onAddChild("steps")}
              >
                Repeat
              </Button>
            )}
          </div>
        </div>
      ) : null}
      <label className="grid gap-1.5 text-xs font-semibold" htmlFor="selected-step-intent">
        <span className="sr-only">Step name</span>
        <Textarea
          rows={1}
          className="min-h-9 resize-none text-sm font-medium"
          id="selected-step-intent"
          value={intent}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setIntent(value);
            updateDraft({ intent: value });
          }}
          maxLength={2_000}
        />
      </label>
      {entry.step.kind === "validation" ? (
        <ValidationExpectationEditor
          value={expected}
          original={validationDraft(entry.step)}
          canAdd={entry.step.binding.status === "unresolved"}
          busy={busy}
          bindingSummary={checkpointBindingCopy(entry.step)}
          hasRememberableReply={hasRememberableReply}
          onChange={(value) => {
            setExpected(value);
            updateDraft({ expected: value });
          }}
        />
      ) : null}
      {entry.step.execution?.status === "disabled" ? (
        <Alert variant="default" className="grid grid-cols-[18px_minmax(0,1fr)] gap-2 p-2.5">
          <AlertTriangle aria-hidden="true" />
          <div>
            <AlertTitle>Disabled on this platform</AlertTitle>
            <AlertDescription>{entry.step.execution.reason}</AlertDescription>
          </div>
        </Alert>
      ) : platformBlocker ? (
        <Alert variant="default" className="grid grid-cols-[18px_minmax(0,1fr)] gap-2 p-2.5">
          <AlertTriangle aria-hidden="true" />
          <div>
            <AlertTitle>Compile blocked on the recorded route</AlertTitle>
            <AlertDescription>{platformBlocker}</AlertDescription>
          </div>
        </Alert>
      ) : null}
      {unsavedCheckpoint ? (
        <Alert variant="default" className="grid grid-cols-[18px_minmax(0,1fr)] gap-2 p-2.5">
          <AlertTriangle aria-hidden="true" />
          <div>
            <AlertTitle>Not saved on this Test</AlertTitle>
            <AlertDescription>
              Choose what Relay should prove, then Save step. An unbound Prove the result is not
              compiled. This does not accept a visual baseline.
            </AlertDescription>
          </div>
        </Alert>
      ) : null}
      {!unsavedCheckpoint &&
      ((entry.step.kind === "instruction" && entry.step.binding.status === "unresolved") ||
        (entry.step.kind === "module" && entry.step.binding.status === "unresolved")) ? (
        <BindingRepair
          step={entry.step}
          candidates={
            entry.step.kind === "instruction"
              ? [
                  ...(entry.step.binding.status === "unresolved"
                    ? (entry.step.binding.candidates ?? [])
                    : []),
                  ...savedPaths,
                ]
              : entry.step.binding.status === "unresolved"
                ? (entry.step.binding.candidates ?? [])
                : []
          }
          appMapId={appMapId}
          busy={busy}
          onBind={onBind}
        />
      ) : null}
      <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={capture}
          onCheckedChange={(value) => {
            setCapture(value === true);
            updateDraft({ capture: value === true });
          }}
        />
        Save a screenshot
      </label>
      {noteOpen || note ? (
        <label className="grid gap-1.5 text-xs font-semibold" htmlFor="selected-step-note">
          <span>Note</span>
          <Textarea
            id="selected-step-note"
            value={note}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setNote(value);
              updateDraft({ note: value });
            }}
            maxLength={4_000}
            rows={2}
          />
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
        <Button
          size="sm"
          variant="default"
          type="submit"
          disabled={!changed || !cleanIntent || !expectedReady || busy}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
        {!noteOpen && !note ? (
          <Button size="sm" type="button" variant="ghost" onClick={() => setNoteOpen(true)}>
            Add note
          </Button>
        ) : null}
        {removeArmed ? (
          <Alert variant="default" className="grid gap-2.5 p-2.5">
            <div>
              <AlertTitle>Remove this step?</AlertTitle>
              <AlertDescription>
                This saved change can be undone while this editor is open.
              </AlertDescription>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="ghost"
                type="button"
                disabled={busy}
                onClick={() => setRemoveArmed(false)}
              >
                Keep step
              </Button>
              <Button variant="outline" type="button" disabled={busy} onClick={onRemove}>
                Remove step
              </Button>
            </div>
          </Alert>
        ) : (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            size="icon-sm"
            className="ml-auto"
            aria-label="Remove step"
            title="Remove step"
            onClick={() => setRemoveArmed(true)}
          >
            <Trash2 aria-hidden="true" />
            <span className="sr-only">Remove step</span>
          </Button>
        )}
      </div>
    </form>
  );
}

export { validationDraft } from "./test-editor-assertion";

export function stepReadinessLabel(
  step: AppMapScenarioTestStep,
  options?: {
    unrecordedNative?: boolean;
    platformBlocker?: string;
    productName?: string;
    originEvidenceMissing?: string;
  },
): string {
  if (step.execution?.status === "disabled") return `Disabled · ${step.execution.reason}`;
  if (options?.platformBlocker) return `Blocked · ${options.platformBlocker}`;
  if (options?.originEvidenceMissing) {
    return `Needs origin evidence · ${options.originEvidenceMissing} has no recorded variant`;
  }
  const unrecordedName = Boolean(
    options?.productName && unrecordedProductName(options.productName),
  );
  const unrecordedReason =
    step.binding.status === "unresolved" &&
    /unrecorded|absent from the recorded tree|do not burn|Heavy account|Cloudflare/iu.test(
      step.binding.reason,
    );
  if (unrecordedName || unrecordedReason) {
    const reason = step.binding.status === "unresolved" ? step.binding.reason : undefined;
    return reason ? `Unrecorded · ${reason}` : "Unrecorded";
  }
  if (options?.unrecordedNative) {
    return `${step.binding.status === "resolved" ? "Ready on Web" : "Needs setup"} · Android/iOS disabled until recorded`;
  }
  return step.binding.status === "resolved" ? "Ready" : "Needs setup";
}

export function stepKindLabel(step: AppMapScenarioTestStep): string {
  if (step.kind === "validation") return "Checkpoint";
  if (step.kind === "instruction") return "Action";
  if (step.kind === "manual") return "Human check";
  if (step.kind === "extraction") return "Remember value";
  if (step.kind === "module") return "Saved section";
  if (step.kind === "decision") return "Decision";
  if (step.kind === "loop") return "Repeat";
  return "Script";
}
