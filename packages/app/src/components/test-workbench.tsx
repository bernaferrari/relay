import { Show, createMemo, type JSX } from "solid-js";
import { useRecipeDraft } from "../context/recipe-draft";
import { useServer } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { shellStageDrawerClearance, shellStageWrap } from "../lib/shell-layout";
import { DeviceStage } from "./stage";
import { AppMapInspector } from "./app-map-inspector";
import { ExecutionInspector } from "./execution-inspector";

/**
 * The default test surface: real device evidence beside the selected step's
 * properties. The step list itself lives in the navigator, so one selection
 * drives all three regions and recording, editing, and reviewing never switch
 * mental models.
 */
export function TestWorkbench(props: {
  onOpenMap: () => void;
  onOpenTargets: () => void;
  onOpenRun: (id: string) => void;
  details?: JSX.Element;
}) {
  const draft = useRecipeDraft();
  const server = useServer();
  const workbench = useWorkbench();
  const execution = createMemo(() => {
    const recipe = server.selectedRecipe();
    if (!recipe) return null;
    const selected = server.jobs().find((job) => job.id === server.selectedJobId());
    const live =
      selected &&
      (selected.status === "queued" ||
        selected.status === "running" ||
        selected.status === "paused");
    if (
      live &&
      selected?.action === recipe.id &&
      (!selected.recipeSnapshot || selected.recipeSnapshot.updatedAt === recipe.updatedAt)
    )
      return selected;
    return workbench.activeLiveJob();
  });
  const hasInspector = () => Boolean(props.details || execution() || draft.steps().length > 0);
  return (
    <>
      <div
        class={cn(
          shellStageWrap,
          hasInspector() && shellStageDrawerClearance,
          "min-h-0 flex-1",
          !hasInspector() && "col-span-full",
        )}
      >
        <DeviceStage onExpandBoard={props.onOpenMap} onOpenTargets={props.onOpenTargets} />
      </div>
      <Show when={hasInspector()}>
        <Show
          when={props.details}
          fallback={
            <Show
              when={execution()}
              fallback={<AppMapInspector compact onOpenTargets={props.onOpenTargets} />}
            >
              {(job) => <ExecutionInspector job={job()} onOpenReport={props.onOpenRun} />}
            </Show>
          }
        >
          {props.details}
        </Show>
      </Show>
    </>
  );
}
