import { Show, Suspense, lazy } from "solid-js";
import type { CanvasCombineSection } from "../lib/app-map-combine-canvas";
import type { AuthoringSurface } from "./authoring-surface-switch";

const AppMapWorkspace = lazy(() =>
  import("./app-map-workspace").then((module) => ({ default: module.AppMapWorkspace })),
);
const AppMapTestWorkspace = lazy(() =>
  import("./app-map-test-workspace").then((module) => ({ default: module.AppMapTestWorkspace })),
);

function Loading(props: { label: string }) {
  return (
    <div class="grid min-h-0 flex-1 place-items-center bg-[var(--background-deep)] text-[12px] text-[var(--text-weak)]">
      Loading {props.label}…
    </div>
  );
}

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
        <Suspense fallback={<Loading label="map" />}>
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
      <Suspense fallback={<Loading label="test editor" />}>
        <AppMapTestWorkspace
          onOpenMap={() => props.onOpenSurface("map")}
          onOpenRun={props.onOpenRun}
        />
      </Suspense>
    </Show>
  );
}
