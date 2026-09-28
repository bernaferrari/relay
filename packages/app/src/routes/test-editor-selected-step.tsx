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
}) {
  return (
    <aside className="min-w-0" aria-label="Selected step editor">
      {selected ? (
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
                  ...(pendingCheckpoint.placement
                    ? { placement: pendingCheckpoint.placement }
                    : {}),
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
      ) : (
        <EmptyState
          title="Choose a step"
          detail="Select a step to edit its instruction, note, and evidence capture."
        />
      )}
    </aside>
  );
}
