import { createEffect, createSignal, Show } from "solid-js";
import { OfflineGate } from "./offline-gate";
import { DeviceStage } from "./stage";
import { FrameCanvas } from "./frame-canvas";
import { StepsPane } from "./run-panel";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";

/**
 * Figma-style workbench:
 *   left  = the artboard (phone) — freeform board only when expanded with frames
 *   right = the structure (steps)
 *
 * No peer Device/Canvas tabs. Empty canvas is not a destination.
 */
export function Workspace() {
  const server = useServer();
  const [boardOpen, setBoardOpen] = createSignal(false);

  // Collapse board when captures disappear.
  createEffect(() => {
    if (server.frames().length === 0) setBoardOpen(false);
  });

  const noDevice = () => server.isEmptyDevices() || server.health() !== "online";

  return (
    <OfflineGate overlay>
      <div
        class={cn(
          "relative grid min-h-0 flex-1 bg-deep transition-[grid-template-columns] duration-200",
          noDevice()
            ? "grid-cols-[minmax(320px,40%)_minmax(0,1fr)]"
            : boardOpen()
              ? "grid-cols-[minmax(440px,54%)_minmax(0,1fr)]"
              : "grid-cols-[minmax(380px,46%)_minmax(0,1fr)]",
        )}
      >
        {/* Left: phone artboard / frame canvas */}
        <div class="flex min-h-0 min-w-0 flex-col border-r border-border bg-deep">
          <div class="flex min-h-0 flex-1 flex-col">
            <Show
              when={boardOpen() && server.frames().length > 0}
              fallback={<DeviceStage onExpandBoard={() => setBoardOpen(true)} />}
            >
              <FrameCanvas onCollapse={() => setBoardOpen(false)} />
            </Show>
          </div>
        </div>
        {/* Right: steps / test editor */}
        <section class="flex min-h-0 flex-col bg-layer-1" aria-label="Test editor">
          <StepsPane />
        </section>
      </div>
    </OfflineGate>
  );
}
