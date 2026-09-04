export type RelayDesktopRenderer = "renderer" | "renderer-v2";

/**
 * Product V2 is the shipped renderer. The legacy renderer remains available
 * only as an explicit development rollback while the deletion gate runs.
 */
export function relayDesktopRenderer(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RelayDesktopRenderer {
  return environment.RELAY_UI_LEGACY === "1" ? "renderer" : "renderer-v2";
}
