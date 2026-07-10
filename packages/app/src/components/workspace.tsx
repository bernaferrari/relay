import { createEffect, createSignal, Show } from "solid-js";
import { OfflineGate } from "./offline-gate";
import { DeviceStage } from "./stage";
import { FrameCanvas } from "./frame-canvas";
import { StepsPane } from "./run-panel";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { paper, surfaceDeep } from "../lib/ui";

/**
 * Split shell: phone artboard (left) · journey steps (right).
 * AgentBoard quiet denseness: deep plate + inset paper document
 * (border-t + left border + top-left radius on the join).
 */
export function Workspace() {
  const server = useServer();
  const [boardOpen, setBoardOpen] = createSignal(false);

  createEffect(() => {
    if (server.frames().length === 0) setBoardOpen(false);
  });

  const noDevice = () => server.isEmptyDevices() || server.health() !== "online";

  return (
    <OfflineGate overlay>
      <div class={cn("relative flex min-h-0 w-full min-w-0 flex-1 flex-col", surfaceDeep)}>
        <div
          class={cn(
            "relative grid min-h-0 w-full min-w-0 flex-1 grid-rows-[minmax(0,1fr)]",
            "border-t border-border-weak-base",
            "overflow-hidden rounded-tl-[12px]",
            noDevice()
              ? "grid-cols-[minmax(280px,36%)_minmax(0,1fr)]"
              : boardOpen()
                ? "grid-cols-[minmax(420px,50%)_minmax(0,1fr)]"
                : "grid-cols-[minmax(300px,39%)_minmax(0,1fr)]",
          )}
        >
          <div class={cn("relative flex h-full min-h-0 min-w-0 flex-col", surfaceDeep)}>
            <div class="flex h-full min-h-0 flex-1 flex-col">
              <Show
                when={boardOpen() && server.frames().length > 0}
                fallback={<DeviceStage onExpandBoard={() => setBoardOpen(true)} />}
              >
                <FrameCanvas onCollapse={() => setBoardOpen(false)} />
              </Show>
            </div>
          </div>
          <section
            class={cn(
              "flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
              "border-l border-border-weak-base",
              paper,
            )}
            aria-label="Test steps"
          >
            <StepsPane />
          </section>
        </div>
      </div>
    </OfflineGate>
  );
}
