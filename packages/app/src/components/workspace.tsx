import { DeviceStage } from "./stage";
import { RunPanel } from "./run-panel";
import { OfflineGate } from "./offline-gate";

/** qa-viewer Stage layout: device hero left, run panel right. */
export function Workspace() {
  return (
    <div class="workspace">
      <OfflineGate overlay>
        <div class="workspace__main">
          <DeviceStage />
          <RunPanel />
        </div>
      </OfflineGate>
    </div>
  );
}
