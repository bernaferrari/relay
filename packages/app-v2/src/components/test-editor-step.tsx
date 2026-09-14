/** @jsxImportSource react */
import type {
  AppMapScenarioTestEdit,
  AppMapScenarioTestStep,
  AppMapTestBindingCandidate,
  AppMapTestStepPlacement,
} from "@relay/protocol";
import { Alert, AlertDescription, AlertTitle } from "@relay/ui-react/components/alert";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { FieldLabel } from "@relay/ui-react/components/field";
import { Textarea } from "@relay/ui-react/components/textarea";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
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
  onSave,
  onBind,
  onRemove,
  onAddChild,
  platformBlocker,
}: {
  entry: StepEntry;
  draft?: StepDraft;
  onDraftChange?(draft: StepDraft): void;
  busy: boolean;
  onSave(transaction: EditTransaction): void;
  onBind(transaction: EditTransaction): void;
  onRemove(): void;
  onAddChild(branch: "then" | "else" | "steps"): void;
  platformBlocker?: string;
}) {
  const [intent, setIntent] = useState(draft?.intent ?? entry.step.intent);
  const [note, setNote] = useState(draft?.note ?? entry.step.note ?? "");
  const [capture, setCapture] = useState(draft?.capture ?? entry.step.capture === true);
  const [expected, setExpected] = useState<ValidationDraft | undefined>(
    draft?.expected ?? validationDraft(entry.step),
  );
  const [removeArmed, setRemoveArmed] = useState(false);
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
      className="grid min-w-0 grid-cols-1 gap-5 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!changed || !cleanIntent) return;
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
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-background text-[10px] tabular-nums text-muted-foreground">
          {entry.number}
        </span>
        <div className="min-w-0">
          <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
            Selected step
          </p>
          <h2>{stepKindLabel(entry.step)}</h2>
        </div>
      </div>
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
      {entry.step.kind === "instruction" ? (
        <p className="text-xs font-normal leading-normal text-muted-foreground">
          Visual judges, reply checks, and ignore regions live on a Checkpoint, not on this action.
        </p>
      ) : null}
      <label className="grid gap-1.5 text-xs font-semibold" htmlFor="selected-step-intent">
        <span>What should happen</span>
        <Input
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
          onChange={(value) => {
            setExpected(value);
            updateDraft({ expected: value });
          }}
        />
      ) : null}
      <label className="grid gap-1.5 text-xs font-semibold" htmlFor="selected-step-note">
        <span>
          Note <small>Optional</small>
        </span>
        <Textarea
          id="selected-step-note"
          value={note}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setNote(value);
            updateDraft({ note: value });
          }}
          maxLength={4_000}
          rows={4}
        />
      </label>
      <FieldLabel className="relay-editor-check flex min-h-14 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground transition-colors outline-none hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50">
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-sm font-medium text-foreground">
            Save screenshot after this step
          </span>
          <span className="text-xs leading-snug text-muted-foreground">
            Include this moment in Results, for each language or data value.
          </span>
        </span>
        <Checkbox
          checked={capture}
          onCheckedChange={(value) => {
            setCapture(value === true);
            updateDraft({ capture: value === true });
          }}
        />
      </FieldLabel>
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
      {entry.step.binding.status === "unresolved" ? (
        <Alert variant="default" className="grid grid-cols-[18px_minmax(0,1fr)] gap-2 p-2.5">
          <AlertTriangle aria-hidden="true" />
          <div>
            <AlertTitle>Step needs review</AlertTitle>
            <AlertDescription>{entry.step.binding.reason}</AlertDescription>
          </div>
        </Alert>
      ) : null}
      {entry.step.binding.status === "unresolved" ? (
        <BindingRepair
          step={entry.step}
          candidates={entry.step.binding.candidates ?? []}
          busy={busy}
          onBind={onBind}
        />
      ) : null}
      {stepBindingCopy(entry.step) ? (
        <p className="text-xs leading-snug text-muted-foreground">{stepBindingCopy(entry.step)}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="default"
          type="submit"
          disabled={!changed || !cleanIntent || !expectedReady || busy}
        >
          {busy ? "Saving…" : "Save step"}
        </Button>
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
            variant="ghost"
            type="button"
            className="text-destructive"
            disabled={busy}
            onClick={() => setRemoveArmed(true)}
          >
            Remove step
          </Button>
        )}
        {!changed ? (
          <span className="text-xs text-muted-foreground">No unsaved changes</span>
        ) : null}
      </div>
    </form>
  );
}

export { validationDraft } from "./test-editor-assertion";

function sameValidationDraft(left?: ValidationDraft, right?: ValidationDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function BindingRepair({
  step,
  candidates,
  busy,
  onBind,
}: {
  step: AppMapScenarioTestStep;
  candidates: readonly AppMapTestBindingCandidate[];
  busy: boolean;
  onBind(transaction: EditTransaction): void;
}) {
  const bindable = candidates.flatMap((candidate) => {
    const binding = bindingForCandidate(step, candidate);
    return binding ? [{ candidate, binding }] : [];
  });
  if (!bindable.length) {
    return (
      <p className="text-xs leading-normal text-muted-foreground">
        No compatible saved target is available yet. Review the recording or ask Relay to suggest a
        repair.
      </p>
    );
  }
  return (
    <div className="grid gap-2.5 rounded-md border border-border bg-muted/40 p-3">
      <div>
        <strong>Choose a saved target</strong>
        <p className="mt-0.5 text-xs leading-normal text-muted-foreground">
          These reviewed targets can repair this step without changing its wording.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {bindable.map(({ candidate, binding }) => (
          <Button
            key={`${candidate.kind}:${candidate.id}`}
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              onBind({
                label: `Bound ${step.intent} to ${candidate.label}`,
                forward: [{ kind: "step.bind", stepId: step.id, binding }],
                reverse: [
                  {
                    kind: "step.unbind",
                    stepId: step.id,
                    reason: step.binding.status === "unresolved" ? step.binding.reason : "Unbound",
                    ...(step.binding.status === "unresolved" && step.binding.candidates
                      ? { candidates: structuredClone(step.binding.candidates) }
                      : {}),
                  },
                ],
              })
            }
          >
            Use {candidate.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function bindingForCandidate(
  step: AppMapScenarioTestStep,
  candidate: AppMapTestBindingCandidate,
): AppMapScenarioTestStep["binding"] | undefined {
  if (step.kind === "instruction" && candidate.kind === "connection") {
    return { status: "resolved", kind: "connections", connectionIds: [candidate.id] };
  }
  if (step.kind === "module" && candidate.kind === "routine") {
    return { status: "resolved", kind: "routine", routineId: candidate.id };
  }
  return undefined;
}

export function stepReadinessLabel(
  step: AppMapScenarioTestStep,
  options?: { unrecordedNative?: boolean; platformBlocker?: string },
): string {
  if (step.execution?.status === "disabled") return `Disabled · ${step.execution.reason}`;
  if (options?.platformBlocker) return `Blocked · ${options.platformBlocker}`;
  if (options?.unrecordedNative) {
    return `${step.binding.status === "resolved" ? "Ready on Web" : "Unbound"} · Android/iOS disabled until recorded`;
  }
  return step.binding.status === "resolved" ? "Ready" : "Unbound";
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
