export type TestRunReadiness = {
  health: string;
  selectedDevice: string | null;
  devices: readonly { serial: string; booted?: boolean | null }[];
  stepCount: number;
  invalidCount: number;
};

/** One source of truth for every Run button in the Tests workspace. */
export function testRunBlocker(state: TestRunReadiness): string {
  if (state.health !== "online") return "Start the Relay server before running this test.";
  if (!state.selectedDevice) return "Choose a target before running this test.";
  const target = state.devices.find((device) => device.serial === state.selectedDevice);
  if (!target || target.booted === false) return "Start this target or choose another one.";
  if (state.stepCount === 0) return "Add at least one step before running this test.";
  if (state.invalidCount > 0) {
    return `Complete ${state.invalidCount} unfinished step${state.invalidCount === 1 ? "" : "s"}.`;
  }
  return "";
}
