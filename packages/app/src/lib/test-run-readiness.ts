export type TestRunReadiness = {
  health: string;
  selectedDevice: string | null;
  devices: readonly { serial: string; booted?: boolean | null }[];
  stepCount: number;
  invalidCount: number;
};

/** One source of truth for every Run button in the Tests workspace. */
export function testRunBlocker(state: TestRunReadiness): string {
  if (state.health !== "online") return "Start the Relay server before running this journey.";
  if (!state.selectedDevice) return "Choose a device before running this journey.";
  const target = state.devices.find((device) => device.serial === state.selectedDevice);
  if (!target || target.booted === false) return "Start the selected device, or choose another.";
  if (state.stepCount === 0) return "Add at least one action before running this journey.";
  if (state.invalidCount > 0) {
    return `Complete ${state.invalidCount} unfinished step${state.invalidCount === 1 ? "" : "s"}.`;
  }
  return "";
}

/** True when the blocker is about the device rather than the test content. */
export function blockerIsDeviceRelated(state: TestRunReadiness): boolean {
  if (state.health !== "online") return false;
  if (!state.selectedDevice) return true;
  const target = state.devices.find((device) => device.serial === state.selectedDevice);
  return !target || target.booted === false;
}
