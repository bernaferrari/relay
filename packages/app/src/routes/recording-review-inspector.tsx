/** @jsxImportSource react */
import type { AuthoringRecordingEdit } from "@relay/protocol";
import { Button } from "@relay/ui-react/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@relay/ui-react/components/dialog";
import { Field, FieldLabel } from "@relay/ui-react/components/field";
import { Input } from "@relay/ui-react/components/input";
import { ArrowDown, ArrowUp, Combine, Scissors, Trash2 } from "lucide-react";
import { useState } from "react";

import type {
  ProductRecordingState,
  RecordingProductService,
} from "../data/recording-product-service";
import type { RecordingEvidenceControl } from "../data/recording-evidence-target";
import { tryReviewTarget } from "../data/recording-try-target";
import { SelectField } from "../components/filter-select";
import { RecordingTargetPicker } from "./recording-target-picker";
import { RecordingWaitPicker } from "./recording-wait-picker";
import { RecordingWaitConditions } from "./recording-wait-conditions";

type ReviewAction = NonNullable<
  NonNullable<ProductRecordingState["snapshot"]>["review"]
>["actions"][number];

export function RecordingReviewInspector({
  actions,
  selectedActions,
  selectedAction,
  selectedIndex,
  actionIntent,
  setActionIntent,
  splitAfterStep,
  setSplitAfterStep,
  canEdit,
  selectionIsContiguous,
  onEdit,
  onSaveWait,
  onMoveSelected,
  state,
  productService,
  controls,
  previewUrl,
}: {
  actions: readonly ReviewAction[];
  selectedActions: readonly ReviewAction[];
  selectedAction?: ReviewAction;
  selectedIndex: number;
  actionIntent: string;
  setActionIntent: (value: string) => void;
  splitAfterStep: number;
  setSplitAfterStep: (value: number) => void;
  canEdit: boolean;
  selectionIsContiguous: boolean;
  onEdit: (edit: AuthoringRecordingEdit) => void;
  onSaveWait?: (edit: AuthoringRecordingEdit) => Promise<void>;
  onMoveSelected: (offset: -1 | 1) => void;
  state?: ProductRecordingState;
  productService: RecordingProductService;
  controls: readonly RecordingEvidenceControl[];
  previewUrl?: string | null;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <aside
      className="flex min-w-0 flex-col gap-3 px-3 py-4 text-card-foreground"
      aria-label="Edit steps"
    >
      <section className="grid gap-3" aria-labelledby="review-editor-title">
        <div className="flex flex-wrap items-center justify-between gap-3.5">
          <h2 id="review-editor-title" className="text-xs font-medium text-muted-foreground">
            {selectedActions.length === 0
              ? "Select a step"
              : selectedActions.length === 1
                ? `Step ${selectedIndex + 1}`
                : `${selectedActions.length} steps selected`}
          </h2>
        </div>

        {selectedAction ? (
          <>
            <Field>
              <FieldLabel htmlFor="review-action-intent" className="text-xs text-muted-foreground">
                What this step does
              </FieldLabel>
              {/* Save appears only once the instruction differs from what's saved. */}
              <div className="flex gap-2">
                <Input
                  id="review-action-intent"
                  value={actionIntent}
                  onChange={(event) => setActionIntent(event.currentTarget.value)}
                  maxLength={240}
                  disabled={!canEdit}
                />
                {canEdit && actionIntent.trim() && actionIntent.trim() !== selectedAction.intent ? (
                  <Button
                    size="sm"
                    aria-label="Save instruction"
                    className="h-auto"
                    onClick={() =>
                      onEdit({
                        kind: "rename",
                        actionId: selectedAction.id,
                        intent: actionIntent.trim(),
                      })
                    }
                  >
                    Save
                  </Button>
                ) : null}
              </div>
            </Field>
            <RecordingWaitConditions
              key={selectedAction.id}
              action={selectedAction}
              canEdit={canEdit}
              onEdit={onEdit}
              onSaveWait={onSaveWait}
            />
            <h3 className="mt-1 text-xs font-medium text-muted-foreground">Change</h3>
            <div className="-mt-1.5 flex flex-wrap items-center gap-1">
              {selectedAction.kind === "tap" ? (
                <RecordingTargetPicker
                  controls={controls}
                  canEdit={canEdit}
                  previewUrl={previewUrl ?? null}
                  onTry={(control) =>
                    tryReviewTarget({
                      previewTarget: productService.previewTarget,
                      selectedTarget: state?.selectedTarget,
                      control,
                      confirmStartingState: async () =>
                        state?.selectedTarget
                          ? { ok: true }
                          : {
                              ok: false,
                              detail: "Restore the recording Device before trying this target.",
                            },
                      observe: async () => {
                        if (!productService.observeTarget || !state?.selectedTarget) return [];
                        return productService.observeTarget(state.selectedTarget);
                      },
                    })
                  }
                  onKeep={(target) =>
                    onEdit({
                      kind: "replace",
                      actionId: selectedAction.id,
                      interaction: { kind: "tap", target },
                    })
                  }
                />
              ) : null}
              <RecordingWaitPicker
                canEdit={canEdit}
                onInsert={(interaction) =>
                  onEdit({ kind: "insert-before", actionId: selectedAction.id, interaction })
                }
              />
            </div>
            {selectedAction.stepCount > 1 ? (
              <div className="grid gap-1.5">
                <SelectField
                  label="Split after selected step"
                  value={String(Math.min(splitAfterStep, selectedAction.stepCount - 1))}
                  disabled={!canEdit}
                  options={Array.from({ length: selectedAction.stepCount - 1 }, (_, index) => ({
                    value: String(index + 1),
                    label: `After step ${index + 1}`,
                  }))}
                  onValueChange={(value) => setSplitAfterStep(Number.parseInt(value, 10))}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onEdit({
                      kind: "split",
                      actionId: selectedAction.id,
                      atStep: Math.min(splitAfterStep, selectedAction.stepCount - 1),
                    })
                  }
                  disabled={!canEdit}
                >
                  <Scissors aria-hidden="true" /> Split action
                </Button>
              </div>
            ) : null}
          </>
        ) : selectedActions.length > 1 ? (
          <Button
            size="sm"
            onClick={() =>
              onEdit({ kind: "merge", actionIds: selectedActions.map((action) => action.id) })
            }
            disabled={!canEdit || !selectionIsContiguous}
          >
            <Combine aria-hidden="true" /> Merge actions
          </Button>
        ) : (
          <p className="text-xs leading-normal text-muted-foreground">
            Choose a step to rename, reorder, replace, split, or remove it.
          </p>
        )}

        {selectedActions.length ? (
          <div className="mt-1 flex items-center gap-1 border-t border-border pt-3">
            {selectedAction ? (
              <div className="flex items-center gap-0.5" role="group" aria-label="Reorder action">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Move up"
                  title="Move up"
                  onClick={() => onMoveSelected(-1)}
                  disabled={!canEdit || selectedIndex <= 0}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Move down"
                  title="Move down"
                  onClick={() => onMoveSelected(1)}
                  disabled={!canEdit || selectedIndex === actions.length - 1}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
              </div>
            ) : null}
            <span className="flex-1" />
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogTrigger render={<Button size="sm" variant="ghost" disabled={!canEdit} />}>
                <Trash2 aria-hidden="true" /> Remove{" "}
                {selectedActions.length === 1 ? "action" : "actions"}
              </DialogTrigger>
              <DialogContent showCloseButton={false}>
                <DialogTitle>
                  Remove selected {selectedActions.length === 1 ? "action" : "actions"}?
                </DialogTitle>
                <DialogDescription>
                  This changes the steps and requires a new replay before saving.
                </DialogDescription>
                <div className="flex flex-wrap items-center justify-end gap-2.5">
                  <DialogClose render={<Button variant="ghost">Cancel</Button>} />
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setDeleteOpen(false);
                      onEdit({
                        kind: "remove",
                        actionIds: selectedActions.map((action) => action.id),
                      });
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        ) : null}
      </section>
    </aside>
  );
}
