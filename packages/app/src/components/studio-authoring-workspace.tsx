import { Show, Suspense, lazy } from "solid-js";
import type { CanvasCombineSection } from "../lib/app-map-combine-canvas";
import type { MapCanvasView, MapMode } from "./map-mode-switch";
import { WorkspaceSkeleton } from "./workspace-skeleton";

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
}) {
  return (
    <Show
      when={props.mode === "test"}
      fallback={
        <Suspense fallback={<WorkspaceSkeleton label="map" />}>
          <AppMapWorkspace
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
        <AppMapTestWorkspace onOpenRun={props.onOpenRun} />
      </Suspense>
    </Show>
  );
}
