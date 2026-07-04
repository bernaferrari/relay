import { DeviceList } from "../components/device-list";
import { ActionList } from "../components/action-list";
import { RunLog } from "../components/run-log";

export function HomePage() {
  return (
    <main class="app-main">
      <DeviceList />
      <ActionList />
      <RunLog />
    </main>
  );
}
