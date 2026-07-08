import { OfflineGate } from "./offline-gate";
import { DeviceStage } from "./stage";
import { StepsPane } from "./run-panel";

/**
 * Workspace shell (plan 012) — two surfaces: device fixture left (~38%),
 * run report right (the rest). The report header's title is the recipe
 * switcher; the rail and its ⌘B collapse are gone.
 */
export function Workspace() {
  return (
    <OfflineGate overlay>
      <div class="shell">
        <DeviceStage />
        <section class="runpane" aria-label="Run pane">
          <StepsPane />
        </section>
      </div>
    </OfflineGate>
  );
}
