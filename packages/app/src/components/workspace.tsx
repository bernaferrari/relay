import { OfflineGate } from "./offline-gate";
import { DeviceStage } from "./stage";
import { StepsPane } from "./run-panel";
import { Sidebar } from "./sidebar";
import { useServer } from "../context/server";

/**
 * Workspace shell — one composition (plan 009):
 *   rail (232px, always visible, ⌘B collapses to 0) · stage (1fr) · run pane (340–400px).
 * The deck/classic experiment, drawer, and tabbed panel are gone.
 */
export function Workspace() {
  const server = useServer();

  return (
    <OfflineGate overlay>
      <div class="shell" classList={{ "shell--rail-collapsed": server.railCollapsed() }}>
        <Sidebar />
        <DeviceStage />
        <section class="runpane" aria-label="Run pane">
          <StepsPane />
        </section>
      </div>
    </OfflineGate>
  );
}
