import { Show } from "solid-js";
import { useRecipeDraft } from "../context/recipe-draft";
import { cn } from "../lib/cn";
import { eyebrow } from "../lib/ui";
import { shellStageWrap } from "../lib/shell-layout";
import { DeviceStage } from "./stage";
import { JourneyInspector, JourneyOutline } from "./journey-chrome";

/**
 * The default test surface. Its three regions intentionally share one step
 * selection: navigator → real device evidence → readable properties.
 * Recording, editing, and reviewing therefore never switch mental models.
 */
export function TestWorkbench(props: {
  onOpenMap: () => void;
  onOpenAdvanced: () => void;
  onOpenTargets: () => void;
}) {
  const draft = useRecipeDraft();

  return (
    <>
      <JourneyOutline compact onAdvancedAdd={props.onOpenAdvanced} />
      <div class={cn(shellStageWrap, "flex-1")}>
        <DeviceStage onExpandBoard={props.onOpenMap} onOpenTargets={props.onOpenTargets} />
      </div>
      <Show
        when={draft.steps().length > 0}
        fallback={
          <aside class="flex min-h-0 flex-col border-l border-[var(--relay-line)] bg-[var(--relay-panel)] p-5 text-[12px] text-[var(--relay-text-tertiary)]">
            <span class={eyebrow}>Step properties</span>
            <strong class="mt-2 text-[14px] text-[var(--relay-text)]">
              Record your first action
            </strong>
            <p class="mt-1.5 max-w-[30ch] leading-[1.55]">
              Actions appear here as editable steps while you use the device.
            </p>
          </aside>
        }
      >
        <JourneyInspector
          compact
          onEdit={props.onOpenAdvanced}
          onOpenTargets={props.onOpenTargets}
        />
      </Show>
    </>
  );
}
