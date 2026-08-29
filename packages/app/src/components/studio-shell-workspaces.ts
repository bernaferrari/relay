import { lazy } from "solid-js";

/**
 * The workspaces the shell only pays for once a person asks for them. They are
 * declared together so the shell's own module stays about layout and state, and
 * so it is obvious at a glance what is and is not in the first paint.
 */
export const DataWorkspace = lazy(() =>
  import("./workspaces/data-workspace").then((module) => ({ default: module.DataWorkspace })),
);
export const RunsWorkspace = lazy(() =>
  import("./runs-workspace").then((module) => ({ default: module.RunsWorkspace })),
);
export const ChangesWorkspace = lazy(() =>
  import("./changes-workspace").then((module) => ({ default: module.ChangesWorkspace })),
);
export const EmptyAppMap = lazy(() =>
  import("./app-map-empty").then((module) => ({ default: module.EmptyAppMap })),
);
export const MapLibrary = lazy(() =>
  import("./map-library").then((module) => ({ default: module.MapLibrary })),
);
export const AppMapCombine = lazy(() =>
  import("./app-map-combine").then((module) => ({ default: module.AppMapCombine })),
);
