import { DeviceStage } from "./stage";
import { RunPanel } from "./run-panel";
import { Sidebar } from "./sidebar";
import { OfflineGate } from "./offline-gate";

/** OpenCode-inspired: sidebar (recipes/history) · stage (device) · detail panel. */
export function Workspace() {
  return (
    <div class="workspace">
      <OfflineGate overlay>
        <div class="workspace__main">
          <Sidebar />
          <DeviceStage />
          <RunPanel />
        </div>
      </OfflineGate>
    </div>
  );
}
