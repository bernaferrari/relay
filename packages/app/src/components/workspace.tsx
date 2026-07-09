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
          "shell-grid stage-well",
          noDevice() && "shell-grid--no-device",
          !noDevice() && boardOpen() && "shell-grid--board",
        )}
      >
        {/* Left: phone artboard / frame canvas */}
        <div class="shell-artboard stage-well">
          <div class="shell-artboard-body">
            <Show
              when={boardOpen() && server.frames().length > 0}
              fallback={<DeviceStage onExpandBoard={() => setBoardOpen(true)} />}
            >
              <FrameCanvas onCollapse={() => setBoardOpen(false)} />
            </Show>
          </div>
        </div>
        {/* Right: steps / test editor */}
        <section class="shell-runpane" aria-label="Test editor">
          <StepsPane />
        </section>
      </div>
    </OfflineGate>
  );
}
