import { Show } from "solid-js";
import type { AppMap } from "@relay/protocol";
import { useAppMapAgentExploration } from "../lib/use-app-map-agent-exploration";
import { productPrimary, productSecondary } from "../lib/ui";
import { AppMapAgentProgress } from "./app-map-agent-progress";
import { AppMapAgentSetup } from "./app-map-agent-setup";
import { Icon } from "./icon";

export function AppMapAgentPanel(props: {
  appMap: AppMap;
  onClose: () => void;
  onProposalReady: () => void;
}) {
  const exploration = useAppMapAgentExploration(() => props.appMap);

  return (
    <aside
      class="ui-panel-in absolute top-3 right-3 bottom-3 z-40 flex w-[min(420px,calc(100%-24px))] flex-col overflow-hidden rounded-[16px] bg-[var(--v2-background-bg-base)] shadow-[0_0_0_1px_var(--v2-border-border-strong),0_22px_70px_rgb(0_0_0/24%)]"
      aria-label="Explore App Map with Relay"
    >
      <header class="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--v2-border-border-muted)] px-4">
        <div class="flex min-w-0 items-center gap-2.5">
          <span class="grid size-8 shrink-0 place-items-center rounded-[9px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
            <Icon name="scan" size={15} />
          </span>
          <span class="min-w-0">
            <strong class="block truncate text-[13px] font-semibold text-[var(--text-strong)]">
              Explore with Relay
            </strong>
            <small class="block truncate text-[10px] text-[var(--text-weak)]">
              Parallel, attributable, and always reviewable
            </small>
          </span>
        </div>
        <button
          type="button"
          class="grid size-10 place-items-center rounded-[9px] text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-interactive-base)]"
          aria-label="Close exploration panel"
          onClick={props.onClose}
        >
          <Icon name="x" size={14} />
        </button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <Show
          when={exploration.state() === "idle" && exploration.workers().length === 0}
          fallback={
            <AppMapAgentProgress
              state={exploration.state()}
              stage={exploration.stage()}
              workers={exploration.workers()}
            />
          }
        >
          <AppMapAgentSetup
            goal={exploration.goal()}
            minutes={exploration.minutes()}
            devices={exploration.devices()}
            targetIds={exploration.targetIds()}
            modelIds={exploration.modelIds()}
            onGoal={exploration.setGoal}
            onMinutes={exploration.setMinutes}
            onTargetIds={exploration.setTargetIds}
            onModelIds={exploration.setModelIds}
          />
        </Show>
      </div>

      <footer class="flex min-h-[68px] shrink-0 items-center justify-between gap-2 border-t border-[var(--v2-border-border-muted)] px-4">
        <Show when={exploration.state() === "idle" && exploration.workers().length === 0}>
          <span class="text-[10px] text-[var(--text-weak)] tabular-nums">
            {exploration.workerCount()} agent{exploration.workerCount() === 1 ? "" : "s"}
          </span>
        </Show>
        <span class="flex-1" />
        <Show
          when={exploration.state() === "running" || exploration.state() === "stopping"}
          fallback={
            <Show
              when={exploration.proposalCount() > 0}
              fallback={
                <button
                  type="button"
                  class={productPrimary}
                  disabled={!exploration.goal().trim() || exploration.workerCount() === 0}
                  onClick={() => void exploration.start()}
                >
                  <Icon name="play" size={13} />
                  {exploration.workerCount() > 1
                    ? `Explore with ${exploration.workerCount()} agents`
                    : "Start exploring"}
                </button>
              }
            >
              <button type="button" class={productPrimary} onClick={props.onProposalReady}>
                <Icon name="check" size={13} /> Review {exploration.proposalCount()} proposal
                {exploration.proposalCount() === 1 ? "" : "s"}
              </button>
            </Show>
          }
        >
          <button
            type="button"
            class={productSecondary}
            disabled={exploration.state() === "stopping"}
            onClick={() => void exploration.stop()}
          >
            <Icon name="square" size={12} />
            {exploration.state() === "stopping" ? "Stopping…" : "Stop"}
          </button>
        </Show>
      </footer>
    </aside>
  );
}
