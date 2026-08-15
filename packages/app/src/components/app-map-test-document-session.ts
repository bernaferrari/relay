import { createEffect, createMemo, createSignal, type Accessor } from "solid-js";
import type { AppMapScenarioTest, AppMapScenarioTestStep, AppMapTest } from "@relay/protocol";
import { useServer } from "../context/server";
import { planScenarioTestEdits } from "../lib/app-map-scenario-edit-plan";
import { createScenarioTest } from "../lib/app-map-test-editor-model";
import { findScenarioStep, flattenScenarioSteps } from "../lib/app-map-test-editor-tree";
import { confirmAction } from "./confirm-dialog";

type TestDocumentSaveState = "saved" | "saving" | "error";

type TestStepDeleteUndo = {
  message: string;
  test: AppMapScenarioTest;
  selectedStepId?: string;
};

type TestDocumentSessionOptions = {
  testId: Accessor<string | undefined>;
  onTestChange?: (testId: string) => void;
  onCanonicalLoaded?: () => void;
  onDraftQueued?: () => void;
  onTestDeleted?: () => void;
};

/** Owns selection and persistence for the graph Test document. */
export function createAppMapTestDocumentSession(options: TestDocumentSessionOptions) {
  const server = useServer();
  const appMap = createMemo(() => server.selectedAppMap());
  const tests = createMemo(() =>
    Object.values(appMap()?.tests ?? {}).toSorted(
      (left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name),
    ),
  );
  const [localTestId, setLocalTestId] = createSignal("");
  const selectedTestId = () => options.testId() ?? localTestId();
  const selectedTest = createMemo(() => tests().find((test) => test.id === selectedTestId()));
  const [draft, setDraft] = createSignal<AppMapScenarioTest>();
  const [selectedStepId, setSelectedStepId] = createSignal<string>();
  const [saveState, setSaveState] = createSignal<TestDocumentSaveState>("saved");
  const [saveError, setSaveError] = createSignal("");
  const [retryAvailable, setRetryAvailable] = createSignal(false);
  const [undoDelete, setUndoDelete] = createSignal<TestStepDeleteUndo>();
  const [deletedTest, setDeletedTest] = createSignal<AppMapTest>();
  const [creating, setCreating] = createSignal(false);
  let loadedKey = "";
  let optimisticRevision = 0;
  let saveQueue = Promise.resolve();
  let pendingSaves = 0;
  let failedDraft: AppMapScenarioTest | undefined;
  let queuedDraft: AppMapScenarioTest | undefined;

  const selectTest = (id: string) => {
    setLocalTestId(id);
    options.onTestChange?.(id);
  };

  createEffect(() => {
    const map = appMap();
    if (!map) return;
    const current = selectedTestId();
    if (!current || !map.tests[current]) {
      const first = tests()[0];
      if (first) selectTest(first.id);
    }
  });

  createEffect(() => {
    const map = appMap();
    const test = selectedTest();
    if (!map || !test) {
      setDraft();
      queuedDraft = undefined;
      setUndoDelete();
      setSelectedStepId();
      loadedKey = "";
      return;
    }
    const key = `${map.id}:${test.id}:${map.revision}`;
    if (key === loadedKey || saveState() !== "saved") return;
    loadedKey = key;
    options.onCanonicalLoaded?.();
    setUndoDelete();
    optimisticRevision = map.revision;
    if (test.kind === "scenario") {
      const copy = structuredClone(test);
      queuedDraft = copy;
      setDraft(copy);
      setSelectedStepId((id) =>
        findScenarioStep(copy.steps, id) ? id : flattenScenarioSteps(copy.steps)[0]?.step.id,
      );
    } else {
      setDraft();
      setSelectedStepId();
    }
  });

  function queueSave(next: AppMapScenarioTest, saveOptions?: { preserveUndo?: boolean }): void {
    const map = appMap();
    if (!map) return;
    const snapshot = structuredClone(next);
    const previous = queuedDraft ?? draft();
    if (!previous) return;
    const edits = planScenarioTestEdits(previous, snapshot);
    if (!saveOptions?.preserveUndo) setUndoDelete();
    queuedDraft = snapshot;
    setDraft(snapshot);
    options.onDraftQueued?.();
    if (edits.length === 0) {
      if (failedDraft) {
        failedDraft = snapshot;
        setRetryAvailable(true);
        setSaveState("error");
        return;
      }
      failedDraft = undefined;
      setSaveError("");
      setRetryAvailable(false);
      setSaveState("saved");
      return;
    }
    if (failedDraft) {
      failedDraft = snapshot;
      setRetryAvailable(true);
      setSaveState("error");
      return;
    }
    setSaveError("");
    setRetryAvailable(false);
    setSaveState("saving");
    pendingSaves += 1;
    saveQueue = saveQueue.then(async () => {
      try {
        if (failedDraft) {
          failedDraft = snapshot;
          setRetryAvailable(true);
          setSaveState("error");
          return;
        }
        const result = await server.editTest({
          appMapId: map.id,
          testId: snapshot.id,
          expectedRevision: optimisticRevision,
          edits,
        });
        optimisticRevision = result.appMap.revision;
        await server.refreshAppMaps();
      } catch (error) {
        failedDraft = snapshot;
        setRetryAvailable(true);
        setSaveError(error instanceof Error ? error.message : String(error));
        setSaveState("error");
      } finally {
        pendingSaves -= 1;
        if (pendingSaves === 0 && !failedDraft) setSaveState("saved");
      }
    });
  }

  async function retrySave(): Promise<void> {
    const snapshot = failedDraft;
    if (!snapshot) return;
    failedDraft = undefined;
    setRetryAvailable(false);
    setSaveError("");
    try {
      await server.refreshAppMaps();
    } catch (error) {
      failedDraft = snapshot;
      setRetryAvailable(true);
      setSaveState("error");
      setSaveError(
        `Could not refresh server truth. ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    const currentMap = server.selectedAppMap();
    const canonical = currentMap?.tests[snapshot.id];
    if (!currentMap || !canonical || canonical.kind !== "scenario") {
      failedDraft = snapshot;
      setRetryAvailable(true);
      setSaveState("error");
      setSaveError("The Test no longer exists as a graph-native scenario. Reload the editor.");
      return;
    }
    optimisticRevision = currentMap.revision;
    queuedDraft = structuredClone(canonical);
    queueSave(snapshot);
  }

  function dismissSaveError(): void {
    setSaveError("");
    setSaveState("saved");
  }

  async function createTest(): Promise<void> {
    const map = appMap();
    if (!map || creating()) return;
    setCreating(true);
    const next = createScenarioTest(map, `Test ${Object.keys(map.tests).length + 1}`);
    try {
      const result = await server.saveTest({
        appMapId: map.id,
        expectedRevision: map.revision,
        test: next,
      });
      optimisticRevision = result.appMap.revision;
      await server.refreshAppMaps();
      selectTest(next.id);
    } catch (error) {
      setRetryAvailable(false);
      setSaveError(error instanceof Error ? error.message : String(error));
      setSaveState("error");
    } finally {
      setCreating(false);
    }
  }

  async function duplicateTest(): Promise<void> {
    const map = appMap();
    const test = selectedTest();
    if (!map || !test || saveState() !== "saved") return;
    const now = Date.now();
    const copy: AppMapTest = {
      ...structuredClone(test),
      id: crypto.randomUUID(),
      name: `${test.name} copy`,
      ...(test.kind === "scenario" ? { steps: renewScenarioStepIds(test.steps) } : {}),
      createdAt: now,
      updatedAt: now,
    };
    try {
      const result = await server.saveTest({
        appMapId: map.id,
        expectedRevision: map.revision,
        test: copy,
      });
      optimisticRevision = result.appMap.revision;
      await server.refreshAppMaps();
      selectTest(copy.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      setSaveState("error");
    }
  }

  function deleteTest(): void {
    const map = appMap();
    const test = selectedTest();
    if (!map || !test || saveState() !== "saved") return;
    confirmAction({
      title: `Delete “${test.name}”?`,
      body: "This removes the Test from this map. Its existing run evidence is kept in Runs.",
      confirmLabel: "Delete Test",
      tone: "destructive",
      onConfirm: async () => {
        try {
          await server.runAction("app-map.test.remove", {
            appMapId: map.id,
            testId: test.id,
            expectedRevision: map.revision,
          });
          selectTest("");
          await server.refreshAppMaps();
          setDeletedTest(structuredClone(test));
          options.onTestDeleted?.();
        } catch (error) {
          setSaveError(error instanceof Error ? error.message : String(error));
          setSaveState("error");
        }
      },
    });
  }

  async function restoreDeletedTest(): Promise<void> {
    const test = deletedTest();
    const map = appMap();
    if (!test || !map) return;
    try {
      await server.saveTest({
        appMapId: map.id,
        expectedRevision: map.revision,
        test: { ...structuredClone(test), updatedAt: Date.now() },
      });
      setDeletedTest();
      await server.refreshAppMaps();
      selectTest(test.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      setSaveState("error");
    }
  }

  return {
    appMap,
    tests,
    selectedTestId,
    selectedTest,
    selectTest,
    draft,
    setDraft,
    selectedStepId,
    setSelectedStepId,
    saveState,
    saveError,
    retryAvailable,
    undoDelete,
    setUndoDelete,
    deletedTest,
    setDeletedTest,
    creating,
    queueSave,
    retrySave,
    dismissSaveError,
    createTest,
    duplicateTest,
    deleteTest,
    restoreDeletedTest,
    awaitPendingSaves: () => saveQueue,
  };
}

function renewScenarioStepIds(steps: readonly AppMapScenarioTestStep[]): AppMapScenarioTestStep[] {
  return steps.map((step) => {
    const copy = { ...structuredClone(step), id: crypto.randomUUID() };
    if (copy.kind === "decision") {
      copy.thenSteps = renewScenarioStepIds(copy.thenSteps);
      if (copy.elseSteps) copy.elseSteps = renewScenarioStepIds(copy.elseSteps);
    }
    if (copy.kind === "loop") copy.steps = renewScenarioStepIds(copy.steps);
    return copy;
  });
}
