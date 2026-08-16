import type { AppMapScenarioTest, AppMapScenarioTestStep } from "@relay/protocol";
import { createScenarioStep, type ScenarioStepKind } from "./app-map-test-editor-model";
import {
  addScenarioChild,
  deleteScenarioStepTree,
  duplicateScenarioStepTree,
  findScenarioStep,
  moveScenarioStepTree,
  reorderScenarioStepTree,
  siblingFocusAfterDelete,
  updateScenarioStepTree,
  type ScenarioStepBranch,
} from "./app-map-test-editor-tree";

type UndoDelete = { message: string; test: AppMapScenarioTest; selectedStepId?: string };

/**
 * Every mutation a step row or the step editor can perform, in one place.
 *
 * Each one saves through the same `queueSave`, then moves selection and focus to
 * whatever the person is most likely to type next — a new step opens its intent,
 * a reorder keeps the row focused so `⌥↑`/`⌥↓` can repeat.
 */
export function createAppMapTestStepActions(options: {
  draft: () => AppMapScenarioTest | undefined;
  queueSave: (test: AppMapScenarioTest, options?: { preserveUndo?: boolean }) => void;
  setDraft: (update: (test?: AppMapScenarioTest) => AppMapScenarioTest | undefined) => void;
  setSelectedStepId: (stepId?: string) => void;
  undoDelete: () => UndoDelete | undefined;
  setUndoDelete: (undo?: UndoDelete) => void;
  /** Called after adding a step, so an overlaid Steps rail can get out of the way. */
  onStepAdded?: () => void;
}) {
  const at = () => Date.now();

  function focusStep(stepId: string | undefined, intent = false): void {
    if (!stepId) return;
    queueMicrotask(() => {
      const id = intent ? `test-step-intent-${stepId}` : `test-step-row-${stepId}`;
      document.getElementById(id)?.focus();
    });
  }

  function save(steps: AppMapScenarioTestStep[], preserveUndo = false): void {
    const test = options.draft();
    if (!test) return;
    options.queueSave(
      { ...test, steps, updatedAt: at() },
      preserveUndo ? { preserveUndo } : undefined,
    );
  }

  function insert(steps: AppMapScenarioTestStep[], stepId: string): void {
    save(steps);
    options.setSelectedStepId(stepId);
    options.onStepAdded?.();
    focusStep(stepId, true);
  }

  return {
    focusStep,

    /** Keystroke-level edit: local draft only, so typing never queues a save. */
    updateDraftStep(next: AppMapScenarioTestStep): void {
      options.setDraft((test) =>
        test ? { ...test, steps: updateScenarioStepTree(test.steps, next.id, () => next) } : test,
      );
    },

    commitStep(next: AppMapScenarioTestStep): void {
      const test = options.draft();
      if (!test) return;
      save(updateScenarioStepTree(test.steps, next.id, () => next));
    },

    addRootStep(kind: ScenarioStepKind): void {
      const test = options.draft();
      if (!test) return;
      const step = createScenarioStep(kind);
      insert([...test.steps, step], step.id);
    },

    addChildStep(
      parentStepId: string,
      branch: Exclude<ScenarioStepBranch, "root">,
      kind: ScenarioStepKind,
    ): void {
      const test = options.draft();
      if (!test) return;
      const step = createScenarioStep(kind);
      insert(addScenarioChild(test.steps, parentStepId, branch, step), step.id);
    },

    moveStep(stepId: string, direction: -1 | 1): void {
      const test = options.draft();
      if (!test) return;
      save(moveScenarioStepTree(test.steps, stepId, direction));
      focusStep(stepId);
    },

    reorderStep(stepId: string, toIndex: number): void {
      const test = options.draft();
      if (!test) return;
      save(reorderScenarioStepTree(test.steps, stepId, toIndex));
      options.setSelectedStepId(stepId);
      focusStep(stepId);
    },

    duplicateStep(stepId: string): void {
      const test = options.draft();
      if (!test) return;
      let duplicateId: string | undefined;
      const steps = duplicateScenarioStepTree(test.steps, stepId, () => {
        const id = crypto.randomUUID();
        duplicateId ??= id;
        return id;
      });
      save(steps);
      options.setSelectedStepId(duplicateId);
      focusStep(duplicateId);
    },

    deleteStep(stepId: string): void {
      const test = options.draft();
      if (!test) return;
      const deleted = findScenarioStep(test.steps, stepId);
      const nextSelection = siblingFocusAfterDelete(test.steps, stepId);
      options.setUndoDelete({
        message: `Deleted ${deleted?.intent || "step"}`,
        test: structuredClone(test),
        selectedStepId: stepId,
      });
      save(deleteScenarioStepTree(test.steps, stepId), true);
      options.setSelectedStepId(nextSelection);
      focusStep(nextSelection);
    },

    undoStepDelete(): void {
      const deleted = options.undoDelete();
      if (!deleted) return;
      options.setUndoDelete();
      options.queueSave({ ...deleted.test, updatedAt: at() });
      options.setSelectedStepId(deleted.selectedStepId);
      focusStep(deleted.selectedStepId);
    },
  };
}
