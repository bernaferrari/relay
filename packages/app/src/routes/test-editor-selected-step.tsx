/** @jsxImportSource react */
import {
  SelectedStepEditor,
  type EditTransaction,
  type StepEntry,
} from "../components/test-editor-step";
import { EmptyState } from "../components/product-patterns";
import type { ProductTestEditorDocument } from "../data/test-editor-product-service";
import type { PendingCheckpointDraft } from "./test-editor-route-helpers";
import type { StepDraft } from "./use-test-step-drafts";
import { TestRecordedTextEditor } from "../components/test-recorded-text-editor";
import { validationDraft } from "../components/test-editor-step";
import type { AppMapScenarioTestStep } from "@relay/protocol";
import type { ProductTestTextAction } from "../data/test-text-actions";
import { sameValidationDraft } from "../components/test-editor-assertion-model";

export function TestEditorSelectedStep({
  editorDocument,
  selected,
  stepDrafts,
  onEditingStateChange,
  updateStepDraft,
  busy,
  pendingCheckpoint,
  apply,
  onClearPending,
  selectStep,
  onStepChange,
  onRemoveStep,
  onAddChildStep,
  onSaveText,
  onTextReverted,
}: {
  editorDocument: ProductTestEditorDocument;
  selected?: StepEntry;
  stepDrafts: Record<string, StepDraft>;
  onEditingStateChange?(state: "dirty"): void;
  updateStepDraft(stepId: string, draft: StepDraft): void;
  busy: boolean;
  pendingCheckpoint: PendingCheckpointDraft | null;
  apply(transaction: EditTransaction): void;
  onClearPending(): void;
  selectStep(stepId: string): void;
  onStepChange(stepId: string | undefined): void;
  onRemoveStep(entry: StepEntry): void;
  onAddChildStep(entry: StepEntry, branch: "then" | "else" | "steps"): void;
  onSaveText(stepId: string, action: ProductTestTextAction, text: string): void;
  onTextReverted(step: AppMapScenarioTestStep, key: string, text: string): void;
}) {
  const textActions = selected ? (editorDocument.textActions?.[selected.step.id] ?? []) : [];
  const draft = selected ? stepDrafts[selected.step.id] : undefined;
  const detailsDirty = Boolean(
    selected &&
    draft &&
    (draft.intent.trim() !== selected.step.intent ||
      draft.note.trim() !== (selected.step.note ?? "") ||
      draft.capture !== (selected.step.capture === true) ||
      !sameValidationDraft(draft.expected, validationDraft(selected.step))),
  );
  const stepEditor = selected ? (
    <SelectedStepEditor
      key={`${selected.step.id}:${editorDocument.revision}`}
      entry={selected}
      savedPaths={editorDocument.savedPaths}
      appMapId={editorDocument.appMapId}
      draft={stepDrafts[selected.step.id]}
      onDraftChange={(draft) => {
        onEditingStateChange?.("dirty");
        updateStepDraft(selected.step.id, draft);
      }}
      busy={busy}
      unsavedCheckpoint={pendingCheckpoint?.step.id === selected.step.id}
      onSave={(transaction) => {
        if (pendingCheckpoint?.step.id !== selected.step.id) {
          apply(transaction);
          return;
        }
        const patch = transaction.forward.find((item) => item.kind === "step.patch");
        if (!patch || patch.kind !== "step.patch") return;
        const binding = patch.patch.binding;
        if (
          !binding ||
          binding.status !== "resolved" ||
          (binding.kind !== "assertion" && binding.kind !== "recipe-step")
        )
          return;
        apply({
          label: "Added a checkpoint",
          forward: [
            {
              kind: "step.add",
              step: {
                ...pendingCheckpoint.step,
                ...(patch.patch.intent === undefined ? {} : { intent: patch.patch.intent }),
                ...(patch.patch.note === undefined
                  ? {}
                  : patch.patch.note === null
                    ? { note: undefined }
                    : { note: patch.patch.note }),
                ...(patch.patch.capture === undefined ? {} : { capture: patch.patch.capture }),
                binding,
              },
              ...(pendingCheckpoint.placement ? { placement: pendingCheckpoint.placement } : {}),
              index: pendingCheckpoint.index,
            },
          ],
          reverse: [{ kind: "step.remove", stepId: pendingCheckpoint.step.id }],
        });
      }}
      onBind={(transaction) => {
        if (pendingCheckpoint?.step.id === selected.step.id) return;
        apply(transaction);
      }}
      onRemove={() => {
        if (pendingCheckpoint?.step.id === selected.step.id) {
          const previous =
            selected.siblingIds[selected.index - 1] ?? selected.placement?.parentStepId ?? null;
          onClearPending();
          if (previous) selectStep(previous);
          else onStepChange(undefined);
          return;
        }
        onRemoveStep(selected);
      }}
      onAddChild={(branch) => onAddChildStep(selected, branch)}
      platformBlocker={editorDocument.stepPlatformBlockers?.[selected.step.id]}
      hasRememberableReply={editorDocument.hasRememberableReply === true}
    />
  ) : null;
  return (
    <aside className="min-w-0" aria-label="Selected step editor">
      {selected ? (
        <>
          {textActions.map((action) => (
            <TestRecordedTextEditor
              key={`${selected.step.id}:${action.key}:${editorDocument.revision}`}
              action={action}
              value={stepDrafts[selected.step.id]?.textValues?.[action.key] ?? action.text}
              busy={busy}
              onChange={(text) => {
                const draft = stepDrafts[selected.step.id];
                updateStepDraft(selected.step.id, {
                  intent: draft?.intent ?? selected.step.intent,
                  note: draft?.note ?? selected.step.note ?? "",
                  capture: draft?.capture ?? selected.step.capture === true,
                  expected: draft?.expected ?? validationDraft(selected.step),
                  textValues: { ...draft?.textValues, [action.key]: text },
                });
                onEditingStateChange?.("dirty");
                if (text === action.text) onTextReverted(selected.step, action.key, text);
              }}
              onSave={() =>
                onSaveText(
                  selected.step.id,
                  action,
                  stepDrafts[selected.step.id]?.textValues?.[action.key] ?? action.text,
                )
              }
            />
          ))}
          {textActions.length ? (
            <details
              key={selected.step.id}
              className="border-t border-border/50"
              open={detailsDirty ? true : undefined}
            >
              <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium">
                Step details
                {detailsDirty ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    Unsaved changes
                  </span>
                ) : null}
              </summary>
              {stepEditor}
            </details>
          ) : (
            stepEditor
          )}
        </>
      ) : (
        <EmptyState
          title="Choose a step"
          detail="Select a step to edit its instruction, note, and evidence capture."
        />
      )}
    </aside>
  );
}
