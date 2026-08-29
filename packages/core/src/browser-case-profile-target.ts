import {
  compileBrowserEnvironment,
  type BrowserCaseProfile,
  type BrowserEnvironmentInput,
  type TargetDefinition,
} from "@relay/protocol";

/** Compile the exact browser environment represented by one saved target.
 * The richer environment viewport is authoritative over the legacy field. */
export function browserCaseProfileForTarget(target: TargetDefinition): BrowserCaseProfile {
  if (target.kind !== "browser" || !target.browser) {
    throw new Error(`managed browser target not found: ${target.id}`);
  }
  const configured: BrowserEnvironmentInput = target.browser.environment ?? {};
  const viewport = configured.viewport ?? target.browser.viewport;
  return compileBrowserEnvironment({
    ...configured,
    ...(viewport ? { viewport } : {}),
  });
}
