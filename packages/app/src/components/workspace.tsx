import { DeviceStage } from "./stage";
import { RunPanel } from "./run-panel";

/** qa-viewer Stage layout: device hero left, run panel right. */
export function Workspace() {
  return (
    <div class="workspace">
      <DeviceStage />
      <RunPanel />
    </div>
  );
}
