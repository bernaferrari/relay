import { Show } from "solid-js";
import type { AppMapAgentExploration } from "../lib/use-app-map-agent-exploration";
import { Button } from "@relay/ui/button";
import { AppMapAgentProgress } from "./app-map-agent-progress";
import { AppMapAgentSetup } from "./app-map-agent-setup";
import { Icon } from "./icon";

export function AppMapAgentPanel(props: {
  exploration: AppMapAgentExploration;
  onClose: () => void;
  onOpenTargets: () => void;
  onProposalReady: () => void;
}) {
  let panel: HTMLElement | undefined;
  const exploration = props.exploration;

  return (
    <aside
      ref={(element) => {
        panel = element;
        queueMicrotask(() => panel?.focus());
      }}
      class="ui-panel-in absolute top-3 right-3 bottom-3 z-40 flex w-[min(376px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl bg-[var(--background-base)] shadow-[var(--map-elevation-panel)]"
      aria-label="Map with AI"
      tabindex={-1}
      data-app-map-native-scroll
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        props.onClose();
      }}
    >
      <header class="flex min-h-[52px] shrink-0 items-center justify-between gap-3 border-b border-[var(--border-weak-base)] px-3.5">
        <div class="flex min-w-0 items-center gap-2.5">
          <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
            <Icon name="scan" size={13} />
          </span>
          <span class="min-w-0">
            <strong class="block truncate text-body font-semibold text-[var(--text-strong)]">
              Map with AI
            </strong>
            <small class="block truncate text-micro text-[var(--text-weak)]">
              Suggested screens come back for you to keep or discard
            </small>
          </span>
        </div>
        <button
          type="button"
          class="grid size-10 place-items-center rounded-xl text-[var(--text-base)] hover:bg-[var(--surface-base-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-interactive-base)]"
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
              onRetry={(workerId) => void exploration.retry(workerId)}
            />
          }
        >
          <AppMapAgentSetup
            goal={exploration.goal()}
            minutes={exploration.minutes()}
            strategy={exploration.strategy()}
            devices={exploration.devices()}
            targetIds={exploration.targetIds()}
            selectedTargetCount={exploration.targetCount()}
            modelIds={exploration.modelIds()}
            onOpenTargets={props.onOpenTargets}
            onGoal={exploration.setGoal}
            onMinutes={exploration.setMinutes}
            onStrategy={exploration.setStrategy}
            onTargetIds={exploration.setTargetIds}
            onModelIds={exploration.setModelIds}
          />
        </Show>
      </div>

      <footer class="flex min-h-16 shrink-0 items-center justify-between gap-2 border-t border-[var(--border-weak-base)] px-4">
        <Show
          when={
            exploration.state() === "idle" &&
            exploration.workers().length === 0 &&
            exploration.workerCount() > 1
          }
        >
          <span class="text-micro text-[var(--text-weak)] tabular-nums">
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
                <Show
                  when={exploration.targetCount() > 0}
                  fallback={
                    <Button variant="primary" size="lg" onClick={props.onOpenTargets}>
                      <Icon name="smartphone" size={13} /> Choose a device
                    </Button>
                  }
                >
                  <Button
                    variant="primary"
                    size="lg"
                    disabled={!exploration.goal().trim() || exploration.workerCount() === 0}
                    onClick={() => void exploration.start()}
                  >
                    <Icon name="play" size={13} />
                    {exploration.workerCount() > 1
                      ? `Explore with ${exploration.workerCount()} agents`
                      : "Start exploring"}
                  </Button>
                </Show>
              }
            >
              <Button variant="primary" size="lg" onClick={props.onProposalReady}>
                <Icon name="check" size={13} /> Review {exploration.proposalCount()} proposal
                {exploration.proposalCount() === 1 ? "" : "s"}
              </Button>
            </Show>
          }
        >
          <Button
            variant="secondary"
            size="lg"
            disabled={exploration.state() === "stopping"}
            onClick={() => void exploration.stop()}
          >
            <Icon name="square" size={12} />
            {exploration.state() === "stopping" ? "Stopping…" : "Stop"}
          </Button>
        </Show>
      </footer>
    </aside>
  );
}
