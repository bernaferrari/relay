import type { AppMapDeviceStatus } from "../components/device-status-label";

export function mappedCompanionStatus(input: {
  outsideMapApp: boolean;
  unmapped: boolean;
  mapName: string;
  panelStatus: AppMapDeviceStatus;
}): AppMapDeviceStatus {
  if (input.outsideMapApp) {
    return {
      label: "Outside this map",
      kind: "attention",
      detail: `Return to ${input.mapName} before capturing.`,
    };
  }
  if (input.unmapped && input.panelStatus.kind === "ready") {
    return {
      label: "Not saved to map",
      kind: "info",
      detail: `Choose Save first screen to add it to ${input.mapName}.`,
    };
  }
  return input.panelStatus;
}
