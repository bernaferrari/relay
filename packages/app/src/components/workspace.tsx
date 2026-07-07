import { Show, createEffect, onCleanup, onMount } from "solid-js";
import { DeviceStage } from "./stage";
import { RunPanel } from "./run-panel";
import { StepsPane } from "./run-panel";
import { Sidebar } from "./sidebar";
import { OfflineGate } from "./offline-gate";
import { useServer } from "../context/server";
import { useCommand } from "../context/command";

/**
 * Workspace shell. Branches on the layout preference (plan 008):
 *  - **deck** (default): stage + steps pane, sidebar as a ⌘B slide-in drawer.
 *  - **classic**: the original 3-column grid (sidebar · stage · tabbed panel).
 */
export function Workspace() {
  const server = useServer();
  const cmd = useCommand();
  let drawerRef: HTMLDivElement | undefined;

  // ── Drawer auto-behavior (deck mode only, plan 008 step 3) ──────────────
  // Open on first load when no recipe is selected (discoverability).
  onMount(() => {
    if (server.layout() === "deck" && !server.selectedRecipeId()) {
      server.setDrawerOpen(true);
    }
  });

  // Auto-close when a run starts (running() rising edge).
  let wasRunning = false;
  createEffect(() => {
    const running = server.running();
    if (running && !wasRunning && server.layout() === "deck") {
      server.setDrawerOpen(false);
    }
    wasRunning = running;
  });

  // Register with the modal registry while the drawer is open so global
  // keybinds (escape → cancel, space → pause) defer to it. Plan 007's registry.
  createEffect(() => {
    if (!server.drawerOpen()) return;
    const dispose = cmd.pushModal();
    onCleanup(dispose);
  });

  const closeDrawer = () => {
    if (server.layout() === "deck") server.setDrawerOpen(false);
  };

  return (
    <div class="workspace">
      <OfflineGate overlay>
        <Show
          when={server.layout() === "deck"}
          fallback={
            <div
              class="workspace__main"
              classList={{ "workspace__main--no-sidebar": !server.drawerOpen() }}
            >
              <Show when={server.drawerOpen()}>
                <Sidebar />
              </Show>
              <DeviceStage />
              <RunPanel />
            </div>
          }
        >
          <div class="deck">
            <DeviceStage />
            <section class="deck__steps">
              <StepsPane />
            </section>
            <Show when={server.drawerOpen()}>
              <div class="drawer-scrim" onClick={closeDrawer} />
              <aside
                ref={drawerRef}
                class="drawer"
                aria-label="Recipes and history"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    closeDrawer();
                  }
                }}
              >
                <Sidebar />
              </aside>
            </Show>
          </div>
        </Show>
      </OfflineGate>
    </div>
  );
}
