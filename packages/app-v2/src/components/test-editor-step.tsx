/** @jsxImportSource react */
import type {
  AppMapScenarioTestEdit,
  AppMapScenarioTestStep,
  AppMapTestBindingCandidate,
  AppMapTestStepPlacement,
} from "@relay/protocol";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@relay/ui-react/components/alert";
import { Button } from "@relay/ui-react/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
import { Input } from "@relay/ui-react/components/input";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { FieldLabel } from "@relay/ui-react/components/field";
import { Textarea } from "@relay/ui-react/components/textarea";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

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

export type StepDraft = { intent: string; note: string; capture: boolean };

export function SelectedStepEditor({
  entry,
  draft,
  onDraftChange,
  busy,
  onSave,
  onBind,
  onRemove,
  onAddChild,
}: {
  entry: StepEntry;
  draft?: StepDraft;
  onDraftChange?(draft: StepDraft): void;
  busy: boolean;
  onSave(transaction: EditTransaction): void;
  onBind(transaction: EditTransaction): void;
  onRemove(): void;
  onAddChild(branch: "then" | "else" | "steps"): void;
}) {
  const [intent, setIntent] = useState(draft?.intent ?? entry.step.intent);
  const [note, setNote] = useState(draft?.note ?? entry.step.note ?? "");
  const [capture, setCapture] = useState(draft?.capture ?? entry.step.capture === true);
  const [removeArmed, setRemoveArmed] = useState(false);
  useEffect(() => {
    setIntent(draft?.intent ?? entry.step.intent);
    setNote(draft?.note ?? entry.step.note ?? "");
    setCapture(draft?.capture ?? entry.step.capture === true);
    setRemoveArmed(false);
  }, [draft, entry.step]);
  function updateDraft(next: Partial<StepDraft>) {
    const value = {
      intent,
      note,
      capture,
      ...next,
    };
    onDraftChange?.(value);
  }
  const cleanIntent = intent.trim();
  const changed =
    cleanIntent !== entry.step.intent ||
    note.trim() !== (entry.step.note ?? "") ||
    capture !== (entry.step.capture === true);

  return (
    <form
      className="relay-selected-step-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!changed || !cleanIntent) return;
        onSave({
          label: `Updated ${cleanIntent}`,
          forward: [
            {
              kind: "step.patch",
              stepId: entry.step.id,
              patch: { intent: cleanIntent, note: note.trim() || null, capture },
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
              },
            },
          ],
        });
      }}
    >
      <div className="relay-inspector-heading">
        <span className="relay-editor-step-number">{entry.number}</span>
        <div>
          <p className="relay-section-label">Selected step</p>
          <h2>{stepKindLabel(entry.step)}</h2>
        </div>
      </div>
      {entry.step.kind === "decision" || entry.step.kind === "loop" ? (
        <div className="relay-editor-branch-actions">
          <strong>Add to branch</strong>
          <div>
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
      <label className="relay-editor-field" htmlFor="selected-step-intent">
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
      <label className="relay-editor-field" htmlFor="selected-step-note">
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
            Capture evidence after this step
          </span>
          <span className="text-xs leading-snug text-muted-foreground">
            Keep a screenshot with the next Run’s report.
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
      {entry.step.binding.status === "unresolved" ? (
        <Alert variant="default" className="relay-step-binding-alert">
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
      <Collapsible className="relay-editor-advanced">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
          Advanced
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 border-t pt-3 text-sm">
          <div>
            <span>Technical details</span>
            <p className="relay-editor-advanced-help">
              The saved configuration Relay uses to carry out or check this step.
            </p>
            <ScrollArea className="relay-editor-binding-scroll">
              <pre>{JSON.stringify(entry.step.binding, null, 2)}</pre>
            </ScrollArea>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <div className="relay-form-actions">
        <Button variant="default" type="submit" disabled={!changed || !cleanIntent || busy}>
          {busy ? "Saving…" : "Save step"}
        </Button>
        {removeArmed ? (
          <Alert variant="default" className="relay-editor-remove-confirm">
            <div>
              <AlertTitle>Remove this step?</AlertTitle>
              <AlertDescription>
                This saved change can be undone while this editor is open.
              </AlertDescription>
            </div>
            <div className="relay-editor-remove-actions">
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
            className="relay-editor-remove-button"
            disabled={busy}
            onClick={() => setRemoveArmed(true)}
          >
            Remove step
          </Button>
        )}
        {!changed ? <span className="relay-action-hint">No unsaved changes</span> : null}
      </div>
    </form>
  );
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
      <p className="relay-editor-binding-help">
        No compatible saved target is available yet. Review the recording or ask Relay to suggest a
        repair.
      </p>
    );
  }
  return (
    <div className="relay-editor-binding-repair">
      <div>
        <strong>Choose a saved target</strong>
        <p>These reviewed targets can repair this step without changing its wording.</p>
      </div>
      <div className="relay-editor-binding-candidates">
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
                    reason:
                      step.binding.status === "unresolved" ? step.binding.reason : "Needs review",
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
