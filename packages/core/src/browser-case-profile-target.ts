import {
  compileBrowserEnvironment,
  type BrowserCaseProfile,
  type BrowserEnvironmentInput,
  type TargetDefinition,
  type TargetProfile,
} from "@relay/protocol";
import { BROWSER_TARGET_CAPABILITIES } from "./targets.js";

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

/** Observed and recorded browser profiles share this identity. A missing
 * `browserCaseProfile` cannot be inferred later without silently retargeting. */
export function managedBrowserTargetProfile(
  target: TargetDefinition,
  observedAt: number,
): TargetProfile {
  const browserCaseProfile = browserCaseProfileForTarget(target);
  return {
    id: `browser:${target.id}`,
    targetId: target.id,
    source: "browser",
    platform: "browser",
    name: target.name,
    viewport: { ...browserCaseProfile.viewport },
    browserCaseProfile,
    capabilities: [...BROWSER_TARGET_CAPABILITIES],
    observedAt,
  };
}
