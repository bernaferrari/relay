import { Show, Suspense, lazy } from "solid-js";
import type { CanvasCombineSection } from "../lib/app-map-combine-canvas";
import { FirstOperatorRunCard, useFirstOperatorRun } from "./first-operator-run";
import { FirstTestChecklist, useFirstTestOnboarding } from "./first-test-onboarding";
import type { MapCanvasView, MapMode } from "./map-mode-switch";
import { WorkspaceSkeleton } from "./workspace-skeleton";
import type { WorkspaceController } from "../lib/workspace-controller";

const AppMapWorkspace = lazy(() =>
  import("./app-map-workspace").then((module) => ({ default: module.AppMapWorkspace })),
);
const AppMapTestWorkspace = lazy(() =>
  import("./app-map-test-workspace").then((module) => ({ default: module.AppMapTestWorkspace })),
);

export function StudioAuthoringWorkspace(props: {
  mode: MapMode;
  navigatorOpen: boolean;
  onMode: (mode: MapMode) => void;
  onOpenTargets: () => void;
  onOpenVariables: () => void;
  onOpenCombine: (combineId?: string, section?: CanvasCombineSection) => void;
  onOpenRun: (id: string) => void;
  onImportYaml: (yaml: string) => Promise<void> | void;
  onExportYaml: () => void;
  workspaceController: WorkspaceController;
}) {
  function recordTest(): void {
    if (props.mode !== "test") props.onMode("test");
    props.workspaceController.request({ kind: "test.record" });
  }
  function showLiveDevice(): void {
    props.workspaceController.request({ kind: "device.show" });
  }
  function chooseTarget(): void {
    props.workspaceController.request({ kind: "target.choose" });
  }
  function captureScreen(): void {
    props.workspaceController.request({ kind: "screen.capture" });
  }
  const onboarding = useFirstTestOnboarding({
    onOpenTargets: chooseTarget,
    onShowLiveDevice: showLiveDevice,
    onSaveStartScreen: captureScreen,
    onRecord: recordTest,
    onImportYaml: props.onImportYaml,
    onOpenTest: () => props.onMode("test"),
    onOpenRun: props.onOpenRun,
    onExportYaml: props.onExportYaml,
  });
  const operatorRun = useFirstOperatorRun({
    firstTestVisible: () => onboarding.visible(),
    onOpenTargets: chooseTarget,
    onShowLiveDevice: showLiveDevice,
    onOpenCombine: (combineId) => props.onOpenCombine(combineId),
    onOpenTest: () => props.onMode("test"),
  });

  return (
    <div class="relative flex min-h-0 min-w-0 flex-1">
      <Show
        when={props.mode === "test"}
        fallback={
          <Suspense fallback={<WorkspaceSkeleton label="map" />}>
            <AppMapWorkspace
              workspaceController={props.workspaceController}
              navigatorOpen={props.navigatorOpen}
              view={props.mode as MapCanvasView}
              onView={props.onMode}
              onOpenTargets={props.onOpenTargets}
              onOpenActions={() => props.onMode("test")}
              onOpenVariables={props.onOpenVariables}
              onOpenCombine={props.onOpenCombine}
              onOpenRun={props.onOpenRun}
            />
          </Suspense>
        }
      >
        <Suspense fallback={<WorkspaceSkeleton label="test editor" />}>
          <AppMapTestWorkspace
            workspaceController={props.workspaceController}
            onOpenRun={props.onOpenRun}
            onChooseTarget={props.onOpenTargets}
            onOpenTarget={showLiveDevice}
            onRecord={onboarding.checklistProps().onRecord}
          />
        </Suspense>
      </Show>
      <Show when={onboarding.visible()}>
        <aside class="absolute bottom-4 left-4 z-30 max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] overflow-y-auto max-[760px]:right-2 max-[760px]:bottom-2 max-[760px]:left-2 max-[760px]:max-w-none">
          <FirstTestChecklist {...onboarding.checklistProps()} />
        </aside>
      </Show>
      <Show when={operatorRun.visible()}>
        <aside class="absolute bottom-4 left-4 z-30 max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] overflow-y-auto max-[760px]:right-2 max-[760px]:bottom-2 max-[760px]:left-2 max-[760px]:max-w-none">
          <FirstOperatorRunCard
            stage={operatorRun.state().stage}
            title={operatorRun.state().title}
            detail={operatorRun.state().detail}
            actionLabel={operatorRun.state().actionLabel}
            deviceLabel={operatorRun.state().deviceLabel}
            deviceDetail={operatorRun.state().deviceDetail}
            onAction={operatorRun.activate}
            onDismiss={operatorRun.dismiss}
          />
        </aside>
      </Show>
      <Show when={onboarding.canReopen() && !operatorRun.visible()}>
        <button
          type="button"
          class="absolute bottom-4 left-4 z-30 min-h-10 rounded-xl border border-[var(--map-divider)] bg-[var(--map-control-surface)] px-3 text-caption font-medium text-[var(--text-strong)] shadow-[var(--map-elevation-control)] transition-colors hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)] max-[760px]:bottom-2 max-[760px]:left-2"
          onClick={onboarding.reopen}
        >
          First useful test
        </button>
      </Show>
    </div>
  );
}
