import type { AppMapCompiledRuntimeTargetProfile, TargetProfile } from "@relay/protocol";
import {
  appMapRuntimeTargetProfileFromSaved,
  appMapRuntimeTargetProfileKey,
} from "./app-map-runtime-target-profile.js";
import { canonicalSha256 } from "./canonical-json.js";

type NativeTarget = { targetId: string; platform: "android" | "ios" };
type Viewport = { width: number; height: number };
export type NativeDeviceFacts = {
  serial: string;
  platform: string;
  osVersion?: string;
  avdName?: string;
  viewport?: Viewport;
};

const viewportFacts = new Map<string, { viewport: Viewport; at: number }>();
export const NATIVE_VIEWPORT_FACT_TTL_MS = 120_000;
const key = (target: NativeTarget) => `${target.platform}:${target.targetId}`;

function validViewport(viewport: Viewport | undefined): viewport is Viewport {
  return Boolean(
    viewport &&
    Number.isSafeInteger(viewport.width) &&
    viewport.width > 0 &&
    Number.isSafeInteger(viewport.height) &&
    viewport.height > 0,
  );
}

/** Retain full capture coordinates, never the dimensions of a scaled preview.
 * iOS callers must supply logical application bounds, rather than Retina pixels. */
export function recordNativeViewport(
  target: NativeTarget,
  viewport: Viewport,
  at = Date.now(),
): void {
  if (!validViewport(viewport) || !Number.isFinite(at)) return;
  const previous = viewportFacts.get(key(target));
  if (previous && previous.at > at) return;
  viewportFacts.set(key(target), { viewport: { ...viewport }, at });
}

/** Discovery reads existing pixel facts; this never starts a capture or AX query. */
export function nativeViewportForTarget(
  target: NativeTarget,
  at = Date.now(),
): Viewport | undefined {
  const fact = viewportFacts.get(key(target));
  if (!fact || at < fact.at || at - fact.at > NATIVE_VIEWPORT_FACT_TTL_MS) return undefined;
  return { ...fact.viewport };
}

/** One constructor for native map captures and recording observations. */
export function nativeCaptureTargetProfile(
  input: NativeTarget & {
    observedAt: number;
    viewport?: Viewport;
    name?: string;
    model?: string | null;
    osVersion?: string;
    androidAvdName?: string;
  },
): TargetProfile {
  const viewport = validViewport(input.viewport) ? { ...input.viewport } : undefined;
  const profile: TargetProfile = {
    id: `device:${input.targetId}${viewport ? `-${viewport.width}x${viewport.height}` : ""}`,
    targetId: input.targetId,
    source: "device",
    platform: input.platform,
    name: input.name?.trim() || input.targetId,
    ...(input.model ? { model: input.model } : {}),
    ...(input.osVersion ? { osVersion: input.osVersion } : {}),
    ...(input.androidAvdName ? { androidAvdName: input.androidAvdName } : {}),
    ...(viewport ? { viewport } : {}),
    capabilities: ["snapshot", "screenshot"],
    observedAt: input.observedAt,
  };
  profile.id = nativeCaptureTargetProfileId(profile);
  return profile;
}

function legacyNativeProfileId(profile: AppMapCompiledRuntimeTargetProfile): string {
  const viewport = profile.viewport;
  return `device:${profile.targetId}${viewport ? `-${viewport.width}x${viewport.height}` : ""}`;
}

function nativeRuntimeIdentity(profile: AppMapCompiledRuntimeTargetProfile) {
  return appMapRuntimeTargetProfileFromSaved({ ...profile, id: legacyNativeProfileId(profile) });
}

/** The digest excludes labels/time but includes every frozen runtime fact. */
export function nativeCaptureTargetProfileId(profile: AppMapCompiledRuntimeTargetProfile): string {
  return `${legacyNativeProfileId(profile)}-${canonicalSha256(nativeRuntimeIdentity(profile)).slice(7, 23)}`;
}

/** Recognize only constructor-owned namespaces; explicit custom identities stay intact. */
export function isNativeCaptureTargetProfile(profile: AppMapCompiledRuntimeTargetProfile): boolean {
  return (
    profile.platform !== "browser" &&
    [
      `device:${profile.targetId}`,
      legacyNativeProfileId(profile),
      nativeCaptureTargetProfileId(profile),
    ].includes(profile.id)
  );
}

export class NativeTargetProfileSelectionError extends Error {}

/** Select an existing frozen identity from independently observed native facts.
 * A missing legacy fact cannot beat a profile that proves that fact. Equally
 * matching identities remain a choice: labels, language and ID order give no
 * authority to merge their evidence or infer the current locale. Generic
 * adapter model values such as "device" are deliberately not matching facts. */
export function selectNativeTargetProfile(input: {
  target: NativeTarget;
  profiles: readonly AppMapCompiledRuntimeTargetProfile[];
  observed?: NativeDeviceFacts;
}): AppMapCompiledRuntimeTargetProfile | undefined {
  const candidates = [
    ...new Map(
      input.profiles
        .filter(
          (profile) =>
            profile.targetId === input.target.targetId &&
            profile.platform === input.target.platform,
        )
        .map((profile) => [appMapRuntimeTargetProfileKey(profile), profile]),
    ).values(),
  ];
  if (!candidates.length) return undefined;
  const observed = input.observed;
  if (
    observed &&
    (observed.serial !== input.target.targetId || observed.platform !== input.target.platform)
  )
    throw new NativeTargetProfileSelectionError("Observed device facts belong to another target.");
  if (candidates.length > 1 && !observed?.viewport)
    throw new NativeTargetProfileSelectionError(
      "The current device viewport is unavailable; choose a saved setup or refresh device discovery.",
    );
  for (const field of ["osVersion", "androidAvdName"] as const) {
    const values = new Set(
      candidates.flatMap((profile) => (profile[field] ? [profile[field]] : [])),
    );
    const actual = field === "osVersion" ? observed?.osVersion : observed?.avdName;
    if (values.size > 1 && !actual)
      throw new NativeTargetProfileSelectionError(
        `The current device ${field} is unavailable; saved setups conflict.`,
      );
  }
  const requiresOs = Boolean(
    observed?.osVersion && candidates.some((profile) => profile.osVersion),
  );
  const requiresAvd = Boolean(
    observed?.avdName && candidates.some((profile) => profile.androidAvdName),
  );
  const requiresViewport = Boolean(
    observed?.viewport && candidates.some((profile) => profile.viewport),
  );
  const matches = candidates.filter(
    (profile) =>
      (!requiresOs || profile.osVersion === observed?.osVersion) &&
      (!requiresAvd || profile.androidAvdName === observed?.avdName) &&
      (!requiresViewport ||
        Boolean(
          profile.viewport &&
          observed?.viewport &&
          profile.viewport.width === observed.viewport.width &&
          profile.viewport.height === observed.viewport.height,
        )),
  );
  // Prefer a cryptographically verified constructor identity over exact
  // legacy aliases. Never coalesce custom/locale identities or differing facts.
  const canonical = matches.find((profile) => profile.id === nativeCaptureTargetProfileId(profile));
  if (
    canonical &&
    matches.every(
      (profile) =>
        isNativeCaptureTargetProfile(profile) &&
        appMapRuntimeTargetProfileKey(nativeRuntimeIdentity(profile)) ===
          appMapRuntimeTargetProfileKey(nativeRuntimeIdentity(canonical)),
    )
  )
    return structuredClone(canonical);
  if (matches.length !== 1)
    throw new NativeTargetProfileSelectionError(
      matches.length
        ? "This device matches more than one saved setup for this Test."
        : "The device runtime no longer matches a saved setup for this Test.",
    );
  return structuredClone(matches[0]);
}
