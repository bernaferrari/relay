import { createEffect, onCleanup, type Accessor } from "solid-js";
import type { AppMapRunReadiness } from "./app-map-run-readiness";
import type { WorkspaceController } from "./workspace-controller";

/** Keep shell-owned request handlers mutually exclusive with the active Map
 * workspace while leaving state notifications connected for the shell's
 * lifetime. */
export function useStudioWorkspaceController(input: {
  controller: WorkspaceController;
  ownsDevicePanel: Accessor<boolean>;
  ownsRecording: Accessor<boolean>;
  toggleDevice: () => void;
  showDevice: () => void;
  hideDevice: () => void;
  recordTest: () => void;
  deviceStateChanged: (open: boolean) => void;
  openRun: (runId?: string) => void;
  openChanges: () => void;
  runReadinessChanged: (readiness: AppMapRunReadiness) => void;
  mapTargetSetChanged: (targetSetId?: string) => void;
}): void {
  const disconnectNotifications = input.controller.connect({
    deviceStateChanged: input.deviceStateChanged,
    openRun: input.openRun,
    openChanges: input.openChanges,
    runReadinessChanged: input.runReadinessChanged,
    mapTargetSetChanged: input.mapTargetSetChanged,
  });
  onCleanup(disconnectNotifications);

  let disconnectRequests: (() => void) | undefined;
  createEffect(() => {
    disconnectRequests?.();
    disconnectRequests = input.controller.connect({
      ...(input.ownsDevicePanel()
        ? {
            toggleDevice: input.toggleDevice,
            showDevice: input.showDevice,
            hideDevice: input.hideDevice,
          }
        : {}),
      ...(input.ownsRecording() ? { recordTest: input.recordTest } : {}),
    });
  });
  onCleanup(() => disconnectRequests?.());
}
