export function nextMapTitle(maps: Array<{ name: string }>): string {
  const used = new Set(maps.map((map) => map.name));
  if (!used.has("My map")) return "My map";
  let index = 2;
  while (used.has(`My map ${index}`)) index++;
  return `My map ${index}`;
}

export function readRememberedDevicePanelPreference(): boolean {
  try {
    return localStorage.getItem("relay:device-panel-open") !== "false";
  } catch {
    return true;
  }
}

const selectedTestKey = (appMapId: string) => `relay:selected-test:v1:${appMapId}`;

/** Keep each map's last open Test stable across workspace changes and renderer reloads. */
export function readRememberedTestSelection(appMapId: string): string | undefined {
  try {
    return localStorage.getItem(selectedTestKey(appMapId))?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function rememberTestSelection(appMapId: string, testId: string): void {
  try {
    localStorage.setItem(selectedTestKey(appMapId), testId);
  } catch {
    // Selection remains valid for this renderer session when storage is unavailable.
  }
}
