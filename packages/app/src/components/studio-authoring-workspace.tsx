import { Show, Suspense, lazy } from "solid-js";
import type { CanvasCombineSection } from "../lib/app-map-combine-canvas";
import type { AuthoringSurface } from "./authoring-surface-switch";
import { WorkspaceSkeleton } from "./workspace-skeleton";

const AppMapWorkspace = lazy(() =>
  import("./app-map-workspace").then((module) => ({ default: module.AppMapWorkspace })),
);
const AppMapTestWorkspace = lazy(() =>
  import("./app-map-test-workspace").then((module) => ({ default: module.AppMapTestWorkspace })),
);

export function StudioAuthoringWorkspace(props: {
  surface: AuthoringSurface;
  navigatorOpen: boolean;
  onOpenSurface: (surface: AuthoringSurface) => void;
  onOpenTargets: () => void;
  onOpenVariables: () => void;
  onOpenCombine: (combineId?: string, section?: CanvasCombineSection) => void;
  onOpenRun: (id: string) => void;
}) {
  return (
    <Show
      when={props.surface === "test"}
      fallback={
        <Suspense fallback={<WorkspaceSkeleton label="map" />}>
          <AppMapWorkspace
            navigatorOpen={props.navigatorOpen}
            onOpenTargets={props.onOpenTargets}
            onOpenActions={() => props.onOpenSurface("test")}
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
