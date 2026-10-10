/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Link } from "@tanstack/react-router";
import { useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { StageModeContext, type StageMode } from "./test-stage";
import type {
  ProductTestEditorDocument,
  ProductTestRepair,
} from "../data/test-editor-product-service";
import type { StepEntry } from "../components/test-editor-step";
import { TestEditorStepOutline } from "../components/test-editor-step-list";
import { HistorySection, RepairSection } from "./test-editor-context-panels";
import { TestEditorHistoryBar } from "./test-editor-page-sections";

type Outline = ComponentProps<typeof TestEditorStepOutline>;
type RepairDecision = Parameters<NonNullable<ComponentProps<typeof RepairSection>["onDecision"]>>;

export function TestEditorWorkspace({
  recordSteps,
  editorDocument,
  embedded,
  workspaceView,
  onWorkspaceViewChange,
  saveState,
  settingsOpen,
  onToggleSettings,
  editorExpanded,
  hasPendingCheckpoint,
  stepEditor,
  entries,
  selected,
  editPending,
  repairPending,
  draggedStepId,
  addStep,
  addCheckpoint,
  onSelectStep,
  onCollapseEditor,
  move,
  dropOn,
  onRepairDecision,
  canUndo,
  canRedo,
  historyPending,
  latestSummary,
  undo,
  redo,
  testId,
  browserPane,
  latestEvidence,
}: {
  recordSteps?: Outline["recordSteps"];
  editorDocument: ProductTestEditorDocument;
  embedded: boolean;
  workspaceView: "steps" | "browser";
  onWorkspaceViewChange(view: "steps" | "browser"): void;
  saveState: ReactNode;
  settingsOpen: boolean;
  onToggleSettings(): void;
  editorExpanded: boolean;
  hasPendingCheckpoint: boolean;
  stepEditor: ReactNode;
  entries: Outline["entries"];
  selected?: StepEntry;
  editPending: boolean;
  repairPending: boolean;
  draggedStepId: RefObject<string | undefined>;
  addStep: Outline["onAdd"];
  addCheckpoint: Outline["onAddCheckpoint"];
  onSelectStep(stepId: string): void;
  onCollapseEditor(): void;
  move: Outline["onMove"];
  dropOn: Outline["onDrop"];
  onRepairDecision(...args: RepairDecision): void;
  canUndo: boolean;
  canRedo: boolean;
  historyPending: boolean;
  latestSummary?: string;
  undo(): void;
  redo(): void;
  testId: string;
  browserPane: ReactNode;
  latestEvidence: ReactNode;
}) {
  const [stageMode, setStageMode] = useState<StageMode>("recorded");
  // One switcher on narrow windows: the steps, the screenshot, or the live app.
  const compactViews = [
    { id: "steps", label: "Steps", view: "steps", mode: undefined },
    { id: "recorded", label: "Screenshot", view: "browser", mode: "recorded" },
    {
      id: "live",
      label: "Live browser",
      view: "browser",
      mode: "live",
    },
  ] as const;
  return (
    <StageModeContext.Provider value={{ mode: stageMode, setMode: setStageMode }}>
      <div
        className="flex shrink-0 gap-1 border-b border-border px-3 py-2 min-[1100px]:hidden"
        aria-label="Editor view"
      >
        {compactViews.map((item) => {
          const active =
            workspaceView === item.view && (item.mode === undefined || stageMode === item.mode);
          return (
            <Button
              key={item.id}
              size="sm"
              variant={active ? "secondary" : "ghost"}
              aria-pressed={active}
              onClick={() => {
                onWorkspaceViewChange(item.view);
                if (item.mode) setStageMode(item.mode);
              }}
            >
              {item.label}
            </Button>
          );
        })}
      </div>
      <div
        className={`grid min-h-0 flex-1 ${embedded ? "min-[1100px]:grid-cols-[340px_minmax(0,1fr)]" : "min-[1100px]:grid-cols-[280px_minmax(0,1fr)]"}`}
      >
        <div
          className={`${workspaceView === "steps" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col min-[1100px]:flex min-[1100px]:border-r min-[1100px]:border-border`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            <TestEditorStepOutline
              headerAside={embedded ? <>{saveState}</> : undefined}
              showDetails={settingsOpen}
              selectedEditor={editorExpanded || hasPendingCheckpoint ? stepEditor : null}
              test={editorDocument.test}
              displayTitles={editorDocument.displayTitles}
              recordedPlatforms={editorDocument.recordedPlatforms}
              routePlatformBlockers={editorDocument.routePlatformBlockers}
              stepPlatformBlockers={editorDocument.stepPlatformBlockers}
              originEvidenceMissing={editorDocument.originEvidenceMissing}
              entries={entries}
              selectedStepId={selected?.step.id}
              busy={editPending || repairPending}
              draggedStepId={draggedStepId}
              recordSteps={recordSteps}
              onAdd={addStep}
              onAddCheckpoint={addCheckpoint}
              onSelect={(id) => {
                if (id === selected?.step.id && editorExpanded) onCollapseEditor();
                else onSelectStep(id);
              }}
              onMove={move}
              onDrop={dropOn}
            />
            {editorDocument.repairs.length ? (
              <RepairSection
                repairs={editorDocument.repairs}
                busy={repairPending}
                onDecision={(proposal, decision) => onRepairDecision(proposal, decision)}
              />
            ) : null}
            {settingsOpen && (editorDocument.repairs.length || editorDocument.history.length) ? (
              <details className="mt-4 border-t border-border pt-2 text-sm text-muted-foreground">
                <summary className="cursor-pointer py-2">
                  History
                  {editorDocument.repairs.length
                    ? ` and ${editorDocument.repairs.length} suggested repairs`
                    : ""}
                </summary>
                <div className="grid gap-6 pt-4">
                  {editorDocument.history.length ? (
                    <HistorySection items={editorDocument.history} />
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
          {/* Undo and redo appear once there is something to undo. */}
          {canUndo || canRedo || historyPending || !embedded ? (
            <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2">
              {canUndo || canRedo || historyPending ? (
                <TestEditorHistoryBar
                  canUndo={canUndo}
                  canRedo={canRedo}
                  busy={editPending || historyPending}
                  latestSummary={latestSummary}
                  onUndo={undo}
                  onRedo={redo}
                />
              ) : (
                <span />
              )}
              {embedded ? null : (
                <Link
                  className="text-xs text-muted-foreground hover:text-foreground"
                  to="/tests/$testId"
                  params={{ testId }}
                >
                  Run setup →
                </Link>
              )}
            </div>
          ) : null}
        </div>
        <div
          className={`${workspaceView === "browser" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col overflow-y-auto min-[1100px]:flex`}
          data-inspector-kind="browser"
        >
          {browserPane}
          {latestEvidence}
        </div>
      </div>
    </StageModeContext.Provider>
  );
}
