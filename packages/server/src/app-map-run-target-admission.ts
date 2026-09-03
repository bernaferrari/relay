import { appMapRuntimeTargetProfileKey } from "@relay/core";
import type { AppMapCompiledRuntimeTargetProfile, OperationInput } from "@relay/protocol";
import { HttpError } from "./http.js";

type ObservedTarget = {
  serial: string;
  connectionState?: string;
  booted?: boolean | null;
  developerMode?: "enabled" | "disabled";
  developerServicesAvailable?: boolean;
};

export function assertReviewedBrowserTargetProfile(input: {
  targetId: string;
  targetSurface: {
    platform: "android" | "browser" | "ios";
    browserEngine?: string;
    viewport?: { width: number; height: number };
    targetProfileId: string;
  };
  observedBrowser:
    | {
        engine: string;
        viewport: { width: number; height: number };
      }
    | undefined;
  routeVariantId?: string;
}): void {
  const { targetId, targetSurface, observedBrowser } = input;
  if (targetSurface.platform !== "browser") return;
  if (
    !observedBrowser ||
    observedBrowser.engine !== targetSurface.browserEngine ||
    (targetSurface.viewport !== undefined &&
      (observedBrowser.viewport.width !== targetSurface.viewport.width ||
        observedBrowser.viewport.height !== targetSurface.viewport.height))
  ) {
    throw new HttpError(
      409,
      `Managed browser target ${targetId} no longer matches reviewed route ${input.routeVariantId ?? "surface"}`,
      {
        code: "TARGET_PROFILE_TARGET_MISMATCH",
        targetProfileId: targetSurface.targetProfileId,
        recovery:
          "Restore the reviewed browser engine and viewport, or review a new route variant before running this Test.",
      },
    );
  }
}

export function frozenEvidenceTargetProfileForTarget(input: {
  target: Pick<OperationInput<"app-map.test.run">["target"], "targetId" | "platform">;
  profiles: AppMapCompiledRuntimeTargetProfile[] | undefined;
}): AppMapCompiledRuntimeTargetProfile | undefined {
  const profiles = [
    ...new Map(
      (input.profiles ?? []).map((profile) => [appMapRuntimeTargetProfileKey(profile), profile]),
    ).values(),
  ];
  if (!profiles.length) return undefined;
  const matching = profiles.filter(
    (profile) =>
      profile.targetId === input.target.targetId && profile.platform === input.target.platform,
  );
  if (matching.length === 1) {
    const selected = matching[0]!;
    if (selected.platform === "browser" && !selected.browserCaseProfile) {
      throw new HttpError(
        409,
        `Saved runtime profile ${selected.id} has no frozen browser environment`,
        {
          code: "FROZEN_BROWSER_PROFILE_REQUIRED",
          targetProfileId: selected.id,
          recovery:
            "Recapture this browser target profile and compile the Test again before controlling the browser.",
        },
      );
    }
    return structuredClone(selected);
  }
  const savedTargets = [
    ...new Set(profiles.map((profile) => `${profile.platform}:${profile.targetId}`)),
  ]
    .sort()
    .join(", ");
  if (matching.length > 1) {
    throw new HttpError(
      409,
      `Choose one frozen evidence profile for ${input.target.platform}:${input.target.targetId}`,
      {
        code: "TARGET_PROFILE_SELECTION_REQUIRED",
        target: input.target,
        targetProfileCandidates: matching.map((profile) => structuredClone(profile)),
        recovery: `Bind an explicit saved targetProfileId for ${input.target.platform}:${input.target.targetId}: ${[...new Set(matching.map((profile) => profile.id))].join(", ")}.`,
      },
    );
  }
  throw new HttpError(
    409,
    `No frozen evidence profile binds to ${input.target.platform}:${input.target.targetId}`,
    {
      code: "TARGET_PROFILE_TARGET_MISMATCH",
      target: input.target,
      savedTargets,
      recovery: `No saved runtime profile for target ${input.target.platform}:${input.target.targetId} — capture a screen on this target first.`,
    },
  );
}

/**
 * Return the actionable state for an explicit device serial. This helper is
 * called only after discovery has completed successfully. An empty inventory
 * therefore means that there is no local device to run against; remote/test
 * targets remain supported through an explicit active lease, which is checked
 * by the route before this helper is used.
 */
export function explicitTargetAvailability(
  serial: string,
  devices: ObservedTarget[],
): "connected" | "not-ready" | "missing" {
  if (devices.length === 0) return "missing";
  const device = devices.find((candidate) => candidate.serial === serial);
  if (!device) return "missing";
  if (device.connectionState === "offline" || device.connectionState === "unauthorized") {
    return "not-ready";
  }
  if (device.booted === false) return "not-ready";
  if (device.developerMode === "disabled" || device.developerServicesAvailable === false) {
    return "not-ready";
  }
  return "connected";
}

/** An offline-preflight failure must say which saved profile was bound or
 * inherited, or name the exact ids that could be bound, or the capture step
 * when this target has no saved profile at all. */
export function offlinePreflightProfileRecovery(input: {
  runtimeTargetProfile: AppMapCompiledRuntimeTargetProfile | undefined;
  explicit: boolean;
  candidates: string[];
  target: { targetId: string; platform: string };
}): string {
  const label = `${input.target.platform}:${input.target.targetId}`;
  if (input.runtimeTargetProfile) {
    return input.explicit
      ? "Review the frozen evidence findings, select or recapture the required profile, then retry this exact Test revision."
      : `Relay inherited the only saved runtime profile for ${label}: ${input.runtimeTargetProfile.id}. Review its frozen evidence findings, then retry this exact Test revision.`;
  }
  return input.candidates.length
    ? `Bind an explicit saved targetProfileId for ${label}: ${input.candidates.join(", ")}, then retry this exact Test revision.`
    : `No saved runtime profile for target ${label} — capture a screen on this target first.`;
}
