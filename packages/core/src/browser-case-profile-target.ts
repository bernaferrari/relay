import {
  compileBrowserEnvironment,
  type BrowserCaseProfile,
  type BrowserEnvironmentInput,
  type TargetDefinition,
  type TargetProfile,
} from "@relay/protocol";
import { BROWSER_TARGET_CAPABILITIES } from "./targets.js";
import { unrecordedNativeRuntimeProfileIdIfMissing } from "./app-map-unrecorded-runtime-profile.js";

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

/** Canonical unsigned managed-browser profile id. Viewport-suffixed unique
 * profiles must not steal this identity. */
export function managedBrowserTargetProfileId(targetId: string): string {
  return `browser:${targetId}`;
}

/** Prefer the unsigned managed profile when several saved ids bind one browser. */
export function canonicalUnsignedBrowserRuntimeProfileId(
  targetId: string,
  savedIds: readonly string[],
): string | undefined {
  const canonical = managedBrowserTargetProfileId(targetId);
  return savedIds.includes(canonical) ? canonical : undefined;
}

/** Inherit one saved runtime profile, or stay unbound when the choice is
 * ambiguous. Logged-out grok.com uses `browser:grok-com`, never the unique
 * signed-in viewport profile. */
export function inheritSavedRuntimeProfileId(input: {
  savedIds: readonly string[];
  platform: string;
  targetId: string;
  explicitProfileId?: string;
}): string | undefined {
  const explicit = input.explicitProfileId?.trim();
  if (explicit) return explicit;
  if (input.savedIds.length === 1) return input.savedIds[0];
  return (
    unrecordedNativeRuntimeProfileIdIfMissing(input) ??
    canonicalUnsignedBrowserRuntimeProfileId(input.targetId, input.savedIds)
  );
}

/** Observed and recorded browser profiles share this identity. A missing
 * `browserCaseProfile` cannot be inferred later without silently retargeting. */
export function managedBrowserTargetProfile(
  target: TargetDefinition,
  observedAt: number,
): TargetProfile {
  const browserCaseProfile = browserCaseProfileForTarget(target);
  return {
    id: managedBrowserTargetProfileId(target.id),
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
