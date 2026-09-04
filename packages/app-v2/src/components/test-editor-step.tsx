/** @jsxImportSource react */
import type {
  AppMapScenarioTestEdit,
  AppMapScenarioTestStep,
  AppMapTestBindingCandidate,
  AppMapTestStepPlacement,
} from "@relay/protocol";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  CheckboxCard,
  Disclosure,
  Input,
  ScrollArea,
  Textarea,
} from "@relay/ui-react";
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

export function SelectedStepEditor({
  entry,
  busy,
  onSave,
  onBind,
  onRemove,
  onAddChild,
}: {
  entry: StepEntry;
  busy: boolean;
  onSave(transaction: EditTransaction): void;
  onBind(transaction: EditTransaction): void;
  onRemove(): void;
  onAddChild(branch: "then" | "else" | "steps"): void;
}) {
  const [intent, setIntent] = useState(entry.step.intent);
  const [note, setNote] = useState(entry.step.note ?? "");
  const [capture, setCapture] = useState(entry.step.capture === true);
  const [removeArmed, setRemoveArmed] = useState(false);
  useEffect(() => {
    setIntent(entry.step.intent);
    setNote(entry.step.note ?? "");
    setCapture(entry.step.capture === true);
    setRemoveArmed(false);
  }, [entry.step]);
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
                  size="small"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onAddChild("then")}
                >
                  Then
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onAddChild("else")}
                >
                  Else
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="small"
                variant="secondary"
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
          onChange={(event) => setIntent(event.currentTarget.value)}
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
          onChange={(event) => setNote(event.currentTarget.value)}
          maxLength={4_000}
          rows={4}
        />
      </label>
      <CheckboxCard
        className="relay-editor-check"
        checked={capture}
        onCheckedChange={setCapture}
        title="Capture evidence after this step"
        description="Keep a screenshot with the next Run’s report."
      />
      {entry.step.binding.status === "unresolved" ? (
        <Alert variant="warning" className="relay-step-binding-alert">
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
      <Disclosure.Root className="relay-editor-advanced">
        <Disclosure.Trigger>Advanced</Disclosure.Trigger>
        <Disclosure.Panel>
          <div>
            <span>Technical details</span>
            <p className="relay-editor-advanced-help">
              The saved configuration Relay uses to carry out or check this step.
            </p>
            <ScrollArea className="relay-editor-binding-scroll">
              <pre>{JSON.stringify(entry.step.binding, null, 2)}</pre>
            </ScrollArea>
          </div>
        </Disclosure.Panel>
      </Disclosure.Root>
      <div className="relay-form-actions">
        <Button variant="primary" type="submit" disabled={!changed || !cleanIntent || busy}>
          {busy ? "Saving…" : "Save step"}
        </Button>
        {removeArmed ? (
          <Alert variant="warning" className="relay-editor-remove-confirm">
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
              <Button variant="secondary" type="button" disabled={busy} onClick={onRemove}>
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
            size="small"
            variant="secondary"
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

function stepKindLabel(step: AppMapScenarioTestStep): string {
  if (step.kind === "validation") return "Checkpoint";
  if (step.kind === "instruction") return "Action";
  if (step.kind === "manual") return "Human check";
  if (step.kind === "extraction") return "Remember value";
  if (step.kind === "module") return "Saved section";
  if (step.kind === "decision") return "Decision";
  if (step.kind === "loop") return "Repeat";
  return "Script";
}
