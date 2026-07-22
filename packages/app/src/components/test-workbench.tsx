import { Show, createMemo, type JSX } from "solid-js";
import { useRecipeDraft } from "../context/recipe-draft";
import { useServer } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { eyebrow } from "../lib/ui";
import { shellStageDrawerClearance, shellStageWrap } from "../lib/shell-layout";
import { DeviceStage } from "./stage";
import { JourneyInspector, JourneyOutline } from "./journey-chrome";
import { ExecutionInspector } from "./execution-inspector";

/**
 * The default test surface. Its three regions intentionally share one step
 * selection: navigator → real device evidence → readable properties.
 * Recording, editing, and reviewing therefore never switch mental models.
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
  return (
    <>
      <JourneyOutline compact />
      <div class={cn(shellStageWrap, shellStageDrawerClearance, "min-h-0 flex-1")}>
        <DeviceStage onExpandBoard={props.onOpenMap} onOpenTargets={props.onOpenTargets} />
      </div>
      <Show
        when={props.details}
        fallback={
          <Show
            when={execution()}
            fallback={
              <Show
                when={draft.steps().length > 0}
                fallback={
                  <aside class="flex min-h-0 flex-col border-l border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)] p-5 text-[12px] text-[var(--text-weak)]">
                    <span class={eyebrow}>Step properties</span>
                    <strong class="mt-2 text-[14px] text-[var(--text-strong)]">
                      Record your first action
                    </strong>
                    <p class="mt-1.5 max-w-[30ch] leading-[1.55]">
                      Actions appear here as editable steps while you use the device.
                    </p>
                  </aside>
                }
              >
                <JourneyInspector compact onOpenTargets={props.onOpenTargets} />
              </Show>
            }
          >
            {(job) => <ExecutionInspector job={job()} onOpenReport={props.onOpenRun} />}
          </Show>
        }
      >
        {props.details}
      </Show>
    </>
  );
}
