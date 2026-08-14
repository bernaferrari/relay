import type { AppMap, AppMapCanvasState } from "@relay/protocol";
import { createMemo, type Accessor } from "solid-js";
import { useRecipeDraft } from "../context/recipe-draft";
import {
  appMapRunReadiness,
  appMapRunTarget,
  findRunnableFlow,
  gateGraphRunReadiness,
} from "./app-map-run-readiness";
import { recipeStepsForRunReadiness } from "./app-map-workspace-helpers";
import { useAppMapRunFlow } from "./use-app-map-run-flow";

/** Compiles selection-aware graph run intent without leaking it into the view. */
export function useAppMapWorkspaceRun(options: {
  activeAppMap: Accessor<AppMap | undefined>;
  graph: Accessor<NonNullable<AppMapCanvasState["graph"]>>;
  selectedNodeId: Accessor<string | null>;
  selectedConnectionId: Accessor<string | null>;
  onRunStarting: () => void;
}) {
  const draft = useRecipeDraft();
  const readinessSteps = createMemo(() =>
    recipeStepsForRunReadiness(draft.steps(), options.activeAppMap()?.connections),
  );
  const baseReadiness = createMemo(() =>
    appMapRunReadiness({
      graph: options.graph(),
      recipeSteps: readinessSteps(),
      selection: {
        screenId: options.selectedNodeId(),
        transitionId: options.selectedConnectionId(),
      },
    }),
  );
  const runnableFlow = createMemo(() =>
    findRunnableFlow(options.activeAppMap(), baseReadiness().transitionPath),
  );
  const runReadiness = createMemo(() =>
    gateGraphRunReadiness(baseReadiness(), Boolean(runnableFlow())),
  );
  const { runCanvasGraph } = useAppMapRunFlow({
    activeAppMap: options.activeAppMap,
    runnableFlow,
    transitionPath: () => runReadiness().transitionPath,
    onRunStarting: options.onRunStarting,
  });
  const runTargetForScreen = (screenId: string) =>
    appMapRunTarget({
      appMap: options.activeAppMap(),
      graph: options.graph(),
      recipeSteps: readinessSteps(),
      selection: { screenId },
    });

  return { runReadiness, runCanvasGraph, runTargetForScreen };
}
