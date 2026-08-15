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
