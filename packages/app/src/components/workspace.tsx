import { createEffect, createSignal, Show } from "solid-js";
import { OfflineGate } from "./offline-gate";
import { DeviceStage } from "./stage";
import { FrameCanvas } from "./frame-canvas";
import { StepsPane } from "./run-panel";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { borderSubtle, surfaceDeep, surfacePanel } from "../lib/ui";

/**
 * Dense instrument shell: dark artboard + dark steps column, full height.
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
      <div
        class={cn(
          "relative grid min-h-0 w-full min-w-0 flex-1 grid-rows-[minmax(0,1fr)]",
          surfaceDeep,
          noDevice()
            ? "grid-cols-[minmax(340px,42%)_minmax(0,1fr)]"
            : boardOpen()
              ? "grid-cols-[minmax(440px,52%)_minmax(0,1fr)]"
              : "grid-cols-[minmax(360px,44%)_minmax(0,1fr)]",
        )}
      >
        <div
          class={cn(
            "relative flex h-full min-h-0 min-w-0 flex-col border-r",
            borderSubtle,
            "bg-[radial-gradient(ellipse_70%_55%_at_50%_40%,color-mix(in_srgb,var(--color-accent)_12%,transparent),transparent_60%),#0a0b0f]",
          )}
        >
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
          class={cn("flex h-full min-h-0 min-w-0 flex-col overflow-hidden", surfacePanel)}
          aria-label="Test editor"
        >
          <StepsPane />
        </section>
      </div>
    </OfflineGate>
  );
}
