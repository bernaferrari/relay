import { createEffect, createSignal, Show } from "solid-js";
import { OfflineGate } from "./offline-gate";
import { DeviceStage } from "./stage";
import { FrameCanvas } from "./frame-canvas";
import { StepsPane } from "./run-panel";
import { useServer } from "../context/server";

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

  return (
    <OfflineGate overlay>
      <div
        class="shell"
        classList={{
          "shell--no-device": server.isEmptyDevices() || server.health() !== "online",
          "shell--board": boardOpen(),
        }}
      >
        <div class="shell__left">
          <div class="shell__left-body">
            <Show
              when={boardOpen() && server.frames().length > 0}
              fallback={<DeviceStage onExpandBoard={() => setBoardOpen(true)} />}
            >
              <FrameCanvas onCollapse={() => setBoardOpen(false)} />
            </Show>
          </div>
        </div>
        <section class="runpane" aria-label="Test editor">
          <StepsPane />
        </section>
      </div>
    </OfflineGate>
  );
}
