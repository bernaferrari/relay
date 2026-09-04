/**
 * Return the renderer build configs in packaging order.
 *
 * Product V2 is the only renderer shipped by default. The legacy Solid
 * renderer is intentionally opt-in so a stale `out/renderer` directory or a
 * routine desktop build cannot quietly reintroduce the retired shell.
 */
export function desktopRendererBuildConfigs(environment = process.env) {
  return environment.RELAY_BUILD_LEGACY === "1"
    ? ["vite.v2.config.ts", "vite.config.ts"]
    : ["vite.v2.config.ts"];
}
